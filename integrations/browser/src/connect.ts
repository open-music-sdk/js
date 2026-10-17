// Sign-in for a Music User Token: Apple's own script, loaded from Apple's CDN when a page asks for it, configured
// with the page's developer token, and asked to authorize inside the listener's click. The SDK issues no token and
// runs no sign-in of its own, and this helper stores nothing: Apple's script keeps a copy of the token of its own,
// which the docs' security model describes.
import { AppleMusicError, got, has, optionsOf, ownOf, parseToken, type tTokenProvider } from "@open-music-sdk/core";

/** Apple's script, as the helper uses it: the global it defines, `MusicKit`. */
export interface tMusicKit {
  /**
   * Apple's own: configures the script for one app, with the developer token its requests carry. Called once per
   * page by the first helper, and again after a configuration that failed.
   *
   * @param options - The developer token, and the app as the script is told of it.
   * @returns The configured instance, or a promise of it, as the script's version gives it.
   * @throws Whatever Apple's script throws or rejects with when it refuses the token or the app; the helper hands
   * it on as it came, through `ready` and `connect()`.
   */
  configure(options: { readonly developerToken: string; readonly app: tConnectApp }): tMusicKitInstance | Promise<tMusicKitInstance>;
}

/** What `configure` gives, as the helper uses it. */
export interface tMusicKitInstance {
  /** The listener's token, when the script holds one: restored for a returning listener, or given by `authorize()`. */
  readonly musicUserToken?: string | null | undefined;
  /** The developer token the instance was configured with. Whether a configured instance takes a new one is a live check; the helper sets it where it can. */
  developerToken?: string | undefined;
  /**
   * Apple's own: opens the sign-in window.
   *
   * @returns The Music User Token, or nothing when the listener declined.
   * @throws Whatever Apple's script rejects with when the window cannot be opened or the sign-in fails; the helper
   * hands it on as it came.
   */
  authorize(): Promise<string | null | undefined>;
  /** Apple's own sign-out, where the instance has one: ends the sign-in in the script, and the copy of the token it kept. */
  unauthorize?: (() => unknown) | undefined;
}

/**
 * The app as Apple's script is configured with it. Its sign-in window does not show this name: the script (v3) names
 * the app to the window by the page's host, `window.location.host`, and takes the icon it shows from the page's
 * `<link rel="apple-music-app-icon">`, a 120x120 one first, else an `apple-touch-icon`.
 */
export interface tConnectApp {
  /** The app's name, as the script is configured with it: a string with something in it. */
  readonly name: string;
  /** The app's version, where the script is to be told one. */
  readonly build?: string | undefined;
}

/** Invalid values throw a TypeError when the helper is made. */
export interface tConnectOptions {
  /** The app, as Apple's script is configured with it; its sign-in window names the app by the page's host. */
  readonly app: tConnectApp;
  /**
   * The page's own `MusicKit`, when it loaded Apple's script itself, under a CSP nonce or Trusted Types. Default:
   * loaded from Apple's CDN, once per page however many helpers are made.
   */
  readonly musicKit?: tMusicKit | undefined;
}

/** The helper. Its functions need no `this`, so each can be handed on by itself. */
export interface tConnect {
  /**
   * Settles once Apple's script is loaded and configured: with the token the script restored for a returning
   * listener, or with `undefined`. Rejects with an `AppleMusicError` tagged `NetworkError` when the script cannot be
   * loaded, with what the developer-token provider rejects with, `DeveloperTokenUnavailable` for the client's own,
   * when the token cannot be fetched, and with what Apple's `configure` throws, as it came.
   */
  readonly ready: Promise<string | undefined>;
  /**
   * Opens Apple's sign-in window, to be called inside the listener's click, and resolves to the Music User Token,
   * or to `undefined` when the script answers with nothing, which is taken for a decline. Waits on nothing but
   * `ready`, which is settled by the time there is a button to click. After a `ready` that failed, the script is
   * loaded and configured afresh, so a page whose endpoint was down when it loaded can still sign in; what that
   * fails with, it rejects with, as `ready` would. What the script's `authorize()` throws is handed on as it came.
   * Called after `dispose()` it is a `TypeError`.
   */
  readonly connect: () => Promise<string | undefined>;
  /**
   * Apple's own sign-out, through the script's `unauthorize()`: ends the sign-in in the script and the copy of the
   * token it kept, so that a later page load does not restore it. Whether it also ends the token at Apple, and with
   * it a copy your server stored, is a live check. Does nothing where the script has no such function, or where the
   * page holds no configuration. Rejects with what the configuration failed with, or what `unauthorize()` throws,
   * as it came. Called after `dispose()` it is a `TypeError`.
   */
  readonly disconnect: () => Promise<void>;
  /** Stops keeping the developer token fresh. The script stays: it is the page's. */
  readonly dispose: () => void;
}

/** The page, as the helper uses it: where the script goes, and the events it listens to. A `Document` fits. */
interface tPage {
  createElement(tag: "script"): tScript;
  readonly head: { appendChild(node: tScript): unknown };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  readonly visibilityState?: string | undefined;
}

interface tScript {
  src: string;
  async: boolean;
  addEventListener(type: string, listener: () => void): void;
  remove(): void;
}

/** What one page holds of Apple's script: one load, and one configuration, shared by every helper made on it. */
interface tPageState {
  loading?: Promise<tMusicKit> | undefined;
  configured?: { readonly app: string; readonly token: { current: string }; readonly instance: Promise<tMusicKitInstance> } | undefined;
}

/**
 * Where Apple serves its MusicKit on the Web script, for your content security policy's `script-src`. It is one URL
 * with no version in it, and the script cannot be pinned, bundled or re-hosted: Apple serves no other, and its
 * licence forbids the rest.
 */
export const MUSICKIT_SCRIPT = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
/** The timer waits at most this long, and asks again when it fires: a longer wait is kept as several. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** The least the helper waits between two askings of the provider, however near the token's end. */
const MIN_WAIT_MS = 60_000;
/** How long to wait when the token says nothing of its end. */
const FALLBACK_WAIT_MS = 600_000;
const WHAT = "an options object with app";

const pages = new WeakMap<object, tPageState>();

/** The state of a page, with nothing to inherit from: a `configured` put on Object.prototype by other code is not the page's. */
const pageState = (): tPageState => Object.create(null) as tPageState;

/** `exp` of a JWT in epoch milliseconds, or undefined when `token` is no JWT that carries one. */
function expiryOf(token: string): number | undefined {
  const payload = /^[\w-]+\.([\w-]+)\.[\w-]+$/.exec(token)?.[1];
  if (payload === undefined) return undefined;
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    const exp = typeof claims === "object" && claims !== null && "exp" in claims ? claims.exp : undefined;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** The global Apple's script defines once it has run. */
const musicKitOf = (): tMusicKit | undefined => Reflect.get(globalThis, "MusicKit") as tMusicKit | undefined;

/**
 * Apple's script, loaded once for this page: the one `<script>` goes in on the first helper, and every helper after
 * waits on the same load. A load that fails is let go of, with its element, so the next helper tries again.
 */
function loaded(page: tPage, state: tPageState): Promise<tMusicKit> {
  state.loading ??= new Promise<tMusicKit>((resolve, reject) => {
    // The page's own, when it is Apple's script and not an element that happens to carry the name: an `<a id="MusicKit">`
    // in content the page shows is found under that name too, and is not asked to configure anything.
    const found = musicKitOf();
    if (found !== undefined && has(found, ["configure"])) {
      resolve(found);
      return;
    }
    const script = page.createElement("script");
    script.src = MUSICKIT_SCRIPT;
    script.async = true;
    const done = () => {
      page.removeEventListener("musickitloaded", done);
      const kit = musicKitOf();
      if (kit === undefined) reject(new AppleMusicError("NetworkError", "Apple's MusicKit script ran but defined no MusicKit"));
      else resolve(kit);
    };
    page.addEventListener("musickitloaded", done);
    script.addEventListener("error", () => {
      page.removeEventListener("musickitloaded", done);
      script.remove();
      reject(new AppleMusicError("NetworkError", `Apple's MusicKit script could not be loaded from ${MUSICKIT_SCRIPT}`));
    });
    page.head.appendChild(script);
  });
  const attempt = state.loading;
  attempt.catch(() => {
    // Nothing replaces a load while it is pending, so the one that failed is still the page's.
    state.loading = undefined;
  });
  return attempt;
}

/** The app as the window will show it, checked: a name with something in it, and a build that is a string where it is given. */
function appOf(app: unknown): tConnectApp {
  if (typeof app !== "object" || app === null) throw new TypeError(`createConnect: app must be an object with the app's name, such as { name: "Crate Digger" }; got ${got(app)}`);
  const { name, build } = ownOf(app as { readonly name?: unknown; readonly build?: unknown });
  if (typeof name !== "string" || name === "") throw new TypeError(`createConnect: app.name must be a string with something in it; got ${got(name)}`);
  if (build !== undefined && typeof build !== "string") throw new TypeError(`createConnect: app.build must be a string where it is given; got ${got(build)}`);
  return build === undefined ? { name } : { name, build };
}

/**
 * The sign-in helper for a page: makes it where the connect button is shown, so that Apple's script is loaded and
 * configured before the click, and the window opens inside it. `music` is the client from `createBrowserClient`,
 * or anything with a `developerToken` provider. Apple's script is one per page, so a second helper on a page
 * already configured for another app is a TypeError, and a second helper for the same app shares the first's load
 * and configuration. A page that makes no helper never fetches the script. A global named `MusicKit` that cannot
 * configure, such as an element with that id in content the page shows, is passed over and the script loaded.
 * While the helper lives it keeps the developer token fresh,
 * at the token's half-life and when the tab comes back, so that `connect()` waits on no network inside the click.
 * What loading and configuring the script fails with is nobody's unhandled rejection: it waits for whoever awaits
 * `ready` or `connect()`.
 *
 * The helper stores nothing, but Apple's script keeps its own copy of the listener's token in browser storage, where
 * any script on your origin can read it: a cross-site scripting hole exposes the token on later visits too.
 *
 * @param music - The client from `createBrowserClient`, or anything with a `developerToken` provider on it.
 * @param options - The app as Apple's script is configured with it, and the page's own `MusicKit` where it loaded the script itself.
 * @returns The helper, frozen: `ready`, `connect`, `disconnect` and `dispose`.
 * @throws TypeError if `music` has no `developerToken`, `options` is not a plain object, `app` is not an object
 * with a `name` that has something in it or a `build` that is not a string, `musicKit` has no `configure`, there
 * is no `document`, or the page's script is configured for another app.
 */
export function createConnect(music: { readonly developerToken: tTokenProvider }, options: tConnectOptions): tConnect {
  if (!has(music, ["developerToken"])) throw new TypeError(`createConnect: music must be a client from createBrowserClient, or anything with a developerToken provider; got ${got(music)}`);
  const provider = music.developerToken;
  const bag = optionsOf("createConnect", options, WHAT);
  const app = appOf(bag.app);
  const kit = bag.musicKit;
  if (kit !== undefined && !has(kit, ["configure"])) throw new TypeError(`createConnect: musicKit must be Apple's MusicKit, with configure; got ${got(kit)}`);
  const page = (globalThis as { document?: tPage }).document;
  if (page === undefined) throw new TypeError("createConnect: needs a page, and there is no document here; make it where the connect button is shown, not on a server");

  let state = pages.get(page);
  if (state === undefined) pages.set(page, (state = pageState()));
  const key = JSON.stringify(app);
  if (state.configured !== undefined && state.configured.app !== key) throw new TypeError("createConnect: Apple's script is one per page, and this page's is configured for another app; make one helper per page, or make each for the same app");

  /**
   * The page's configuration: the one it has, or one made now, shared by every helper on the page. One that fails is
   * let go of, so the next asking makes one afresh.
   */
  const configure = (): NonNullable<tPageState["configured"]> => {
    if (state.configured !== undefined) return state.configured;
    /** The developer token the instance was last given, for the refresh to compare with. */
    const token = { current: "" };
    const record: NonNullable<tPageState["configured"]> = {
      app: key,
      token,
      instance: (async () => {
        const musicKit = kit ?? (await loaded(page, state));
        token.current = await provider({});
        return musicKit.configure({ developerToken: token.current, app });
      })(),
    };
    state.configured = record;
    record.instance.catch(() => {
      // Nothing replaces a configuration while it is pending, so the one that failed is still the page's.
      state.configured = undefined;
    });
    return record;
  };
  const first = configure();

  let disposed = false;
  /** Asked after an await, where the helper may have been disposed meanwhile. */
  const isDisposed = (): boolean => disposed;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Asks the provider again, sets a token that changed on the instance, and waits for the next asking, whatever came of this one. */
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    try {
      const record = state.configured;
      if (record === undefined) return;
      const instance = await record.instance;
      const token = await provider({});
      if (isDisposed()) return;
      if (token !== record.token.current) {
        record.token.current = token;
        // Set where the instance has the property, and left as it is where the property cannot be set: whether a configured instance takes a new token is a live check.
        if ("developerToken" in instance) Reflect.set(instance, "developerToken", token);
      }
    } finally {
      if (!isDisposed()) schedule();
    }
  };
  /** The next asking: halfway to the token's end, a minute at the least, and never past what one timer keeps. An asking that failed is made again in a minute. */
  const schedule = (): void => {
    clearTimeout(timer);
    const expiresAt = expiryOf(state.configured?.token.current ?? "");
    const wait = expiresAt === undefined ? FALLBACK_WAIT_MS : Math.max(MIN_WAIT_MS, (expiresAt - Date.now()) / 2);
    timer = setTimeout(() => void refresh().catch(() => undefined), Math.min(wait, MAX_TIMER_MS));
  };
  const visibility = (): void => {
    if (page.visibilityState !== "hidden") void refresh().catch(() => undefined);
  };
  page.addEventListener("visibilitychange", visibility);

  const ready: Promise<string | undefined> = first.instance.then((instance) => {
    if (!disposed) schedule();
    return parseToken(instance.musicUserToken);
  });
  // What is rejected is for whoever awaits `ready` or `connect()` to hear; in the meantime it is nobody's unhandled rejection.
  void ready.catch(() => undefined);

  const connect = async (): Promise<string | undefined> => {
    if (disposed) throw new TypeError("createConnect: connect() was called after dispose()");
    // Settled by the time there is a button to click: no network, and no wait but a microtask, before the window.
    // After a configuration that failed, this is where the next one is made, and the one wait before the window.
    const record = configure();
    const instance = await record.instance;
    if (record !== first && !isDisposed()) schedule();
    return parseToken(await instance.authorize());
  };
  const disconnect = async (): Promise<void> => {
    if (disposed) throw new TypeError("createConnect: disconnect() was called after dispose()");
    const record = state.configured;
    if (record === undefined) return;
    const instance = await record.instance;
    if (typeof instance.unauthorize === "function") await instance.unauthorize();
  };
  const dispose = (): void => {
    disposed = true;
    clearTimeout(timer);
    page.removeEventListener("visibilitychange", visibility);
  };
  return Object.freeze(ownOf({ ready, connect, disconnect, dispose }));
}

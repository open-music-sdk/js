// Sign-in for a Music User Token: Apple's own script, loaded from Apple's CDN when a page asks for it, configured
// with the page's developer token, and asked to authorize inside the listener's click. The SDK issues no token and
// runs no sign-in of its own, and this helper stores nothing: Apple's script keeps a copy of the token of its own,
// which is written down in the README.
import { AppleMusicError, got, has, optionsOf, ownOf, parseToken, type tTokenProvider } from "@open-music-sdk/core";

/** Apple's script, as the helper uses it: the global it defines, `MusicKit`. */
export interface tMusicKit {
  configure(options: { readonly developerToken: string; readonly app: tConnectApp }): tMusicKitInstance | Promise<tMusicKitInstance>;
}

/** What `configure` gives, as the helper uses it. */
export interface tMusicKitInstance {
  /** The listener's token, when the script holds one: restored for a returning listener, or given by `authorize()`. */
  readonly musicUserToken?: string | null | undefined;
  /** The developer token the instance was configured with. Whether a configured instance takes a new one is a live check; the helper sets it where it can. */
  developerToken?: string | undefined;
  /** Opens Apple's sign-in window and resolves to the Music User Token, or to nothing when the listener declined. */
  authorize(): Promise<string | null | undefined | void>;
}

/** What Apple's sign-in window shows of the app. */
export interface tConnectApp {
  readonly name: string;
  readonly build?: string | undefined;
}

/** Invalid values throw a TypeError when the helper is made. */
export interface tConnectOptions {
  /** The app, as Apple's sign-in window names it. */
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
   * listener, or with `undefined`. Rejects with a `NetworkError` when the script cannot be loaded.
   */
  readonly ready: Promise<string | undefined>;
  /**
   * Opens Apple's sign-in window, to be called inside the listener's click, and resolves to the Music User Token,
   * or to `undefined` when the listener declined or closed the window. Waits on nothing but `ready`, which is
   * settled by the time there is a button to click. What the script throws is handed on as it came.
   */
  readonly connect: () => Promise<string | undefined>;
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
  configured?: { readonly app: string; developerToken: string; readonly instance: Promise<tMusicKitInstance> } | undefined;
}

/** Apple's one unversioned URL for the script. It cannot be pinned, bundled or re-hosted: see the README. */
export const MUSICKIT_SCRIPT = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
/** The timer waits at most this long, and asks again when it fires: a longer wait is kept as several. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** The least the helper waits between two askings of the provider, however near the token's end. */
const MIN_WAIT_MS = 60_000;
/** How long to wait when the token says nothing of its end. */
const FALLBACK_WAIT_MS = 600_000;
const WHAT = "an options object with app";

const pages = new WeakMap<object, tPageState>();

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
const musicKitOf = (): tMusicKit | undefined => (globalThis as { MusicKit?: tMusicKit }).MusicKit;

/**
 * Apple's script, loaded once for this page: the one `<script>` goes in on the first helper, and every helper after
 * waits on the same load. A load that fails is let go of, with its element, so the next helper tries again.
 */
function loaded(page: tPage, state: tPageState): Promise<tMusicKit> {
  state.loading ??= new Promise<tMusicKit>((resolve, reject) => {
    const found = musicKitOf();
    if (found !== undefined) {
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
    if (state.loading === attempt) state.loading = undefined;
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
 * already configured for another app is a TypeError. While the helper lives it keeps the developer token fresh,
 * at the token's half-life and when the tab comes back, so that `connect()` waits on no network inside the click.
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
  if (state === undefined) pages.set(page, (state = {}));
  const key = JSON.stringify(app);
  if (state.configured !== undefined && state.configured.app !== key) throw new TypeError("createConnect: Apple's script is one per page, and this page's is configured for another app; make one helper per page, or make each for the same app");
  if (state.configured === undefined) {
    const record: NonNullable<tPageState["configured"]> = {
      app: key,
      developerToken: "",
      instance: (async () => {
        const musicKit = kit ?? (await loaded(page, state));
        const token = await provider({});
        record.developerToken = token;
        return musicKit.configure({ developerToken: token, app });
      })(),
    };
    state.configured = record;
    record.instance.catch(() => {
      if (state.configured === record) state.configured = undefined;
    });
  }
  const record = state.configured;

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Asks the provider again, sets a token that changed on the instance, and waits for the next asking. */
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    const instance = await record.instance;
    const token = await provider({});
    if (disposed) return;
    if (token !== record.developerToken) {
      record.developerToken = token;
      if ("developerToken" in instance) instance.developerToken = token;
    }
    schedule();
  };
  /** The next asking: halfway to the token's end, a minute at the least, and never past what one timer keeps. */
  const schedule = (): void => {
    clearTimeout(timer);
    const expiresAt = expiryOf(record.developerToken);
    const wait = expiresAt === undefined ? FALLBACK_WAIT_MS : Math.max(MIN_WAIT_MS, (expiresAt - Date.now()) / 2);
    timer = setTimeout(() => void refresh().catch(() => undefined), Math.min(wait, MAX_TIMER_MS));
  };
  const visibility = (): void => {
    if (page.visibilityState !== "hidden") void refresh().catch(() => undefined);
  };
  page.addEventListener("visibilitychange", visibility);

  const ready: Promise<string | undefined> = record.instance.then((instance) => {
    if (!disposed) schedule();
    return parseToken(instance.musicUserToken);
  });
  // What is rejected is for whoever awaits `ready` or `connect()` to hear; in the meantime it is nobody's unhandled rejection.
  void ready.catch(() => undefined);

  const connect = async (): Promise<string | undefined> => {
    if (disposed) throw new TypeError("createConnect: connect() was called after dispose()");
    // Settled by the time there is a button to click: no network, and no wait but a microtask, before the window.
    const instance = await record.instance;
    return parseToken(await instance.authorize());
  };
  const dispose = (): void => {
    disposed = true;
    clearTimeout(timer);
    page.removeEventListener("visibilitychange", visibility);
  };
  return Object.freeze(ownOf({ ready, connect, dispose }));
}

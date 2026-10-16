"use client";
// The provider and the hooks: what runs in a client component, and the one built file that carries the directive, so
// that what the entry re-exports beside it still runs in a route handler or a server component.
import { createConnect, type tBrowserMusic, type tConnect, type tConnectOptions } from "@open-music-sdk/browser";
import { got, has, parseToken } from "@open-music-sdk/core";
import { previewPlayer, type tPreviewAudio, type tPreviewPlayer, type tPreviewPlayerOptions, type tPreviewPlayerState, type tPreviewable } from "@open-music-sdk/lib-preview-player";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { musicQueries, type tMusicQueries } from "./query";

/** What the provider holds for the hooks. */
interface tHeld {
  /** The client as it was handed to the provider: the page's, bound to no listener. */
  readonly base: tBrowserMusic;
  /** The client the hooks give: `base.as(token)` while a token is held, else `base`. */
  readonly music: tBrowserMusic;
  readonly token: string | undefined;
  /**
   * The scope of every query key: 0 for the page's client before any sign-in, so a server render and a hydration
   * agree, and a scope of its own for each sign-in and each other client, unique across pages, reloads and
   * providers, so that one listener's cache, persisted or not, is never another's.
   */
  readonly scope: string | number;
  /** Whether a token Apple's script restored may be taken: not while one is held, and not once the app forgot one. */
  readonly restorable: boolean;
  readonly setToken: (token: string | undefined) => void;
}

const MusicContext = createContext<tHeld | undefined>(undefined);
const CLIENT = ["request", "paginate", "storefront", "as", "forUser", "developerToken"] as const;

/** A scope of its own, unique across pages and reloads: a UUID where the page has one, which a page that is not secure has not. */
const scopeOf = (): string => (typeof crypto === "object" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** What `MusicProvider` takes. */
export interface tMusicProviderProps {
  /** The client from `createBrowserClient`, made once, outside the tree. */
  readonly music: tBrowserMusic;
  /** The tree the hooks are used in. */
  readonly children?: ReactNode | undefined;
}

/**
 * Holds the client and the listener's token, in React state and nowhere else: in memory, gone with the page. No
 * token arrives as a prop, since a prop from a server component is written into the page; `useMusicUserToken` and
 * the sign-in hand it over. `useMusic` gives the client bound to it, derived once here, so every component shares
 * one client and one storefront lookup. The token is in the provider's state and its context value, where React
 * DevTools, and a browser extension that uses its hook, can show it.
 *
 * @param props - The client, and the tree the hooks are used in.
 * @returns The context's provider around `children`.
 * @throws TypeError if `music` is not a client from `createBrowserClient`.
 */
export function MusicProvider(props: tMusicProviderProps): ReactElement {
  const { music, children } = props;
  if (!has(music, CLIENT)) throw new TypeError(`MusicProvider: music must be a client from createBrowserClient; got ${got(music)}`);
  const [held, setHeld] = useState<{ readonly token: string | undefined; readonly scope: string; readonly forgotten: boolean }>({ token: undefined, scope: "", forgotten: false });
  const setToken = useCallback((token: string | undefined) => {
    const value = token === undefined ? undefined : parseToken(token);
    if (token !== undefined && value === undefined) throw new TypeError(`useMusicUserToken: token must be a token, printable characters with no spaces or line breaks inside, or undefined to forget it; got ${got(token)}`);
    // The same token again changes nothing, and keeps its scope. Another is another sign-in, with a scope of its own; none is a sign-out, remembered so that nothing restores it.
    setHeld((was) => (was.token === value ? was : { token: value, scope: value === undefined ? "" : scopeOf(), forgotten: value === undefined }));
  }, []);
  // The client first handed over is scope 0, as on a server; another client handed over later is another scope, so its cache is its own.
  const first = useRef(music);
  const clientScope = useMemo(() => (first.current === music ? 0 : scopeOf()), [music]);
  const value = useMemo<tHeld>(
    () => ({
      base: music,
      music: held.token === undefined ? music : music.as(held.token),
      token: held.token,
      scope: held.token === undefined ? clientScope : held.scope,
      restorable: held.token === undefined && !held.forgotten,
      setToken,
    }),
    [music, held, clientScope, setToken],
  );
  return createElement(MusicContext.Provider, { value }, children);
}

function useHeld(fn: string): tHeld {
  const context = useContext(MusicContext);
  if (context === undefined) throw new TypeError(`${fn}: no MusicProvider above this component`);
  return context;
}

/**
 * The provider's client, bound to the listener while a token is held. One object for every component.
 *
 * @returns The client: `music.as(token)` while a token is held, else `music` as it was handed to the provider.
 * @throws TypeError if there is no `MusicProvider` above the component.
 */
export function useMusic(): tBrowserMusic {
  return useHeld("useMusic").music;
}

/**
 * The listener's token as the provider holds it, and the function that sets it: with a token, after your own sign-in
 * or an authenticated fetch of one your server stored; with `undefined`, to forget it, as after a `UserTokenInvalid`.
 * The setter throws a `TypeError` for a value that is no token: printable characters with no spaces or line breaks
 * inside.
 *
 * Forgetting the token here is not a sign-out. The provider then takes no token Apple's script restores until the
 * next `connect()`, but the script restores it on the next page load; `disconnect()` from `useConnect` is the
 * sign-out. The provider does not forget a token on a `UserTokenInvalid` by itself: the component that made the call
 * gets the error.
 *
 * @returns The token, or `undefined` while none is held, and the setter, which keeps its identity.
 * @throws TypeError if there is no `MusicProvider` above the component.
 */
export function useMusicUserToken(): readonly [token: string | undefined, setToken: (token: string | undefined) => void] {
  const { token, setToken } = useHeld("useMusicUserToken");
  return useMemo(() => [token, setToken] as const, [token, setToken]);
}

/**
 * `musicQueries` over the provider's client, in the provider's scope, made once per client and per sign-in. The scope
 * is 0 for the client first handed to the provider, before any sign-in, so a server render and a hydration agree.
 * Each sign-in, and each other client handed to the provider, has a scope of its own, unique across pages, reloads
 * and providers, so what one listener cached, persisted or not, is never under another's keys.
 *
 * @returns The catalog's and the listener's read functions, each as its query.
 * @throws TypeError if there is no `MusicProvider` above the component.
 */
export function useMusicQueries(): tMusicQueries {
  const { music, scope } = useHeld("useMusicQueries");
  return useMemo(() => musicQueries(music, scope), [music, scope]);
}

/** What `useConnect` gives: where the sign-in stands, and the two functions, each keeping its identity. */
export interface tUseConnect {
  /** Whether Apple's script is loaded and configured: when the button can be enabled. */
  readonly isReady: boolean;
  /** Why it is not, when it cannot be: what the helper's `ready` rejected with, or what the last `connect()` failed with. */
  readonly error: unknown;
  /**
   * Opens Apple's sign-in window, to be called inside the click, and resolves to the Music User Token, which the
   * provider now holds too, or to `undefined` when the script answered with nothing. After a `ready` that failed it
   * loads and configures the script afresh. Rejects with what the helper's `connect()` rejects with, after putting
   * it in `error`; called before the component mounted or after it unmounted, it is a `TypeError`.
   */
  readonly connect: () => Promise<string | undefined>;
  /**
   * Signs out: Apple's own sign-out through the script, so a later page load restores nothing, and the provider
   * forgets the token. Whether the script's sign-out also ends the token at Apple is a live check. Rejects with what
   * the helper's `disconnect()` rejects with, and the token is then kept; called before the component mounted or
   * after it unmounted, it is a `TypeError`.
   */
  readonly disconnect: () => Promise<void>;
}

/**
 * Apple's sign-in, as `createConnect` runs it: the helper is made when the component mounts, from the provider's
 * client, and disposed when it unmounts. The token a returning listener's script restored goes to the provider,
 * unless the provider holds one already or the app has forgotten one; the token `connect()` gives always does. The
 * options are read on the first mount only, as the helper reads them once.
 *
 * @param options - The app as Apple's script is configured with it, and the page's own `MusicKit` where it loaded the script itself.
 * @returns Where the sign-in stands, and `connect` and `disconnect`, each keeping its identity.
 * @throws TypeError if there is no `MusicProvider` above the component; what `createConnect` refuses in the
 * options, a mount with no `document`, or a page whose script is configured for another app, is a `TypeError`
 * thrown when the component mounts, from the effect, so it reaches the nearest error boundary rather than this call.
 */
export function useConnect(options: tConnectOptions): tUseConnect {
  const { base, restorable, setToken } = useHeld("useConnect");
  const first = useRef(options);
  const helper = useRef<tConnect | undefined>(undefined);
  // Read when `ready` settles, which is after this render: what the provider holds then is what counts.
  const mayRestore = useRef(restorable);
  useEffect(() => {
    mayRestore.current = restorable;
  }, [restorable]);
  const [state, setState] = useState<{ readonly isReady: boolean; readonly error: unknown }>({ isReady: false, error: undefined });
  useEffect(() => {
    const made = createConnect(base, first.current);
    helper.current = made;
    let live = true;
    made.ready.then(
      (restored) => {
        if (!live) return;
        if (restored !== undefined && mayRestore.current) setToken(restored);
        setState({ isReady: true, error: undefined });
      },
      (error: unknown) => {
        if (live) setState({ isReady: false, error });
      },
    );
    return () => {
      live = false;
      made.dispose();
      helper.current = undefined;
    };
  }, [base, setToken]);
  const connect = useCallback(async (): Promise<string | undefined> => {
    const made = helper.current;
    if (made === undefined) throw new TypeError("useConnect: connect() was called before the component mounted, or after it unmounted");
    try {
      const token = await made.connect();
      if (token !== undefined) setToken(token);
      setState({ isReady: true, error: undefined });
      return token;
    } catch (error) {
      setState({ isReady: false, error });
      throw error;
    }
  }, [setToken]);
  const disconnect = useCallback(async (): Promise<void> => {
    const made = helper.current;
    if (made === undefined) throw new TypeError("useConnect: disconnect() was called before the component mounted, or after it unmounted");
    await made.disconnect();
    setToken(undefined);
  }, [setToken]);
  return useMemo(() => ({ isReady: state.isReady, error: state.error, connect, disconnect }), [state, connect, disconnect]);
}

/** What `usePreviewPlayer` takes: the player's options, with the element or a ref to it. */
export interface tUsePreviewPlayerOptions extends Omit<tPreviewPlayerOptions, "audio"> {
  /** The element to play through, or a ref to one, read when the component mounts. Default: one made with `new Audio()`. */
  readonly audio?:
    | tPreviewAudio
    | {
        /** The element the ref holds once it is rendered; `null` before, which the mount refuses. */
        readonly current: tPreviewAudio | null;
      }
    | undefined;
}

type tVerb = (typeof VERBS)[number];
type tVerbs<T extends tPreviewable> = Pick<tPreviewPlayer<T>, tVerb>;

/** The player's verbs, each keeping its identity for as long as the component lives, and where it stands. */
export interface tUsePreviewPlayer<T extends tPreviewable = tPreviewable> extends tVerbs<T> {
  /** Where the player stands: its own frozen snapshot, and one idle snapshot on the server and before the component mounts. */
  readonly state: tPreviewPlayerState<T>;
}

const VERBS = ["load", "play", "pause", "next", "previous", "seek", "setVolume"] as const;
const IDLE: tPreviewPlayerState<never> = Object.freeze({ status: "idle", tracks: Object.freeze([]), index: -1, track: undefined, position: 0, duration: 0, volume: 1 });

/** Whether `audio` is a ref to an element rather than one: an element can play, and a ref holds `current`. */
const isRef = (audio: unknown): audio is { readonly current: tPreviewAudio | null } => typeof audio === "object" && audio !== null && "current" in audio && !has(audio, ["play"]);

/**
 * A preview player for the component: made when it mounts, since an audio element is a browser's, and disposed when
 * it unmounts. `state` is the player's own snapshot through `useSyncExternalStore`, and the idle one before that.
 * The verbs keep their identity, so one can go into an effect's dependencies; one called before the player exists,
 * which only a child's effect can do, is a TypeError. The options are read on the first mount only.
 *
 * @param options - The player's options, with the element to play through or a ref to it.
 * @returns The player's state and its verbs; each verb throws and rejects as the player's own does.
 * @throws TypeError if `audio` is a ref with nothing in it when the component mounts, or `previewPlayer` refuses an
 * option: thrown then, from the effect, so it reaches the nearest error boundary rather than this call.
 */
export function usePreviewPlayer<T extends tPreviewable = tPreviewable>(options?: tUsePreviewPlayerOptions): tUsePreviewPlayer<T> {
  const first = useRef(options);
  const current = useRef<tPreviewPlayer<T> | undefined>(undefined);
  const [player, setPlayer] = useState<tPreviewPlayer<T> | undefined>(undefined);
  useEffect(() => {
    const given = first.current;
    let audio = given?.audio;
    if (isRef(audio)) {
      // A ref with nothing in it is a mistake, not a reason to play through an element of the player's own while the page's stays silent.
      if (audio.current === null) throw new TypeError("usePreviewPlayer: audio is a ref with nothing in it when the component mounted; render the element before this component, or hand over the element itself");
      audio = audio.current;
    }
    const made = previewPlayer<T>({ ...given, audio });
    current.current = made;
    setPlayer(made);
    return () => {
      made.dispose();
      current.current = undefined;
      setPlayer((was) => (was === made ? undefined : was));
    };
  }, []);
  const subscribe = useCallback((listener: () => void) => (player === undefined ? () => undefined : player.subscribe(listener)), [player]);
  const getSnapshot = useCallback((): tPreviewPlayerState<T> => (player === undefined ? (IDLE as tPreviewPlayerState<T>) : player.state), [player]);
  const getServerSnapshot = useCallback((): tPreviewPlayerState<T> => IDLE as tPreviewPlayerState<T>, []);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const verbs = useMemo((): tVerbs<T> => {
    const verb = (name: tVerb) => (...args: unknown[]): unknown => {
      const made = current.current;
      if (made === undefined) throw new TypeError(`usePreviewPlayer.${name}: the player is made when the component mounts; call ${name} from a click, or from an effect of the component that called usePreviewPlayer`);
      return (made[name] as (...given: unknown[]) => unknown)(...args);
    };
    return Object.freeze(Object.fromEntries(VERBS.map((name) => [name, verb(name)]))) as unknown as tVerbs<T>;
  }, []);
  return useMemo(() => ({ state, ...verbs }), [state, verbs]);
}

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
  /** Raised by every change of token: the scope of every query key, so that one listener's cache is never another's. */
  readonly generation: number;
  readonly setToken: (token: string | undefined) => void;
}

const MusicContext = createContext<tHeld | undefined>(undefined);
const CLIENT = ["request", "paginate", "storefront", "as", "forUser", "developerToken"] as const;

export interface tMusicProviderProps {
  /** The client from `createBrowserClient`, made once, outside the tree. */
  readonly music: tBrowserMusic;
  readonly children?: ReactNode | undefined;
}

/**
 * Holds the client and the listener's token, in React state and nowhere else: in memory, gone with the page. No
 * token arrives as a prop, since a prop from a server component is written into the page; `useMusicUserToken` and
 * the sign-in hand it over. `useMusic` gives the client bound to it, derived once here, so every component shares
 * one client and one storefront lookup.
 */
export function MusicProvider(props: tMusicProviderProps): ReactElement {
  const { music, children } = props;
  if (!has(music, CLIENT)) throw new TypeError(`MusicProvider: music must be a client from createBrowserClient; got ${got(music)}`);
  const [held, setHeld] = useState<{ readonly token: string | undefined; readonly generation: number }>({ token: undefined, generation: 0 });
  const setToken = useCallback((token: string | undefined) => {
    const value = token === undefined ? undefined : parseToken(token);
    if (token !== undefined && value === undefined) throw new TypeError(`useMusicUserToken: token must be a token, printable characters with no spaces or line breaks inside, or undefined to forget it; got ${got(token)}`);
    setHeld((was) => (was.token === value ? was : { token: value, generation: was.generation + 1 }));
  }, []);
  const value = useMemo<tHeld>(
    () => ({ base: music, music: held.token === undefined ? music : music.as(held.token), token: held.token, generation: held.generation, setToken }),
    [music, held, setToken],
  );
  return createElement(MusicContext.Provider, { value }, children);
}

function useHeld(fn: string): tHeld {
  const context = useContext(MusicContext);
  if (context === undefined) throw new TypeError(`${fn}: no MusicProvider above this component`);
  return context;
}

/** The provider's client, bound to the listener while a token is held. One object for every component. */
export function useMusic(): tBrowserMusic {
  return useHeld("useMusic").music;
}

/**
 * The listener's token as the provider holds it, and the function that sets it: with a token, after your own sign-in
 * or an authenticated fetch of one your server stored; with `undefined`, to forget it, as after a `UserTokenInvalid`.
 * A value that is no token is a TypeError.
 */
export function useMusicUserToken(): readonly [token: string | undefined, setToken: (token: string | undefined) => void] {
  const { token, setToken } = useHeld("useMusicUserToken");
  return useMemo(() => [token, setToken] as const, [token, setToken]);
}

/** `musicQueries` over the provider's client, scoped by its generation, made once per client and per token. */
export function useMusicQueries(): tMusicQueries {
  const { music, generation } = useHeld("useMusicQueries");
  return useMemo(() => musicQueries(music, generation), [music, generation]);
}

export interface tUseConnect {
  /** Whether Apple's script is loaded and configured: when the button can be enabled. */
  readonly isReady: boolean;
  /** Why it is not, when it cannot be: what the helper's `ready` rejected with. */
  readonly error: unknown;
  /**
   * Opens Apple's sign-in window, to be called inside the click, and resolves to the Music User Token, which the
   * provider now holds too, or to `undefined` when the listener declined.
   */
  readonly connect: () => Promise<string | undefined>;
}

/**
 * Apple's sign-in, as `createConnect` runs it: the helper is made when the component mounts, once, from the
 * provider's client, and disposed when it unmounts. The token a returning listener's script restored, and the one
 * `connect()` gives, go to the provider. The options are read on the first mount only, as the helper reads them once.
 */
export function useConnect(options: tConnectOptions): tUseConnect {
  const { base, setToken } = useHeld("useConnect");
  const first = useRef(options);
  const helper = useRef<tConnect | undefined>(undefined);
  const [state, setState] = useState<{ readonly isReady: boolean; readonly error: unknown }>({ isReady: false, error: undefined });
  useEffect(() => {
    const made = createConnect(base, first.current);
    helper.current = made;
    let live = true;
    made.ready.then(
      (restored) => {
        if (!live) return;
        if (restored !== undefined) setToken(restored);
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
    const token = await made.connect();
    if (token !== undefined) setToken(token);
    return token;
  }, [setToken]);
  return useMemo(() => ({ isReady: state.isReady, error: state.error, connect }), [state, connect]);
}

export interface tUsePreviewPlayerOptions extends Omit<tPreviewPlayerOptions, "audio"> {
  /** The element to play through, or a ref to one, read when the component mounts. Default: one made with `new Audio()`. */
  readonly audio?: tPreviewAudio | { readonly current: tPreviewAudio | null } | undefined;
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
 */
export function usePreviewPlayer<T extends tPreviewable = tPreviewable>(options?: tUsePreviewPlayerOptions): tUsePreviewPlayer<T> {
  const first = useRef(options);
  const current = useRef<tPreviewPlayer<T> | undefined>(undefined);
  const [player, setPlayer] = useState<tPreviewPlayer<T> | undefined>(undefined);
  useEffect(() => {
    const given = first.current;
    const audio = isRef(given?.audio) ? (given.audio.current ?? undefined) : given?.audio;
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

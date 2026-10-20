// Shows: createBrowserClient, musicQueries, useMusicUserToken. Guides:
// /guides/token-endpoint, /guides/tanstack-query
import {
  createBrowserClient,
  musicQueries,
  useMusicUserToken,
} from "@open-music-sdk/react";
import {
  createContext,
  use,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// One client for the page, made once, outside the tree, and handed to
// MusicProvider in main.tsx. It fetches its developer token from the server's
// token route, which Vite forwards to whichever server sample runs, and
// fetches the next one before the last runs out.
export const music = createBrowserClient({ tokenUrl: "/api/music/token" });

/**
 * The catalog's queries, which are the same for every listener: over the
 * page's own client, in scope 0, so that a sign-in asks Apple for none of them
 * again unless the storefront changes. The listener's own come from
 * useMusicQueries(), in a scope of each sign-in's own.
 */
export const catalog = musicQueries(music).catalog;

/** A sign-in the server has kept the token of. */
interface tSignIn {
  /** The token the provider held then. */
  readonly token: string;
  /** The storefront the listener's account is in, from Apple. */
  readonly storefront: string;
}

interface tNow {
  /**
   * Whether a listener is signed in: the provider holds their token, and the
   * server has kept it. `useMusic()` is then bound to them.
   */
  readonly signedIn: boolean;
  /** The storefront every catalog call asks in. */
  readonly storefront: string;
  /** Picks the storefront to ask in while signed out. */
  readonly pick: (storefront: string) => void;
  /** Records a sign-in, once the server has kept its token. */
  readonly signIn: (signIn: tSignIn) => void;
}

const Now = createContext<tNow | undefined>(undefined);

/**
 * Who is signed in, and the storefront: the picker's while signed out, and the
 * listener's own, from Apple, once signed in. sign-in.tsx and the picker
 * change it, and every screen draws itself again.
 */
export function NowProvider({ children }: { children: ReactNode }) {
  const [token] = useMusicUserToken();
  const [picked, pick] = useState("us");
  const [signedInWith, signIn] = useState<tSignIn>();
  // A sign-in whose token the provider no longer holds is over: the listener
  // signed out, or signed in again as someone else.
  const current = signedInWith?.token === token ? signedInWith : undefined;
  const now = useMemo<tNow>(
    () => ({
      signedIn: current !== undefined,
      storefront: current?.storefront ?? picked,
      pick,
      signIn,
    }),
    [current, picked],
  );
  return <Now value={now}>{children}</Now>;
}

export function useNow(): tNow {
  const now = use(Now);
  if (now === undefined) throw new Error("useNow: no NowProvider above");
  return now;
}

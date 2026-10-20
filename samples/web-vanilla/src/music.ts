// Shows: createBrowserClient. Guide: /guides/token-endpoint
import {
  createBrowserClient,
  type tBrowserMusic,
} from "@open-music-sdk/browser";

// One client for the page. It fetches its developer token from the server's
// token route, which Vite forwards to whichever server sample runs, and fetches
// the next one before the last runs out.
export const music = createBrowserClient({ tokenUrl: "/api/music/token" });

interface tNow {
  /** A client for the signed-in listener; undefined while signed out. */
  readonly listener: tBrowserMusic | undefined;
  /** The storefront every catalog call asks in. */
  readonly storefront: string;
}

/**
 * Who is signed in, and the storefront: the picker's while signed out, and the
 * listener's own, from Apple, once signed in. sign-in.ts and the picker change
 * it, and every screen draws itself again.
 */
export const now: tNow = { listener: undefined, storefront: "us" };

export function change(next: Partial<tNow>): void {
  Object.assign(now, next);
  document.dispatchEvent(new Event("now-changed"));
}

export function onChange(draw: () => void): void {
  document.addEventListener("now-changed", draw);
}

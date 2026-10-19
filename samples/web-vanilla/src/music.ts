// Shows: createBrowserClient. Guide: /guides/token-endpoint
import { createBrowserClient, type tBrowserMusic } from "@open-music-sdk/browser";

// #region client
// One client for the page. It fetches its developer token from the server's token route, which Vite forwards to
// whichever server sample runs, and fetches the next one before the last runs out.
export const music = createBrowserClient({ tokenUrl: "/api/music/token" });
// #endregion client

/**
 * Who is signed in, and the storefront every catalog call asks in: the picker's while signed out, and the listener's
 * own, from Apple, once signed in. sign-in.ts and the picker change it, and every screen redraws.
 */
export const now: { readonly listener: tBrowserMusic | undefined; readonly storefront: string } = { listener: undefined, storefront: "us" };

export function change(next: Partial<typeof now>): void {
  Object.assign(now, next);
  document.dispatchEvent(new Event("now-changed"));
}

export function onChange(draw: () => void): void {
  document.addEventListener("now-changed", draw);
}

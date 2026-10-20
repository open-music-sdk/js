"use client";
// Shows: useConnect, useMusicUserToken. Guides: /guides/sign-in,
// /guides/nextjs
import { useConnect, useMusicUserToken } from "@open-music-sdk/react";
import { useEffect } from "react";
import { fromServer } from "./errors";
import { say, showError } from "./status";

/**
 * The header's sign-in and sign-out. Apple's sign-in runs in the browser, as
 * it has to; the token it gives goes to the server, and the page keeps none of
 * it. `signedIn` is the server's word: it holds a token Apple accepts.
 */
export function SignIn({ signedIn }: { signedIn: boolean }) {
  // Apple's script is loaded and configured as the header mounts, so that its
  // window opens inside the click: a browser blocks a window opened later.
  const { isReady, error, connect, disconnect } = useConnect({
    app: { name: "Vinyl Collector Simulator" },
  });
  const [token, setToken] = useMusicUserToken();
  // Why the script cannot be had, or why the last sign-in failed.
  useEffect(() => {
    if (error !== undefined) showError(error);
  }, [error]);

  // #region after-sign-in
  // Once the provider holds a token, from a sign-in or from Apple's script on
  // a reload, the page hands it to the server, which asks Apple whether it
  // works and keeps it. Then the page forgets it, and loads again for the
  // listener.
  useEffect(() => {
    if (token === undefined) return;
    // A server that holds a token Apple takes is not handed another, as it
    // would be on every reload: the page only forgets this one.
    if (signedIn) {
      setToken(undefined);
      return;
    }
    // The request stops when the token changes or the header goes, as
    // StrictMode makes it go once in development. Its AbortError is said
    // nowhere.
    const stop = new AbortController();
    async function keep(posted: string): Promise<void> {
      const answer = await fetch("/api/music/user-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: posted }),
        signal: stop.signal,
      });
      if (answer.status === 422) {
        say(fromServer(answer.status));
        // Apple's script keeps the token Apple refused, and would hand it back
        // at the next sign-in: leave it, so that the listener can sign in with
        // another account.
        await disconnect();
        return;
      }
      // The page keeps no token: the provider forgets this one, and takes none
      // Apple's script restores until the next sign-in.
      setToken(undefined);
      if (!answer.ok) {
        say(fromServer(answer.status));
        return;
      }
      // The whole page again, rather than this route drawn again: Next keeps
      // the pages visited before, as they were drawn for no one, for Back.
      location.reload();
    }
    keep(token).catch(showError);
    return () => {
      stop.abort();
    };
  }, [token, signedIn, disconnect, setToken]);
  // #endregion after-sign-in

  // Apple's own sign-out, which ends the token at Apple, and then the server
  // forgets its copy. The whole page loads again, so no page Next kept for
  // Back shows the listener's library.
  async function signOut(): Promise<void> {
    await disconnect();
    await fetch("/api/music/user-token", { method: "DELETE" });
    location.reload();
  }

  if (signedIn) {
    return (
      <button
        type="button"
        onClick={() => {
          signOut().catch(showError);
        }}
      >
        Sign out
      </button>
    );
  }
  // The button works once the script has loaded, or failed to: connect() loads
  // it afresh after a load that failed.
  const settled = isReady || error !== undefined;
  return (
    <button
      type="button"
      disabled={!settled}
      onClick={() => {
        // A failure is in `error` too, and said from there.
        connect().catch(() => undefined);
      }}
    >
      Sign in with Apple Music
    </button>
  );
}

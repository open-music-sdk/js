// Shows: useConnect, useMusicUserToken, useMusic, getUserStorefront. Guides:
// /guides/sign-in, /guides/store-user-tokens
import {
  useConnect,
  useMusic,
  useMusicUserToken,
} from "@open-music-sdk/react";
import { useEffect } from "react";
import { fromServer, say, showError, useShowError } from "./errors";
import { useNow } from "./music";

/**
 * The header's sign-in and sign-out. The token Apple's window gives, and the
 * one Apple's script restores for a returning listener, go to MusicProvider.
 */
export function SignIn() {
  // Apple's script is loaded and configured as the header mounts, so that its
  // window opens inside the click: a browser blocks a window opened later.
  const { isReady, error, connect, disconnect } = useConnect({
    app: { name: "Vinyl Collector Simulator" },
  });
  const [token] = useMusicUserToken();
  const music = useMusic();
  const { signIn } = useNow();
  // Why the script cannot be had, or why the last sign-in failed.
  useShowError(error);

  // #region after-sign-in
  // Once the provider holds a token, from a sign-in or from Apple's script on
  // a reload, the page hands it to the server, which asks Apple whether it
  // works and keeps it. Then the page signs in.
  useEffect(() => {
    if (token === undefined) return;
    // Both requests stop when the token changes or the header goes, as
    // StrictMode makes it go once in development. Their AbortError is said
    // nowhere.
    const stop = new AbortController();
    const { signal } = stop;
    async function keep(posted: string): Promise<void> {
      const answer = await fetch("/api/music/user-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: posted }),
        signal,
      });
      if (!answer.ok) {
        say(fromServer(answer.status));
        // Apple's script keeps the token Apple refused, and would hand it back
        // at the next sign-in: leave it, so that the listener can sign in with
        // another account.
        if (answer.status === 422) await disconnect();
        return;
      }
      // useMusic() is bound to the listener by now. The storefront their
      // account is in, from Apple.
      const storefront = await music.user.getUserStorefront({ signal });
      signIn({ token: posted, storefront: storefront.id });
      const where = storefront.attributes?.name ?? storefront.id;
      say(`Signed in. You're digging in the ${where} storefront.`);
    }
    keep(token).catch(showError);
    return () => {
      stop.abort();
    };
  }, [token, music, disconnect, signIn]);
  // #endregion after-sign-in

  // Apple's own sign-out, which ends the token at Apple and makes the provider
  // forget it, and then the server forgets its copy.
  async function signOut(): Promise<void> {
    await disconnect();
    await fetch("/api/music/user-token", { method: "DELETE" });
    say("Signed out.");
  }

  if (token !== undefined) {
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

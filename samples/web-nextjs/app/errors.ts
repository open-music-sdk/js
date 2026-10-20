// Shows: isAppleMusicError. Guide: /guides/errors
//
// Used on both sides: by the server actions, which answer with these words
// rather than throw, and by the page.
import { isAppleMusicError } from "@open-music-sdk/react";

// #region explain
/** What went wrong, in words the listener can act on. */
export function explain(e: unknown): string {
  // Apple answered 403, or the store has no token for this listener.
  if (isAppleMusicError(e, "UserTokenInvalid")) {
    return "Apple no longer accepts your sign-in. Sign in again.";
  }
  // Apple answered 401: the server's key is wrong, or the listener has no
  // Apple Music subscription.
  if (isAppleMusicError(e, "DeveloperTokenInvalid")) {
    return "Apple refused the request. Check the server's MusicKit key, "
      + "and that this account has an Apple Music subscription.";
  }
  // The token route did not answer with a token.
  if (isAppleMusicError(e, "DeveloperTokenUnavailable")) {
    return "The page could not get a token from its server. Reload it.";
  }
  if (isAppleMusicError(e, "RateLimited")) {
    return "Apple asked for a pause. Try again in a minute.";
  }
  if (isAppleMusicError(e, "NetworkError")) {
    return "Apple could not be reached.";
  }
  if (isAppleMusicError(e)) {
    return `Apple answered with an error: ${e.message}`;
  }
  // The preview player's own: a browser starts sound only after a click.
  if (e instanceof DOMException && e.name === "NotAllowedError") {
    return "The browser plays sound only after a click. Press Play.";
  }
  return e instanceof Error ? e.message : String(e);
}
// #endregion explain

/** What the user-token route answers when it won't keep the token. */
const FROM_SERVER: Record<number, string> = {
  401: "The server has no session for this page. Reload it.",
  421: "The server answers only requests sent to its own address. "
    + "Open the page at the address its README gives.",
  422: "Apple does not accept this sign-in: the account may have no Apple "
    + "Music subscription, or the sign-in has ended. "
    + "Sign in again, with another account if it happens again.",
  502: "The server could not ask Apple. Try again.",
};

export function fromServer(status: number): string {
  const said = FROM_SERVER[status];
  return said ?? `The server answered ${String(status)}. Try again.`;
}

// Shows: isAppleMusicError. Guide: /guides/errors
import { isAppleMusicError } from "@open-music-sdk/browser";
import { byId } from "./dom";

const status = byId("status", HTMLParagraphElement);

// #region explain
/** What went wrong, in words the listener can act on. */
export function explain(e: unknown): string {
  // Apple answered 403, or the client has no Music User Token for a request that needs one.
  if (isAppleMusicError(e, "UserTokenInvalid")) return "Apple no longer accepts your sign-in. Sign in again.";
  // Apple answered 401: the server's key, or a listener with no Apple Music subscription.
  if (isAppleMusicError(e, "DeveloperTokenInvalid")) return "Apple refused the request. Check the server's MusicKit key, and that this account has an Apple Music subscription.";
  // The token route did not answer with a token.
  if (isAppleMusicError(e, "DeveloperTokenUnavailable")) return "The page could not get a token from its server. Is a server sample running?";
  if (isAppleMusicError(e, "RateLimited")) return "Apple asked for a pause. Try again in a minute.";
  if (isAppleMusicError(e, "NetworkError")) return "Apple could not be reached.";
  if (isAppleMusicError(e)) return `Apple answered with an error: ${e.message}`;
  // The preview player's own: a browser starts sound only after a click.
  if (e instanceof DOMException && e.name === "NotAllowedError") return "The browser plays sound only after a click. Press Play.";
  return e instanceof Error ? e.message : String(e);
}
// #endregion explain

/** Says what went wrong on the status line, and hands the error itself to the console for whoever is developing. */
export function showError(e: unknown): void {
  // A later play, next or previous took over from this one: nothing went wrong.
  if (e instanceof DOMException && e.name === "AbortError") return;
  say(explain(e));
  console.error(e);
}

export function say(message: string): void {
  status.textContent = message;
}

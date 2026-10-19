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

/**
 * Says what went wrong on the status line, and tells the console for whoever is developing: the whole error when it
 * is the SDK's or a TypeError, whose messages never hold a token, and only the name of anything else, such as what
 * Apple's sign-in script throws, whose shape is Apple's own.
 */
export function showError(e: unknown): void {
  // A later play, next or previous took over from this one: nothing went wrong.
  if (e instanceof DOMException && e.name === "AbortError") return;
  say(explain(e));
  console.error(isAppleMusicError(e) || e instanceof TypeError ? e : `${e instanceof Error ? e.name : typeof e}: not printed, as it may hold what Apple's script holds`);
}

/** What the sample's own server answers when it will not do what the page asked. */
const FROM_SERVER: Record<number, string> = {
  401: "The server has no session for this page. Reload it.",
  421: "The server answers only requests sent to its own address. Open the page at the address its README gives.",
  422: "Apple does not accept this sign-in: the account may have no Apple Music subscription, or the sign-in has ended. Sign in again, with another account if it happens again.",
  502: "The server could not ask Apple. Try again.",
};

export function fromServer(status: number): string {
  return FROM_SERVER[status] ?? `The server answered ${String(status)}. Try again.`;
}

export function say(message: string): void {
  status.textContent = message;
}

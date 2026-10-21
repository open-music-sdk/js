// Shows: isAppleMusicError. Guide: /guides/errors
import { isAppleMusicError } from "@open-music-sdk/react";
import { useEffect, useSyncExternalStore } from "react";

// #region explain
/** What went wrong, in words the listener can act on. */
export function explain(e: unknown): string {
  // Apple answered 403, or the client has no Music User Token for a request
  // that needs one.
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
    return "The page could not get a token from its server. "
      + "Is a server sample running?";
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

/**
 * Says what went wrong on the status line, and tells the console, for whoever
 * is developing. The console gets the whole error only when it is the SDK's or
 * a TypeError, whose messages never hold a token. Anything else, such as what
 * Apple's sign-in script throws, has a shape of Apple's own, so only its name
 * is printed.
 */
export function showError(e: unknown): void {
  // A later play, next or previous took over from this one: nothing went wrong.
  if (e instanceof DOMException && e.name === "AbortError") return;
  say(explain(e));
  if (isAppleMusicError(e) || e instanceof TypeError) {
    console.error(e);
  } else {
    const name = e instanceof Error ? e.name : typeof e;
    console.error(
      `${name}: not printed, as it may hold what Apple's script holds`,
    );
  }
}

/**
 * Says a query's error on the status line, once for each error it fails with.
 * TanStack Query hands over `null` while there is none.
 */
export function useShowError(error: unknown): void {
  useEffect(() => {
    if (error !== null && error !== undefined) showError(error);
  }, [error]);
}

/** What the sample's server answers when it won't do what the page asked. */
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

// The status line holds one message, which anything on the page can replace,
// from a click or from a promise that settles long after one. So it is kept
// outside React, and the line subscribes to it.
let message = "";
const subscribers = new Set<() => void>();

export function say(said: string): void {
  message = said;
  for (const subscriber of subscribers) subscriber();
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/** The page's status line: what was said last. */
export function Status() {
  const said = useSyncExternalStore(subscribe, () => message);
  return (
    <p id="status" role="status" aria-live="polite">
      {said}
    </p>
  );
}

"use client";
// The page's status line, and what reaches it.
import { isAppleMusicError } from "@open-music-sdk/react";
import { useSyncExternalStore } from "react";
import { explain } from "@/lib/errors";

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
  const said = useSyncExternalStore(
    subscribe,
    () => message,
    () => "",
  );
  return (
    <p id="status" role="status" aria-live="polite">
      {said}
    </p>
  );
}

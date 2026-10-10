// What a function sends as its body. The functions that read take nothing but ids and options; the ones that
// write take something to send, and it is taken as everything else is: checked and copied as the function is called.
import { optionsOf } from "@open-music-sdk/core";

/**
 * A body as this call's own copy of it, all the way down: nothing done to the caller's object afterwards changes
 * what is sent. `what` says what was expected, for the error when it is not a plain object, or holds what JSON
 * cannot. What it holds beyond that is Apple's to judge.
 */
export function bodyOf<T extends object>(fn: string, value: T, what: string): T {
  // No body is not an empty one: `optionsOf` would take nothing at all for an empty bag.
  if ((value as unknown) === undefined) throw new TypeError(`${fn}: expected ${what}; got undefined`);
  const own = optionsOf(fn, value, what);
  try {
    return JSON.parse(JSON.stringify(own)) as T;
  } catch {
    // A cycle, or a BigInt. The runtime's own message names what it found, so it is not passed on.
    throw new TypeError(`${fn}: expected ${what}, holding only what JSON can; got one that holds something else`);
  }
}

// What a function is handed is checked where it is handed over. A mistake is a TypeError that names the function
// and the argument and describes the value, never repeats it: a value in the wrong place may be a token.
import type { tAppleMusicClient } from "./client";
import { got } from "./got";

/** Whether `value` is an object with a function under each of `methods`. Nothing is called on it. */
export const has = (value: unknown, methods: readonly string[]): boolean =>
  typeof value === "object" && value !== null && methods.every((method) => typeof (value as Record<string, unknown>)[method] === "function");

/**
 * An options bag, or the empty one when none was given. The types rule anything else out, and a caller without
 * them can still pass it.
 */
export function optionsOf<T extends object>(fn: string, options: T | undefined, what: string): T {
  if (options === undefined) return {} as T;
  if (typeof options === "object" && (options as unknown) !== null) return options;
  throw new TypeError(`${fn}: expected ${what}; got ${got(options)}`);
}

/**
 * A client from createClient, or anything with the `methods` the caller is about to use: a wrapped client, or a
 * test's own. Naming the methods is what keeps the check to what is called.
 */
export function clientOf(fn: string, client: unknown, methods: readonly (keyof tAppleMusicClient)[]): tAppleMusicClient {
  if (has(client, methods)) return client as tAppleMusicClient;
  throw new TypeError(`${fn}: client must be a client from createClient; got ${got(client)}`);
}

/** Longer than any identifier or code Apple gives out, which run to a few dozen characters. */
const MAX_LENGTH = 256;

/**
 * `value` as one segment of a path, percent-encoded. Whatever it holds stays inside the segment: a slash, a
 * question mark or a hash is encoded, and "." and "..", which no encoding protects because a URL parser reads
 * them as "here" and "one up", are refused. So a value from outside cannot turn a request for one endpoint into a
 * request for another, where a different token may be sent.
 */
export function segmentOf(fn: string, name: string, value: unknown): string {
  if (typeof value === "string" && value !== "" && value.length <= MAX_LENGTH && value !== "." && value !== "..") {
    try {
      return encodeURIComponent(value);
    } catch {
      // Half of a surrogate pair: not text that can be sent, and refused like anything else that is no segment.
    }
  }
  throw new TypeError(`${fn}: ${name} must be a string of 1 to ${String(MAX_LENGTH)} characters, and not "." or ".."; got ${got(value)}`);
}

/** The most Apple documents taking in one request, which is for songs by id. Each item is a URL made longer, so the list is not left open. */
const MAX_ITEMS = 300;

/** One value of a list: a list is sent joined by commas, so an item with a comma in it would arrive as two. */
const isItem = (item: unknown): item is string => typeof item === "string" && item !== "" && item.length <= MAX_LENGTH && !item.includes(",");

/**
 * `value` as a list of one or more strings, of the caller's ids, types or codes: this call's own copy, taken
 * before it is checked, so what was checked is what is sent.
 */
export function listOf(fn: string, name: string, value: unknown): readonly string[] {
  const items: unknown[] = Array.isArray(value) && value.length <= MAX_ITEMS ? [...(value as unknown[])] : [];
  const bad = items.findIndex((item) => !isItem(item));
  if (items.length > 0 && bad === -1) return items as string[];
  const what = !Array.isArray(value) ? got(value) : bad === -1 ? `a list of ${String(value.length)}` : `${got(items[bad])} at index ${String(bad)}`;
  throw new TypeError(`${fn}: ${name} must be a list of 1 to ${String(MAX_ITEMS)} strings, each of 1 to ${String(MAX_LENGTH)} characters with no comma in it; got ${what}`);
}

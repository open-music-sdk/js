// What a function is handed is checked where it is handed over. A mistake is a TypeError that names the function
// and the argument and describes the value, never repeats it: a value in the wrong place may be a token.
import type { tAppleMusicClient } from "./client";
import { got } from "./got";

/** Whether `value` is an object with a function under each of `methods`. Nothing is called on it. */
export const has = (value: unknown, methods: readonly string[]): boolean =>
  typeof value === "object" && value !== null && methods.every((method) => typeof (value as Record<string, unknown>)[method] === "function");

/**
 * What an object holds itself, each property read once, as an object of this call's own that inherits nothing. A
 * property is then there or it is not, whatever other code has put on `Object.prototype`: an option nobody passed
 * cannot be found there.
 */
export const ownOf = <T extends object>(bag: T): T => Object.assign(Object.create(null) as T, bag);

/**
 * An options bag as this call's own: what the caller's object holds itself, and the empty bag when none was
 * given. The types rule anything but an object out, and a caller without them can still pass it.
 */
export function optionsOf<T extends object>(fn: string, options: T | undefined, what: string): T {
  if (options === undefined) return ownOf({} as T);
  if (typeof options === "object" && (options as unknown) !== null) return ownOf(options);
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

/**
 * The longest an id, a name or a code may be. Apple's run to a few dozen characters, and a token to some two
 * hundred, so this takes every one of the first and none of the second: a token put where an id belongs is refused
 * here, and is neither sent to Apple nor repeated in the error Apple's answer to it would become.
 */
export const MAX_NAME = 64;

/** The longest a piece of text that is no name may be, such as a cursor Apple gave. */
export const MAX_LENGTH = 256;

/**
 * `value` as one segment of a path, percent-encoded. Whatever it holds stays inside the segment: a slash, a
 * question mark or a hash is encoded, and "." and "..", which no encoding protects because a URL parser reads
 * them as "here" and "one up", are refused. So a value from outside cannot turn a request for one endpoint into a
 * request for another, where a different token may be sent.
 */
export function segmentOf(fn: string, name: string, value: unknown): string {
  if (typeof value === "string" && value !== "" && value.length <= MAX_NAME && value !== "." && value !== "..") {
    try {
      return encodeURIComponent(value);
    } catch {
      // Half of a surrogate pair: not text that can be sent, and refused like anything else that is no segment.
    }
  }
  throw new TypeError(`${fn}: ${name} must be a string of 1 to ${String(MAX_NAME)} characters, and not "." or ".."; got ${got(value)}`);
}

/** The most Apple documents taking in one request, which is for songs by id. Each item is a URL made longer, so the list is not left open. */
export const MAX_ITEMS = 300;

/** One value of a list: a list is sent joined by commas, so an item with a comma in it would arrive as two. */
const isItem = (item: unknown): item is string => typeof item === "string" && item !== "" && item.length <= MAX_NAME && !item.includes(",");

/**
 * How long a caller's list says it is, asked once; `undefined` for what is no list. Everything after goes by this
 * answer, so a list that would answer differently a second time is not asked a second time.
 */
export function lengthOf(value: unknown): number | undefined {
  const length: unknown = Array.isArray(value) ? value.length : undefined;
  return typeof length === "number" ? length : undefined;
}

/**
 * The first `length` items of a caller's list, each read once, by index: not through the list's iterator, which a
 * list can be given to hand over more than its length said.
 */
export const copyOf = (list: unknown, length: number): unknown[] => Array.from({ length }, (_, index) => (list as readonly unknown[])[index]);

/**
 * `value` as a list of one or more strings, of the caller's ids, types or codes: this call's own copy, taken
 * before it is checked, so what was checked is what is sent.
 */
export const listOf = (fn: string, name: string, value: unknown): readonly string[] => listed(fn, name, value, 1);

/** As `listOf`, for a list that may also hold nothing when `least` is 0: an option's list, where nothing means none. */
export function listed(fn: string, name: string, value: unknown, least: 0 | 1): readonly string[] {
  const length = lengthOf(value);
  const items = length !== undefined && length <= MAX_ITEMS ? copyOf(value, length) : [];
  const bad = items.findIndex((item) => !isItem(item));
  if (length !== undefined && items.length === length && length >= least && bad === -1) return items as string[];
  const what = length === undefined ? got(value) : bad === -1 ? `a list of ${String(length)}` : `${got(items[bad])} at index ${String(bad)}`;
  throw new TypeError(`${fn}: ${name} must be a list of 1 to ${String(MAX_ITEMS)} strings, each of 1 to ${String(MAX_NAME)} characters with no comma in it; got ${what}`);
}

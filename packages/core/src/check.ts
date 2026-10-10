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
 * Whether `value` is a plain object: one written as `{…}`, or made with no prototype. A list, a Map, a
 * URLSearchParams, a Buffer and a class's instance are not: what each holds is not in properties of its own, so
 * read as a bag of them it would be an empty bag, and what the caller meant by it would be dropped without a word.
 * The prototype is asked about rather than compared, so an object from another realm is as plain as one from here.
 */
export function isPlain(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** What `value` is, for the error that says it was to be a plain object: `got`, which tells a list and a Map from neither. */
export const gotFor = (value: unknown): string => (Array.isArray(value) ? "a list" : typeof value === "object" && value !== null ? "an object that is not a plain one" : got(value));

/**
 * An options bag as this call's own: what the caller's object holds itself, and the empty bag when none was
 * given. The types rule anything but a plain object out, and a caller without them can still pass it.
 */
export function optionsOf<T extends object>(fn: string, options: T | undefined, what: string): T {
  if (options === undefined) return ownOf({} as T);
  if (isPlain(options)) return ownOf(options);
  throw new TypeError(`${fn}: expected ${what}; got ${gotFor(options)}`);
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
 * What a segment may not hold: a slash, a backslash, a percent sign, or a control character. No id, name or code
 * of Apple's holds one. Encoded, each would stay inside the segment as far as a URL goes, and that is as far as
 * this package can see: a server that decodes a path before it reads it would find a slash there again. So what
 * could be read as one, or as the start of an encoding of one, is not sent at all.
 */
const UNFIT = /[/\\%\p{Cc}]/u;

/**
 * `value` as one segment of a path, percent-encoded. A question mark, a hash or a space is encoded and stays in
 * the segment. What could be read as leaving it is refused: a slash, a backslash, a percent sign and a control
 * character, and "." and "..", which a URL parser reads as "here" and "one up". So a value from outside cannot turn
 * a request for one endpoint into a request for another, where a different token may be sent.
 */
export function segmentOf(fn: string, name: string, value: unknown): string {
  if (typeof value === "string" && value !== "" && value.length <= MAX_NAME && value !== "." && value !== ".." && !UNFIT.test(value)) {
    try {
      return encodeURIComponent(value);
    } catch {
      // Half of a surrogate pair: not text that can be sent, and refused like anything else that is no segment.
    }
  }
  throw new TypeError(
    `${fn}: ${name} must be a string of 1 to ${String(MAX_NAME)} characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ${got(value)}`,
  );
}

/** The most Apple documents taking in one request, which is for songs by id. Each item is a URL made longer, so the list is not left open. */
export const MAX_ITEMS = 300;

/** One value of a list: a list is sent joined by commas, so an item with a comma in it would arrive as two. */
export const isItem = (item: unknown): item is string => typeof item === "string" && item !== "" && item.length <= MAX_NAME && !item.includes(",");

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

/** More types than Apple has of resource. Each one is a list of ids, so how many there may be is not left open. */
const MAX_TYPES = 32;

/** How many of its own names an object holds, counted no further than `most` and one: enough to say it holds too many, without reading them all. */
function namesIn(value: object, most: number): number {
  let held = 0;
  for (const key in value) if (Object.hasOwn(value, key) && ++held > most) break;
  return held;
}

/**
 * A name as Apple writes the ones that go in brackets, a type of resource after `ids` or a filter after `filter`:
 * lowercase words with hyphens between, such as `library-playlists` or `storefront-chart`, and no longer than a
 * name may be. Held to that, it stays inside its brackets.
 */
export const isBracketed = (name: unknown): name is string => typeof name === "string" && name.length <= MAX_NAME && /^[a-z]+(-[a-z]+)*$/.test(name);

/**
 * `value` as ids by type, such as `{ songs: ["1"], albums: ["2"] }`, as the parameters they are sent as:
 * `ids[songs]` and `ids[albums]`. Each list is one as `listOf` takes them. A type whose list is undefined is left
 * out, and one at least has to be left in, since ids of no type ask for nothing. Which types there are is Apple's
 * to say: a name is held to what a type's name looks like, so that it stays inside its brackets.
 *
 * All of it goes into one URL, so all of it is bounded: the names by how many there may be, counted before anything
 * is made of them, and the ids by how many there may be over every type together, which is as many as one list
 * may hold.
 */
export function typedIdsOf(fn: string, name: string, value: unknown): Record<string, readonly string[]> {
  if (!isPlain(value)) throw new TypeError(`${fn}: ${name} must be a plain object of ids by type, such as { songs: ["1"] }; got ${gotFor(value)}`);
  const TYPES = `${fn}: ${name} must hold the ids of 1 to ${String(MAX_TYPES)} types; got `;
  if (namesIn(value, MAX_TYPES) > MAX_TYPES) throw new TypeError(`${TYPES}more than ${String(MAX_TYPES)}`);
  const given = Object.entries(value).filter(([, ids]: [string, unknown]) => ids !== undefined);
  if (given.length === 0) throw new TypeError(`${TYPES}0`);
  const lists = given.map(([type, ids]: [string, unknown]): [string, readonly string[]] => {
    if (!isBracketed(type)) throw new TypeError(`${fn}: ${name} holds a name that is no type of resource, which is lowercase words with hyphens between, as library-songs is; got ${got(type)}`);
    return [`ids[${type}]`, listOf(fn, `${name}.${type}`, ids)];
  });
  const total = lists.reduce((sum, [, ids]) => sum + ids.length, 0);
  if (total > MAX_ITEMS) throw new TypeError(`${fn}: ${name} must hold at most ${String(MAX_ITEMS)} ids over all its types; got ${String(total)}`);
  return Object.fromEntries(lists);
}

/** As `listOf`, for a list that may also hold nothing when `least` is 0: an option's list, where nothing means none. */
export function listed(fn: string, name: string, value: unknown, least: 0 | 1): readonly string[] {
  const length = lengthOf(value);
  const items = length !== undefined && length <= MAX_ITEMS ? copyOf(value, length) : [];
  const bad = items.findIndex((item) => !isItem(item));
  if (length !== undefined && items.length === length && length >= least && bad === -1) return items as string[];
  const what = length === undefined ? got(value) : bad === -1 ? `a list of ${String(length)}` : `${got(items[bad])} at index ${String(bad)}`;
  throw new TypeError(`${fn}: ${name} must be a list of 1 to ${String(MAX_ITEMS)} strings, each of 1 to ${String(MAX_NAME)} characters with no comma in it; got ${what}`);
}

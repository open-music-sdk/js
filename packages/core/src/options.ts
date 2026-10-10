// The options a function for an endpoint takes, and how they become what `request` takes. Written once, so that
// the same option means the same thing whichever function it is handed to.
import { MAX_ITEMS, MAX_LENGTH, MAX_NAME, copyOf, gotFor, isItem, isPlain, lengthOf, listed, optionsOf } from "./check";
import type { tParams, tRequestInit, tSchemaLike } from "./client";
import { got } from "./got";

/**
 * What a function that asks Apple for something takes. Every field is optional and an explicit `undefined` means
 * it was not given. Invalid values throw a TypeError, and no error quotes a value.
 */
export interface tReadOptions<T = unknown> {
  /** The language to answer in, as a tag the storefront supports, such as `"en-GB"`. Default: the storefront's own. */
  readonly language?: string | undefined;
  /** The relationships to send in full with each resource, such as `["albums", "artists"]`. An empty list is none. */
  readonly include?: readonly string[] | undefined;
  /** The attributes to add to those sent by default, such as `["artistUrl"]`. An empty list is none. */
  readonly extend?: readonly string[] | undefined;
  /** How many to send in one answer: a whole number above zero. Apple sets the default and the most. */
  readonly limit?: number | undefined;
  /** Where in the collection to start: a whole number from zero, or a cursor as Apple gave it. */
  readonly offset?: number | string | undefined;
  /**
   * Any other query parameter, sent as given: what Apple takes and no option here names. An option that is given,
   * or an argument of the function, wins over the same key here.
   */
  readonly params?: tParams | undefined;
  /** Validates the answer; a failure throws ValidationError. Any Standard Schema, such as a validator from @open-music-sdk/validate. */
  readonly schema?: tSchemaLike<T> | undefined;
  /** Aborts the request. An abort is rethrown as it is. */
  readonly signal?: AbortSignal | undefined;
}

/** What a function that walks pages takes beside the rest: how far a walk may go. */
export interface tWalkOptions {
  /**
   * The most pages a walk may ask Apple for: a whole number above zero. Default: no limit, so a walk goes on for as
   * long as each page names a next one. It is the walk's alone: called with a client, a function asks for the one
   * page it resolves to, whatever this says.
   */
  readonly maxPages?: number | undefined;
}

/** More than any endpoint takes. Each one is a URL made longer, so the bag is not left open. */
const MAX_PARAMS = 100;

type tValue = NonNullable<tParams[string]>;

const isName = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= MAX_NAME;
const isCursor = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= MAX_LENGTH;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A list an option may hold: nothing, when it was not given or holds nothing. */
function namesOf(fn: string, name: string, value: unknown): readonly string[] | undefined {
  const names = value === undefined ? [] : listed(fn, name, value, 0);
  return names.length === 0 ? undefined : names;
}

function languageOf(fn: string, value: unknown): string | undefined {
  if (value === undefined || isName(value)) return value;
  throw new TypeError(`${fn}: language must be a string of 1 to ${String(MAX_NAME)} characters; got ${got(value)}`);
}

function limitOf(fn: string, value: unknown): number | undefined {
  if (value === undefined || (Number.isSafeInteger(value) && (value as number) > 0)) return value as number | undefined;
  throw new TypeError(`${fn}: limit must be a whole number above 0; got ${got(value)}`);
}

function offsetOf(fn: string, value: unknown): number | string | undefined {
  if (value === undefined || isCursor(value) || (Number.isSafeInteger(value) && (value as number) >= 0)) return value as number | string | undefined;
  throw new TypeError(`${fn}: offset must be a whole number from 0, or a cursor of 1 to ${String(MAX_LENGTH)} characters; got ${got(value)}`);
}

function maxPagesOf(fn: string, value: unknown): number | undefined {
  if (value === undefined || (Number.isSafeInteger(value) && (value as number) > 0)) return value as number | undefined;
  throw new TypeError(`${fn}: maxPages must be a whole number above 0; got ${got(value)}`);
}

function schemaOf<T>(fn: string, value: unknown): tSchemaLike<T> | undefined {
  // A Standard Schema is known by what is under "~standard", whatever holds it: an object, or a function, as some libraries' schemas are.
  const standard = (typeof value === "object" && value !== null) || typeof value === "function" ? (value as { "~standard"?: unknown })["~standard"] : undefined;
  if (value === undefined || (typeof standard === "object" && standard !== null && typeof (standard as { validate?: unknown }).validate === "function")) return value as tSchemaLike<T> | undefined;
  throw new TypeError(`${fn}: schema must be a Standard Schema, with a validate function under "~standard"; got ${got(value)}`);
}

/**
 * A signal as `fetch` will take it. Anything else would be found out late, after other things had been asked for,
 * and by the runtime, whose own complaint prints what it was handed.
 */
function signalOf(fn: string, value: unknown): AbortSignal | undefined {
  if (value === undefined || value instanceof AbortSignal) return value;
  throw new TypeError(`${fn}: signal must be an AbortSignal; got ${got(value)}`);
}

/** An option a function takes beyond the ones above, such as `views`: one value, or a list of them. */
function alsoOf(fn: string, name: string, value: unknown): tValue | undefined {
  if (Array.isArray(value)) return namesOf(fn, name, value);
  if (value === undefined || isName(value) || isNumber(value) || typeof value === "boolean") return value;
  throw new TypeError(`${fn}: ${name} must be a string of 1 to ${String(MAX_NAME)} characters, a number, true or false, or a list of strings; got ${got(value)}`);
}

/**
 * A parameter's name as Apple writes them: `include`, `ids[albums]`, `limit[songs:tracks]`. One that fits is too
 * short to be a token and holds nothing a log could be misled by, so the error about its value can name it. One
 * that does not fit is described, as any value is.
 */
const isKey = (key: string): boolean => key.length <= MAX_NAME && /^[a-z][\w.:-]*(\[[\w.:-]+\])*$/i.test(key);

/**
 * One of the caller's own parameters as it can be sent, a list as this call's copy; `undefined` when it cannot be.
 * Text is held to a length and a list's items to what a list's are everywhere here, so nothing a caller put under
 * a name by mistake is sent to Apple at whatever length it has.
 */
function sendable(given: unknown): tValue | undefined {
  if (!Array.isArray(given)) return (typeof given === "string" && given.length <= MAX_LENGTH) || isNumber(given) || typeof given === "boolean" ? given : undefined;
  // A list too long is not read: its length is all that is asked for, and asked once.
  const length = lengthOf(given);
  const list = length !== undefined && length <= MAX_ITEMS ? copyOf(given, length) : [undefined];
  return list.every((each) => isItem(each) || isNumber(each)) ? list : undefined;
}

/** The caller's own parameters. Null, undefined and a list of nothing mean absent. */
function paramsOf(fn: string, value: unknown): [string, tValue][] {
  if (value === undefined) return [];
  // Asked before anything of it is read: a Map or a URLSearchParams would be read as no parameters at all, and a Buffer as one for each of its bytes.
  if (!isPlain(value)) throw new TypeError(`${fn}: params must be a plain object of query parameters; got ${gotFor(value)}`);
  const entries: [string, unknown][] = Object.entries(value);
  if (entries.length > MAX_PARAMS) throw new TypeError(`${fn}: params must hold at most ${String(MAX_PARAMS)} parameters; got ${String(entries.length)}`);
  const out: [string, tValue][] = [];
  for (const [key, given] of entries) {
    if (!isKey(key)) {
      throw new TypeError(
        `${fn}: params holds a name that is not a parameter's, which is letters, digits, "-", "_", "." and ":", with any part in brackets after, as in ids[albums], and at most ${String(MAX_NAME)} characters; got ${got(key)}`,
      );
    }
    if (given === undefined || given === null) continue;
    const item = sendable(given);
    if (item === undefined) {
      throw new TypeError(
        `${fn}: params.${key} must be a string of at most ${String(MAX_LENGTH)} characters, a number, true or false, or a list of at most ${String(MAX_ITEMS)} numbers and strings, each string of 1 to ${String(MAX_NAME)} characters with no comma in it; got ${got(given)}`,
      );
    }
    if (!Array.isArray(item) || item.length > 0) out.push([key, item]);
  }
  return out;
}

/**
 * The options as `request` takes them: each read once, checked, and copied, so that nothing done to the caller's
 * objects afterwards changes what is sent.
 *
 * Three things fill the query, and the later wins: the caller's `params`; then the options that are given, with
 * `language` sent as `l`; then `set`, which is what the function itself puts there, such as the ids it was handed.
 * `also` names any further options the function takes, such as `views`, each sent under its own name.
 */
export function initOf<T>(fn: string, options: tReadOptions<T> | undefined, set: tParams = {}, also: readonly string[] = []): tRequestInit<T> {
  const bag = optionsOf(fn, options, "an options object");
  const { language, include, extend, limit, offset, params, schema, signal } = bag;
  // A Map, so that a name is a key and nothing else, whatever a function's own `set` or `also` names.
  const query = new Map<string, tValue>(paramsOf(fn, params));
  const given: [string, tParams[string]][] = [
    ["l", languageOf(fn, language)],
    ["include", namesOf(fn, "include", include)],
    ["extend", namesOf(fn, "extend", extend)],
    ["limit", limitOf(fn, limit)],
    ["offset", offsetOf(fn, offset)],
    ...also.map((name): [string, tParams[string]] => [name, alsoOf(fn, name, (bag as Record<string, unknown>)[name])]),
    ...Object.entries(set),
  ];
  for (const [key, value] of given) if (value !== undefined && value !== null) query.set(key, value);
  return { params: Object.fromEntries(query), schema: schemaOf(fn, schema), signal: signalOf(fn, signal) };
}

/**
 * As `initOf`, for a function that walks pages: what it gives also holds `maxPages`, the most pages the walk may
 * ask for, when the caller gave one. It is what `paginate` takes, and `request` has no use for it.
 */
export function walkOf<T>(fn: string, options: (tReadOptions<T> & tWalkOptions) | undefined, set: tParams = {}, also: readonly string[] = []): tRequestInit<T> & tWalkOptions {
  const bag = optionsOf(fn, options, "an options object");
  const init = initOf<T>(fn, bag, set, also);
  const maxPages = maxPagesOf(fn, bag.maxPages);
  return maxPages === undefined ? init : { ...init, maxPages };
}

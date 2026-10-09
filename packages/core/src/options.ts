// The options a function for an endpoint takes, and how they become what `request` takes. Written once, so that
// the same option means the same thing whichever function it is handed to.
import { MAX_ITEMS, MAX_LENGTH, MAX_NAME, copyOf, lengthOf, listed, optionsOf } from "./check";
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

function schemaOf<T>(fn: string, value: unknown): tSchemaLike<T> | undefined {
  const standard = typeof value === "object" && value !== null ? (value as { "~standard"?: unknown })["~standard"] : undefined;
  if (value === undefined || (typeof standard === "object" && standard !== null && typeof (standard as { validate?: unknown }).validate === "function")) return value as tSchemaLike<T> | undefined;
  throw new TypeError(`${fn}: schema must be a Standard Schema, with a validate function under "~standard"; got ${got(value)}`);
}

/** An option a function takes beyond the ones above, such as `views`: one value, or a list of them. */
function alsoOf(fn: string, name: string, value: unknown): tValue | undefined {
  if (Array.isArray(value)) return namesOf(fn, name, value);
  if (value === undefined || isName(value) || isNumber(value) || typeof value === "boolean") return value;
  throw new TypeError(`${fn}: ${name} must be a string of 1 to ${String(MAX_NAME)} characters, a number, true or false, or a list of strings; got ${got(value)}`);
}

/** One of the caller's own parameters as it can be sent, a list as this call's copy; `undefined` when it cannot be. */
function sendable(given: unknown): tValue | undefined {
  if (!Array.isArray(given)) return typeof given === "string" || isNumber(given) || typeof given === "boolean" ? given : undefined;
  // A list too long is not read: its length is all that is asked for, and asked once.
  const length = lengthOf(given);
  const list = length !== undefined && length <= MAX_ITEMS ? copyOf(given, length) : [undefined];
  return list.every((each) => typeof each === "string" || isNumber(each)) ? list : undefined;
}

/** The caller's own parameters. Null, undefined and a list of nothing mean absent. */
function paramsOf(fn: string, value: unknown): [string, tValue][] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${fn}: params must be an object of query parameters; got ${got(value)}`);
  const entries: [string, unknown][] = Object.entries(value);
  if (entries.length > MAX_PARAMS) throw new TypeError(`${fn}: params must hold at most ${String(MAX_PARAMS)} parameters; got ${String(entries.length)}`);
  const out: [string, tValue][] = [];
  for (const [key, given] of entries) {
    if (given === undefined || given === null) continue;
    const item = sendable(given);
    if (item === undefined) throw new TypeError(`${fn}: params.${key} must be a string, a number, true or false, or a list of at most ${String(MAX_ITEMS)} strings and numbers; got ${got(given)}`);
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
  // A Map, so that a parameter a caller names `__proto__` is one more parameter and nothing else.
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
  return { params: Object.fromEntries(query), schema: schemaOf(fn, schema), signal };
}

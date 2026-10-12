// What a value holds itself. Apple's answers, a playlist read back from a file and a list of tracks from another
// service are all data from somewhere else, and are read by this rule: a field is there when the object holds it,
// and not when it could be found on Object.prototype, where other code may have put anything.
import { isPlain, ownOf } from "@open-music-sdk/core";

/** Nothing held: an object with no fields, and nothing to inherit one from. */
const NOTHING: Readonly<Record<string, unknown>> = Object.freeze(Object.create(null) as Record<string, unknown>);

/**
 * What a value holds itself, where it is a plain object, and nothing where it is not. Either way what comes back
 * inherits nothing, so a field read from it is one the value held or is `undefined`.
 */
export const held = (value: unknown): Readonly<Record<string, unknown>> => (isPlain(value) ? ownOf(value as Record<string, unknown>) : NOTHING);

/** The first item of a list, where it is a list that holds one itself. An empty list has none, whatever is under `0` on Object.prototype. */
export const first = (list: unknown): unknown => (Array.isArray(list) && Object.hasOwn(list, 0) ? (list[0] as unknown) : undefined);

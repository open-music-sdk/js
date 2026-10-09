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

// What a function is handed is checked where it is handed over. A mistake is a TypeError that names the function
// and the argument and describes the value, never repeats it: a value in the wrong place may be a token.
import { got, parseToken, type tAppleMusicClient, type tUserTokenStore } from "@open-music-sdk/core";

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

/** A client from createClient. What this package calls on it is `as` and `request`. */
export function clientOf(fn: string, client: unknown): tAppleMusicClient {
  if (has(client, ["as", "request"])) return client as tAppleMusicClient;
  throw new TypeError(`${fn}: client must be a client from createClient; got ${got(client)}`);
}

/** A store with the three methods core's `forUser()` and this package call. */
export function storeOf(fn: string, store: unknown): tUserTokenStore {
  if (has(store, ["get", "set", "delete"])) return store as tUserTokenStore;
  throw new TypeError(`${fn}: store must have get, set and delete; got ${got(store)}`);
}

/** The id a token is kept under. It is the app's own, so any string with something in it will do. */
export function userIdOf(fn: string, userId: unknown): string {
  if (typeof userId === "string" && userId !== "") return userId;
  throw new TypeError(`${fn}: userId must be a string with something in it; got ${got(userId)}`);
}

/**
 * The token as core will send it, with the whitespace around it dropped. What a token is, is core's rule and
 * decided nowhere else.
 */
export function tokenOf(fn: string, token: unknown): string {
  const value = parseToken(token);
  if (value !== undefined) return value;
  throw new TypeError(`${fn}: token must be printable characters with no spaces or line breaks inside; got ${got(token)}`);
}

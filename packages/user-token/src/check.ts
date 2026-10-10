// What a function is handed is checked where it is handed over. A mistake is a TypeError that names the function
// and the argument and describes the value, never repeats it: a value in the wrong place may be a token.
// What an object or an options bag is, is core's `has` and `optionsOf`; what is here is this package's own.
import { clientOf as clientWith, got, has, parseToken, type tAppleMusicClient, type tUserTokenStore } from "@open-music-sdk/core";

/** A client from createClient. What this package calls on it is `as` and `request`. */
export const clientOf = (fn: string, client: unknown): tAppleMusicClient => clientWith(fn, client, ["as", "request"]);

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

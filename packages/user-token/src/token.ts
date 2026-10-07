// Getting a Music User Token in: read it from the environment, and ask Apple about it before anything depends on it.
import { AppleMusicError, isAppleMusicError, type tAppleMusicClient, type tErrorDetails } from "@open-music-sdk/core";

// A token is opaque, but it has to travel as a header value: visible ASCII, no whitespace, bounded.
const HEADER_SAFE = /^[\x21-\x7e]{1,4096}$/;
const SHAPE = "expected 1 to 4096 visible ASCII characters with no whitespace";

/** Whether `value` could be sent as a Music-User-Token header. Says nothing about whether Apple accepts it. */
export const isUserTokenShaped = (value: unknown): value is string => typeof value === "string" && HEADER_SAFE.test(value);

// Messages name where a token came from, never the token: errors end up in logs.
const invalid = (message: string, details?: tErrorDetails) => new AppleMusicError("UserTokenInvalid", message, details);

/**
 * Asks Apple whether `token` works, with GET /v1/me/storefront, and resolves to the listener's
 * storefront. Rejects with UserTokenInvalid when it does not: Apple answered 403, or answered 401
 * for the listener while accepting the developer token. Any other failure (developer token, rate
 * limit, network, a reply with no storefront) is the client's usual error.
 */
export async function validateUserToken(client: tAppleMusicClient, token: unknown, init: { readonly signal?: AbortSignal | undefined } = {}): Promise<string> {
  if (!isUserTokenShaped(token)) throw invalid(`Not a Music User Token: ${SHAPE}`);
  const { signal } = init;
  let body: unknown;
  try {
    // Not client.storefront(): that answers from configuration, without asking Apple, when a storefront is set.
    body = await client.as(token).request<unknown>("v1/me/storefront", { signal });
  } catch (e) {
    if (!isAppleMusicError(e, "DeveloperTokenRejected")) throw e;
    // Apple documents two causes for a 401 on a personal endpoint: the developer token, or a listener
    // who is not signed in or has no subscription. One request without the user token tells them
    // apart: if the developer token is the problem this throws, as it would have anyway.
    await client.request("v1/test", { user: false, signal });
    throw invalid("Apple answered 401 for the listener while accepting the developer token: not signed in, or no Apple Music subscription", {
      status: e.status,
      errors: e.errors,
      cause: e,
    });
  }
  const id = (body as { data?: readonly ({ id?: unknown } | null)[] | null } | null | undefined)?.data?.[0]?.id;
  // A 2xx that names no storefront is not Apple accepting the token.
  if (typeof id !== "string") throw new AppleMusicError("ApiError", "/v1/me/storefront returned no storefront", { status: 200 });
  return id;
}

/**
 * The token from an environment variable, for a CLI or job with no HTTP surface; undefined when the
 * variable is unset or blank. `env` defaults to process.env; on Workers pass the bindings object.
 * A value that is set but could not be a token throws UserTokenInvalid, naming the variable.
 */
export function userTokenFromEnv(name = "MUSIC_USER_TOKEN", env?: object): string | undefined {
  const source = env ?? (globalThis as { process?: { env?: object } }).process?.env ?? {};
  const value = (source as Record<string, unknown>)[name];
  // Surrounding whitespace is what pasting into a .env file or a secret manager leaves behind.
  const token = typeof value === "string" ? value.trim() : value;
  if (token == null || token === "") return undefined;
  if (!isUserTokenShaped(token)) throw invalid(`${name} is not a Music User Token: ${SHAPE}`);
  return token;
}

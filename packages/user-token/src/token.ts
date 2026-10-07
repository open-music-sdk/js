// Getting a Music User Token in: read it from the environment, and ask Apple about it before anything depends on it.
import { AppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";

// A token is opaque, but it has to travel as a header value: visible ASCII, no whitespace, bounded.
const HEADER_SAFE = /^[\x21-\x7e]{1,4096}$/;

// Messages name where a token came from, never the token: errors end up in logs.
const invalid = (message: string) => new AppleMusicError("UserTokenInvalid", message);

/**
 * Asks Apple whether `token` works, with GET /v1/me/storefront. Rejects with UserTokenInvalid when it
 * does not; any other failure (developer token, rate limit, network) is the client's usual error.
 */
export async function validateUserToken(client: tAppleMusicClient, token: unknown, init: { readonly signal?: AbortSignal | undefined } = {}): Promise<void> {
  if (typeof token !== "string" || !HEADER_SAFE.test(token))
    throw invalid("Not a Music User Token: expected 1 to 4096 visible ASCII characters with no whitespace");
  // Not client.storefront(): that answers from configuration, without asking Apple, when a storefront is set.
  await client.as(token).request("v1/me/storefront", { signal: init.signal });
}

/**
 * The token from an environment variable, for a CLI or job with no HTTP surface. `env` defaults to
 * process.env; on Workers pass the bindings object. Throws UserTokenInvalid when it is not set.
 */
export function userTokenFromEnv(name = "MUSIC_USER_TOKEN", env?: object): string {
  const source = env ?? (globalThis as { process?: { env?: object } }).process?.env ?? {};
  const token = (source as Record<string, unknown>)[name];
  // Surrounding whitespace is what pasting into a .env file or a secret manager leaves behind.
  if (typeof token !== "string" || token.trim() === "") throw invalid(`No Music User Token: set ${name}`);
  return token.trim();
}

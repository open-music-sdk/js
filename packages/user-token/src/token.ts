// A Music User Token is handed over by the app, wherever the app got it; nothing here reads an environment or a
// file. What this does is ask Apple about it before anything depends on it.
import { AppleMusicError, isAppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import { clientOf, optionsOf, tokenOf } from "./check";

/** Invalid values throw a TypeError. No error quotes a token. */
export interface tValidateOptions {
  /** Aborts the requests to Apple. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Asks Apple whether `token` works, with GET /v1/me/storefront, and resolves to the listener's storefront.
 *
 * What a token is, is core's rule: printable characters with no spaces or line breaks inside, and whitespace
 * around it dropped. A `token` that is not one is the caller's mistake and a TypeError, before Apple is asked;
 * the error describes the value and never repeats it.
 *
 * `UserTokenInvalid` is Apple's verdict and nothing else: Apple answered 403, or answered 401 for the listener
 * while accepting the developer token. Any other failure (developer token, rate limit, network, a reply with no
 * storefront) is the client's usual error and says nothing about the token.
 */
export async function validateUserToken(client: tAppleMusicClient, token: string, options: tValidateOptions = {}): Promise<string> {
  const music = clientOf("validateUserToken", client);
  const value = tokenOf("validateUserToken", token);
  const { signal } = optionsOf("validateUserToken", options, "an options object");
  let body: unknown;
  try {
    // Not client.storefront(): that answers from configuration, without asking Apple, when a storefront is set.
    body = await music.as(value).request<unknown>("v1/me/storefront", { signal });
  } catch (e) {
    if (!isAppleMusicError(e, "DeveloperTokenInvalid")) throw e;
    // Apple documents two causes for a 401 on a personal endpoint: the developer token, or a listener
    // who is not signed in or has no subscription. One request without the user token tells them
    // apart: if the developer token is the problem this throws, as it would have anyway.
    await music.request("v1/test", { user: false, signal });
    throw new AppleMusicError("UserTokenInvalid", "Apple answered 401 for the listener while accepting the developer token: not signed in, or no Apple Music subscription", {
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

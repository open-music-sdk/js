// acceptUserToken: taking a token in for one of your users, without an HTTP request in sight.
import { optionsOf, type tAppleMusicClient, type tUserTokenStore } from "@open-music-sdk/core";
import { clientOf, storeOf, tokenOf, userIdOf } from "./check";
import { validateUserToken, type tValidateOptions } from "./token";

/**
 * Takes a token in for one of your users: asks Apple whether it works and only then stores it under `userId`,
 * replacing the token already there. Resolves to the listener's storefront. Whatever stops it (Apple's verdict,
 * a failure to ask, an abort) leaves the store as it was.
 *
 * It rejects as `validateUserToken` does, and with whatever the store throws. This is all `userTokenIntake` does
 * once it has read its request; call it yourself from a framework that hands you something other than a
 * web-standard Request.
 *
 * @param client - The client to ask Apple with.
 * @param store - Where the token goes once Apple has accepted it: the store your client's `forUser()` reads.
 * @param userId - Your own id for the user, which the token is stored under.
 * @param token - The Music User Token to take in.
 * @param options - A `signal` to abort with.
 * @returns The listener's storefront id, such as `us`.
 * @throws TypeError if `client` is not a client, `store` lacks `get`, `set` or `delete`, `userId` is not a string
 *   with something in it, `token` is not a token, or `options` is not a plain object, before Apple is asked.
 * @throws AppleMusicError as `validateUserToken` throws it: `UserTokenInvalid` when Apple will not take the token,
 *   otherwise what asking failed with.
 * @throws Whatever `store.set` rejects with, once Apple has accepted the token.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export async function acceptUserToken(client: tAppleMusicClient, store: tUserTokenStore, userId: string, token: string, options: tValidateOptions = {}): Promise<string> {
  // Everything is checked before Apple is asked: a mistake here must not cost a request, or leave a token
  // validated and nowhere to put it.
  const music = clientOf("acceptUserToken", client);
  const kept = storeOf("acceptUserToken", store);
  const id = userIdOf("acceptUserToken", userId);
  // The token is stored as it was validated and will be sent: with the whitespace around it dropped.
  const value = tokenOf("acceptUserToken", token);
  const storefront = await validateUserToken(music, value, optionsOf("acceptUserToken", options, "an options object"));
  await kept.set(id, value);
  return storefront;
}

// acceptUserToken: taking a token in for one of your users, without an HTTP request in sight.
import type { tAppleMusicClient, tUserTokenStore } from "@open-music-sdk/core";
import { tokenOf } from "./check.js";
import { validateUserToken, type tValidateOptions } from "./token.js";

/**
 * Takes a token in for one of your users: asks Apple whether it works and only then stores it under `userId`,
 * replacing the token already there. Resolves to the listener's storefront. Whatever stops it (Apple's verdict,
 * a failure to ask, an abort) leaves the store as it was.
 *
 * It rejects as `validateUserToken` does, and with whatever the store throws. This is all `userTokenIntake` does
 * once it has read its request; call it yourself from a framework that hands you something other than a
 * web-standard Request.
 */
export async function acceptUserToken(client: tAppleMusicClient, store: tUserTokenStore, userId: string, token: string, options: tValidateOptions = {}): Promise<string> {
  // The token is stored as it was validated and will be sent: with the whitespace around it dropped.
  const value = tokenOf("acceptUserToken", token);
  const storefront = await validateUserToken(client, value, options);
  await store.set(userId, value);
  return storefront;
}

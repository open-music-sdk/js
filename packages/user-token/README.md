# @open-music-sdk/user-token

Everything around a listener's Music User Token except issuing it: asking Apple whether it works, taking it in from
your page, and keeping it where `core`'s `forUser(userId)` finds it. Only Apple's sign-in issues the token. This
package starts once you hold the string.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which re-export what an app uses of this package. Use this
one to build your own client.

```
pnpm add @open-music-sdk/user-token @open-music-sdk/core
```

Keep the two on the same version. See
[One version for every package](https://open-music-sdk.github.io/js/concepts/packages#one-version-for-every-package).

## Example

On your server. `sessionUserId(req)` and `userId` stand for your own session lookup:

```ts
import { createClient } from "@open-music-sdk/core";
import { developerTokenMinter } from "@open-music-sdk/developer-token";
import { MemoryUserTokenStore, userTokenIntake } from "@open-music-sdk/user-token";

const store = new MemoryUserTokenStore();
const music = createClient({
  developerToken: developerTokenMinter({ pem: process.env.APPLE_MUSIC_PRIVATE_KEY!, teamId: process.env.APPLE_MUSIC_TEAM_ID!, keyId: process.env.APPLE_MUSIC_KEY_ID! }),
  userTokenStore: store,
});

// The route your page posts { "token": "..." } to. Apple checks the token, and only then does the store keep it.
export const POST = userTokenIntake(music, { store, userId: (req) => sessionUserId(req) });

// In any later request, the listener's token is looked up in the store.
const playlists = await music.forUser(userId).request("v1/me/library/playlists");
```

## What's in it

A verb does the thing once. A `userToken…` noun is something to hand on, such as a handler for your router. The
stores are classes, which you give `createClient` as `userTokenStore`.

| Export | What it does |
| --- | --- |
| `validateUserToken(client, token, options?)` | Asks Apple whether the token works, and resolves to the listener's storefront |
| `acceptUserToken(client, store, userId, token, options?)` | Checks the token with Apple, and only then stores it under `userId` |
| `userTokenIntake(client, options)` | `acceptUserToken` behind a web-standard handler, `(req: Request) => Promise<Response>` |
| `MemoryUserTokenStore` | A store in the process's memory, gone on restart |
| `KvUserTokenStore(kv, options?)` | A store over Workers KV, or anything with KV's `get`, `put` and `delete` |
| `tValidateOptions`, `tIntakeOptions`, `tKvStoreOptions` | The options each of those takes |
| `tUserTokenIntake`, `tKvNamespace` | The handler's type, and the part of a KV namespace the store uses |
| `tUserTokenStore` | `core`'s interface for a store, for one of your own |

## Learn more

- [Keep a listener's token on your server](https://open-music-sdk.github.io/js/guides/store-user-tokens): the
  intake route, its answers, `acceptUserToken` for other frameworks, and choosing a store
- [Sign a listener in](https://open-music-sdk.github.io/js/guides/sign-in), which gets the token in your page
- [Cloudflare Workers](https://open-music-sdk.github.io/js/guides/cloudflare-workers), for `KvUserTokenStore`
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens): where the token
  can go, and how to treat it
- [Security model](https://open-music-sdk.github.io/js/concepts/security#on-your-server), for what the intake route
  and the stores do and don't protect
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/user-token/)

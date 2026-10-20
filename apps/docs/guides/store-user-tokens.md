# Keep a listener's token on your server

In a full-stack app, your server calls Apple for the listener. In this guide your page posts the listener's
[Music User Token](../glossary#music-user-token) to a route on your server, which checks it with Apple and stores
it under your own user id. Later requests act for the listener by that id.

Before you start, you need:

- your MusicKit key on your server. See [Set up your MusicKit key](./musickit-key).
- a page that signs the listener in. See [Sign a listener in](./sign-in).
- sessions of your own, which tell your server which of your users sent a request.

In the code below, `userId` is your own id for the signed-in user, and `sessionUserId`, `showSignInAgain` and
`askListenerToReconnect` stand for your own code.

## 1. Make a store and a client

On your server, create one store and one client, and share them between your routes:

```ts
// music.ts
import {
  MemoryUserTokenStore,
  createServerClient,
} from "@open-music-sdk/server";

export const store = new MemoryUserTokenStore();
export const music = createServerClient({
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
  storefront: "us",
  userTokenStore: store,
});
```

`MemoryUserTokenStore` loses every token when the process restarts. [Choose a store](#choose-a-store) covers the
others.

## 2. Mount the intake route

On your server, mount `userTokenIntake` as the `POST` handler of a route, here `/api/music/user-token`. It takes a
web-standard `Request` and returns a `Response`:

```ts
import { userTokenIntake } from "@open-music-sdk/server";
import { music, store } from "./music";

export const POST = userTokenIntake(music, {
  store,
  userId: (req) => sessionUserId(req),
});
```

`userId` finds the signed-in user from your own session, and returns nothing when there's none. The token is
stored under the id it returns. `userTokenIntake` checks `store` and `userId` when you create it, so a mistake is
a `TypeError` at startup.

The route takes a `POST` with `Content-Type: application/json` and a body of `{ "token": "..." }`. It asks Apple
whether the token works, stores it only if Apple accepts it, and answers:

| Status | Body | When |
| --- | --- | --- |
| 204 | none | Apple accepted the token and the store has it |
| 400 | `{ "error": "BadRequest" }` | The body isn't JSON, or has no string `token` |
| 401 | `{ "error": "Unauthorized" }` | `userId` returned nothing |
| 405 | `{ "error": "MethodNotAllowed" }` | The request isn't a `POST` |
| 413 | `{ "error": "PayloadTooLarge" }` | The body is over 8 KiB |
| 415 | `{ "error": "UnsupportedMediaType" }` | The content type isn't `application/json` |
| 422 | `{ "error": "UserTokenInvalid" }` | What was posted isn't a token, or Apple refused it. Nothing is stored. |
| 502 | `{ "error": "<tag>" }` | Apple didn't confirm the token: the tag is `DeveloperTokenInvalid`, `DeveloperTokenUnavailable`, `RateLimited`, `ApiError` or `NetworkError`. Nothing is stored. |

Anything else that fails rejects the handler, and is yours to answer: `userId` or the store throwing, a body
something else has already read, a request aborted part way.

The route waits for Apple as long as the client's `retry` option lets it. If a page waits on this route, give the
route a client with a shorter wait, or put your own timeout around the handler. [Handle errors](./errors) shows
how to set `retry`.

::: warning Who can post a token
- Have `userId` return the user from your own session, and nothing when there's none. It's the route's only
  authentication.
- Don't let your CORS policy allow other origins to send `Content-Type: application/json` with credentials.
  Requiring JSON is what stops another site from posting its own token for your visitor.
- Rate-limit the route as you would a login. Every token it checks costs at least one request to Apple.

The [security model](../concepts/security#on-your-server) explains each of these, and what the route sends back.
:::

## 3. Post the token from the page

In your page, post the token `connect()` resolves to, in step 4 of [Sign a listener in](./sign-in):

```ts
async function sendToken(musicUserToken: string): Promise<void> {
  const res = await fetch("/api/music/user-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: musicUserToken }),
  });
  if (res.status === 204) return; // checked and stored
  if (res.status === 422) return showSignInAgain(); // Apple refused it
  throw new Error(`Could not connect Apple Music: ${res.status}`);
}
```

The page keeps nothing. Your server makes every later call to Apple.

## 4. Act for the listener

On your server, in any later request, `music.forUser(userId)` gives a client for the listener. It looks their
token up in the store at each request:

```ts
import { isAppleMusicError } from "@open-music-sdk/server";
import { music, store } from "./music";

const sent = await store.get(userId);
try {
  await music.forUser(userId).user.addToLibrary({ songs: ["1613600188"] });
} catch (e) {
  if (!isAppleMusicError(e, "UserTokenInvalid")) throw e;
  // Forget only the token Apple refused. The listener may have signed in
  // again, and a new token been stored, while this request was on its way.
  if ((await store.get(userId)) === sent) {
    await store.delete(userId);
    askListenerToReconnect(userId);
  }
}
```

A listener the store has no token for gets a `UserTokenInvalid` error from the first request, as one whose token
Apple answers `403` to does.

A listener who isn't signed in to Apple Music, or has no subscription, can get a `401` instead. That arrives as
`DeveloperTokenInvalid`, as a developer token Apple refuses does, so the example above lets it through.
`validateUserToken` tells the two apart: it rejects with `UserTokenInvalid` when the listener is the cause. See
[Handle errors](./errors).

When the listener signs out in your page, delete their token on your server too, with `store.delete(userId)`. The
samples' servers take a `DELETE` on the same route, which the page sends once Apple's sign-out is done:

::: code-group

<<< @/../../samples/worker-server/src/index.ts#sign-out{ts} [Cloudflare Workers]

<<< @/../../samples/express-server/src/server.ts#sign-out{ts} [Express]

:::

The [sample apps](../samples)' servers ask Apple what the listener played lately this way, with a session cookie
standing in for your own sessions:

::: code-group

<<< @/../../samples/worker-server/src/index.ts#act-for-listener{ts} [Cloudflare Workers]

<<< @/../../samples/express-server/src/server.ts#act-for-listener{ts} [Express]

:::

## 5. Take a token in without a web-standard `Request`

If your framework hands you something other than a web-standard `Request`, as Express does, call
`acceptUserToken` yourself. It's what the intake route does once it has read the request: it asks Apple, and
stores the token only if Apple accepts it.

On your server, as the [Express sample](../samples) does it, with `sessionOf` reading its session cookie in place
of your own sessions:

<<< @/../../samples/express-server/src/server.ts#user-token{ts}

It answers a token as the intake route does: `422` when it's no good, and `502` when Apple didn't confirm it. Check
the session and require JSON here too, for the reasons in step 2. `express.json()` reads a body only when its
content type is JSON. Answer every request with `Cache-Control: no-store`, as the sample does for everything under
`/api`.

Check that what was posted is a token before you call `acceptUserToken`, rather than catching its `TypeError`. It
throws one for a string that isn't a token, but a `pem` that isn't a key throws one too, at the first request, and
a listener told their sign-in failed would never learn that your key is the problem.

## Choose a store

A store is where `forUser(userId)` finds a listener's token. Pass the same one to `createServerClient` as
`userTokenStore`, and to the intake route as `store`.

`MemoryUserTokenStore` keeps tokens in the process's memory. It loses them all when the process restarts, and
isn't shared between processes or isolates. Use it for tests, scripts and a server that runs as one process.

`KvUserTokenStore` keeps tokens in a Cloudflare Workers KV namespace, or in anything with KV's `get`, `put` and
`delete`. It stores each token under `music-user-token:` followed by the user id. To change that, pass a
`prefix`:

```ts
import { KvUserTokenStore } from "@open-music-sdk/server";

// env.MUSIC_TOKENS is a KV namespace bound to your Worker.
const store = new KvUserTokenStore(env.MUSIC_TOKENS, {
  prefix: "apple-music:",
});
```

Workers KV is eventually consistent, which the [security model](../concepts/security#on-your-server) covers. See
[Cloudflare Workers](./cloudflare-workers) for where to create the store in a Worker.

For anything else, write a store of your own: an object with the three methods `forUser` and the intake need.

```ts
import type { tUserTokenStore } from "@open-music-sdk/server";

// `db` stands for your own database.
const store: tUserTokenStore = {
  get: async (userId) => (await db.musicTokens.find(userId))?.token,
  set: async (userId, token) => {
    await db.musicTokens.save(userId, token);
  },
  delete: async (userId) => {
    await db.musicTokens.remove(userId);
  },
};
```

`get` resolves to `undefined` when there's no token for the user.

::: warning Neither store encrypts
Whoever can read your KV namespace can read the tokens in it. Wrap the namespace if you need more than your
platform provides, and keep tokens out of logs, URLs and browser storage. See the [security model](../concepts/security#on-your-server).
:::

## Next steps

- [Handle errors](./errors), for the other errors a listener's request can end in.
- [Cloudflare Workers](./cloudflare-workers) and [Next.js](./nextjs), for this setup on each platform.
- The reference for [`userTokenIntake`](../reference/@open-music-sdk/user-token/functions/userTokenIntake),
  [`acceptUserToken`](../reference/@open-music-sdk/user-token/functions/acceptUserToken),
  [`MemoryUserTokenStore`](../reference/@open-music-sdk/user-token/classes/MemoryUserTokenStore) and
  [`KvUserTokenStore`](../reference/@open-music-sdk/user-token/classes/KvUserTokenStore).

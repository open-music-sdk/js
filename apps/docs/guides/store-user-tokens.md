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
import { MemoryUserTokenStore, createServerClient } from "@open-music-sdk/server";

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

export const POST = userTokenIntake(music, { store, userId: (req) => sessionUserId(req) });
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

Every answer says `Cache-Control: no-store`, and none carries the token or Apple's error text.

Anything else that fails rejects the handler, and is yours to answer: `userId` or the store throwing, a body
something else has already read, a request aborted part way.

The route waits for Apple as the client's `retry` option says. By default it tries a failure once more, and waits
out a `429` for a `Retry-After` of up to 60 seconds before it answers. If a page waits on this route, give it a
client with a shorter wait, or put your own timeout around the handler. [Handle errors](./errors) shows how to
set the client's `retry`.

::: warning Who can post a token
- `userId` is the authentication. It must return the signed-in user from your own session, and nothing when
  there's none. The body can't name a user.
- Requiring JSON is the cross-site defence. A form or a `no-cors` fetch on another site can't send
  `application/json`, so it can't bind its own token to your visitor. That holds only while your CORS policy
  doesn't let other origins send that header with credentials.
- Every token the route checks costs a request to Apple against your developer token, and a `401` costs one more
  to find out whose it was. Rate-limit the route as you would a login.
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
  // Forget only the token Apple refused. The listener may have signed in again, and a new token
  // been stored, while this request was on its way.
  if ((await store.get(userId)) === sent) {
    await store.delete(userId);
    askListenerToReconnect(userId);
  }
}
```

A listener the store has no token for gets a `UserTokenInvalid` error from the first request, as one whose token
Apple refused does.

When the listener signs out in your page, delete their token on your server too, with `store.delete(userId)`.

## 5. Take a token in without a web-standard `Request`

If your framework hands you something other than a web-standard `Request`, as Express does, call
`acceptUserToken` yourself. It's what the intake route does once it has read the request: it asks Apple, and
stores the token only if Apple accepts it.

On your server:

```ts
import { acceptUserToken, isAppleMusicError } from "@open-music-sdk/server";
import express from "express";
import { music, store } from "./music";

const app = express();

app.post("/api/music/user-token", express.json(), async (req, res) => {
  const userId = sessionUserId(req);
  if (!userId) return void res.status(401).end();
  const token: unknown = req.body?.token;
  if (typeof token !== "string") return void res.status(400).end();
  try {
    await acceptUserToken(music, store, userId, token);
    res.status(204).end();
  } catch (e) {
    if (isAppleMusicError(e, "UserTokenInvalid")) res.status(422).end();
    else throw e;
  }
});
```

Check the session and require JSON here too, for the reasons in step 2. `express.json()` reads a body only when
its content type is JSON.

`acceptUserToken` throws a `TypeError` for a string that isn't a token, such as one with a space inside, before
Apple is asked; the intake route answers that with `422`. Any other `AppleMusicError` means Apple didn't confirm
the token, which the intake route answers with `502`.

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
const store = new KvUserTokenStore(env.MUSIC_TOKENS, { prefix: "apple-music:" });
```

Workers KV is eventually consistent. A token just stored or just deleted can take up to a minute to look that
way elsewhere, and Apple's `403` stays the final word on whether a token works. See
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
`KvUserTokenStore` writes the token as it's given, so whoever can read the namespace can read the token. Wrap
the namespace if you need more than your platform provides. A Music User Token is as sensitive as a session
cookie: keep it out of logs, URLs and browser storage. See the [security model](../concepts/security).
:::

## Next steps

- [Handle errors](./errors), for the other errors a listener's request can end in.
- [Cloudflare Workers](./cloudflare-workers) and [Next.js](./nextjs), for this setup on each platform.
- The reference for [`userTokenIntake`](../reference/@open-music-sdk/user-token/functions/userTokenIntake),
  [`acceptUserToken`](../reference/@open-music-sdk/user-token/functions/acceptUserToken),
  [`MemoryUserTokenStore`](../reference/@open-music-sdk/user-token/classes/MemoryUserTokenStore) and
  [`KvUserTokenStore`](../reference/@open-music-sdk/user-token/classes/KvUserTokenStore).

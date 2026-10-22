# Keep a listener's token on your server

In a full-stack app, your server calls Apple for the listener. In this guide your page posts the listener's
[Music User Token](../glossary#music-user-token) to a route on your server, which checks it with Apple and stores
it under your own user id. Later requests act for the listener by that id.

Before you start, you need:

- your MusicKit key and its two IDs in your server's environment, as `APPLE_MUSIC_PRIVATE_KEY`,
  `APPLE_MUSIC_TEAM_ID` and `APPLE_MUSIC_KEY_ID`. See [Set up your MusicKit key](./musickit-key).
- a page that signs the listener in, and so holds their Music User Token. See [Sign a listener in](./sign-in).
- sessions of your own, which tell your server which of your users sent a request.

In the code below, these stand for your own code:

- `sessionOf(req)` is your own session lookup. It takes the request your framework hands you, and returns the
  signed-in user's id, or `undefined` when there's none.
- `userId` is that id, in a request from a signed-in user.
- `showSignInAgain()` asks the listener, in your page, to sign in again.
- `askListenerToReconnect(userId)` has that user asked to sign in again.

## 1. Make a store and a client

On your server, create one store and one client, and share them between your routes.

::: for server=express
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
:::

::: for server=workers
A Worker is handed its secrets with each request, in `env`, so make the store and the client on the first one, and
keep them for the rest:

```ts
// src/music.ts
import {
  KvUserTokenStore,
  createServerClient,
  type tKvNamespace,
  type tMusic,
} from "@open-music-sdk/server";

// What the Worker is handed in `env`: your key as secrets, and a KV
// namespace bound as MUSIC_USER_TOKENS.
export interface Env {
  readonly APPLE_MUSIC_PRIVATE_KEY: string;
  readonly APPLE_MUSIC_TEAM_ID: string;
  readonly APPLE_MUSIC_KEY_ID: string;
  readonly MUSIC_USER_TOKENS: tKvNamespace;
}

interface tServer {
  readonly music: tMusic;
  readonly store: KvUserTokenStore;
}

let made: tServer | undefined;

export function setUp(env: Env): tServer {
  if (made !== undefined) return made;
  const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS);
  const music = createServerClient({
    pem: env.APPLE_MUSIC_PRIVATE_KEY,
    teamId: env.APPLE_MUSIC_TEAM_ID,
    keyId: env.APPLE_MUSIC_KEY_ID,
    storefront: "us",
    userTokenStore: store,
  });
  made = { music, store };
  return made;
}
```

`KvUserTokenStore` keeps the tokens in Workers KV, where every instance of your Worker finds them.
[Deploy a Worker](./cloudflare-workers) makes the namespace at Cloudflare.
:::

::: for server=nextjs
`next build` loads your modules with no key, so make the store and the client on first use:

```ts
// src/lib/music.ts
import {
  MemoryUserTokenStore,
  createServerClient,
  type tMusic,
  type tUserTokenStore,
} from "@open-music-sdk/server";

interface tServer {
  readonly music: tMusic;
  readonly store: tUserTokenStore;
}

// Kept on globalThis: Next can load this module more than once, in each
// route's bundle, and every copy has to find the same tokens.
const held = globalThis as { musicServer?: tServer };

function made(): tServer {
  if (held.musicServer !== undefined) return held.musicServer;
  const store = new MemoryUserTokenStore();
  const music = createServerClient({
    pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
    teamId: process.env.APPLE_MUSIC_TEAM_ID!,
    keyId: process.env.APPLE_MUSIC_KEY_ID!,
    storefront: "us",
    userTokenStore: store,
  });
  held.musicServer = { music, store };
  return held.musicServer;
}

export const getMusic = (): tMusic => made().music;
export const getStore = (): tUserTokenStore => made().store;
```

`MemoryUserTokenStore` loses every token when the server restarts. [Choose a store](#choose-a-store) covers the
others.
:::

## 2. Mount the intake route

On your server, take the listener's token in at a route, here `/api/music/user-token`, with `userTokenIntake`. It
takes a web-standard `Request` and returns a `Response`.

::: for server=workers
In your Worker, make the intake on the first request, with step 1's store and client:

```ts
// src/index.ts
import {
  userTokenIntake,
  type tUserTokenIntake,
} from "@open-music-sdk/server";
import { setUp, type Env } from "./music";

let intake: tUserTokenIntake | undefined;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname !== "/api/music/user-token") {
      return new Response(null, { status: 404 });
    }
    const { music, store } = setUp(env);
    intake ??= userTokenIntake(music, {
      store,
      userId: (req) => sessionOf(req),
    });
    return intake(req);
  },
};
```
:::

::: for server=express
Express hands a route Node's request instead of a web `Request`, so call `acceptUserToken` yourself, as
[step 5](#_5-take-a-token-in-without-a-web-standard-request) shows.
:::

::: for server=nextjs
Mount it as the `POST` of a route handler, here `src/app/api/music/user-token/route.ts`, and make it on the first
request, since `next build` runs with no key. In the code below, from the [Next sample](../samples),
`userTokenIntake` and the type `tUserTokenIntake` come from `@open-music-sdk/server`, and `getMusic()` and
`getStore()` are step 1's. `sessionId()` is your session lookup in Next: it reads the request's cookies itself,
and resolves to the signed-in user's id, or `undefined`:

<<< @/../../samples/web-nextjs/src/app/api/music/user-token/route.ts#user-token{ts}
:::

`userId` finds the signed-in user from your own session, and returns nothing when there's none. The token is
stored under the id it returns. `userTokenIntake` checks `store` and `userId` when you create it, so a mistake is
a `TypeError` there.

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

In your page, post the Music User Token your sign-in gives you, the one `connect()` resolves to:

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
token up in step 1's store at each request.

::: for server=express
In the code below, `music` and `store` are step 1's, imported from `./music`:
:::

::: for server=workers
In the code below, `music` and `store` are the ones step 1's `setUp(env)` gives, in your `fetch` handler:
:::

::: for server=nextjs
In the code below, `music` and `store` are step 1's `getMusic()` and `getStore()`, in a server component, a
server action or a route handler:
:::

```ts
import { isAppleMusicError } from "@open-music-sdk/server";

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

When the listener signs out in your page, delete their token on your server too, with `store.delete(userId)`. Take
a `DELETE` on the same route for it, and have the page send it before Apple's sign-out, so that a sign-out Apple's
script fails still leaves no token on the server:

::: for server=workers
In your Worker, send the route's `DELETE` to it before the intake, which answers anything but a `POST` with
`405`: `if (req.method === "DELETE") return signOut(store, req);`. The type `tUserTokenStore` comes from
`@open-music-sdk/server`:

<<< @/../../samples/worker-server/src/index.ts#sign-out{ts}
:::

::: for server=express
Here and below, `app` is your Express app:

<<< @/../../samples/express-server/src/server.ts#sign-out{ts}
:::

::: for server=nextjs
<<< @/../../samples/web-nextjs/src/app/api/music/user-token/route.ts#sign-out{ts}
:::

## 5. Take a token in without a web-standard `Request`

If your framework hands you something other than a web-standard `Request`, as Express does, call
`acceptUserToken` yourself. It's what the intake route does once it has read the request: it asks Apple, and
stores the token only if Apple accepts it.

On your server, take the token in an Express route, as the [Express sample](../samples) does. In its code, `app` is
your Express app, `music` and `store` are step 1's, and `acceptUserToken` and `parseToken` come from
`@open-music-sdk/server`. `parseToken` returns what was posted as a token, or `undefined` when it isn't one:

<<< @/../../samples/express-server/src/server.ts#user-token{ts}

It answers a token as the intake route does: `422` when it's no good, and `502` when Apple didn't confirm it. Check
the session and require JSON here too, for the reasons in step 2. `express.json()` reads a body only when its
content type is JSON. Send `Cache-Control: no-store` with every answer, as the intake route does.

Check that what was posted is a token, with `parseToken`, before you call `acceptUserToken`, rather than catching
its `TypeError`. It throws one for a string that isn't a token, but a `pem` that isn't a key throws one too, at the
first request, and a listener told their sign-in failed would never learn that your key is the problem.

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

// env.MUSIC_USER_TOKENS is a KV namespace bound to your Worker.
const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS, {
  prefix: "apple-music:",
});
```

Workers KV is eventually consistent, which the [security model](../concepts/security#on-your-server) covers.
[Deploy a Worker](./cloudflare-workers) makes a namespace at Cloudflare.

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
- [Set up your server](./server-setup), for the store and the client on each server.
- The reference for [`userTokenIntake`](../reference/@open-music-sdk/user-token/functions/userTokenIntake),
  [`acceptUserToken`](../reference/@open-music-sdk/user-token/functions/acceptUserToken),
  [`MemoryUserTokenStore`](../reference/@open-music-sdk/user-token/classes/MemoryUserTokenStore) and
  [`KvUserTokenStore`](../reference/@open-music-sdk/user-token/classes/KvUserTokenStore).

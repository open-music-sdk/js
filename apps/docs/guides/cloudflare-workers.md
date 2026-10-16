# Cloudflare Workers

In this guide you write a Worker that hands your pages a developer token, takes in listeners' Music User Tokens
and keeps them in Workers KV, and calls Apple for a signed-in listener.

Before you start, you need:

- your MusicKit private key, key ID and team ID. See [Set up your MusicKit key](./musickit-key).
- a Worker project that you run with Wrangler.
- a KV namespace bound to the Worker. This guide calls the binding `MUSIC_USER_TOKENS`.
- a session of your own, which tells the Worker who is signed in.

## 1. Install the package

```
pnpm add @open-music-sdk/server
```

The package runs on Workers as it is. It needs nothing but `fetch` and WebCrypto, which Workers have.

## 2. Put your key in Worker secrets

Store the key and its two IDs as secrets of the Worker:

```
npx wrangler secret put APPLE_MUSIC_PRIVATE_KEY
npx wrangler secret put APPLE_MUSIC_TEAM_ID
npx wrangler secret put APPLE_MUSIC_KEY_ID
```

Wrangler asks for each value. For the key, paste the contents of the `.p8` file on one line, with each line break
written as `\n`. The SDK reads line breaks escaped that way.

For local development, put the same three in a `.dev.vars` file next to your Wrangler config, which `wrangler dev`
reads:

```
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG…\n-----END PRIVATE KEY-----"
APPLE_MUSIC_TEAM_ID="ABCDE12345"
APPLE_MUSIC_KEY_ID="ABC123DEFG"
```

::: warning Never commit `.dev.vars`
It holds your private key. Add it to `.gitignore` before you write the key into it.
:::

## 3. Write the Worker

The Worker below is complete. Your session lookup is the one piece left to you: `sessionUserId` stands for it, and
resolves to the signed-in user's id, or `undefined` when there is none.

```ts
// src/index.ts
import {
  KvUserTokenStore,
  createServerClient,
  isAppleMusicError,
  tokenEndpoint,
  userTokenIntake,
  type tKvNamespace,
  type tMusic,
  type tTokenEndpoint,
  type tUserTokenIntake,
} from "@open-music-sdk/server";

interface Env {
  APPLE_MUSIC_PRIVATE_KEY: string;
  APPLE_MUSIC_TEAM_ID: string;
  APPLE_MUSIC_KEY_ID: string;
  MUSIC_USER_TOKENS: tKvNamespace;
}

interface App {
  readonly music: tMusic;
  readonly token: tTokenEndpoint;
  readonly intake: tUserTokenIntake;
}

// Made on the first request, and kept for every request this isolate serves after it.
let app: App | undefined;

function setUp(env: Env): App {
  const key = { pem: env.APPLE_MUSIC_PRIVATE_KEY, teamId: env.APPLE_MUSIC_TEAM_ID, keyId: env.APPLE_MUSIC_KEY_ID };
  const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS);
  const music = createServerClient({ ...key, storefront: "us", userTokenStore: store });
  return {
    music,
    token: tokenEndpoint({ ...key, origin: ["https://app.example"] }),
    intake: userTokenIntake(music, { store, userId: (req) => sessionUserId(req, env) }),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { music, token, intake } = (app ??= setUp(env));
    const { pathname } = new URL(req.url);

    if (pathname === "/api/music/token") return token(req);
    if (pathname === "/api/music/user-token") return intake(req);

    if (pathname === "/api/music/playlists") {
      const userId = await sessionUserId(req, env);
      if (userId === undefined) return new Response(null, { status: 401 });
      const names: string[] = [];
      try {
        for await (const playlist of music.forUser(userId).user.listLibraryPlaylists()) {
          names.push(playlist.attributes?.name ?? "");
        }
      } catch (e) {
        if (isAppleMusicError(e, "UserTokenInvalid")) return Response.json({ error: "UserTokenInvalid" }, { status: 422 });
        throw e;
      }
      return Response.json({ names });
    }

    return new Response("Not found", { status: 404 });
  },
};
```

If you generate your `Env` type with `wrangler types`, use that one instead. Its KV namespace type fits
`KvUserTokenStore`.

### Made once, on the first request

A Worker is handed its secrets with each request, in `env`. Make the client from them on the first request, and
keep it in a module variable, as `app ??= setUp(env)` does.

Don't make it per request. A client made per request imports the key and signs a new token on every request. One
kept in the module signs a token once, reuses it for every request the isolate serves, and replaces it in the
background halfway through its life. `tokenEndpoint` keeps a token of its own the same way, so page loads within
a token's life share one signature.

### The two routes

`tokenEndpoint` and `userTokenIntake` each take a web-standard `Request` and return a `Response`, and answer
methods themselves. The token route answers a `GET` with a token, and any method but `GET` or `OPTIONS` with
`405`. The user-token route takes a `POST` from your page and answers any other method with `405`. So the Worker
routes them by path alone.

[Serve a developer token to a page](./token-endpoint) explains `origin`, and what limits who can take tokens from
the token route. [Keep a listener's token on your server](./store-user-tokens) covers what the user-token route
answers, and what the page posts to it.

::: warning Who can post a token
Read the warnings in [Mount the intake route](./store-user-tokens#_2-mount-the-intake-route) before you deploy
the user-token route: on `userId`, on your CORS policy, and on rate-limiting it.
:::

### Acting for a listener

`music.forUser(userId)` gives a client for one listener. At each request it reads that listener's token from
the store. A listener the store has no token for gets a `UserTokenInvalid` error, as does one whose token Apple
answers `403` to. The Worker answers `422` then, and your page asks the listener to sign in again.

A listener who isn't signed in to Apple Music, or has no subscription, can get a `401` instead, which arrives as
`DeveloperTokenInvalid` and which this Worker rethrows. `validateUserToken` tells it apart from a developer token
Apple refuses. See [Handle errors](./errors).

## 4. Keep listeners' tokens in Workers KV

`KvUserTokenStore` keeps each token in your namespace under `music-user-token:` and the user's id. To share a
namespace with other data, give it a prefix of your own:

```ts
const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS, { prefix: "apple-music:" });
```

The store checks the namespace and the prefix when you make it: a binding without `get`, `put` and `delete`, or a
prefix that isn't a string, is a `TypeError` then.

Workers KV is eventually consistent. A token just stored or just deleted can take up to a minute to look that way
from elsewhere. Apple's refusal of a token stays the final word.

::: warning The store doesn't encrypt tokens
`KvUserTokenStore` writes each token as it's given, so whoever can read the namespace can read the tokens. A Music
User Token is as sensitive as a session cookie. To encrypt them, wrap the namespace in an object of your own with
the same `get`, `put` and `delete`.
:::

## 5. Point your page at the Worker

In your page, give the token route's URL to `createBrowserClient`:

```ts
import { createBrowserClient } from "@open-music-sdk/browser";

const music = createBrowserClient({ tokenUrl: "https://worker.example/api/music/token", storefront: "us" });
```

The page can be on another origin than the Worker, such as a static site, as long as it's one of the origins you
gave `tokenEndpoint`. The route sends the CORS header for those origins only.

## Next steps

- [Keep a listener's token on your server](./store-user-tokens), for the user-token route and when to forget a
  token.
- [Serve a developer token to a page](./token-endpoint), for the token route's options and its limits.
- The reference for [`createServerClient`](../reference/@open-music-sdk/server/functions/createServerClient) and
  [`KvUserTokenStore`](../reference/@open-music-sdk/user-token/classes/KvUserTokenStore).

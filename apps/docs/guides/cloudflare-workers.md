---
for: server=workers
---

# Deploy a Worker

In this guide you deploy a Cloudflare Worker that serves your pages a developer token and keeps each listener's
[Music User Token](../glossary#music-user-token) in Workers KV. You write the Worker, give it your key as secrets
and a KV namespace of its own, and deploy it.

Before you start, you need:

- your MusicKit private key, key ID and team ID. See [Set up your MusicKit key](./musickit-key).
- a Worker project with a Wrangler config, and `@open-music-sdk/server` installed in it.
- a Cloudflare account, which Wrangler is signed in to with `npx wrangler login`.
- sessions of your own, which tell your Worker which of your users sent a request.

In the code below, `sessionOf(req)` stands for your own session lookup: it takes the Worker's `Request` and
resolves to the signed-in user's id, or `undefined` when there's none.

## 1. Write the Worker

In your Worker, in `src/index.ts`, make the client and the two routes from what the Worker is handed in `env`:

```ts
import {
  KvUserTokenStore,
  createServerClient,
  tokenEndpoint,
  userTokenIntake,
  type tKvNamespace,
  type tTokenEndpoint,
  type tUserTokenIntake,
} from "@open-music-sdk/server";

// What the Worker is handed in `env`: the secrets of step 2, the KV
// namespace of step 3 and the variable of step 4.
interface Env {
  readonly APPLE_MUSIC_PRIVATE_KEY: string;
  readonly APPLE_MUSIC_TEAM_ID: string;
  readonly APPLE_MUSIC_KEY_ID: string;
  readonly MUSIC_USER_TOKENS: tKvNamespace;
  readonly PAGE_ORIGIN: string;
}

interface Routes {
  readonly token: tTokenEndpoint;
  readonly userToken: tUserTokenIntake;
}

// Made on the first request, from the env it brings, and kept for the rest.
let routes: Routes | undefined;

function setUp(env: Env): Routes {
  const key = {
    pem: env.APPLE_MUSIC_PRIVATE_KEY,
    teamId: env.APPLE_MUSIC_TEAM_ID,
    keyId: env.APPLE_MUSIC_KEY_ID,
  };
  const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS);
  // music.forUser(userId) reads each listener's token from the same store.
  const music = createServerClient({ ...key, userTokenStore: store });
  return {
    token: tokenEndpoint({ ...key, origin: [env.PAGE_ORIGIN] }),
    userToken: userTokenIntake(music, { store, userId: sessionOf }),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    routes ??= setUp(env);
    switch (new URL(req.url).pathname) {
      case "/api/music/token":
        return routes.token(req);
      case "/api/music/user-token":
        return routes.userToken(req);
      default:
        return new Response(null, { status: 404 });
    }
  },
};
```

- `/api/music/token` answers a `GET` with a short-lived developer token, bound to `PAGE_ORIGIN`. See
  [Serve a developer token to a page](./token-endpoint).
- `/api/music/user-token` takes a `POST` of a listener's token from your page, asks Apple whether it works, and
  stores it under the id `sessionOf` resolves to. See [Keep a listener's token on your server](./store-user-tokens).

A Worker is handed its secrets with each request, so `setUp` runs on the first one and the module keeps what it
makes. Don't make the client per request. A client made per request imports the key and signs a new token every
time. One kept in the module signs a token once, reuses it for every request the isolate serves, and replaces it in
the background halfway through its life.

If you generate your `Env` type with `npx wrangler types`, use it in place of the one above.

## 2. Put your key in Worker secrets

Store the key and its two IDs as secrets of the Worker:

```sh
npx wrangler secret put APPLE_MUSIC_PRIVATE_KEY
npx wrangler secret put APPLE_MUSIC_TEAM_ID
npx wrangler secret put APPLE_MUSIC_KEY_ID
```

Wrangler asks for each value. For the key, paste the contents of the `.p8` file on one line, with each line break
written as `\n`.

`PAGE_ORIGIN`, the origin your page is served from, isn't a secret. It goes in your Wrangler config, in step 4.

## 3. Make the KV namespace

Make a namespace at Cloudflare for listeners' tokens:

```sh
npx wrangler kv namespace create music-user-tokens --binding MUSIC_USER_TOKENS
```

Wrangler prints the namespace's `id`, and offers to put it in your config under the binding you named.

`KvUserTokenStore` keeps each token in the namespace under `music-user-token:` and the user's id. To share a
namespace with other data, give the store a prefix of your own in `setUp`:

```ts
const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS, {
  prefix: "apple-music:",
});
```

Workers KV is eventually consistent. A token just stored or just deleted can take up to a minute to look that way
from elsewhere. Apple's refusal of a token stays the final word.

::: warning The store doesn't encrypt tokens
`KvUserTokenStore` writes each token as it's given, so whoever can read the namespace can read the tokens. A Music
User Token is as sensitive as a session cookie. To encrypt them, wrap the namespace in an object of your own with
the same `get`, `put` and `delete`.
:::

## 4. Check your Wrangler config

Your Wrangler config names the Worker's code, binds the namespace as `MUSIC_USER_TOKENS`, and sets `PAGE_ORIGIN`
under `vars`:

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "kv_namespaces": [
    { "binding": "MUSIC_USER_TOKENS", "id": "<the id Wrangler printed>" }
  ],
  "vars": { "PAGE_ORIGIN": "https://app.example" }
}
```

Check that `MUSIC_USER_TOKENS` holds the `id` Wrangler printed, and that no placeholder id is left. Write
`PAGE_ORIGIN` exactly as a browser sends it: a scheme and a host, with no path and no trailing slash.

## 5. Point your page at the Worker

In your page, give the token route's full URL to `createBrowserClient`:

```ts
import { createBrowserClient } from "@open-music-sdk/browser";

const music = createBrowserClient({
  tokenUrl: "https://worker.example/api/music/token",
  storefront: "us",
});
```

In React, `createBrowserClient` comes from `@open-music-sdk/react` and is used the same way.

The page can be on another origin than the Worker, such as a static site, as long as it's `PAGE_ORIGIN`. The token
route sends the CORS header for that origin only. The user-token route sends none, so only a page on the Worker's
own origin can post a token to it.

## 6. Deploy it

::: warning Who can take and post tokens
- Have `sessionOf` resolve to the user from your own session, and to nothing when there's none. It's the
  user-token route's only authentication.
- Don't let a CORS policy of yours allow other origins to send `Content-Type: application/json` with credentials.
  Requiring JSON is what stops another site from posting its own token for your visitor.
- Rate-limit both routes, as you would a login. Anyone can fetch a token from the token route, and every token
  the user-token route checks costs a request to Apple.
:::

```sh
npx wrangler deploy
```

To watch the Worker's logs, run `npx wrangler tail`. A secret you didn't set fails the first request with a
`TypeError` that says which value is wrong.

## Next steps

- [Keep a listener's token on your server](./store-user-tokens), to post a listener's token from your page, act
  for them with `music.forUser(userId)`, and forget the token when they sign out.
- [Serve a developer token to a page](./token-endpoint#_3-limit-who-can-take-tokens), for what limits who can take
  tokens from the route.
- The reference for [`createServerClient`](../reference/@open-music-sdk/server/functions/createServerClient),
  [`tokenEndpoint`](../reference/@open-music-sdk/server/functions/tokenEndpoint),
  [`userTokenIntake`](../reference/@open-music-sdk/user-token/functions/userTokenIntake) and
  [`KvUserTokenStore`](../reference/@open-music-sdk/user-token/classes/KvUserTokenStore).

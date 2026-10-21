---
for: server=workers
---

# Deploy a Worker

The Worker from [Set up your server](./server-setup) runs on your machine. In this guide you give a deployed copy
its key and a KV namespace of its own, change what the sample leaves to one machine, and deploy it.

Before you start, you need:

- the Worker, with its two routes. See [Serve a developer token to a page](./token-endpoint) and
  [Keep a listener's token on your server](./store-user-tokens).
- a Cloudflare account, which Wrangler is signed in to with `npx wrangler login`.

## 1. Put your key in Worker secrets

Store the key and its two IDs as secrets of the Worker:

```sh
npx wrangler secret put APPLE_MUSIC_PRIVATE_KEY
npx wrangler secret put APPLE_MUSIC_TEAM_ID
npx wrangler secret put APPLE_MUSIC_KEY_ID
```

Wrangler asks for each value. For the key, paste the contents of the `.p8` file on one line, with each line break
written as `\n`.

`PAGE_ORIGIN`, the origin your page is served from, isn't a secret. Set it under `vars` in your Wrangler config:

```jsonc
"vars": { "PAGE_ORIGIN": "https://app.example" }
```

## 2. Make the KV namespace

Make a namespace at Cloudflare for listeners' tokens:

```sh
npx wrangler kv namespace create music-user-tokens
```

Put the `id` it prints in place of the sample's placeholder, under the binding `MUSIC_USER_TOKENS`.

`KvUserTokenStore` keeps each token in the namespace under `music-user-token:` and the user's id. To share a
namespace with other data, give it a prefix of your own:

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

## 3. Change what is there for one machine

The sample runs on a developer's machine. Before you deploy it:

- Put your own session lookup in place of `sessionOf`, one that resolves to the signed-in user's id or `undefined`,
  and leave out the cookie the Worker gives. The sample's session is any id a browser presents, which is enough
  on one machine and not on the web.
- Make `hosts` the names your Worker answers to, its own and your page's, in place of `127.0.0.1:8787`. The check
  is there because a server on a loopback address can be reached by a site whose name points at it.
- Rate-limit both routes.

If you generate your `Env` type with `wrangler types`, use that one in place of `tEnv`.

::: warning Who can post a token
Read the warnings in [Mount the intake route](./store-user-tokens#_2-mount-the-intake-route) before you deploy
the user-token route: on `userId`, on your CORS policy, and on rate-limiting it.
:::

## 4. Point your page at the Worker

In your page, give the token route's full URL to `createBrowserClient`:

```ts
import { createBrowserClient } from "@open-music-sdk/browser";

const music = createBrowserClient({
  tokenUrl: "https://worker.example/api/music/token",
  storefront: "us",
});
```

The page can be on another origin than the Worker, such as a static site, as long as it's the `PAGE_ORIGIN` the
Worker's tokens are bound to. The route sends the CORS header for that origin only.

## 5. Deploy it

```sh
npx wrangler deploy
```

## Next steps

- [Serve a developer token to a page](./token-endpoint#_3-limit-who-can-take-tokens), for what limits who can take
  tokens from the route.
- The reference for [`createServerClient`](../reference/@open-music-sdk/server/functions/createServerClient) and
  [`KvUserTokenStore`](../reference/@open-music-sdk/user-token/classes/KvUserTokenStore).

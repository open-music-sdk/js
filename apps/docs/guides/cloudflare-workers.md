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

The Worker in step 3 also reads `PAGE_ORIGIN`, the origin your page is served from, which isn't a secret. Set it
under `vars` in your Wrangler config.

For local development, put the same values in a `.dev.vars` file next to your Wrangler config, which
`wrangler dev` reads:

```
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG…\n-----END PRIVATE KEY-----"
APPLE_MUSIC_TEAM_ID="ABCDE12345"
APPLE_MUSIC_KEY_ID="ABC123DEFG"
PAGE_ORIGIN="http://localhost:2728"
```

::: warning Never commit `.dev.vars`
It holds your private key. Add it to `.gitignore` before you write the key into it.
:::

If a Vite dev server runs in the same repository, as a page's often does, name the file `.env` instead, which
`wrangler dev` reads when there is no `.dev.vars`. Vite's dev server serves any file in the repository to a page
that asks for it, except those on its deny list, and that list names `.env` but not `.dev.vars`. The
[sample apps](../samples) do this.

## 3. Write the Worker

The Worker below is the [worker-server sample](../samples), complete, as it runs on a developer's machine.

<<< @/../../samples/worker-server/src/index.ts#file{ts}

The `// #region` lines mark the parts other guides show, and do nothing.

Before you deploy it, change what is there for the machine it runs on:

- Put your own session lookup in place of `sessionOf`, one that resolves to the signed-in user's id or `undefined`,
  and leave out the cookie the Worker gives. The sample's session is any id a browser presents, which is enough
  on one machine and not on the web.
- Make `hosts` the names your Worker answers to, its own and your page's, in place of `127.0.0.1:8787`. The check
  is there because a server on a loopback address can be reached by a site whose name points at it.
- Rate-limit both routes, as [Who can post a token](#the-two-routes) below says.

If you generate your `Env` type with `wrangler types`, use that one in place of `tEnv`.

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
`DeveloperTokenInvalid`. The Worker answers that, and any other `AppleMusicError`, with `502` and the error's
tag. `validateUserToken` tells a listener's `401` apart from a developer token Apple refuses. See
[Handle errors](./errors).

## 4. Keep listeners' tokens in Workers KV

`KvUserTokenStore` keeps each token in your namespace under `music-user-token:` and the user's id. To share a
namespace with other data, give it a prefix of your own:

```ts
const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS, {
  prefix: "apple-music:",
});
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

const music = createBrowserClient({
  tokenUrl: "https://worker.example/api/music/token",
  storefront: "us",
});
```

The page can be on another origin than the Worker, such as a static site, as long as it's one of the origins you
gave `tokenEndpoint`. The route sends the CORS header for those origins only.

## Next steps

- [Keep a listener's token on your server](./store-user-tokens), for the user-token route and when to forget a
  token.
- [Serve a developer token to a page](./token-endpoint), for the token route's options and its limits.
- The reference for [`createServerClient`](../reference/@open-music-sdk/server/functions/createServerClient) and
  [`KvUserTokenStore`](../reference/@open-music-sdk/user-token/classes/KvUserTokenStore).

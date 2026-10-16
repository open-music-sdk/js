# Serve a developer token to a page

A web page can't sign a developer token, because it can't hold your private key. In this guide you add a route
to your server that signs short-lived tokens, and point the browser client at it.

Before you start, you need:

- your MusicKit private key, key ID and team ID, loaded the way your app loads its other secrets. See
  [Set up your MusicKit key](./musickit-key).
- a server that takes a web-standard `Request` and returns a `Response`: Node, Cloudflare Workers, Bun, Deno, or
  a framework's route handler.

## 1. Add the route

On your server, mount `tokenEndpoint` as the `GET` handler of a route, here `/api/music/token`:

```ts
import { tokenEndpoint } from "@open-music-sdk/server";

export const GET = tokenEndpoint({
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
  origin: ["https://app.example"],
});
```

`origin` lists the web origins your pages are served from, each exactly as a browser sends it: a scheme and a
host, with no path and no trailing slash. Every token names them, and Apple honours them for requests from a
browser.

The route answers a `GET` with a fresh token as JSON, `{ "token": "<jwt>" }`. Tokens last fifteen minutes by
default, and page loads within a token's life share one signature. To change the lifetime, pass `ttlSeconds`,
from 60 to 86,400 (one day).

A page on one of your origins can read the token even when the route is on another origin, such as a Worker in
front of a static site. The route sends the CORS header for your origins only, and for nothing but the token.

## 2. Point the browser client at it

In your page, give the route's URL to `createBrowserClient`:

```ts
import { createBrowserClient } from "@open-music-sdk/browser";

const music = createBrowserClient({ tokenUrl: "/api/music/token", storefront: "us" });
const album = await music.catalog.getAlbum("1613600183");
```

`storefront` is the [storefront](../glossary#storefront) the catalog is read in.

The client fetches a token the first time a request needs one and replaces it in the background before it
expires. A relative URL is resolved against the page's address when you create the client.

Use the route's final URL. The client refuses a redirect, so that a token only ever comes from the URL you gave
it. If your framework redirects `/api/music/token` to `/api/music/token/`, use the second.

In React, `createBrowserClient` comes from `@open-music-sdk/react` and is used the same way. In Next.js, the
route needs one more line so it's never built ahead of time: see [Next.js](./nextjs).

## 3. Limit who can take tokens

::: warning Anyone can fetch a token from this route
A developer token spends your whole team's rate limit, and the `origin` in it only binds browsers. A script can
send any `Origin` header it likes, so anyone can fetch a token from your route and use it until it expires.
:::

What limits the damage:

- Keep tokens short-lived. The fifteen-minute default is enough, because the client replaces tokens as they go.
  `tokenEndpoint` refuses a lifetime over one day.
- Rate-limit the route, as you would a login.
- If tokens should go only to your signed-in users, put the route behind your session. This works on your own
  origin only, because a page on another origin can't send your cookie or a header of its own to the route.
- Don't let a CDN cache the route. Every answer says `cache-control: no-store` and `vary: origin`. A CDN rule
  that caches regardless would hand one token to everyone, even after it expires.
- Run one route per deployment, listing that deployment's origins only. Anyone who fetches a token can decode it
  and read every origin in it, so your production route shouldn't name a staging or `localhost` origin.

## When something goes wrong

- A `pem` that's a string but not a valid key fails on the first request to the route, with a `TypeError` your
  framework logs. Nothing about the error is sent to the page.
- When the page can't get a token from your route, its requests fail with a `DeveloperTokenUnavailable` error,
  never one that looks like Apple's. The client retries when the route is unreachable, times out, or answers
  `429` or a `5xx` other than `501`. Any other status, or an answer with no valid token, isn't retried.

## Next steps

- [Sign a listener in](./sign-in), which needs this route too.
- [Security model](../concepts/security), for everything a page can and can't keep secret.
- The reference for [`tokenEndpoint`](../reference/@open-music-sdk/server/functions/tokenEndpoint) and
  [`createBrowserClient`](../reference/@open-music-sdk/browser/functions/createBrowserClient).

# @open-music-sdk/server

The Apple Music API for anything server-side: a Node service, a Cloudflare Worker, Bun, Deno, a CLI, an
Electron main process. One import gives a client that mints its own developer token from the key you
hand it, with the catalog, the listener's library and the playlist verbs on it; a token endpoint for
your pages; the user-token intake; and the rest of the family.

```
pnpm add @open-music-sdk/server
```

**Runs where the private key may live.** One build runs on Node 24, workerd, Bun and Deno: each has
the same `fetch` and WebCrypto. For a page, use [`@open-music-sdk/browser`](../browser/README.md); for a React
app, [`@open-music-sdk/react`](../react/README.md). A Next.js app uses this package in its route handlers,
server components and actions, and `react` in its client components.

```ts
import { MemoryUserTokenStore, createServerClient, isAppleMusicError, tokenEndpoint, userTokenIntake } from "@open-music-sdk/server";

// The key and its two ids, from wherever your app keeps its secrets. Made once, at module level.
const key = { pem: process.env.APPLE_MUSIC_PRIVATE_KEY!, teamId: process.env.APPLE_MUSIC_TEAM_ID!, keyId: process.env.APPLE_MUSIC_KEY_ID! };
const store = new MemoryUserTokenStore();
const music = createServerClient({ ...key, storefront: "us", userTokenStore: store });

const album = await music.catalog.getAlbum("1613600183"); // the developer token alone

const listener = music.forUser(userId); // the listener's token from the store, looked up per request
for await (const playlist of listener.user.listLibraryPlaylists()) { /* every page */ }
const { tracks } = await listener.playlists.resolve([{ isrc: "GBAYE0601498" }]);
const { id, appended } = await listener.playlists.apply(listener.playlists.plan({ name: "Road trip" }, tracks));

// Two handlers to mount as they are: a web-standard Request in, a Response out.
export const GET = tokenEndpoint({ ...key, origin: ["https://app.example"] }); // a fifteen-minute token for your page
export const POST = userTokenIntake(music, { store, userId: (req) => sessionUserId(req) }); // where the page posts the listener's token

try {
  await listener.user.addToLibrary({ songs: ["1613600188"] });
} catch (e) {
  if (isAppleMusicError(e, "UserTokenInvalid")) askListenerToReconnect(userId);
  else throw e;
}
```

## What is in it

| Export | Does |
| --- | --- |
| `createServerClient(options)` | A client that mints its own developer token, with `catalog`, `user` and `playlists` on it, and `as()` and `forUser()` that give the same again for a listener |
| `tokenEndpoint(options)` | A handler that hands a page a short-lived developer token bound to the page's origin: what `createBrowserClient({ tokenUrl })` fetches |
| The feature tier, from one path | What an app uses of each package, under the names its README gives: see [What is re-exported](#what-is-re-exported) |

## The client

`createServerClient` takes the key and its two ids as [`developerTokenMinter`](../../packages/developer-token/README.md)
does, and every option of [`createClient`](../../packages/core/README.md) but the developer token, which the
minter provides:

| Option | |
| --- | --- |
| `pem`, `teamId`, `keyId` | The contents of the `.p8`, your Team ID and the key's ID. Required. Loading them is your app's job, done the way it loads its other secrets: this package reads no environment and no file. |
| `ttlSeconds`, `refreshAheadSeconds` | The token's lifetime, default one hour, and how long before `exp` to mint a replacement. |
| `userToken`, `userTokenStore` | One listener's token, or the store `forUser(userId)` reads. |
| `storefront`, `fetch`, `retry`, `rateLimit`, `onRequest`, `onResponse` | As `createClient` takes them. |

Not among them: `origin`, which is refused rather than dropped. The server's own token never meets a
browser, and the one that does is the endpoint's.

What it gives is core's client, `request`, `paginate`, `storefront`, `as` and `forUser`, with three
namespaces on it: `catalog` is [`catalog(client)`](../../clients/client-catalog/README.md), `user` is
[`user(client)`](../../clients/client-user/README.md), and `playlists` is
[`playlists(client)`](../../lib/lib-playlists/README.md), each made for this client. `as(token)` and
`forUser(userId)` give a listener's client with the three made for it. The object is frozen, inherits
nothing, and each of its functions can be handed on by itself.

The options are checked and read once, when the client is made. A mistake is a `TypeError` naming the
function that checks it: `createServerClient` for the options object, `developer token` for the key
and its ids, `createClient` for the rest. No error repeats a value. Nothing is asked of Apple until a
call, and the key is imported on the first mint: a `pem` that is a string but no key is a `TypeError`
on the first request.

**Make it once, at module level.** On a worker that is handed its secrets per request, a client made
per request imports the key and signs a token on every one. Keep it in a module variable:

```ts
let music: tMusic | undefined;
export default {
  fetch(req: Request, env: Env) {
    music ??= createServerClient({ pem: env.APPLE_MUSIC_PRIVATE_KEY, teamId: env.APPLE_MUSIC_TEAM_ID, keyId: env.APPLE_MUSIC_KEY_ID });
    …
  },
};
```

## The token endpoint

A page cannot mint a developer token, so your server hands it one. `tokenEndpoint` is that handler,
and `createBrowserClient({ tokenUrl })` in [`@open-music-sdk/browser`](../browser/README.md) is what fetches
from it.

| Option | |
| --- | --- |
| `pem`, `teamId`, `keyId` | As for the client. Required. |
| `origin` | The web origins the token is for, one at least, each exactly as a browser sends it: `https://app.example`, with no path or trailing slash. Required. |
| `ttlSeconds` | The token's lifetime in whole seconds, from 60 to 86 400, one day. Default 900, fifteen minutes. |
| `refreshAheadSeconds` | How long before `exp` to mint a replacement. Default, and at most, half the lifetime. |

It keeps a minter of its own, so page loads within a token's life share one signature.

| Request | Answer |
| --- | --- |
| `GET` | `200`, `{ "token": "<jwt>" }` as JSON |
| `OPTIONS` | `204`, `allow: GET`, `access-control-allow-methods: GET` |
| Anything else | `405`, `{ "error": "MethodNotAllowed" }`, `allow: GET` |

Every answer says `vary: origin` and `cache-control: no-store`. A request whose `Origin` header is
one of the origins given is answered with `access-control-allow-origin` for that origin, so a page on
another origin, a static site in front of a Worker, reads the token with no wrapper. No other request
gets a CORS header, and no answer carries a credentials header or allows a header of the page's own:
a page on another origin can fetch the token and nothing more. Mount it behind your own session if
tokens should go only to your users; that holds on your own origin alone, since a page on another
cannot send a cookie or a header of its own to it. A request that is gone, aborted by the page, is
answered all the same: the mint is one flight shared by every request, and no request's to cancel.

It catches nothing. A `pem` that is a string but no key fails at the first mint, inside the request,
with the `TypeError` the minter throws; your framework logs it, and that is where you find it. Nothing
of the error is echoed to the page.

**What limits the damage.** A developer token is a bearer credential for your whole team's quota, and
an endpoint that hands one out is a public dispenser:

- The `origin` claim is honoured by browsers. It does not stop a script that sets its own `Origin`
  header, so anyone can fetch a token here, read the catalog with it and spend your rate limit for as
  long as it lives. That is why the default life is fifteen minutes, and why a longer one buys nothing:
  the page's fetcher replaces its token in the background.
- Rate-limit the route, as you would a login.
- `cache-control: no-store` and `vary: origin` are on every answer, so no proxy or CDN keeps a copy,
  and none hands one page's answer to another. A CDN rule that caches regardless would hand one token
  to everyone, past its end.
- Every token names every origin in the list, and anyone who fetches one can decode it: one endpoint
  per deployment, listing that deployment's origins alone, so that a staging or a localhost origin is
  not published by the production one.
- `ttlSeconds` stops at a day here, whatever the minter takes elsewhere: a token anyone can fetch, and
  nothing can take back, is not for keeping.

## What is re-exported

Everything an app uses of the feature tier, under the names each package's README gives, so one
import is enough:

| From | Names |
| --- | --- |
| [`core`](../../packages/core/README.md) | `AppleMusicError`, `isAppleMusicError`, `createRateLimiter`, and the types. Not `createClient`, nor the builders and checks the clients are declared with: an assembly of your own is the feature tier directly. |
| [`developer-token`](../../packages/developer-token/README.md) | `mintDeveloperToken`, `developerTokenMinter`, `developerTokenFetcher` |
| [`user-token`](../../packages/user-token/README.md) | `validateUserToken`, `acceptUserToken`, `userTokenIntake`, `MemoryUserTokenStore`, `KvUserTokenStore` |
| [`util-artwork`](../../packages/util-artwork/README.md) | `artworkImage`, `artworkUrl`, `artworkSrcSet` |
| [`client-catalog`](../../clients/client-catalog/README.md), [`client-user`](../../clients/client-user/README.md) | Every function, and `catalog` and `user` |
| [`lib-playlists`](../../lib/lib-playlists/README.md) | `playlists` |
| [`validate`](../../packages/validate/README.md) | Every validator, under `schemas`: `schemas.song`, `schemas.libraryPlaylist`, to pass as `schema` |
| [`types`](../../packages/types/README.md) | Every generated type: `tSong`, `tAlbum`, `tLibraryPlaylist` |

## Not here

A page, which cannot hold the key: [`@open-music-sdk/browser`](../browser/README.md), whose client fetches its
token from `tokenEndpoint`. A React app: [`@open-music-sdk/react`](../react/README.md).

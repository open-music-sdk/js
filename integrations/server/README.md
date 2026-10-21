# @open-music-sdk/server

The Apple Music API for code that runs on a server: Node, Cloudflare Workers, Bun, Deno, a command-line tool or an
Electron main process. One import gives you a client that signs its own developer token, a route that hands your
pages a token, and everything else an app uses from the other packages.

```
pnpm add @open-music-sdk/server
```

For a web page, use [`@open-music-sdk/browser`](../browser/README.md). For a React app, use
[`@open-music-sdk/react`](../react/README.md). A Next.js app uses this package on the server and `react` in its
client components.

## Example

On your server:

```ts
import { createServerClient, isAppleMusicError } from "@open-music-sdk/server";

// Create the client once, when the module loads. Load the key the way your app loads its other secrets.
const music = createServerClient({
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
  storefront: "us",
});

const album = await music.catalog.getAlbum("1613600183"); // needs the developer token only

const listener = music.as(musicUserToken); // one listener's client, with the token your page sent you or the CLI printed
try {
  for await (const playlist of listener.user.listLibraryPlaylists()) console.log(playlist.attributes?.name);
} catch (e) {
  if (isAppleMusicError(e, "UserTokenInvalid")) askListenerToSignInAgain(); // Apple answered 403
  else throw e;
}
```

A listener who isn't signed in, or has no subscription, can get a `401` instead, which arrives as
`DeveloperTokenInvalid`. [Handle errors](https://open-music-sdk.github.io/js/guides/errors) shows how to tell the
two apart.

## What's in it

| Export | What it does |
| --- | --- |
| `createServerClient(options)` | A client that signs its own developer token, with `catalog`, `user` and `playlists` on it. `as(token)` and `forUser(userId)` give you the same for one listener. |
| `tokenEndpoint(options)` | A route handler that gives your pages a short-lived developer token |
| Everything else | What an app uses from the other packages, listed below |

It re-exports these, under the names each package gives them:

| From | Names |
| --- | --- |
| [`core`](../../packages/core/README.md) | `AppleMusicError`, `isAppleMusicError`, `createRateLimiter`, `parseToken`, and the types |
| [`developer-token`](../../packages/developer-token/README.md) | `mintDeveloperToken`, `developerTokenMinter`, `developerTokenFetcher` |
| [`user-token`](../../packages/user-token/README.md) | `validateUserToken`, `acceptUserToken`, `userTokenIntake`, `MemoryUserTokenStore`, `KvUserTokenStore` |
| [`util-artwork`](../../packages/util-artwork/README.md) | `artworkImage`, `artworkUrl`, `artworkSrcSet`, `FORMATS` |
| [`client-catalog`](../../clients/client-catalog/README.md), [`client-user`](../../clients/client-user/README.md) | Every function, and `catalog` and `user` |
| [`lib-playlists`](../../lib/lib-playlists/README.md) | `playlists` |
| [`validate`](../../packages/validate/README.md) | Every validator, under `schemas`, such as `schemas.song` |
| [`types`](../../packages/types/README.md) | Every generated type, such as `tSong` and `tLibraryPlaylist` |

`core`'s `createClient` and the tools the clients are built with aren't re-exported. To build your own client from
the parts, install the packages themselves.

## Learn more

- [Which package to install](https://open-music-sdk.github.io/js/concepts/packages)
- [The command-line tool](https://open-music-sdk.github.io/js/cli), to check
  your key and get a Music User Token for your own account
- [Serve a developer token to a page](https://open-music-sdk.github.io/js/guides/token-endpoint)
- [Keep a listener's token on your server](https://open-music-sdk.github.io/js/guides/store-user-tokens)
- [Security model](https://open-music-sdk.github.io/js/concepts/security), for your key, the token endpoint and
  the listener's token
- [Set up your server](https://open-music-sdk.github.io/js/guides/server-setup) and
  [Deploy a Worker](https://open-music-sdk.github.io/js/guides/cloudflare-workers)
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/server/)

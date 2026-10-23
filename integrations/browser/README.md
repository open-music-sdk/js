<div align="center">

<img src="https://raw.githubusercontent.com/open-music-sdk/js/main/assets/open-music-app-logo.svg" alt="open-music-sdk" width="200">

# Open Music SDK for Web Pages

`@open-music-sdk/browser`

[![npm](https://img.shields.io/npm/v/@open-music-sdk/browser)](https://www.npmjs.com/package/@open-music-sdk/browser)
[![test coverage](https://codecov.io/gh/open-music-sdk/js/graph/badge.svg)](https://codecov.io/gh/open-music-sdk/js)

</div>

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

The Apple Music API for a web page, with or without a framework. One import gives you a client that fetches its
developer token from your server, Apple's sign-in for the listener's Music User Token, the preview player, and
everything else a page uses from the other packages. Nothing a page bundles from it signs a token, holds a key or
touches the page's storage, and a test holds every build to that.

## Installation

```
pnpm add @open-music-sdk/browser
```

The developer token comes from a route on your server: `tokenEndpoint` in
[`@open-music-sdk/server`](../server/README.md). For a React app, use [`@open-music-sdk/react`](../react/README.md),
which is this package with a provider and hooks.

## Documentation

- [The documentation site](https://open-music-sdk.github.io/js/): guides for each client and server, concepts,
  and the reference
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/browser/)
- [Which package to install](https://open-music-sdk.github.io/js/concepts/packages)
- [Serve a developer token to a page](https://open-music-sdk.github.io/js/guides/token-endpoint)
- [Sign a listener in](https://open-music-sdk.github.io/js/guides/sign-in), and the
  [security model](https://open-music-sdk.github.io/js/concepts/security) for what Apple's script keeps in the page
- [Play song previews](https://open-music-sdk.github.io/js/guides/previews)

## Example

This runs in your page. `playButton`, `connectButton`, `showError` and `showLibrary` stand for your own code, and
the client fetches its developer token from your token endpoint when a request first needs one:

```ts
import { createBrowserClient, createConnect, previewPlayer } from "@open-music-sdk/browser";

const music = createBrowserClient({ tokenUrl: "/api/music/token", storefront: "us" }); // once per page

const { results } = await music.catalog.searchCatalog("james brown", { types: ["songs"], limit: 5 });
const player = previewPlayer();
player.load(results.songs?.data ?? []);
playButton.onclick = () => void player.play().catch(showError); // sound has to start from a click

// Create the sign-in helper where the button is shown, and enable the button once Apple's script is ready, or
// has failed to load: a click then loads it again.
const signIn = createConnect(music, { app: { name: "Vinyl Collector Simulator" } });
void signIn.ready.catch(showError).finally(() => (connectButton.disabled = false));
connectButton.onclick = async () => {
  try {
    const token = await signIn.connect(); // opens Apple's sign-in window
    if (token) showLibrary(music.as(token)); // a client for this listener
  } catch (e) {
    showError(e); // what Apple's script threw: show it, never print it
  }
};
```

## What's in it

| Export | What it does |
| --- | --- |
| `createBrowserClient(options)` | A client that fetches its developer token from your token endpoint, with `catalog`, `user` and `playlists` on it. `as(token)` and `forUser(userId)` give you the same for one listener. |
| `createConnect(music, options)` | Apple's sign-in, for the listener's Music User Token: `ready`, `connect()`, `disconnect()` and `dispose()` |
| `MUSICKIT_SCRIPT` | The URL of Apple's MusicKit on the Web script, for your content security policy |
| Everything else | What a page uses from the other packages, listed below |

It re-exports these, under the names each package gives them:

| From | Names |
| --- | --- |
| [`core`](../../packages/core/README.md) | `AppleMusicError`, `isAppleMusicError`, `createRateLimiter`, and the types |
| [`developer-token`](../../packages/developer-token/README.md) | `developerTokenFetcher`, from the entry with no signing code |
| [`user-token`](../../packages/user-token/README.md) | `validateUserToken`, for a page that holds the token itself |
| [`util-artwork`](../../packages/util-artwork/README.md) | `artworkImage`, `artworkUrl`, `artworkSrcSet`, `FORMATS` |
| [`client-catalog`](../../clients/client-catalog/README.md), [`client-user`](../../clients/client-user/README.md) | Every function, and `catalog` and `user` |
| [`lib-playlists`](../../lib/lib-playlists/README.md) | `playlists` |
| [`lib-preview-player`](../../lib/lib-preview-player/README.md) | `previewPlayer` |
| [`validate`](../../packages/validate/README.md) | Every validator, under `schemas`, such as `schemas.song` |
| [`types`](../../packages/types/README.md) | Every generated type, such as `tSong` and `tLibraryPlaylist` |

The token minter, the token stores and the intake belong on a server, and aren't here. Neither are `core`'s
`createClient` and the tools the clients are built with: to build your own client from the parts, install the
packages themselves.

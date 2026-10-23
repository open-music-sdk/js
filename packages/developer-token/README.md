<div align="center">

<img src="https://raw.githubusercontent.com/open-music-sdk/js/main/assets/open-music-app-logo.svg" alt="open-music-sdk" width="200">

# Open Music SDK Developer Tokens

`@open-music-sdk/developer-token`

[![npm](https://img.shields.io/npm/v/@open-music-sdk/developer-token)](https://www.npmjs.com/package/@open-music-sdk/developer-token)
[![test coverage](https://codecov.io/gh/open-music-sdk/js/graph/badge.svg)](https://codecov.io/gh/open-music-sdk/js)

</div>

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

> **You probably don't want this package.** Most apps install one integration and import everything from it: see
> [Which package to install](https://github.com/open-music-sdk/js#which-package-to-install) in the repository's README.

Developer tokens for `core`'s client. On a machine that may hold your MusicKit private key, it signs them. In a page,
which may not, it fetches them from a token endpoint you host. Either way it reuses a token and replaces it before
it expires, or when Apple rejects it.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which re-export what an app uses of this package. Use this
one to build your own client.

## Installation

```
pnpm add @open-music-sdk/developer-token @open-music-sdk/core
```

Keep the two on the same version. See
[One version for every package](https://open-music-sdk.github.io/js/concepts/packages#one-version-for-every-package).

## Documentation

- [The documentation site](https://open-music-sdk.github.io/js/): guides for each client and server, concepts,
  and the reference
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/developer-token/)
- [Set up your MusicKit key](https://open-music-sdk.github.io/js/guides/musickit-key)
- [Serve a developer token to a page](https://open-music-sdk.github.io/js/guides/token-endpoint)
- [Build your own client from the parts](https://open-music-sdk.github.io/js/guides/own-client)
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens), for how a token
  is reused and replaced
- [Security model](https://open-music-sdk.github.io/js/concepts/security), for where the key and the tokens may go,
  and what limits a token endpoint

## Example

On a server, a worker or a command-line tool, anywhere the private key may live:

```ts
import { createClient } from "@open-music-sdk/core";
import { developerTokenMinter } from "@open-music-sdk/developer-token";

// The key and its two IDs, loaded the way your app loads its other secrets. Nothing here reads the environment.
const music = createClient({
  developerToken: developerTokenMinter({
    pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
    teamId: process.env.APPLE_MUSIC_TEAM_ID!,
    keyId: process.env.APPLE_MUSIC_KEY_ID!,
  }),
  storefront: "us",
});

const answer = await music.request("v1/catalog/us/albums/1613600183"); // signed on first use, then reused
```

## What's in it

A verb does the thing once. A `developerToken…` noun is a provider to hand to `createClient`, named for how it gets
its token.

| Export | What it does |
| --- | --- |
| `mintDeveloperToken(options)` | Signs one developer token, an ES256 JWT, and returns it |
| `developerTokenMinter(options)` | A provider that signs a token on first use, reuses it, and signs the next before the token expires |
| `developerTokenFetcher(url, options?)` | A provider that fetches the token from your token endpoint, and reuses it the same way |
| `tMintOptions`, `tMinterOptions`, `tFetcherOptions`, `tDeveloperTokenProvider` | The options each one takes, and the type of a provider |

The package has two entries:

- `@open-music-sdk/developer-token` holds everything, signing code included.
- `@open-music-sdk/developer-token/fetcher` holds `developerTokenFetcher` alone, in a file that imports neither
  `jose` nor the minter.

In a page, import from `/fetcher`. The page then carries no signing code, bundler or no bundler, and nothing in it
can sign a token even if a key were handed to it by mistake:

```ts
// In your page.
import { developerTokenFetcher } from "@open-music-sdk/developer-token/fetcher";

const developerToken = developerTokenFetcher("/api/music/token"); // hand it to createClient
```

To check your key, or to hand a developer token to another tool without writing code, the
[CLI](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme) has `open-music-sdk doctor` and
`open-music-sdk token --developer`, which mints one that lives an hour.

# @open-music-sdk/developer-token

Developer tokens for `core`'s client. On a machine that may hold your MusicKit private key, it signs them. In a page,
which may not, it fetches them from a token endpoint you host. Either way it reuses a token and replaces it before
it expires, or when Apple rejects it.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which re-export what an app uses of this package. Use this
one to build your own client.

```
pnpm add @open-music-sdk/developer-token @open-music-sdk/core
```

Keep the two on the same version. See
[One version for every package](https://open-music-sdk.github.io/js/concepts/packages#one-version-for-every-package).

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

## Learn more

- [Set up your MusicKit key](https://open-music-sdk.github.io/js/guides/musickit-key)
- [Serve a developer token to a page](https://open-music-sdk.github.io/js/guides/token-endpoint)
- [Build your own client from the parts](https://open-music-sdk.github.io/js/guides/own-client)
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens), for how a token
  is reused and replaced
- [Security model](https://open-music-sdk.github.io/js/concepts/security), for where the key and the tokens may go,
  and what limits a token endpoint
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/developer-token/)

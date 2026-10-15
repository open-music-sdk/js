# Status and roadmap

::: warning Under construction
Nothing is published to npm yet. Every package below exists and passes its tests, but none has been run against
the live Apple Music API, in a browser, or in a React app outside its tests. This table is the source of truth for
what works. Expect everything else to be missing or to change.
:::

The SDK is a family of small packages that share one core and one generated type layer, in the manner of the AWS
SDK for JavaScript v3. There are foundation packages, two clients split at the token boundary, libraries for
common tasks, and the integrations an app installs. Every package ships the same version number. See
[Which package to install](./concepts/packages).

| Sub-task | Status | Progress | Description |
| --- | :---: | :---: | --- |
| Repository tooling | 🚧 In progress | 80% | pnpm workspace · Turborepo · TypeScript · ESLint · tsdown · Vitest · CI workflow · Changesets and the release workflow not yet set up |
| [`codegen`](https://github.com/open-music-sdk/js/tree/main/codegen#readme) | ✅ Done | 100% | Crawl Apple's docs · commit a normalized IR · emit types and validators · one file per resource family |
| [`@open-music-sdk/types`](./reference/@open-music-sdk/types/) | ✅ Done | 100% | An interface for every API object · singular names · discriminated resource union · zero dependencies |
| [`@open-music-sdk/validate`](./reference/@open-music-sdk/validate/) | ✅ Done | 100% | A Standard Schema validator for every API object · tiny runtime · no dependencies · tested |
| [`@open-music-sdk/core`](./reference/@open-music-sdk/core/) | 🚧 In progress | 80% | Client factory · tagged errors · retry and rate limiting · pagination · request hooks · the token and bounded-read primitives the other packages share · the checks and builders the clients declare their endpoints with · the check on where a URL may point · untested against the live API |
| [`@open-music-sdk/developer-token`](./reference/@open-music-sdk/developer-token/) | 🚧 In progress | 80% | JWT minting · minter and fetcher providers over one cache · a `/fetcher` entry with no signing code · untested against the live API |
| [`@open-music-sdk/user-token`](./reference/@open-music-sdk/user-token/) | 🚧 In progress | 80% | Validation · intake handler, and the same step without HTTP · memory and KV stores · untested against the live API |
| [`@open-music-sdk/util-artwork`](./reference/@open-music-sdk/util-artwork/) | 🚧 In progress | 80% | Artwork URL templates · `src`, `srcset` and layout size for an `<img>` · format and crop · opt-in host check, which is all of `core` it carries · checked against Apple's image server, untested against the live API |
| [`@open-music-sdk/client-catalog`](./reference/@open-music-sdk/client-catalog/) | 🚧 In progress | 80% | A function for each of the 58 catalog, storefront, search, and chart endpoints · `catalog(client)` with the answers unwrapped · developer token only · held to Apple's documentation by its tests, untested against the live API |
| [`@open-music-sdk/client-user`](./reference/@open-music-sdk/client-user/) | 🚧 In progress | 80% | A function for each of the 79 library, ratings, recommendations, history, and replay endpoints · `user(client)` with the answers unwrapped · both tokens · held to Apple's documentation by its tests, untested against the live API |
| [`@open-music-sdk/lib-playlists`](./reference/@open-music-sdk/lib-playlists/) | 🚧 In progress | 80% | `playlists(client)` · resolve tracks by ISRC, then by a search held to an exact match · read a playlist whole, which is also the export · plan what it is missing · apply it with each write sent once · progress, a delay between requests and an opt-in limit on pages · untested against the live API |
| [`@open-music-sdk/lib-preview-player`](./reference/@open-music-sdk/lib-preview-player/) | 🚧 In progress | 80% | `previewPlayer()` · a queue of preview clips around one audio element · play, pause, next, previous, seek, volume · one frozen state to subscribe to · opt-in host check · no framework · untested in a browser against the live API |
| [`@open-music-sdk/server`](./reference/@open-music-sdk/server/) | 🚧 In progress | 80% | `createServerClient()` that mints its own token, with `catalog`, `user` and `playlists` on it · `tokenEndpoint()` for a page's token, bound to its origins · the feature tier from one path · one build for Node, Workers, Bun and Deno · untested against the live API |
| [`@open-music-sdk/browser`](./reference/@open-music-sdk/browser/) | 🚧 In progress | 80% | `createBrowserClient()` over the token endpoint, with the same namespaces · `createConnect()` running Apple's sign-in, the token kept fresh off the click · no signing code, which a bundle test holds it to · untested in a browser against Apple's live script |
| [`@open-music-sdk/react`](./reference/@open-music-sdk/react/) | 🚧 In progress | 80% | `MusicProvider` holding the client and the listener's token · `useMusic`, `useMusicUserToken`, `useConnect`, `usePreviewPlayer` · `musicQueries` over every read function for TanStack Query · `"use client"` on the hooks' file alone · untested in a React app outside its tests |
| [Docs site, `apps/docs`](https://github.com/open-music-sdk/js/tree/main/apps/docs#readme) | 🚧 In progress | 70% | The reference: TypeDoc over every package's doc comments, with arguments, returns and throws on every function, which CI checks · one VitePress site with guides, concepts and the reference, published to GitHub Pages from `main` · package READMEs cut to a short template · a tutorial once the samples exist |
| `@open-music-sdk/cli`, `apps/cli` | ⬜ Not started | 0% | Run with `npx` · `login` gets a Music User Token for your own account through Apple's sign-in, `aws login` style · `doctor`, `token`, `check` · where the packages first meet the live API |
| Sample apps, `samples/` | ⬜ Not started | 0% | Worker · Express · vanilla web · React · Next.js · each runs in development with one command |
| First release | ⬜ Not started | 0% | One version across the family · npm provenance |

Progress is a judgement of how much of the described scope exists and is tested.

## What comes next

In this order:

1. The docs site: this site, with its guides and concepts.
2. The CLI, and a first run against the live API through it, with the fixes that run brings.
3. The sample apps, and with them a tutorial.
4. Changesets.
5. The first release.

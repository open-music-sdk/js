# Status and roadmap

::: tip On npm
Every package is on npm, all at one version, since 1.0.0 on 23 October 2026. The
[releases](https://github.com/open-music-sdk/js/releases) say what each version changed. This table is the source
of truth for what works.
:::

The SDK is a family of small packages that share one core and one generated type layer, in the manner of the AWS
SDK for JavaScript v3. There are foundation packages, two clients split at the token boundary, libraries for
common tasks, and the integrations an app installs, with a CLI to use beside them while you build. Every package
ships the same version number. See
[Which package to install](./concepts/packages).

| Sub-task | Status | Progress | Description |
| --- | :---: | :---: | --- |
| Repository tooling | ✅ Done | 100% | pnpm workspace · Turborepo · TypeScript · ESLint · tsdown · Vitest · CI workflow · Changesets, one fixed group over every package · the release workflow, which versions from the changesets and publishes to npm with provenance |
| [`codegen`](https://github.com/open-music-sdk/js/tree/main/codegen#readme) | ✅ Done | 100% | Crawl Apple's docs · commit a normalized IR · emit types and validators · one file per resource family |
| [`@open-music-sdk/types`](./reference/@open-music-sdk/types/) | ✅ Done | 100% | An interface for every API object · singular names · discriminated resource union · zero dependencies · four properties Apple's documentation marks as required made optional, as Apple left them out against the live API |
| [`@open-music-sdk/validate`](./reference/@open-music-sdk/validate/) | ✅ Done | 100% | A Standard Schema validator for every API object · tiny runtime · no dependencies · tested · every answer of the clients' read functions held to them against the live API once, through the CLI's `check` |
| [`@open-music-sdk/core`](./reference/@open-music-sdk/core/) | ✅ Done | 100% | Client factory · tagged errors · retry and rate limiting · pagination · request hooks · the token and bounded-read primitives the other packages share · the checks and builders the clients declare their endpoints with · the check on where a URL may point |
| [`@open-music-sdk/developer-token`](./reference/@open-music-sdk/developer-token/) | ✅ Done | 100% | JWT minting · minter and fetcher providers over one cache · a `/fetcher` entry with no signing code |
| [`@open-music-sdk/user-token`](./reference/@open-music-sdk/user-token/) | ✅ Done | 100% | Validation · intake handler, and the same step without HTTP · memory and KV stores |
| [`@open-music-sdk/util-artwork`](./reference/@open-music-sdk/util-artwork/) | ✅ Done | 100% | Artwork URL templates · `src`, `srcset` and layout size for an `<img>` · format and crop · opt-in host check, which is all of `core` it carries · checked against Apple's image server |
| [`@open-music-sdk/client-catalog`](./reference/@open-music-sdk/client-catalog/) | ✅ Done | 100% | A function for each of the 58 catalog, storefront, search, and chart endpoints · `catalog(client)` with the answers unwrapped · developer token only · held to Apple's documentation by its tests, and every function to the live API through the CLI's `check`, each answer held to its type |
| [`@open-music-sdk/client-user`](./reference/@open-music-sdk/client-user/) | ✅ Done | 100% | A function for each of the 79 library, ratings, recommendations, history, and replay endpoints · `user(client)` with the answers unwrapped · both tokens · held to Apple's documentation by its tests, and every function to the live API through the CLI's `check`, each answer held to its type, the writes with `--write` |
| [`@open-music-sdk/lib-playlists`](./reference/@open-music-sdk/lib-playlists/) | ✅ Done | 100% | `playlists(client)` · resolve tracks by ISRC, then by a search held to an exact match · read a playlist whole, which is also the export · plan what it is missing · apply it with each write sent once · progress, a delay between requests and an opt-in limit on pages |
| [`@open-music-sdk/lib-preview-player`](./reference/@open-music-sdk/lib-preview-player/) | ✅ Done | 100% | `previewPlayer()` · a queue of preview clips around one audio element · play, pause, next, previous, seek, volume · one frozen state to subscribe to · opt-in host check · no framework |
| [`@open-music-sdk/server`](./reference/@open-music-sdk/server/) | ✅ Done | 100% | `createServerClient()` that mints its own token, with `catalog`, `user` and `playlists` on it · `tokenEndpoint()` for a page's token, bound to its origins · what an app uses of the other packages, from one path · one build for Node, Workers, Bun and Deno, run on Node and on workerd through the server samples |
| [`@open-music-sdk/browser`](./reference/@open-music-sdk/browser/) | ✅ Done | 100% | `createBrowserClient()` over the token endpoint, with the same namespaces · `createConnect()` running Apple's sign-in, the token kept fresh off the click · no signing code, which a bundle test holds it to |
| [`@open-music-sdk/react`](./reference/@open-music-sdk/react/) | ✅ Done | 100% | `MusicProvider` holding the client and the listener's token · `useMusic`, `useMusicUserToken`, `useConnect`, `usePreviewPlayer` · `musicQueries` over every read function for TanStack Query · `"use client"` on the hooks' file alone, which a Next build reads as meant · run in the React and Next.js samples, under StrictMode |
| [Docs site, `apps/docs`](https://github.com/open-music-sdk/js/tree/main/apps/docs#readme) | ✅ Done | 100% | The reference: TypeDoc over every package's doc comments, with arguments, returns and throws on every function, which CI checks · one VitePress site with Getting started, guides, concepts and the reference, published to GitHub Pages from `main` · each guide stands on its own, its code following the client and server the reader picks in the nav, much of it imported from the samples, and CI holds each group of it to every framework once · package READMEs cut to a short template |
| [`@open-music-sdk/cli`, `apps/cli`](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme) | ✅ Done | 100% | Run with `npx` · `login` gets a Music User Token for your own account through Apple's sign-in, `aws login` style, on a loopback page made of `server`'s token endpoint and intake and `browser`'s sign-in · `token`, `doctor`, `logout` · `check`, a diagnostic of every endpoint function of both clients, each answer held to its type, and of what the SDK takes on trust, each by its name · tested against fakes, and run against the live API: sign-in, `doctor` and `check`, with its writes |
| [Sample apps, `samples/`](./samples) | ✅ Done | 100% | Vinyl Collector Simulator, one demo written once per way of using the SDK · Express, Worker, a vanilla page and a React page, either page with either server from one command · a Next.js app, its own server, whose build CI runs with no key · a test holds them to using every export · the guides show their code · walked through against the live API, Apple's sign-in among it |
| First release | ✅ Done | 100% | 1.0.0 of every package, published on 23 October 2026 · one version across the family · provenance through npm's trusted publishing from 1.0.1 on |

Progress is a judgement of how much of the described scope exists and is tested.

## What comes next

Releases follow the changesets, as [CONTRIBUTING](https://github.com/open-music-sdk/js/blob/main/CONTRIBUTING.md#releasing)
describes: a pull request that changes a package says what changed and how big the change is, and merging the
release pull request publishes every package at the new version.

# Status and roadmap

::: warning Under construction
Nothing is published to npm yet. Every package below exists and passes its tests. Against the live Apple Music
API, on Windows, the CLI's sign-in has run. Its `check` has asked, in one storefront:
- every endpoint function that reads, each answer held to its generated type;
- what the SDK takes on trust, through the functions that take it.

With `--write`, it has set and taken away a rating of each type and made a playlist folder too. The React and
Next.js samples have run against it in a headless browser, signed out, and the Next sample's listener pages too, with
a token handed to its server. Apple's sign-in in a React app is still to be run by hand. This table is the source of
truth for what works. Expect everything else to be missing or to change.
:::

The SDK is a family of small packages that share one core and one generated type layer, in the manner of the AWS
SDK for JavaScript v3. There are foundation packages, two clients split at the token boundary, libraries for
common tasks, and the integrations an app installs, with a CLI to use beside them while you build. Every package
ships the same version number. See
[Which package to install](./concepts/packages).

| Sub-task | Status | Progress | Description |
| --- | :---: | :---: | --- |
| Repository tooling | 🚧 In progress | 80% | pnpm workspace · Turborepo · TypeScript · ESLint · tsdown · Vitest · CI workflow · Changesets and the release workflow not yet set up |
| [`codegen`](https://github.com/open-music-sdk/js/tree/main/codegen#readme) | ✅ Done | 100% | Crawl Apple's docs · commit a normalized IR · emit types and validators · one file per resource family |
| [`@open-music-sdk/types`](./reference/@open-music-sdk/types/) | ✅ Done | 100% | An interface for every API object · singular names · discriminated resource union · zero dependencies · four properties Apple's documentation marks as required made optional, as Apple left them out against the live API |
| [`@open-music-sdk/validate`](./reference/@open-music-sdk/validate/) | ✅ Done | 100% | A Standard Schema validator for every API object · tiny runtime · no dependencies · tested · every answer of the clients' read functions held to them against the live API once, through the CLI's `check` |
| [`@open-music-sdk/core`](./reference/@open-music-sdk/core/) | 🚧 In progress | 80% | Client factory · tagged errors · retry and rate limiting · pagination · request hooks · the token and bounded-read primitives the other packages share · the checks and builders the clients declare their endpoints with · the check on where a URL may point · its requests met the live API once, through the CLI |
| [`@open-music-sdk/developer-token`](./reference/@open-music-sdk/developer-token/) | 🚧 In progress | 80% | JWT minting · minter and fetcher providers over one cache · a `/fetcher` entry with no signing code · minting met the live API once, through the CLI |
| [`@open-music-sdk/user-token`](./reference/@open-music-sdk/user-token/) | 🚧 In progress | 80% | Validation · intake handler, and the same step without HTTP · memory and KV stores · validation and the intake met the live API once, through the CLI's sign-in; the stores have not |
| [`@open-music-sdk/util-artwork`](./reference/@open-music-sdk/util-artwork/) | 🚧 In progress | 80% | Artwork URL templates · `src`, `srcset` and layout size for an `<img>` · format and crop · opt-in host check, which is all of `core` it carries · checked against Apple's image server, and the charts' templates against the live API once, through the CLI's `check` |
| [`@open-music-sdk/client-catalog`](./reference/@open-music-sdk/client-catalog/) | 🚧 In progress | 80% | A function for each of the 58 catalog, storefront, search, and chart endpoints · `catalog(client)` with the answers unwrapped · developer token only · held to Apple's documentation by its tests; every function met the live API once, through the CLI's `check`, each answer held to its type |
| [`@open-music-sdk/client-user`](./reference/@open-music-sdk/client-user/) | 🚧 In progress | 80% | A function for each of the 79 library, ratings, recommendations, history, and replay endpoints · `user(client)` with the answers unwrapped · both tokens · held to Apple's documentation by its tests; every function that reads met the live API once, through the CLI's `check`, each answer held to its type, and so did every function that writes: additions, favorites, library playlists, a rating of each type and a playlist folder |
| [`@open-music-sdk/lib-playlists`](./reference/@open-music-sdk/lib-playlists/) | 🚧 In progress | 80% | `playlists(client)` · resolve tracks by ISRC, then by a search held to an exact match · read a playlist whole, which is also the export · plan what it is missing · apply it with each write sent once · progress, a delay between requests and an opt-in limit on pages · `read`, `plan` and `apply` met the live API once, through the CLI's `check`, and `resolve` by ISRC; its search has not |
| [`@open-music-sdk/lib-preview-player`](./reference/@open-music-sdk/lib-preview-player/) | 🚧 In progress | 80% | `previewPlayer()` · a queue of preview clips around one audio element · play, pause, next, previous, seek, volume · one frozen state to subscribe to · opt-in host check · no framework · the hosts of live clips seen once, through the CLI's `check`; untested in a browser against the live API |
| [`@open-music-sdk/server`](./reference/@open-music-sdk/server/) | 🚧 In progress | 80% | `createServerClient()` that mints its own token, with `catalog`, `user` and `playlists` on it · `tokenEndpoint()` for a page's token, bound to its origins · what an app uses of the other packages, from one path · one build for Node, Workers, Bun and Deno · the client, `tokenEndpoint` and the intake met the live API once, through the CLI's sign-in, and again on Node and on workerd, through the server samples |
| [`@open-music-sdk/browser`](./reference/@open-music-sdk/browser/) | 🚧 In progress | 80% | `createBrowserClient()` over the token endpoint, with the same namespaces · `createConnect()` running Apple's sign-in, the token kept fresh off the click · no signing code, which a bundle test holds it to · signed in once against Apple's live script, from the CLI's page, in one browser on Windows |
| [`@open-music-sdk/react`](./reference/@open-music-sdk/react/) | 🚧 In progress | 80% | `MusicProvider` holding the client and the listener's token · `useMusic`, `useMusicUserToken`, `useConnect`, `usePreviewPlayer` · `musicQueries` over every read function for TanStack Query · `"use client"` on the hooks' file alone, which a Next build reads as meant · run in the React and Next.js samples, under StrictMode, in a headless browser; Apple's sign-in through `useConnect` still to be run by hand |
| [Docs site, `apps/docs`](https://github.com/open-music-sdk/js/tree/main/apps/docs#readme) | 🚧 In progress | 90% | The reference: TypeDoc over every package's doc comments, with arguments, returns and throws on every function, which CI checks · one VitePress site with Getting started, guides, concepts and the reference, published to GitHub Pages from `main` · each guide's code follows the client and server the reader picks in the nav, imported from the samples, which CI holds to every framework once · package READMEs cut to a short template |
| [`@open-music-sdk/cli`, `apps/cli`](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme) | 🚧 In progress | 60% | Run with `npx` · `login` gets a Music User Token for your own account through Apple's sign-in, `aws login` style, on a loopback page made of `server`'s token endpoint and intake and `browser`'s sign-in · `token`, `doctor`, `logout` · `check`, a diagnostic of every endpoint function of both clients, each answer held to its type, and of what the SDK takes on trust, each by its name · tested against fakes, and run against the live API on Windows: sign-in, `doctor` and `check`, with its writes |
| [Sample apps, `samples/`](./samples) | 🚧 In progress | 90% | Vinyl Collector Simulator, one demo written once per way of using the SDK · Express, Worker, a vanilla page and a React page, either page with either server from one command · a Next.js app, its own server, whose build CI runs with no key · a test holds them to using every export · the guides show their code · their requests met the live API from Node, and the three pages in a headless browser; Apple's sign-in in a browser, by hand, still to come |
| First release | ⬜ Not started | 0% | One version across the family · npm provenance |

Progress is a judgement of how much of the described scope exists and is tested.

## What comes next

The docs site, the first run against the live API, and the sample apps are in. Then, in this order:

1. Apple's sign-in in each page sample, by hand, in Firefox, Chrome and Edge, with what it finds fixed.
2. Changesets.
3. The first release.

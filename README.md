# open-music-sdk

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

Open, community-led TypeScript SDK for the Apple Music API. Providing strongly typed, ESM only, and framework specific alternatives to Apple's official MusicKit on the Web.

> **🚧 Under construction.** Nothing is published to npm yet. The type, validator, client core, developer
> token, user token and artwork packages and the two clients exist and pass their tests, but none has been
> run against the live API, and there is no integration to install.
> The table below is the source of truth for what works; expect everything else to be missing or to change.

## Project status

The plan is a family of small packages that share one core and one generated type layer, in the manner of
the AWS SDK for JavaScript v3: foundation packages, two clients split at the token boundary, convenience
libs, and the integrations people actually install. Every package ships the same version number.

| Sub-task | Status | Progress | Description |
| --- | :---: | :---: | --- |
| Repository tooling | 🚧 In progress | 80% | pnpm workspace · Turborepo · TypeScript · ESLint · tsdown · Vitest · CI workflow · Changesets and the release workflow not yet set up |
| [`codegen`](./codegen) | ✅ Done | 100% | Crawl Apple's docs · commit a normalized IR · emit types and validators · one file per resource family |
| [`@open-music-sdk/types`](./packages/types) | ✅ Done | 100% | An interface for every API object · singular names · discriminated resource union · zero dependencies |
| [`@open-music-sdk/validate`](./packages/validate) | ✅ Done | 100% | A Standard Schema validator for every API object · tiny runtime · no dependencies · tested |
| [`@open-music-sdk/core`](./packages/core) | 🚧 In progress | 80% | Client factory · tagged errors · retry and rate limiting · pagination · request hooks · the token and bounded-read primitives the other packages share · the checks and builders the clients declare their endpoints with · untested against the live API |
| [`@open-music-sdk/developer-token`](./packages/developer-token) | 🚧 In progress | 80% | JWT minting · minter and fetcher providers over one cache · a `/fetcher` entry with no signing code · untested against the live API |
| [`@open-music-sdk/user-token`](./packages/user-token) | 🚧 In progress | 80% | Validation · intake handler, and the same step without HTTP · memory and KV stores · untested against the live API |
| [`@open-music-sdk/util-artwork`](./packages/util-artwork) | 🚧 In progress | 80% | Artwork URL templates · `src`, `srcset` and layout size for an `<img>` · format and crop · opt-in host check · zero dependencies · checked against Apple's image server, untested against the live API |
| [`@open-music-sdk/client-catalog`](./clients/client-catalog) | 🚧 In progress | 80% | A function for each of the 58 catalog, storefront, search, and chart endpoints · `catalog(client)` with the answers unwrapped · developer token only · held to Apple's documentation by its tests, untested against the live API |
| [`@open-music-sdk/client-user`](./clients/client-user) | 🚧 In progress | 80% | A function for each of the 79 library, ratings, recommendations, history, and replay endpoints · `user(client)` with the answers unwrapped · both tokens · held to Apple's documentation by its tests, untested against the live API |
| `@open-music-sdk/lib-playlists` | ⬜ Not started | 0% | Resolve tracks · read playlists · plan and apply changes · export |
| `@open-music-sdk/lib-preview-player` | ⬜ Not started | 0% | Queue player for preview clips · framework-free · browser only |
| `@open-music-sdk/server` | ⬜ Not started | 0% | Server client · token endpoint · user-token intake · Node, Workers, Bun, Deno |
| `@open-music-sdk/browser` | ⬜ Not started | 0% | Browser client · fetches tokens from your server · no signing code |
| `@open-music-sdk/react` | ⬜ Not started | 0% | Provider · hooks · query option factories |
| `@open-music-sdk/next` | ⬜ Not started | 0% | Server and client halves · route handlers · cookie-backed token store |
| Sample apps | ⬜ Not started | 0% | CLI · Worker · vanilla web · React · Next.js · Electron |
| First release | ⬜ Not started | 0% | One version across the family · npm provenance |

Progress is a judgement of how much of the described scope exists and is tested.

Until an integration exists, an app puts the pieces together itself: a client from `core`, a developer
token from `developer-token`, and the functions of `client-catalog` and `client-user`, each of which
takes that client. Each README linked above shows how.

## What every package holds to

Settled while the foundation packages were built, kept by the two clients, and followed by the
packages still to come.

- **Nothing reads an environment or a file.** Keys, IDs and tokens arrive as arguments. Loading them
  is your app's job, done the way it loads its other secrets.
- **Two kinds of error.** A mistake in how a function was called is a `TypeError` that says which
  argument was wrong, raised before anything is sent. What happens at runtime with Apple, or with
  your own token endpoint, is an `AppleMusicError` with a `_tag` to switch on.
- **Strict about what a function is handed, and no stricter.** A value in the wrong place is refused.
  What your app does with the SDK is yours to decide: how many pages a walk asks for, how fast
  requests are made and where an artwork URL points are not checked by default, and `maxPages`, a
  rate limiter and the artwork host check are there to turn on.
- **No error prints a key or a token.** A value that should have been one is described by its length
  or its kind, so a secret never reaches a log by way of an error message.
- **Options are checked and taken when a thing is created.** A mistake fails there and not on the
  first request, and nothing done to your options object afterwards changes what happens.
- **Credentials only go to `https://api.music.apple.com`.** `core` refuses a path that resolves
  anywhere else before a token is asked for or a request is made.
- **The Music User Token goes only where the listener's things are.** No function of
  `client-catalog` sends it, whichever client it is handed and wherever a next link points. Every
  function of `client-user` does.
- **A write is sent once, unless Apple says it was not carried out.** A `POST` is sent again only
  after a 429, or when there was no developer token to send it with, so a lost answer cannot make a
  playlist twice.
- **One function for each endpoint, held to Apple's documentation.** The types and validators are
  generated from it, and each client's tests hold every function to the method, the path, the
  parameters and the answer its endpoint documents. Where a package differs from the documentation,
  its README says how.
- **What is read from outside is bounded.** The answer from your token endpoint and a body posted to
  the intake handler are read up to a limit and no further.
- **Signing code stays where a key may live.** `jose` is the only third-party runtime dependency, and
  the entry a browser imports, `@open-music-sdk/developer-token/fetcher`, has none of it.
- **ESM only, Node 24 or newer, no framework runtime.**

## Layout

```
pnpm-workspace.yaml   workspace globs and the dependency catalog
turbo.json            codegen → build → typecheck → lint → test
tsconfig.base.json    strict TypeScript base every package extends
eslint.config.ts      root ESLint config (tooling/eslint-config)
tooling/              private shared configs: eslint, tsdown, vitest
codegen/              docc-crawl → docc-ir/ir.json → emit (see codegen/README.md)
packages/             foundation packages: types, validate, core, developer-token, user-token, util-artwork
clients/              one client per token boundary: client-catalog, client-user
.github/workflows/    ci: build, typecheck, lint and test on what a change affects
```

Planned workspaces: `lib/` (conveniences), `integrations/` (what people install: server, browser,
react, next), `apps/` (private samples).

## Development

```
corepack enable
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

## License

[MIT](./LICENSE) with a [Developer Certificate of Origin](./CONTRIBUTING.md#developer-certificate-of-origin) sign-off on contributions.
The project name and logo are not covered by the code license; see [TRADEMARKS.md](./TRADEMARKS.md).
Using the Apple Music API requires your own Apple Developer account and agreement with Apple.

# open-music-sdk

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

Open, community-led TypeScript SDK for the Apple Music API. Providing strongly typed, ESM only, and framework specific alternatives to Apple's official MusicKit on the Web.

> **🚧 Under construction.** Nothing is published to npm yet. The generated type and validator packages
> exist and pass their tests, but there is no HTTP client, no token handling, and no integration to install.
> The table below is the source of truth for what works; expect everything else to be missing or to change.

## Project status

The plan is a family of small packages that share one core and one generated type layer, in the manner of
the AWS SDK for JavaScript v3: foundation packages, two clients split at the token boundary, convenience
libs, and the integrations people actually install. Every package ships the same version number.

| Sub-task | Status | Progress | Description |
| --- | :---: | :---: | --- |
| Repository tooling | ✅ Done | 100% | pnpm workspace · Turborepo · TypeScript · ESLint · tsdown · Vitest · Changesets · CI and release workflows |
| `codegen` | ✅ Done | 100% | Crawl Apple's docs · commit a normalized IR · emit types and validators · one file per resource family |
| `@open-music-sdk/types` | ✅ Done | 100% | An interface for every API object · singular names · discriminated resource union · zero dependencies |
| `@open-music-sdk/validate` | ✅ Done | 100% | A Standard Schema validator for every API object · tiny runtime · no dependencies · tested |
| `@open-music-sdk/core` | 🚧 In progress | 80% | Client factory · tagged errors · retry and rate limiting · pagination · request hooks · untested against the live API |
| `@open-music-sdk/developer-token` | 🚧 In progress | 0% | JWT minting · cached minter · remote token provider · key file loading |
| `@open-music-sdk/user-token` | ⬜ Not started | 0% | Music User Token intake · validation · pluggable stores |
| `@open-music-sdk/util-artwork` | ⬜ Not started | 0% | Artwork URL templates · srcset helpers · browser only |
| `@open-music-sdk/client-catalog` | ⬜ Not started | 0% | Catalog, storefront, search, and chart endpoints · developer token only |
| `@open-music-sdk/client-user` | ⬜ Not started | 0% | Library, ratings, recommendations, history, and replay endpoints · both tokens |
| `@open-music-sdk/lib-playlists` | ⬜ Not started | 0% | Resolve tracks · read playlists · plan and apply changes · export |
| `@open-music-sdk/lib-preview-player` | ⬜ Not started | 0% | Queue player for preview clips · framework-free · browser only |
| `@open-music-sdk/server` | ⬜ Not started | 0% | Server client · token endpoint · user-token intake · Node, Workers, Bun, Deno |
| `@open-music-sdk/browser` | ⬜ Not started | 0% | Browser client · fetches tokens from your server · no signing code |
| `@open-music-sdk/react` | ⬜ Not started | 0% | Provider · hooks · query option factories |
| `@open-music-sdk/next` | ⬜ Not started | 0% | Server and client halves · route handlers · cookie-backed token store |
| Sample apps | ⬜ Not started | 0% | CLI · Worker · vanilla web · React · Next.js · Electron |
| First release | ⬜ Not started | 0% | One version across the family · npm provenance |

Progress is a judgement of how much of the described scope exists and is tested.

## Layout

```
pnpm-workspace.yaml   workspace globs and the dependency catalog
turbo.json            codegen → build → typecheck → lint → test
tsconfig.base.json    strict TypeScript base every package extends
eslint.config.ts      root ESLint config (tooling/eslint-config)
.changeset/           one fixed version group: @open-music-sdk/*
tooling/              private shared configs: eslint, tsdown, vitest
codegen/              docc-crawl → docc-ir/ir.json → emit (see codegen/README.md)
packages/             foundation packages: types, validate, core
```

Planned workspaces: `clients/` (one per token boundary), `lib/` (conveniences),
`integrations/` (what people install: server, browser, react, next), `apps/` (private samples).

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

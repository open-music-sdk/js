# open-music-sdk

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

Open, community-led TypeScript SDK for the Apple Music API. ESM only, Node 24+, every modern browser and edge runtime.

> **🚧 Under construction.** Nothing is published to npm yet. The generated type and validator packages
> exist and pass their tests, but there is no HTTP client, no token handling, and no integration to install.
> The table below is the source of truth for what works; expect everything else to be missing or to change.

## Project status

The plan is a family of small packages that share one core and one generated type layer, in the manner of
the AWS SDK for JavaScript v3: foundation packages, two clients split at the token boundary, convenience
libs, and the integrations people actually install. Every package ships the same version number.

| Sub-task | Status | Progress | Description |
| --- | :---: | :---: | --- |
| Repository tooling | ✅ Done | 100% | pnpm workspace with a dependency catalog, Turborepo pipeline, TypeScript 6, typescript-eslint, tsdown, Vitest, Changesets with one fixed version group, CI and release workflows. |
| `codegen` | ✅ Done | 100% | Crawls Apple's DocC JSON once, commits a normalized IR, emits types and validators split one file per resource family. Re-run when Apple's release notes mention new attributes. |
| `@open-music-sdk/types` | ✅ Done | 100% | 275 generated interfaces with singular names (`tSong`, `tSongAttributes`), a `tAnyResource` union discriminated by `type`. Source-only, zero dependencies. |
| `@open-music-sdk/validate` | ✅ Done | 100% | One Standard Schema validator per dictionary, built on a sub-100-line runtime with no dependencies. 446 tests. |
| `@open-music-sdk/core` | ⬜ Not started | 0% | `createClient`, tagged errors, retry with `Retry-After`, a token-bucket rate limiter shared per developer token, `next`-link pagination, redacted config, request and response hooks. |
| `@open-music-sdk/developer-token` | ⬜ Not started | 0% | ES256 minting with `jose`, a single-flight cached minter with refresh-ahead, a remote-token provider for browsers, and a `node` entry that reads the `.p8` from disk. |
| `@open-music-sdk/user-token` | ⬜ Not started | 0% | Intake helpers for the Music User Token (the one thing Apple issues and we cannot), validation against `/v1/me/storefront`, and a store interface with memory and KV implementations. |
| `@open-music-sdk/util-artwork` | ⬜ Not started | 0% | `{w}x{h}` artwork template substitution and `srcset` helpers. Browser-side only. |
| `@open-music-sdk/client-catalog` | ⬜ Not started | 0% | Typed functions for `/v1/catalog`, `/v1/storefronts`, search, charts. Developer token only. Hand-written against the endpoint table in the IR. |
| `@open-music-sdk/client-user` | ⬜ Not started | 0% | Typed functions for `/v1/me`: library, ratings, recommendations, history, replay. Requires both tokens. |
| `@open-music-sdk/lib-playlists` | ⬜ Not started | 0% | Resolve outside tracks to catalog IDs by ISRC, read a playlist fully, plan a diff as append operations, apply with verification, export to portable JSON. |
| `@open-music-sdk/lib-preview-player` | ⬜ Not started | 0% | A framework-free queue player for the 30-second preview clips, the only audio a non-Apple client may play. About 1 KB. |
| `@open-music-sdk/server` | ⬜ Not started | 0% | The integration for Node, Workers, Bun, and Deno: `createServerClient`, a drop-in token endpoint and user-token intake handler, export conditions per runtime. |
| `@open-music-sdk/browser` | ⬜ Not started | 0% | `createBrowserClient({ tokenUrl })` that fetches a developer token from your server. Deliberately contains no signing code. |
| `@open-music-sdk/react` | ⬜ Not started | 0% | Everything in `browser` plus a provider, hooks, and TanStack Query option factories. |
| `@open-music-sdk/next` | ⬜ Not started | 0% | `server` and `react` wired together with Next-shaped route handlers, a per-request client for server components, and a cookie-backed user-token store. |
| Sample apps | ⬜ Not started | 0% | CLI, token-endpoint Worker, vanilla web, React, Next.js, and Electron samples. CI will assert every integration appears in at least one app. |
| First release | ⬜ Not started | 0% | Changesets release of the whole `@open-music-sdk/*` family at one version, with npm provenance. |

Progress is a judgement of how much of the described scope exists and is tested, not a line count.

## Layout

```
pnpm-workspace.yaml   workspace globs and the dependency catalog
turbo.json            codegen → build → typecheck → lint → test
tsconfig.base.json    strict TypeScript base every package extends
eslint.config.ts      root ESLint config (tooling/eslint-config)
.changeset/           one fixed version group: @open-music-sdk/*
tooling/              private shared configs: eslint, tsdown, vitest
codegen/              docc-crawl → docc-ir/ir.json → emit (see codegen/README.md)
packages/             foundation packages: types, validate
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

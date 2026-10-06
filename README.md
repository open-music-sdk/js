# open-music-sdk

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

Open, community-led TypeScript SDK for the Apple Music API. ESM only, Node 22+, every modern browser and edge runtime.

## Status

Scaffolding and repository tooling only. No packages are published yet.

## Layout

```
pnpm-workspace.yaml   workspace globs and the dependency catalog
turbo.json            codegen → build → typecheck → lint → test
tsconfig.base.json    strict TypeScript base every package extends
eslint.config.js      root ESLint config (tooling/eslint-config)
.changeset/           one fixed version group: @open-music-sdk/*
tooling/              private shared configs: eslint, tsdown, vitest
```

Planned workspaces: `packages/` (foundation), `clients/` (one per token boundary), `lib/` (conveniences),
`integrations/` (what people install: server, browser, react, next), `apps/` (private samples), `codegen/`.

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

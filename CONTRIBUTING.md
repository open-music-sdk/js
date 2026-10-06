# Contributing

## Setup

- Node 22 or newer (see `.nvmrc`), pnpm via `corepack enable`.
- `pnpm install`, then `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`. Each runs through Turborepo.

## Changes to published packages

Add a changeset with `pnpm changeset`. Every package in the `@open-music-sdk/*` family shares one version,
so any changeset bumps the whole family on the next release.

## Developer Certificate of Origin

Instead of a contributor license agreement, every commit must be signed off under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```
git commit -s
```

This adds a `Signed-off-by` trailer to the commit message and certifies that you wrote
the change or have the right to submit it under the MIT license.

## Conventions

- ESM only. No CommonJS anywhere.
- Interfaces and type aliases are prefixed with a lowercase `t` followed by a PascalCase name (`tSong`, `tClientOptions`).
  Classes are PascalCase, methods and properties are camelCase. ESLint enforces this.
- No Apple marks in package names or identifiers. Say "for the Apple Music API" in descriptions and keywords instead.
- Never commit raw pages from Apple's documentation; codegen commits only the intermediate representation.

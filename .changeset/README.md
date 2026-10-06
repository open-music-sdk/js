# Changesets

Every published package shares one version (one Changesets fixed group, `@open-music-sdk/*`).
Any changeset bumps the whole family; the release PR lists what actually changed.

Add one with `pnpm changeset`. Private workspace packages (apps, codegen, tooling) are never versioned.

Until the first @open-music-sdk/* package exists, every changeset command fails with
"does not match any package in the project". Expected: Changesets requires a fixed group to match at least one package.

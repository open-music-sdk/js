# Contributing

## Setup

You need Node 24 or newer (see `.nvmrc`) and pnpm, which `corepack enable` sets up.

```
corepack enable
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

Each command runs through Turborepo. To work on the docs site, run `pnpm --filter docs dev`.

## Layout

```
pnpm-workspace.yaml   workspace globs and the dependency catalog
turbo.json            codegen → build → typecheck → lint → test → check
tsconfig.base.json    strict TypeScript base every package extends
eslint.config.ts      root ESLint config (tooling/eslint-config)
tooling/              private shared configs: eslint, tsdown, vitest
codegen/              docc-crawl → docc-ir/ir.json → emit (see codegen/README.md)
packages/             foundation packages: types, validate, core, developer-token, user-token, util-artwork
clients/              one client per token boundary: client-catalog, client-user
lib/                  conveniences over the clients: lib-playlists, lib-preview-player
integrations/         what people install: server, browser, react
apps/                 beside the packages: cli, the published CLI, and docs, the docs site (each has a README)
.github/workflows/    ci: build, typecheck, lint and test on what a change affects · pages: the docs site, from main
```

`samples/` holds the private sample apps: one demo, Vinyl Collector Simulator, per way of using the SDK, which the
guides show code from. See [samples/README.md](./samples/README.md).

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
- Every export has a doc comment, and every function, method and namespace member says what each argument is
  (`@param`), what it returns (`@returns`) and what it throws (`@throws`, one per kind of error). A function with no
  `@throws` throws nothing. `pnpm --filter docs check` holds the first two on every function and method; each
  client's tests hold them on its namespace's members; the rest, and every `@throws`, is read for in review. See
  [apps/docs](./apps/docs/README.md).

## Releasing

Every `@open-music-sdk` package ships the same version, the CLI among them, and a release moves all of them: a
matching version means packages released and tested together. [Changesets](https://changesets.dev) keeps the
record, in one fixed group, and no version is edited by hand.

- A pull request that changes a published package adds a changeset: run `pnpm changeset`, pick the packages it
  changes and the bump, and write the line that goes in their changelogs. CI fails a pull request that changes a
  package without one. For a change that should release nothing, such as a test or a comment,
  `pnpm changeset --empty`.
- The bump is for the whole family, since every package takes it:
  - patch: a fix, with nothing added or changed in the API;
  - minor: an addition, such as a function, an option, an endpoint or a package;
  - major: a removal or a change in what an existing name does, a higher Node floor, or a higher peer major.
- On each push to `main`, the `release` workflow opens or refreshes a pull request titled "release: version
  packages": every package at the new version, each `CHANGELOG.md` with its entries, the changesets consumed.
  Merging it is the release. The same workflow publishes every package to npm with provenance and creates the
  GitHub release `v<version>`, with the pull requests since the last one as its notes. A publish that fails part
  way is rerun from the Actions tab; versions already on npm are skipped.

## Writing docs

The docs site, in [`apps/docs`](./apps/docs/README.md), follows [Diátaxis](https://diataxis.fr/), without its
tutorials: Getting started sets up a server and a client, and each How To guide stands on its own. Every page is
one of three kinds, and stays that kind:

| Kind | Where | What it does | What it leaves out |
| --- | --- | --- | --- |
| Guide | `apps/docs/guides/` | Gets a reader who knows the basics to one goal | Teaching the basics, explaining why at length |
| Concept | `apps/docs/concepts/` | Explains how something works and why | Steps to follow |
| Reference | Doc comments, and each package's README | States the facts: arguments, options, returns, errors | Advice and opinion |

A package README opens that package's reference page, and is also its page on npm and GitHub. It follows one
template: the family's header, as the root README has it, with a plain-English title and the package name; on a
part an app rarely installs alone, a note pointing at "Which package to install"; what the package does in a
sentence, and when to use an integration instead; Installation; Documentation, the links to the guides and
concepts that use it, the reference first; one example of under 20 lines; and what is in it. Options belong in
the doc comment of each option, not in a README table. On the site, the header gives way to the package name.

How to write:

- Write to "you", in the present tense and the active voice.
- Put the action first. Give the reason after it, or on a Concepts page that you link to.
- Keep sentences short and give each paragraph one idea.
- Explain a term the first time a page uses it, or link to the [glossary](./apps/docs/glossary.md).
- Say a thing once, on the page it belongs to, and link to it everywhere else.
- Make a guide stand on its own, for a reader who arrives from a search and has read no other guide. Every name its
  code uses is imported from a package, defined in the guide, or declared as standing for the reader's own code.
  What it needs from elsewhere goes in its "Before you start" list, and it teaches nothing beyond its own goal.
- Say where every code example runs: on a server, in a page, or anywhere.
- Show a sample's code with `<<<` rather than a copy of it. Where the code differs by framework, put each
  framework's in a `::: for` block, as [the docs' README](./apps/docs/README.md#code-for-each-framework) shows,
  and keep the prose around the blocks the same for every reader.
- Use bold for warnings only. On the site, a warning that matters goes in a `::: warning` box.
- Mark what has not been run against the live API, where it changes what a reader should rely on.

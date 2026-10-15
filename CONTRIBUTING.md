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
apps/                 private apps of the repository: docs, the docs site (see apps/docs/README.md)
.github/workflows/    ci: build, typecheck, lint, test and check on what a change affects · pages: the docs site, from main
```

Planned workspaces: `apps/cli` (the CLI) and `samples/` (private sample apps).

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

## Writing docs

The docs site, in [`apps/docs`](./apps/docs/README.md), follows [Diátaxis](https://diataxis.fr/). Every page is
one of four kinds, and stays that kind:

| Kind | Where | What it does | What it leaves out |
| --- | --- | --- | --- |
| Tutorial | `apps/docs/start/` (once the samples exist) | Teaches a newcomer by building something that works | Choices, edge cases, long explanations |
| Guide | `apps/docs/guides/` | Gets a reader who knows the basics to one goal | Teaching the basics, explaining why at length |
| Concept | `apps/docs/concepts/` | Explains how something works and why | Steps to follow |
| Reference | Doc comments, and each package's README | States the facts: arguments, options, returns, errors | Advice and opinion |

A package README opens that package's reference page, and is also its page on npm and GitHub. It follows one
template: what the package does in a sentence, when to use an integration instead, install, one example of
under 20 lines, what is in it, and links to the guides and concepts that use it. Options belong in the doc
comment of each option, not in a README table.

How to write:

- Write to "you", in the present tense and the active voice.
- Put the action first. Give the reason after it, or on a Concepts page that you link to.
- Keep sentences short and give each paragraph one idea.
- Explain a term the first time a page uses it, or link to the [glossary](./apps/docs/glossary.md).
- Say a thing once, on the page it belongs to, and link to it everywhere else.
- Say where every code example runs: on a server, in a page, or anywhere.
- Use bold for warnings only. On the site, a warning that matters goes in a `::: warning` box.
- Mark what has not been run against the live API, where it changes what a reader should rely on.

# Which package to install

Most apps install one package, an [integration](../glossary#integration), and import everything from it. This
page helps you pick one, explains how the other packages fit around it, and introduces the command-line tool you
use beside them.

::: info Not on npm yet
Nothing is published to npm yet. The packages exist and pass their tests, but you can't install them from the
registry until the first release.
:::

## What to install

| You're building | Install |
| --- | --- |
| Code that runs on a server: a Node service, a Cloudflare Worker, Bun, Deno, a command-line tool or an Electron main process | [`server`](../reference/@open-music-sdk/server/) |
| A web page without React | [`browser`](../reference/@open-music-sdk/browser/) |
| A React app | [`react`](../reference/@open-music-sdk/react/) |
| A Next.js app | `server` for route handlers, server components and actions, and `react` for client components. See [Next.js](../guides/nextjs). |
| Your own client, from the parts | `core`, and the client and library packages you need. See [Build your own client from the parts](../guides/own-client). |
| A Music User Token for your own account, to try the API or run a script | The CLI, `@open-music-sdk/cli`, beside any of the above. See [The command-line tool](#the-command-line-tool). |

Each package's reference page gives its install line.

A page can't sign a developer token, so it fetches one from a route on your server. `tokenEndpoint` in `server`
is that route. An app with `browser` or `react` therefore runs `server`, or another route that does the same
job, on its back end. See [Serve a developer token to a page](../guides/token-endpoint).

## The command-line tool

`@open-music-sdk/cli` is a command you run while you build, not a library you import. It does what your app can't
do for you yet:

- `login` gets a Music User Token for your own Apple Music account. It serves a page on `localhost` that runs
  Apple's sign-in, opens it in your browser, and keeps the token once Apple has accepted it.
- `token` prints that token, and nothing else, for another program to read. `token --developer` mints a developer
  token from your key instead, which lives an hour.
- `doctor` asks Apple whether your key works, then whether the kept token does. A `401` can mean either, and this
  tells them apart. It prints nothing secret.
- `logout` forgets the kept token.

It reads your key and its IDs from `APPLE_MUSIC_PRIVATE_KEY`, `APPLE_MUSIC_TEAM_ID` and `APPLE_MUSIC_KEY_ID`, the
variables these docs use, so with those set it needs no flags. A value it can't find, it asks for. You also need
Node 24 or newer, and an Apple Account with an Apple Music subscription to sign in with.

To use your own account from a script, sign in once, then hand the token to the script in an environment
variable. On your machine:

```sh
open-music-sdk login
APPLE_MUSIC_USER_TOKEN=$(open-music-sdk token) node job.js
```

In `job.js`, `music.as(process.env.APPLE_MUSIC_USER_TOKEN)` gives a client that acts for you.

Add the CLI to your project as a dev dependency and run it with `pnpm exec`. Or run it once with `npx`, pinned to
a version: unpinned, `npx` runs whatever is newest, with your key in reach.

```sh
pnpm add -D @open-music-sdk/cli
pnpm exec open-music-sdk doctor

npx @open-music-sdk/cli@<version> login
```

`open-music-sdk --help` lists every command, and `open-music-sdk help <command>` gives a command's options. The
CLI's [README](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme) explains how `login` keeps the
sign-in safe. The token is kept in one file in your user profile, readable by you alone and not encrypted, until
`logout` forgets it.

::: info Before the first release
To run the CLI from a clone of the repository, build it with `pnpm --filter @open-music-sdk/cli... build`, then
run `node apps/cli/dist/bin.js login`.
:::

The token the CLI keeps is yours. Your listeners' tokens come from their own sign-in in your app: see
[Sign a listener in](../guides/sign-in).

## How the packages are split

The SDK is a family of small packages in four tiers, in the manner of the AWS SDK for JavaScript v3. Each tier
is built on the ones below it.

| Tier | Packages | What it's for |
| --- | --- | --- |
| Integrations | `server`, `browser`, `react` | What an app installs. A ready-made client, and everything else an app uses, from one import. |
| Clients | `client-catalog`, `client-user` | A named function for nearly every endpoint of Apple's API |
| Libraries | `lib-playlists`, `lib-preview-player` | The work most apps do around the clients |
| Foundation | `core`, `developer-token`, `user-token`, `util-artwork`, `types`, `validate` | The parts everything else is built on |

The clients are split at the token boundary. Every function in
[`client-catalog`](../reference/@open-music-sdk/client-catalog/) reads the [catalog](../glossary#catalog) and sends
the developer token alone. Every function in [`client-user`](../reference/@open-music-sdk/client-user/) reads or
changes one listener's things and sends their Music User Token as well.
[Developer tokens and Music User Tokens](./tokens) explains why the line falls there.

The libraries do what an app would otherwise write around the clients:

- [`lib-playlists`](../reference/@open-music-sdk/lib-playlists/) finds tracks from another service in Apple's
  catalog, reads a playlist whole, and adds what it's missing without adding anything twice.
- [`lib-preview-player`](../reference/@open-music-sdk/lib-preview-player/) plays the short preview clips of the
  songs a client fetched, as a queue around one audio element.

The foundation packages:

- [`core`](../reference/@open-music-sdk/core/) is the HTTP client every request goes through. It attaches the
  tokens, follows `next` links, turns Apple's status codes into errors and retries what's worth retrying.
- [`developer-token`](../reference/@open-music-sdk/developer-token/) signs a developer token with your private
  key, or fetches one from your token endpoint, and keeps it fresh.
- [`user-token`](../reference/@open-music-sdk/user-token/) checks a Music User Token with Apple, takes one in from
  a page, and keeps it in a store on your server.
- [`util-artwork`](../reference/@open-music-sdk/util-artwork/) turns Apple's
  [artwork templates](../glossary#artwork-template) into image URLs.
- [`types`](../reference/@open-music-sdk/types/) and [`validate`](../reference/@open-music-sdk/validate/) are
  generated from Apple's documentation: a TypeScript type and a [Standard Schema](../glossary#standard-schema)
  validator for every object in the API.

## What an integration gives you

Each integration gives you a client. `createServerClient` in `server` signs its own developer token with your
key. `createBrowserClient` in `browser` and `react` fetches one from your token endpoint.

The client is `core`'s client, with `request`, `paginate`, `storefront`, `as` and `forUser`, and three
[namespaces](../glossary#namespace) on it:

- `catalog`: every function of `client-catalog`, bound to the client, handing over what Apple's answer holds
  instead of the whole answer.
- `user`: every function of `client-user`, bound the same way.
- `playlists`: the verbs of `lib-playlists`.

`as(token)` gives you the same client for one listener, and `forUser(userId)` does the same with the token looked
up in a store.

Each integration adds what its platform needs:

- `server` has `tokenEndpoint`, the route that hands a page a developer token.
- `browser` has `createConnect`, which runs Apple's sign-in for the listener's Music User Token, and
  `MUSICKIT_SCRIPT`, the address of Apple's script, for your content security policy.
- `react` has everything in `browser`, plus `MusicProvider`, the hooks `useMusic`, `useMusicUserToken`,
  `useConnect`, `usePreviewPlayer` and `useMusicQueries`, and `musicQueries` for TanStack Query.

Each also re-exports what an app uses of the other packages, under the names those packages give them. The
reference pages of [`server`](../reference/@open-music-sdk/server/) and
[`browser`](../reference/@open-music-sdk/browser/) list them. `core`'s `createClient`, and the tools the clients
are built with, aren't re-exported. To build your own client, install `core` and the client and library packages
themselves.

## One version for every package

Every package ships the same version number. If you install `core` and the client and library packages
yourself, keep them all on the same version.

If your app does end up with a different copy of `core` than one of the packages resolves, nothing breaks. A
client made by either copy is a client to every package, and an `AppleMusicError` is recognised, and retried,
whichever copy made it. That's because both go by shape: a client is anything with the client's methods, and an
`AppleMusicError` is an `Error` with that name and a `_tag`.

## Module format and runtimes

Every package is ESM only, with no CommonJS build. The SDK supports Node 24 or newer, and needs no framework
runtime.

- `server` is one build that runs on Node, Cloudflare Workers, Bun and Deno, since each has the same `fetch` and
  WebCrypto. It's also for a command-line tool or an Electron main process. See
  [Cloudflare Workers](../guides/cloudflare-workers).
- `browser` runs in a page. Nothing a page bundles from it signs a token, holds a key or touches the page's
  storage.
- `react` runs in a page too, with React 19 as a peer dependency. TanStack Query isn't a dependency:
  `musicQueries` gives what `useQuery` and `useInfiniteQuery` take, and imports nothing from it.
- `core` depends on nothing outside the family, and runs anywhere `fetch` does. `jose`, which signs developer
  tokens, is the only third-party runtime dependency in the family.
- `lib-preview-player` needs an audio element, so it runs in a browser. `lib-playlists` and `util-artwork` run
  anywhere.

# Which package to install

Most apps install one package, an [integration](../glossary#integration), and import everything from it. This
page helps you pick one, and explains how the other packages fit around it.

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

Each package's reference page gives its install line.

A page can't sign a developer token, so it fetches one from a route on your server. `tokenEndpoint` in `server`
is that route. An app with `browser` or `react` therefore runs `server`, or another route that does the same
job, on its back end. See [Serve a developer token to a page](../guides/token-endpoint).

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

<div align="center">

<img src="https://raw.githubusercontent.com/open-music-sdk/js/main/assets/open-music-app-logo.svg" alt="open-music-sdk" width="200">

# Open Music SDK for React

`@open-music-sdk/react`

[![npm](https://img.shields.io/npm/v/@open-music-sdk/react)](https://www.npmjs.com/package/@open-music-sdk/react)
[![test coverage](https://codecov.io/gh/open-music-sdk/js/graph/badge.svg)](https://codecov.io/gh/open-music-sdk/js)

</div>

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

The Apple Music API for a React app: everything in [`@open-music-sdk/browser`](../browser/README.md), plus a
provider that holds the client and the listener's token, hooks for the client, Apple's sign-in and the preview
player, and query builders for TanStack Query.

## Installation

```
pnpm add @open-music-sdk/react react
```

React 19 is a peer dependency. TanStack Query is not a dependency: the query builders give you what `useQuery` and
`useInfiniteQuery` take, without importing it. The developer token comes from a route on your server: `tokenEndpoint`
in [`@open-music-sdk/server`](../server/README.md). A Next.js app uses `server` on the server and this package in its
client components.

## Documentation

- [The documentation site](https://open-music-sdk.github.io/js/): guides for each client and server, concepts,
  and the reference
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/react/)
- [Which package to install](https://open-music-sdk.github.io/js/concepts/packages)
- [Sign a listener in](https://open-music-sdk.github.io/js/guides/sign-in), and the
  [security model](https://open-music-sdk.github.io/js/concepts/security) for where the provider keeps the token
- [Set up your client](https://open-music-sdk.github.io/js/guides/client-setup) and
  [Read and write with TanStack Query](https://open-music-sdk.github.io/js/guides/tanstack-query)
- [Play song previews](https://open-music-sdk.github.io/js/guides/previews)

## Example

In your client components, rendered inside TanStack Query's `QueryClientProvider`, where `showError` stands for your
own code:

```tsx
import { MusicProvider, createBrowserClient, useConnect, useMusicQueries } from "@open-music-sdk/react";
import { useQuery } from "@tanstack/react-query";

// Create the client once, outside the component tree.
const music = createBrowserClient({ tokenUrl: "/api/music/token", storefront: "us" });
export const App = () => <MusicProvider music={music}><Connect /><Album id="1613600183" /></MusicProvider>;

function Connect() {
  const { isReady, error, connect } = useConnect({ app: { name: "Vinyl Collector Simulator" } }); // the token goes to the provider
  // Enabled once Apple's script is ready, or has failed to load: a click then loads it again.
  return <button disabled={!isReady && error === undefined} onClick={() => void connect().catch(showError)}>Connect Apple Music</button>;
}

function Album({ id }: { id: string }) {
  const { data: album } = useQuery(useMusicQueries().catalog.getAlbum(id)); // needs the developer token only
  return <h1>{album?.attributes?.name}</h1>;
}
```

## What's in it

| Export | What it does |
| --- | --- |
| `<MusicProvider music>` | Holds the client and the listener's token, in React state and nowhere else |
| `useMusic()` | The provider's client, bound to the listener while a token is held: one object for every component |
| `useMusicUserToken()` | `[token, setToken]`: the token the provider holds, and how to set or forget it |
| `useConnect(options)` | Apple's sign-in, as `createConnect` in `browser` runs it: `isReady`, `error`, `connect()` and `disconnect()` |
| `usePreviewPlayer(options?)` | A preview player for the component: its `state`, and `load`, `play`, `pause`, `next`, `previous`, `seek` and `setVolume` |
| `musicQueries(music, scope?)`, `useMusicQueries()` | Every read function of the catalog and the library, as a query for `useQuery` or, for a list, `useInfiniteQuery` |
| Everything in `browser` | `createBrowserClient`, `createConnect`, and everything it re-exports: see [its README](../browser/README.md) |

Only the built file that holds the provider and the hooks carries the `"use client"` directive. So `musicQueries`,
`isAppleMusicError` or `artworkImage` imported from this package can also be used in a route handler, a server
component or a prefetch. The [Next sample](https://github.com/open-music-sdk/js/tree/main/samples/web-nextjs)
imports them so, and `next build` passes in CI.

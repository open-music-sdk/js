# @open-music-sdk/react

The Apple Music API for a React app: everything in [`@open-music-sdk/browser`](../browser/README.md), a
provider that holds the client and the listener's token, hooks for the client, Apple's sign-in and the
preview player, and one query factory for TanStack Query.

```
pnpm add @open-music-sdk/react react
```

**Runs in a page.** The developer token comes from an endpoint your server hosts, `tokenEndpoint` of
[`@open-music-sdk/server`](../server/README.md). React 19 is a peer. TanStack Query is neither: the factory gives
what `useQuery` and `useInfiniteQuery` take, and imports nothing of it.

```tsx
import { MusicProvider, createBrowserClient, useConnect, useMusic, useMusicQueries, usePreviewPlayer } from "@open-music-sdk/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

// The client, made once, outside the tree, as a QueryClient is.
const music = createBrowserClient({ tokenUrl: "/api/music/token" });

export function App() {
  return (
    <MusicProvider music={music}>
      <Connect />
      <Album id="1613600183" />
      <Library />
    </MusicProvider>
  );
}

function Connect() {
  const { isReady, connect, disconnect } = useConnect({ app: { name: "Crate Digger" } }); // Apple's script, loaded on mount; the token goes to the provider
  const [token] = useMusicUserToken();
  return token ?
      <button onClick={() => void disconnect().catch(showWhyNot)}>Sign out</button>
    : <button disabled={!isReady} onClick={() => void connect().catch(showWhyNot)}>Connect Apple Music</button>;
}

function Album({ id }: { id: string }) {
  const queries = useMusicQueries();
  const { data: album } = useQuery(queries.catalog.getAlbum(id, { include: ["tracks"] })); // the developer token alone
  const { state, load, play } = usePreviewPlayer();
  const tracks = album?.relationships?.tracks?.data ?? [];
  return album ? <button onClick={() => { load(tracks); void play().catch(showWhyNot); }}>{state.status === "playing" ? "Playing" : "Play previews"}</button> : null;
}

function Library() {
  const [token] = useMusicUserToken(); // held once the listener signed in
  const queries = useMusicQueries();
  const { data } = useInfiniteQuery({ ...queries.user.listLibraryPlaylists(), enabled: token !== undefined }); // every page, as the listener scrolls
  return <ul>{data?.pages.flatMap((page) => page.data).map((p) => <li key={p.id}>{p.attributes?.name}</li>)}</ul>;
}
```

## What is in it

| Export | Does |
| --- | --- |
| `<MusicProvider music>` | Holds the client and the listener's token, in state and nowhere else |
| `useMusic()` | The provider's client, bound to the listener while a token is held: one object for every component |
| `useMusicUserToken()` | `[token, setToken]`: the token the provider holds, and how to set or forget it |
| `useConnect(options)` | Apple's sign-in, as [`createConnect`](../browser/README.md#sign-in) runs it: `{ isReady, error, connect, disconnect }` |
| `usePreviewPlayer(options?)` | A [preview player](../../lib/lib-preview-player/README.md) for the component: its `state`, and its verbs |
| `musicQueries(music, scope?)`, `useMusicQueries()` | Every read function of the catalog and the library as its query for TanStack Query |
| Everything in `browser` | `createBrowserClient`, `createConnect`, the feature tier: see [its README](../browser/README.md) |

The `"use client"` directive is at the top of the one built file that holds the provider and the
hooks, and on nothing else, so `artworkImage`, `isAppleMusicError` or `musicQueries` imported from
this package carry no directive and can be imported into a route handler, a server component or a
prefetch. That this is how Next's bundler reads it has not met a Next build yet.

## The provider

`<MusicProvider music={music}>` takes the client from `createBrowserClient`, made once outside the
tree. It holds the listener's token in React state: in memory, gone with the page, never in storage.
No token arrives as a prop, since a prop handed down from a server component is written into the page;
it arrives through `useConnect`, or through `setToken` after an authenticated `no-store` fetch of one
your server stored. It is in the provider's state and in its context value, where React DevTools, and
an extension that uses its hook, can show it.

`useMusic()` gives the client bound to that token, `music.as(token)`, derived once in the provider, so
every component shares one client and one storefront lookup. It is the page's client until a token is
held. A hook called with no provider above it is a `TypeError` naming the hook.

Signing out is `disconnect()` from `useConnect`: Apple's own sign-out, so a later page load restores
nothing, and the provider forgets the token. `setToken(undefined)` alone forgets it in the provider,
after a `UserTokenInvalid` say, and the provider then takes no token Apple's script restores until the
next `connect()`; the script would restore it on the next page load, which is why sign-out is
`disconnect()`. The provider does not forget the token on a `UserTokenInvalid` by itself: the component
that made the call sees the error. A value that is no token is a `TypeError`.

## Sign-in

`useConnect({ app, musicKit? })` makes the helper when the component mounts, once, from the provider's
client, and disposes it when the component unmounts. The options are read on the first mount only. The
token Apple's script restored for a returning listener, and the one `connect()` gives, go to the
provider, so `useMusic()` is bound from then on.

| Member | |
| --- | --- |
| `isReady` | Whether Apple's script is loaded and configured: when the button can be enabled |
| `error` | Why it is not, when it cannot be |
| `connect()` | Opens Apple's sign-in window, to be called inside the click; resolves to the token, or to `undefined` when the script answers with nothing, which is taken for a decline. After a `ready` that failed, it loads and configures the script afresh first. |
| `disconnect()` | Apple's own sign-out, and the provider forgets the token |

Everything a page has to know about the script, the headers it needs, and the copy of the token it
keeps, is in [the browser package's README](../browser/README.md#sign-in).

## The player

`usePreviewPlayer(options?)` makes a player when the component mounts, since an audio element is a
browser's, and disposes it when the component unmounts. `audio` may be an element or a ref to one,
read on mount; `hosts` is the player's. `state` is the player's own frozen snapshot through
`useSyncExternalStore`, and one idle snapshot on the server and before the mount, so a server render
and a hydration agree. The verbs, `load`, `play`, `pause`, `next`, `previous`, `seek` and
`setVolume`, keep their identity for as long as the component lives, so one can go into an effect's
dependencies; one called before the player exists, which only a child's effect can manage, is a
`TypeError` naming it.

## Queries

`musicQueries(music, scope?)` maps every read function of [`client-catalog`](../../clients/client-catalog/README.md)
and [`client-user`](../../clients/client-user/README.md) to a function of the same arguments giving its query:

| The function | The query |
| --- | --- |
| One resource, several, or an answer as it is: `getAlbum`, `getSongsByIsrc`, `searchCatalog` | What `useQuery` takes, resolving to what the namespace's function gives |
| A walk: `listGenres`, `listLibraryPlaylists`, `getAlbumRelationship` | What `useInfiniteQuery` takes: Apple's pages, each with the `next` Apple sent |
| A write: `addToLibrary`, `createLibraryPlaylist`, `setSongRating` | Not there. A write is `useMutation({ mutationFn: (ids) => music.user.addToLibrary(ids) })` |

Every key is `["open-music-sdk", scope, "catalog" | "user", name, ...args]`. A schema among the
arguments is the marker `"schema"`, so two schemas are not told apart by a key; a function or a signal
is left out. Every query carries `retry: false`: core retried what should be retried, and three more
tries on a refusal or a mistake would help nobody. No `staleTime` is set; that is your app's.

A walk asks for its later pages as `paginate` would: a catalog's send no Music User Token wherever the
link points, the listener's send it, and `next` is read from Apple's body as it came, not from a
schema's copy. `maxPages` is refused: how many pages are kept is TanStack's `maxPages`, on
`useInfiniteQuery`. A relationship or a view is generic over its name, which a mapped type collapses,
so its query is typed as the union of what any of them holds.

`useMusicQueries()` is `musicQueries` over the provider's client, in the provider's scope: 0 for the
page's client before any sign-in, so a server render and a hydration agree, and a scope of its own for
each sign-in and for each other client handed to the provider, unique across pages, reloads and
providers, so that what one listener cached, persisted or not, is never under another's keys. A token
is never part of a key.

A server prefetch, `musicQueries(createServerClient(…))` for a `HydrationBoundary`, is in scope 0,
which the page is in until a token is held: it matches the catalog queries of a page before sign-in,
and no query of a listener's, whose scope is the page's own. Prefetch the catalog; the listener's
library is fetched by the page. `useSuspenseQuery` runs during Next's server render of a client
component too, where a relative `tokenUrl` has no page to resolve against: prefetch on the server, or
use `useQuery`.

## Next.js

A Next.js app installs [`@open-music-sdk/server`](../server/README.md) for its route handlers, server
components and actions, and this package for its client components:

```ts
// app/api/music/token/route.ts
import { connection } from "next/server";
import { tokenEndpoint } from "@open-music-sdk/server";
const token = tokenEndpoint({ pem, teamId, keyId, origin: ["https://app.example"] });
export async function GET(req: Request) {
  await connection(); // never prerendered: a token minted at build would be served to everyone
  return token(req);
}

// app/api/music/user-token/route.ts
export const POST = userTokenIntake(music, { store, userId: async () => (await session()).userId });

// app/providers.tsx
"use client";
const music = createBrowserClient({ tokenUrl: "/api/music/token" });
export function Providers({ children }) { return <MusicProvider music={music}>{children}</MusicProvider>; }

// app/album/[id]/page.tsx, a server component
const album = await music.catalog.getAlbum(id); // the server's client, from @open-music-sdk/server
```

The listener's token belongs in your session, behind `userTokenIntake` and a store of your own; a
server action calls `music.forUser(userId)`. Core sends through the `fetch` it is given, so Next's
caching is a `fetch` wrapper or `"use cache"` in the component. This recipe has not met a Next build
yet; the Next sample app is where it is proven.

## Not here

The key, the token endpoint and the intake: [`@open-music-sdk/server`](../server/README.md). A page without
React: [`@open-music-sdk/browser`](../browser/README.md).

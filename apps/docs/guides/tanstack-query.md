---
for: client=react,nextjs
---

# Read and write with TanStack Query

In this guide you fetch the catalog and a listener's library with TanStack Query's hooks, and write with
`useMutation`. In a Next app, you also prefetch the catalog on the server.

Before you start, you need:

- a React or Next.js app with `MusicProvider` and TanStack Query's `QueryClientProvider` around it, version 5. See
  [Set up your client](./client-setup).
- in a Next app, a client on the server, made once with `createServerClient`. See
  [Set up your server](./server-setup).

`@open-music-sdk/react` doesn't depend on TanStack Query. `musicQueries` gives the objects `useQuery` and
`useInfiniteQuery` take, and imports nothing from TanStack Query.

## 1. Read with `useQuery`

In a component, `useMusicQueries()` gives every read function of the catalog and the listener's library as a
query:

```tsx
import { useMusicQueries } from "@open-music-sdk/react";
import { useQuery } from "@tanstack/react-query";

export function Album({ id }: { id: string }) {
  const queries = useMusicQueries();
  const { data: album } = useQuery(queries.catalog.getAlbum(id));
  return <h1>{album?.attributes?.name}</h1>;
}
```

`queries.catalog` and `queries.user` have a function for each read function of the client's `catalog` and `user`,
taking the same arguments. What it gives depends on the function:

| The function | Its query |
| --- | --- |
| One resource, several, or an answer as it is, such as `getAlbum`, `getSongsByIsrc` or `searchCatalog` | What `useQuery` takes. It resolves to what the client's function of that name gives: for `getAlbum`, the album. |
| A walk through pages, such as `listGenres`, `listLibraryPlaylists` or `getAlbumRelationship` | What `useInfiniteQuery` takes: Apple's pages, each with the `next` link Apple sent. See step 2. |
| A write, such as `addToLibrary`, `createLibraryPlaylist` or `setSongRating` | None. See step 3. |

Every query has `retry: false`. The client already retried what is worth retrying, and more tries on a refusal or
a mistake would help no one. No `staleTime` is set: choose your own, as you would for any query:

```tsx
const { data: album } = useQuery({
  ...queries.catalog.getAlbum(id),
  staleTime: 5 * 60_000,
});
```

## 2. Walk pages with `useInfiniteQuery`

In a component, spread a walk's query into `useInfiniteQuery`. A listener's query needs their token, so enable it
once they've signed in:

```tsx
import {
  useMusicQueries,
  useMusicUserToken,
  type tLibraryPlaylist,
} from "@open-music-sdk/react";
import { useInfiniteQuery } from "@tanstack/react-query";

export function Library() {
  const [token] = useMusicUserToken();
  const queries = useMusicQueries();
  const { data, hasNextPage, fetchNextPage } = useInfiniteQuery({
    ...queries.user.listLibraryPlaylists(),
    enabled: token !== undefined,
  });
  const pages = data?.pages ?? [];
  const playlists = pages.flatMap(
    (page): tLibraryPlaylist[] => page.data ?? [],
  );
  const more = () => void fetchNextPage();
  return (
    <>
      <ul>
        {playlists.map((playlist) => (
          <li key={playlist.id}>{playlist.attributes?.name}</li>
        ))}
      </ul>
      {hasNextPage && <button onClick={more}>More</button>}
    </>
  );
}
```

A component drawn only while a listener is signed in needs no `enabled`.

Each page is Apple's [page](../glossary#page-next-link), with the `next` link Apple sent, as it came in Apple's
answer even when you pass a `schema`. Later pages are asked for as `paginate` asks for them: a catalog walk's never
send the listener's token, wherever the link points, and a listener's walk's do.

- A walk's query refuses the `maxPages` option with a `TypeError`. To limit how many pages are kept, use TanStack
  Query's own `maxPages`, on `useInfiniteQuery`.
- A relationship's or a view's query, such as `getAlbumRelationship(id, "tracks")`, is typed as the union of
  what any relationship or view of that resource holds. Narrow each item by its `type`.

## 3. Write with `useMutation`

A write has no query. In a component, call the function on the client from `useMusic()`, which is bound to the
listener once they've signed in:

```tsx
import { useMusic } from "@open-music-sdk/react";
import { useMutation } from "@tanstack/react-query";

export function AddToLibrary({ songId }: { songId: string }) {
  const music = useMusic();
  const add = useMutation({
    mutationFn: () => music.user.addToLibrary({ songs: [songId] }),
  });
  return (
    <button disabled={add.isPending} onClick={() => add.mutate()}>
      Add to library
    </button>
  );
}
```

`addToLibrary` resolves once Apple has accepted the request, which is before the songs appear in the library. A
query of the library refetched at once may not show them yet.

## 4. Prefetch the catalog on the server

::: for client=react
A Vite app draws its pages in the browser, with no server render to prefetch for. Go on to step 5.
:::

::: for client=nextjs
On the server, `musicQueries` over the server's client gives the same queries, which you can prefetch and hand to
the page. In the code below, `getMusic()` stands for your own function that returns the server's client.

The page renders `Album` from step 1. It uses hooks, so put it in a file of its own that starts with
`"use client"`, `src/app/album/[id]/album.tsx`:

```tsx
"use client";

import { useMusicQueries } from "@open-music-sdk/react";
import { useQuery } from "@tanstack/react-query";

export function Album({ id }: { id: string }) {
  const queries = useMusicQueries();
  const { data: album } = useQuery(queries.catalog.getAlbum(id));
  return <h1>{album?.attributes?.name}</h1>;
}
```

The page prefetches its query in a server component, `src/app/album/[id]/page.tsx`:

```tsx
import { musicQueries } from "@open-music-sdk/react";
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import { connection } from "next/server";
import { Suspense } from "react";
import { getMusic } from "@/lib/music"; // your server's client
import { Album } from "./album";

type tParams = Promise<{ id: string }>;

export default function AlbumPage({ params }: { params: tParams }) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Prefetched params={params} />
    </Suspense>
  );
}

async function Prefetched({ params }: { params: tParams }) {
  await connection();
  const { id } = await params;
  const queryClient = new QueryClient();
  const query = musicQueries(getMusic()).catalog.getAlbum(id);
  await queryClient.prefetchQuery(query);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Album id={id} />
    </HydrationBoundary>
  );
}
```

`<Suspense>` and `await connection()` are what a Next app with Cache Components asks of a read made at each
request: see [Make a first request](./client-setup#_4-make-a-first-request).

`musicQueries(getMusic())` builds its keys in scope 0, which is the page's scope until a listener signs in (see
step 5). So a prefetched query matches the page's query when both are called with the same arguments. Give the
server's client and the page's client the same storefront: a key holds the call's arguments, not the client's
storefront.

The [Next sample](../samples) prefetches its album page this way, with the storefront and a schema in the call on
both sides.

Prefetch the catalog only. A listener's queries are in a scope of the page's own, which no server prefetch
matches, so the page fetches the listener's library itself.

A catalog query from `useMusicQueries()` changes scope at each sign-in too. So once a listener has signed in, the
`Album` above no longer matches what the server prefetched, and fetches the album again. To keep it matching, build
the page's catalog queries with `musicQueries(music)`, where `music` is the client you hand `MusicProvider`:
they're in scope 0 whoever is signed in.

`musicQueries` runs in a server component: of `@open-music-sdk/react`, only the provider and the hooks are client
code.

`useSuspenseQuery` also runs while Next renders a client component on the server. There, a relative `tokenUrl`,
as you hand it to `createBrowserClient`, has no page to resolve against, so a query that needs a token fails.
Prefetch on the server, or use `useQuery`.
:::

## 5. Know what the keys hold

Every key has this shape:

```ts
["open-music-sdk", scope, "catalog" | "user", functionName, ...args]
// queries.catalog.getAlbum("1613600183") before sign-in:
["open-music-sdk", 0, "catalog", "getAlbum", "1613600183"]
```

- An option object is keyed by what it holds, and a function or a signal in it is left out. A function or a
  signal passed as an argument of its own keeps its place in the key, as `undefined`.
- A `schema` is keyed as the string `"schema"`, so two calls that differ only in their schema share a key.
- A token is never part of a key.

`useMusicQueries()` uses the provider's scope. It is 0 for the page's client before anyone signs in, so a server
render and a hydration agree. Each sign-in gets a scope of its own, and so does each other client you hand the
provider. Each scope is unique across pages, reloads and providers, so what one listener cached, persisted or not,
is never under another listener's keys.

If you make queries yourself with `musicQueries(music, scope)`, pass a scope that tells your listeners apart. It
defaults to 0.

## Next steps

- [Set up your client](./client-setup), for the providers these examples use.
- [Sign a listener in](./sign-in), which starts a listener's scope.
- The reference for [`musicQueries`](../reference/@open-music-sdk/react/functions/musicQueries) and
  [`useMusicQueries`](../reference/@open-music-sdk/react/functions/useMusicQueries).

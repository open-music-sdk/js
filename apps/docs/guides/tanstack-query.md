# TanStack Query

In this guide you fetch the catalog and a listener's library with TanStack Query's hooks, write with
`useMutation`, and prefetch the catalog on the server.

Before you start, you need:

- a React app with `MusicProvider` around it. See [Next.js](./nextjs) for one way to set it up.
- `@tanstack/react-query` 5, with a `QueryClientProvider` around the app.

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

`queries.catalog` and `queries.user` have a function for each read function of `music.catalog` and `music.user`,
taking the same arguments. What it gives depends on the function:

| The function | Its query |
| --- | --- |
| One resource, several, or an answer as it is, such as `getAlbum`, `getSongsByIsrc` or `searchCatalog` | What `useQuery` takes. It resolves to what the function on `music.catalog` or `music.user` gives: for `getAlbum`, the album. |
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

The [React sample](../samples) draws its Library only while a listener is signed in, so its queries need no
`enabled`. It pages through the listener's playlists as they flip toward the back of a crate, which calls `more`:

<<< @/../../samples/web-react/src/library.tsx#your-playlists{tsx}

Each page is Apple's [page](../glossary#page-next-link), with the `next` link Apple sent, as it came in Apple's
answer even when you pass a `schema`. Later pages are asked for as `paginate` asks for them: a catalog walk's never
send the listener's token, wherever the link points, and a listener's walk's do.

- A walk's query refuses the `maxPages` option with a `TypeError`. To limit how many pages are kept, use TanStack
  Query's own `maxPages`, on `useInfiniteQuery`.
- A relationship's or a view's query, such as `getAlbumRelationship(id, "tracks")`, is typed as the union of
  what any relationship or view of that resource holds. Narrow each item by its `type`.

## 3. Write with `useMutation`

A write has no query. In a component, call the function on the client from `useMusic()`, which is bound to the
listener once they've signed in. The React sample adds a song or a music video this way:

<<< @/../../samples/web-react/src/songs.tsx#add-to-library{tsx}

`addToLibrary` resolves once Apple has accepted the request, which is before the songs appear in the library. A
query of the library refetched at once may not show them yet.

## 4. Prefetch the catalog on the server

On the server, `musicQueries` over the server's client gives the same queries, which you can prefetch and hand to
the page. In a Next.js server component, `app/album/[id]/page.tsx`:

```tsx
import { musicQueries } from "@open-music-sdk/react";
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import { connection } from "next/server";
import { Suspense } from "react";
import { getMusic } from "@/lib/music"; // the server's client, from Next.js
import { Album } from "./album"; // the client component from step 1

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
request: see step 6 of [Next.js](./nextjs).

`musicQueries(getMusic())` builds its keys in scope 0, which is the page's scope until a listener signs in (see
step 5). So a prefetched query matches the page's query when both are called with the same arguments. Give the
server's client and the page's client the same storefront: a key holds the call's arguments, not the client's
storefront.

The [Next sample](../samples) prefetches its album page so, naming the storefront and the schema in the call, and
its client component calls `getAlbum` with the same three arguments. `query` gives the album, which the page goes
on to use:

<<< @/../../samples/web-nextjs/app/(dig)/albums/[id]/page.tsx#prefetch{tsx}

Prefetch the catalog only. A listener's queries are in a scope of the page's own, which no server prefetch
matches, so the page fetches the listener's library itself.

A catalog query from `useMusicQueries()` changes scope at each sign-in too, so a prefetched one stops matching once
a listener has signed in. The Next sample's album page builds its query with `musicQueries(music)` over the page's
own client instead, in scope 0 whoever is signed in, and its server components draw the listener's library.

`next build` imports `musicQueries` from `@open-music-sdk/react` into the Next sample's server components, and
passes in CI.

`useSuspenseQuery` also runs while Next renders a client component on the server. There, a relative `tokenUrl`
has no page to resolve against, so a query that needs a token fails. Prefetch on the server, or use `useQuery`.

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

- [Next.js](./nextjs), for the server's client and the provider these examples use.
- [Sign a listener in](./sign-in), which starts a listener's scope.
- The reference for [`musicQueries`](../reference/@open-music-sdk/react/functions/musicQueries) and
  [`useMusicQueries`](../reference/@open-music-sdk/react/functions/useMusicQueries).

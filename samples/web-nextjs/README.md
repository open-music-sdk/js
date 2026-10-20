# web-nextjs

Vinyl Collector Simulator as a Next.js app, which is its own server. The catalog and the listener's library are
drawn by server components, everything the listener does is a server action, and only Apple's sign-in and the
previews run in the browser. It is the same app as [`web-vanilla`](../web-vanilla) and [`web-react`](../web-react),
with the same crates.

```sh
cp samples/.env.example samples/web-nextjs/.env.local   # then fill it in
pnpm turbo dev --filter=web-nextjs                       # from the repository's root
```

Then open <http://localhost:2728>. No server sample runs beside it: the routes under `app/api` are its own.

| File | Shows |
| --- | --- |
| [`lib/music.ts`](./lib/music.ts) | `createServerClient`, `createRateLimiter` and `MemoryUserTokenStore`, made on first use so that `next build` needs no key |
| [`lib/session.ts`](./lib/session.ts) | The session cookie, through `next/headers` |
| [`lib/listener.ts`](./lib/listener.ts) | `forUser`, and the listener's storefront from `getUserStorefront`, once per render through React's `cache` |
| [`lib/catalog.ts`](./lib/catalog.ts) | `getCharts`, `listGenres` and `listStorefronts` under `"use cache"`: the same for everyone in a storefront |
| [`proxy.ts`](./proxy.ts) | The host check, and the session cookie on the first answer |
| [`app/api/music/token/route.ts`](./app/api/music/token/route.ts) | `tokenEndpoint`, behind `await connection()` so it is never prerendered |
| [`app/api/music/user-token/route.ts`](./app/api/music/user-token/route.ts) | `userTokenIntake`, and the sign-out that forgets the token |
| [`app/actions.ts`](./app/actions.ts) | The server actions: `addToLibrary`, `addToFavorites`, ratings, `playlists.resolve`, `plan` and `apply`, the next page of a crate |
| [`app/providers.tsx`](./app/providers.tsx) | `createBrowserClient` and `MusicProvider`, for the sign-in, and TanStack Query's cache |
| [`app/sign-in.tsx`](./app/sign-in.tsx) | `useConnect`: the token goes to the server, and the page keeps none of it |
| [`app/(dig)/albums/[id]/page.tsx`](./app/(dig)/albums/[id]/page.tsx) | `musicQueries` prefetched into a `HydrationBoundary`, `schemas`, and `request` with `segmentOf` for "in your library" |
| [`app/artwork.tsx`](./app/artwork.tsx) | `next/image` with `artworkUrl` as its loader |
| [`app/player.tsx`](./app/player.tsx) | `usePreviewPlayer` |
| [`app/library/page.tsx`](./app/library/page.tsx) | The listener's lists, each streamed in as the server reads it |
| [`app/errors.ts`](./app/errors.ts) | `isAppleMusicError`, each tag in words a listener can act on, on either side |

The listener's token never stays in the page. Once Apple's sign-in gives it, the page posts it to the user-token
route and forgets it, and the server finds it in its store, by the session cookie, for every page it draws and every
action it runs. The store forgets every token when the dev server stops.

The app turns on Cache Components. A page reads Apple on every request, but for what is marked `"use cache"`, and
navigating hides the page left behind rather than dropping it, so on Back the floor's crates are where you left them.
The listener lookup in [`lib/listener.ts`](./lib/listener.ts) awaits `connection()`: the client reads the clock to
keep its developer token fresh, which Next refuses while it draws a page ahead of time.

`next build` runs in CI with no key in its environment, which is what proves the recipe in the
[Next.js guide](https://open-music-sdk.github.io/js/guides/nextjs). The build is for that alone: the sample is not
designed to deploy.

It leaves out a component library and a state library. Its tabs are links to pages, each page is drawn on the server,
and the crates' look and flip are the same stylesheet as the other page samples', in [`app/styles.css`](./app/styles.css).

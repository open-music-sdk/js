# web-nextjs

Vinyl Collector Simulator as a Next.js app, which is its own server. The catalog and the listener's library are
drawn by server components, everything the listener does is a server action, and only Apple's sign-in and the
previews run in the browser. It is the same app as [`web-vanilla`](../web-vanilla) and [`web-react`](../web-react),
with the same crates.

```sh
cp samples/.env.example samples/web-nextjs/.env.local   # then fill it in
pnpm turbo dev --filter=web-nextjs                       # from the repository's root
```

Then open <http://localhost:2728>. No server sample runs beside it: the routes under `src/app/api` are its own.

Everything is under `src`. `src/app` holds the routes alone: pages, layouts, error pages and route handlers.
`src/components` holds the components they draw, and `src/lib` what runs on the server, with the server actions
and the words for an error, which the page uses too. `@/` in an import is `src/`.

| File | Shows |
| --- | --- |
| [`src/lib/music.ts`](./src/lib/music.ts) | `createServerClient`, `createRateLimiter` and `MemoryUserTokenStore`, made on first use so that `next build` needs no key |
| [`src/lib/session.ts`](./src/lib/session.ts) | The session cookie, through `next/headers` |
| [`src/lib/listener.ts`](./src/lib/listener.ts) | `forUser`, and the listener's storefront from `getUserStorefront`, once per render through React's `cache` |
| [`src/lib/catalog.ts`](./src/lib/catalog.ts) | `getCharts`, `listGenres` and `listStorefronts` under `"use cache"`: the same for everyone in a storefront |
| [`src/proxy.ts`](./src/proxy.ts) | The host check, and the session cookie on the first answer |
| [`src/app/api/music/token/route.ts`](./src/app/api/music/token/route.ts) | `tokenEndpoint`, behind `await connection()` so it is never prerendered |
| [`src/app/api/music/user-token/route.ts`](./src/app/api/music/user-token/route.ts) | `userTokenIntake`, and the sign-out that forgets the token |
| [`src/lib/actions.ts`](./src/lib/actions.ts) | The server actions: `addToLibrary`, `addToFavorites`, ratings, `playlists.resolve`, `plan` and `apply`, the next page of a crate |
| [`src/components/providers.tsx`](./src/components/providers.tsx) | `createBrowserClient` and `MusicProvider`, for the sign-in, `musicQueries` for the album's query, and TanStack Query's cache |
| [`src/components/sign-in.tsx`](./src/components/sign-in.tsx) | `useConnect`: the token goes to the server, and React's state forgets it |
| [`src/app/(dig)/albums/[id]/page.tsx`](./src/app/(dig)/albums/[id]/page.tsx) | `musicQueries` prefetched into a `HydrationBoundary`, `schemas`, and `request` with `segmentOf` for "in your library" |
| [`src/components/artwork.tsx`](./src/components/artwork.tsx) | `next/image` with `artworkUrl` as its loader, in one file to copy into your own app |
| [`src/components/player.tsx`](./src/components/player.tsx) | `usePreviewPlayer` |
| [`src/app/library/page.tsx`](./src/app/library/page.tsx) | The listener's lists, each streamed in as the server reads it |
| [`src/lib/errors.ts`](./src/lib/errors.ts) | `isAppleMusicError`, each tag in words a listener can act on, on either side |

The server acts for the listener. Once Apple's sign-in gives the token, the page posts it to the user-token route and
React's state forgets it, and the server finds it in its store, by the session cookie, for every page it draws and
every action it runs. Apple's script still keeps its own copy in the page's storage until the listener signs out, as
it does on any page, which is how a returning listener is signed in again on a reload. The server's store forgets
every token when the dev server stops.

The app turns on Cache Components. A page reads Apple on every request, but for what is marked `"use cache"`, and
navigating hides the page left behind rather than dropping it, so on Back the floor's crates are where you left them.
The listener lookup in [`src/lib/listener.ts`](./src/lib/listener.ts) awaits `connection()`: the client reads the clock to
keep its developer token fresh, which Next refuses while it draws a page ahead of time.

Next runs a page's server actions one at a time. So the search hints, and the next page of a crate, wait behind a
send or a pasted tracklist that is under way. The catalog's actions take the storefront the page was drawn in, so
they ask Apple for nothing but what they read.

`next build` runs in CI with no key in its environment, which is what proves the setup in
[Set up your server](https://open-music-sdk.github.io/js/guides/server-setup). The build is for that alone: the sample is not
designed to deploy, and has no `start` script. Its dev script listens on `localhost` alone. `next start`, or
`next dev` without `--hostname localhost`, listens on every network the machine is on, where only the host check in
[`src/proxy.ts`](./src/proxy.ts) would stand between the app and the rest of the network.

It leaves out a component library and a state library. Its tabs are links to pages, each page is drawn on the server,
and the crates' look and flip are the same stylesheet as the other page samples', in [`src/styles.css`](./src/styles.css).

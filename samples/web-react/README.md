# web-react

Vinyl Collector Simulator in a React page, built with Vite, reading through TanStack Query. Flip through crates of
the catalog, play the previews, sign in with Apple Music, see your library, and send your own crate of songs to it
as a playlist. It is the same app as [`web-vanilla`](../web-vanilla), in files of the same names.

```sh
pnpm turbo dev --filter=web-react --filter=express-server   # from the repository's root, or worker-server
```

Then open <http://localhost:2728>. Vite forwards `/api` to the server on `127.0.0.1:8787`.

| File | Shows |
| --- | --- |
| [`src/main.tsx`](./src/main.tsx) | `MusicProvider`, TanStack Query's client, and the header's tabs |
| [`src/music.tsx`](./src/music.tsx) | `createBrowserClient`, and who is signed in |
| [`src/dig.tsx`](./src/dig.tsx) | `getCharts`, `listGenres`, `listStorefronts`: the floor, and the storefront picker |
| [`src/search.tsx`](./src/search.tsx) | `searchCatalog`, `getSearchHints` |
| [`src/pages.tsx`](./src/pages.tsx) | `getAlbum` with `schemas`, `getArtist`, `getArtistView`, `getArtistRelationship` a page at a time, `getPlaylist`, `request` with `segmentOf` for the one endpoint the clients lack, `addToLibrary`, `addToFavorites` |
| [`src/songs.tsx`](./src/songs.tsx) | `getSongRatings`, `setSongRating`, `deleteSongRating`, `addToLibrary` with `useMutation` |
| [`src/artwork.tsx`](./src/artwork.tsx) | `artworkImage` |
| [`src/player.tsx`](./src/player.tsx) | `usePreviewPlayer`, `artworkUrl` |
| [`src/sign-in.tsx`](./src/sign-in.tsx) | `useConnect`, `useMusicUserToken`, `useMusic`: sign in, restore a returning listener, sign out; the token posted to the server |
| [`src/library.tsx`](./src/library.tsx) | The listener's lists, their playlists a page at a time with `useInfiniteQuery`, `searchLibrary`, and the list the server asks for |
| [`src/crate.tsx`](./src/crate.tsx) | The picks, and `playlists.resolve` for a pasted tracklist |
| [`src/send.tsx`](./src/send.tsx) | `playlists.read`, `plan` and `apply`: the crate sent as a playlist, with the plan shown first |
| [`src/errors.tsx`](./src/errors.tsx) | `isAppleMusicError`, each tag in words a listener can act on, and the status line |
| [`src/box.tsx`](./src/box.tsx), [`src/sleeve.tsx`](./src/sleeve.tsx), [`src/view.tsx`](./src/view.tsx) | The page itself, with nothing of the SDK: the crate and its sleeves, the floor and its pages |

Every read goes through `useMusicQueries()`, so the cache of one listener is never another's: each sign-in has a
scope of its own in the keys. A write is a `useMutation` over `useMusic()`, which is bound to the listener once they
have signed in.

Signed out, the page asks the catalog in the storefront you pick. Signed in, it asks in yours, from Apple. Catalog
ids differ between storefronts, so the crate empties when the storefront changes.

The app is wrapped in `<StrictMode>`, so in development React mounts each component twice: the provider, the hooks
and the player are seen to undo what they set up.

It leaves out a router library, a state library and a component library: the three screens are sections the
header's tabs show one at a time, and a page opened from a crate is an address such as `#albums/1440857781`, which
the browser's Back goes back from. The crates' look and flip are CSS, in [`styles.css`](./styles.css), the same
stylesheet as `web-vanilla`'s.

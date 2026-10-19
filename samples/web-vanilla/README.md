# web-vanilla

Vinyl Collector Simulator in a page with no framework, built with Vite. Flip through crates of the catalog, play the
previews, sign in with Apple Music, see your library, and send your own crate of songs to it as a playlist.

```sh
pnpm turbo dev --filter=web-vanilla --filter=express-server   # from the repository's root, or worker-server
```

Then open <http://localhost:2728>. Vite forwards `/api` to the server on `127.0.0.1:8787`.

| File | Shows |
| --- | --- |
| [`src/music.ts`](./src/music.ts) | `createBrowserClient`, and who is signed in |
| [`src/dig.ts`](./src/dig.ts) | `getCharts`, `listGenres`, `searchCatalog`, `getSearchHints`, `listStorefronts` |
| [`src/pages.ts`](./src/pages.ts) | `getAlbum` with `schemas`, `getArtist`, `getArtistView`, `getArtistRelationship`, `getPlaylist`, `request` with `segmentOf` for the one endpoint the clients lack, `addToLibrary`, `addToFavorites` |
| [`src/songs.ts`](./src/songs.ts) | `getSongRatings`, `setSongRating`, `deleteSongRating`, `addToLibrary` |
| [`src/box.ts`](./src/box.ts) | `artworkImage`, and the crate every list is drawn as |
| [`src/player.ts`](./src/player.ts) | `previewPlayer`, `artworkUrl` |
| [`src/sign-in.ts`](./src/sign-in.ts) | `createConnect`: sign in, restore a returning listener, sign out; the token posted to the server |
| [`src/library.ts`](./src/library.ts) | The listener's lists, their playlists a page at a time, `searchLibrary`, and the list the server asks for |
| [`src/crate.ts`](./src/crate.ts) | The picks, and `playlists.resolve` for a pasted tracklist |
| [`src/send.ts`](./src/send.ts) | `playlists.read`, `plan` and `apply`: the crate sent as a playlist, with the plan shown first |
| [`src/errors.ts`](./src/errors.ts) | `isAppleMusicError`, each tag in words a listener can act on |
| [`src/view.ts`](./src/view.ts), [`src/dom.ts`](./src/dom.ts), [`src/main.ts`](./src/main.ts) | The page itself, with nothing of the SDK |

Signed out, the page asks the catalog in the storefront you pick. Signed in, it asks in yours, from Apple. Catalog
ids differ between storefronts, so the crate empties when the storefront changes.

The floor is the storefront's top charts, then a crate for each genre, filled as it scrolls into view. Every list is
a crate: flip through it with its buttons, the arrow keys or a swipe, and click the sleeve in front to open its page or
play its preview.

It leaves out a router library, a state library and a component library: the three screens are sections of
[`index.html`](./index.html), the header's tabs show one at a time, and a page opened from a crate is an address such
as `#albums/1440857781`, which the browser's Back goes back from. The crates' look and flip are CSS, in
[`styles.css`](./styles.css).

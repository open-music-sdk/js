# web-vanilla

Crate Digger in a page with no framework, built with Vite. Dig through the catalog, play the previews, sign in with
Apple Music, see your library, and send a crate of songs to it as a playlist.

```sh
pnpm turbo dev --filter=web-vanilla --filter=express-server   # from the repository's root, or worker-server
```

Then open <http://localhost:5173>. Vite forwards `/api` to the server on `127.0.0.1:8787`.

| File | Shows |
| --- | --- |
| [`src/music.ts`](./src/music.ts) | `createBrowserClient`, and who is signed in |
| [`src/dig.ts`](./src/dig.ts) | `searchCatalog`, `getSearchHints`, `getCharts`, `listStorefronts` |
| [`src/pages.ts`](./src/pages.ts) | `getAlbum` with `schemas`, `getArtist`, `getArtistView`, `getArtistRelationship`, `getPlaylist`, `request` for the one endpoint the clients lack, `addToLibrary`, `addToFavorites` |
| [`src/songs.ts`](./src/songs.ts) | `artworkImage`, `getSongRatings`, `setSongRating`, `deleteSongRating`, `addToLibrary` |
| [`src/player.ts`](./src/player.ts) | `previewPlayer`, `artworkUrl` |
| [`src/sign-in.ts`](./src/sign-in.ts) | `createConnect`: sign in, restore a returning listener, sign out; the token posted to the server |
| [`src/library.ts`](./src/library.ts) | The listener's lists, their playlists a page at a time, `searchLibrary`, and the list the server asks for |
| [`src/crate.ts`](./src/crate.ts) | `playlists.resolve` for a pasted tracklist, then `read`, `plan` and `apply` to send the crate |
| [`src/errors.ts`](./src/errors.ts) | `isAppleMusicError`, each tag in words a listener can act on |
| [`src/view.ts`](./src/view.ts), [`src/dom.ts`](./src/dom.ts), [`src/main.ts`](./src/main.ts) | The page itself, with nothing of the SDK |

Signed out, the page asks the catalog in the storefront you pick. Signed in, it asks in yours, from Apple. Catalog
ids differ between storefronts, so the crate empties when the storefront changes.

It leaves out a router, a state library and a component library: the three screens are sections of
[`index.html`](./index.html), and the header's tabs show one at a time.

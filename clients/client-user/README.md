<div align="center">

<img src="https://raw.githubusercontent.com/open-music-sdk/js/main/assets/open-music-app-logo.svg" alt="open-music-sdk" width="200">

# Open Music SDK User Client

`@open-music-sdk/client-user`

[![npm](https://img.shields.io/npm/v/@open-music-sdk/client-user)](https://www.npmjs.com/package/@open-music-sdk/client-user)
[![test coverage](https://codecov.io/gh/open-music-sdk/js/graph/badge.svg)](https://codecov.io/gh/open-music-sdk/js)

</div>

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

> **You probably don't want this package.** Most apps install one integration and import everything from it: see
> [Which package to install](https://github.com/open-music-sdk/js#which-package-to-install) in the repository's README.

A listener's side of the Apple Music API, with a function for each of its 79 endpoints: their library and its
playlists, their ratings, the recommendations made for them, what they've played, their replay, and their own
station. Every function takes a client from [`@open-music-sdk/core`](../../packages/core/README.md) that holds the
listener's Music User Token. A client with none rejects every call with `UserTokenInvalid` before Apple is asked.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which put these functions on `music.user`. Use this
package to build your own client.

## Installation

```
pnpm add @open-music-sdk/client-user @open-music-sdk/core
```

Keep the two on the same version. See
[One version for every package](https://open-music-sdk.github.io/js/concepts/packages#one-version-for-every-package).

## Documentation

- [The documentation site](https://open-music-sdk.github.io/js/): guides for each client and server, concepts,
  and the reference
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/client-user/)
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens), and
  [keep a listener's token on your server](https://open-music-sdk.github.io/js/guides/store-user-tokens)
- [Import a playlist](https://open-music-sdk.github.io/js/guides/import-playlist), with `lib-playlists`, which
  builds on these functions
- [Handle errors](https://open-music-sdk.github.io/js/guides/errors) and
  [validate Apple's responses](https://open-music-sdk.github.io/js/guides/validation)
- [Call an endpoint the clients don't cover](https://open-music-sdk.github.io/js/guides/direct-requests)
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences)

## Example

On a server or in a page, where `developerToken` and `musicUserToken` are your tokens:

```ts
import { createLibraryPlaylist, user } from "@open-music-sdk/client-user";
import { createClient } from "@open-music-sdk/core";

const listener = createClient({ developerToken }).as(musicUserToken); // a client for one listener

// Called with the client, a function resolves to Apple's answer.
const { data } = await createLibraryPlaylist(listener, { attributes: { name: "Road trip" } });

// Bound to the client, the same functions hand over what the answer holds.
const mine = user(listener);
await mine.setSongRating("1613600188", 1);
for await (const song of mine.listLibrarySongs()) {
  console.log(song.attributes?.name); // every song in the library, a page at a time
}
```

## What's in it

A function's noun is the generated type it's about: `getLibrarySong` resolves to a `tLibrarySongsResponse`, whose
`data` holds a `tLibrarySong`. What [`client-catalog`](../client-catalog/README.md) has as `getSong`, the library
has as `getLibrarySong`.

| Pattern | Asks for | Functions |
| --- | --- | --- |
| `get<X>(client, id, options?)` | The resource with an id | `getLibrarySong`, `getLibraryAlbum`, `getLibraryArtist`, `getLibraryMusicVideo`, `getLibraryPlaylist`, `getLibraryPlaylistFolder`, `getPersonalRecommendation` |
| `get<X>s(client, ids, options?)` | The resources with some ids | The same 7, in the plural |
| `list<X>s(client, options?)` | A whole collection | `listLibrarySongs`, `listLibraryAlbums`, `listLibraryArtists`, `listLibraryMusicVideos`, `listLibraryPlaylists`, `listPersonalRecommendations` |
| `get<X>Relationship(client, id, name, options?)` | One relationship of a resource, always as a page, even one that holds one resource at most | For the same 7 |
| `create<X>(client, resource, options?)` | A new resource | `createLibraryPlaylist`, `createLibraryPlaylistFolder` |
| `get<X>Rating(client, id, options?)`, `get<X>Ratings(client, ids, options?)` | The listener's rating of one, or of several | For `Song`, `Album`, `MusicVideo`, `Playlist`, `Station`, `LibrarySong`, `LibraryAlbum`, `LibraryMusicVideo`, `LibraryPlaylist` |
| `set<X>Rating(client, id, value, options?)`, `delete<X>Rating(client, id, options?)` | Sets a rating, `1` for a like and `-1` for a dislike, or takes it away | For the same 9 |

Fourteen follow no pattern:

| Function | Does |
| --- | --- |
| `searchLibrary(client, term, options)` | Library resources that match a term, by type. `options.types` is required. |
| `getLibraryResources(client, ids, options?)` | Library resources of several types at once: `{ "library-songs": ["i.1"] }` |
| `addToLibrary(client, ids, options?)` | Adds catalog resources to the library: `{ songs: ["1"], albums: ["2"] }` |
| `addToFavorites(client, ids, options?)` | Adds resources to the favorites, by the same kind of ids |
| `addLibraryPlaylistTracks(client, id, tracks, options?)` | Adds tracks to the end of a playlist: `[{ id: "1", type: "songs" }]` |
| `getRootLibraryPlaylistFolder(client, options?)` | The folder every playlist and playlist folder is in, at the top |
| `listRecentlyAdded(client, options?)` | What was added to the library lately |
| `listHeavyRotation(client, options?)` | What the listener plays most at present |
| `listRecentlyPlayed(client, options?)` | The albums, playlists and stations played lately |
| `listRecentlyPlayedTracks(client, options?)` | The tracks played lately |
| `listRecentlyPlayedStations(client, options?)` | The radio stations played lately |
| `getMusicSummariesByYear(client, values, options?)` | The listener's replay. The one year Apple takes at present is `"latest"`. |
| `getPersonalStation(client, options?)` | The listener's own station, the one call outside `/v1/me`, which takes a `storefront` |
| `getUserStorefront(client, options?)` | The storefront the listener's account is in |

And `user(client)`, all 79 bound to one client.

## Two ways to call

| | `getLibrarySong(client, id)` | `user(client).getLibrarySong(id)` |
| --- | --- | --- |
| One resource: `get<X>`, `get<X>Rating`, `getRootLibraryPlaylistFolder`, `getPersonalStation`, `getUserStorefront` | Apple's answer, `{ data: [song] }` | The resource. A success that holds none is an `ApiError` with the status it came with, not `undefined`. |
| A write that answers with a resource: `create<X>`, `set<X>Rating` | Apple's answer, `{ data: [playlist] }` | The resource, or `undefined` if the answer holds none. The write happened either way. |
| Several: `get<X>s`, `get<X>Ratings`, `getLibraryResources`, `getMusicSummariesByYear` | Apple's answer, `{ data: [...] }` | The list, empty when Apple sent none |
| A collection or a relationship: every `list…`, `get<X>Relationship` | The first page: `{ data, next }` | Every item of every page, as an `AsyncIterable` |
| `searchLibrary` | Apple's answer | The same answer |
| `delete<X>Rating`, `addToLibrary`, `addToFavorites`, `addLibraryPlaylistTracks` | Nothing | Nothing |

The functions are separate exports, so a bundler leaves out the ones you don't import. `user(client)` holds all of
them, and can't be changed. Each call makes a new one, so make it once for a listener and keep it.

## Options and arguments

Every function takes its options last, and some options are required, as above. Each option is described on the
function's options type in the reference. An option a function doesn't take isn't sent.

Arguments are checked before Apple is asked. A mistake is a `TypeError` that names the function and the argument,
and never repeats the value. An id, a relationship's name and a storefront are each one segment of a path: at most
64 characters, with no slash, backslash, percent sign or control character, and not `.` or `..`. A search term is
at most 256 characters. A list holds at most 300 items, each at most 64 characters with no comma.

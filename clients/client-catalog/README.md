<div align="center">

<img src="https://raw.githubusercontent.com/open-music-sdk/js/main/assets/open-music-app-logo.svg" alt="open-music-sdk" width="200">

# Open Music SDK Catalog Client

`@open-music-sdk/client-catalog`

[![npm](https://img.shields.io/npm/v/@open-music-sdk/client-catalog)](https://www.npmjs.com/package/@open-music-sdk/client-catalog)
[![test coverage](https://codecov.io/gh/open-music-sdk/js/graph/badge.svg)](https://codecov.io/gh/open-music-sdk/js)

</div>

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

> **You probably don't want this package.** Most apps install one integration and import everything from it: see
> [Which package to install](https://github.com/open-music-sdk/js#which-package-to-install) in the repository's README.

The catalog of the Apple Music API, with a function for each of its 58 endpoints: songs, albums, artists,
playlists, music videos, stations, genres, curators, record labels, storefronts, search and charts. Every function
takes a client from [`@open-music-sdk/core`](../../packages/core/README.md), and sends the developer token alone,
on every page of a list too. The listener's side of the API is [`client-user`](../client-user/README.md).

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which put these functions on `music.catalog`. Use this
package to build your own client.

## Installation

```
pnpm add @open-music-sdk/client-catalog @open-music-sdk/core
```

Keep the two on the same version. See
[One version for every package](https://open-music-sdk.github.io/js/concepts/packages#one-version-for-every-package).

## Documentation

- [The documentation site](https://open-music-sdk.github.io/js/): guides for each client and server, concepts,
  and the reference
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/client-catalog/)
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens), for which requests
  send which token
- [Handle errors](https://open-music-sdk.github.io/js/guides/errors) and
  [validate Apple's responses](https://open-music-sdk.github.io/js/guides/validation)
- [Call an endpoint the clients don't cover](https://open-music-sdk.github.io/js/guides/direct-requests)
- [Build your own client from the parts](https://open-music-sdk.github.io/js/guides/own-client)
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences)

## Example

On a server or in a page, where `developerToken` is a token or a provider of one:

```ts
import { catalog, getAlbum } from "@open-music-sdk/client-catalog";
import { createClient } from "@open-music-sdk/core";

const music = createClient({ developerToken, storefront: "us" });

// Called with the client, a function resolves to Apple's answer.
const { data } = await getAlbum(music, "1613600183", { include: ["artists"] });

// Bound to the client, the same function hands over what the answer holds.
const store = catalog(music);
const album = await store.getAlbum("1613600183");
for await (const track of store.getAlbumRelationship("1613600183", "tracks")) {
  console.log(track.attributes?.name); // every track, a page at a time
}
```

## What's in it

A function's noun is the generated type it's about: `getSong` resolves to a `tSongsResponse`, whose `data` holds a
`tSong`.

| Pattern | Asks for | Functions |
| --- | --- | --- |
| `get<X>(client, id, options?)` | The resource with an id | `getSong`, `getAlbum`, `getArtist`, `getPlaylist`, `getMusicVideo`, `getStation`, `getStationGenre`, `getGenre`, `getCurator`, `getAppleCurator`, `getActivity`, `getRecordLabel`, `getStorefront` |
| `get<X>s(client, ids, options?)` | The resources with some ids | The same 13, in the plural: `getSongs`, `getAlbums`, …, `getActivities`, `getStorefronts` |
| `get<X>sBy<Filter>(client, values, options?)` | The resources a filter picks out | `getSongsByIsrc`, `getMusicVideosByIsrc`, `getAlbumsByUpc`, `getSongsByEquivalents`, `getAlbumsByEquivalents`, `getMusicVideosByEquivalents`, `getPlaylistsByStorefrontChart` |
| `list<X>s(client, options?)` | A whole collection | `listGenres`, `listStationGenres`, `listStorefronts` |
| `get<X>Relationship(client, id, name, options?)` | One relationship of a resource, always as a page, even one that holds one resource at most | For `Song`, `Album`, `Artist`, `Playlist`, `MusicVideo`, `Station`, `StationGenre`, `Curator`, `AppleCurator`, `Activity` |
| `get<X>View(client, id, name, options?)` | One view of a resource, as a page | For `Album`, `Artist`, `Playlist`, `MusicVideo`, `RecordLabel` |

Seven follow no pattern:

| Function | Asks for |
| --- | --- |
| `searchCatalog(client, term, options)` | Resources that match a term, by type. `options.types` is required. |
| `getSearchHints(client, term, options?)` | Terms a search might be for, given the start of one |
| `getSearchSuggestions(client, term, options)` | Terms, resources or both, given the start of a search. `options.kinds` is required. |
| `getCharts(client, options)` | The charts, by type. `options.types` is required. |
| `getCatalogResources(client, ids, options?)` | Resources of several types at once: `{ songs: ["1"], albums: ["2"] }` |
| `getLiveRadioStations(client, options?)` | The live radio stations, such as Apple Music 1 |
| `getLanguageTag(client, acceptLanguage, options?)` | The language a storefront would answer in, given the ones a reader accepts |

And `catalog(client)`, all 58 bound to one client.

## Two ways to call

| | `getSong(client, id)` | `catalog(client).getSong(id)` |
| --- | --- | --- |
| One resource: `get<X>` | Apple's answer, `{ data: [song] }` | The resource. A success that holds none is an `ApiError` with the status it came with, not `undefined`. |
| Several: `get<X>s`, `get<X>sBy…`, `getCatalogResources`, `getLiveRadioStations` | Apple's answer, `{ data: [...] }` | The list, empty when Apple sent none |
| A collection, a relationship or a view | The first page: `{ data, next }` | Every item of every page, as an `AsyncIterable` |
| Search, hints, suggestions, charts, language tag | Apple's answer | The same answer |

The functions are separate exports, so a bundler leaves out the ones you don't import. `catalog(client)` holds all
of them, and can't be changed. Each call makes a new one, so make it once and keep it.

## Options and arguments

Every function takes its options last, and some options are required, as above. Each option is described on the
function's options type in the reference. An option a function doesn't take isn't sent.

Arguments are checked before Apple is asked. A mistake is a `TypeError` that names the function and the argument,
and never repeats the value. An id, a relationship's or a view's name, and a storefront are each one segment of a
path: at most 64 characters, with no slash, backslash, percent sign or control character, and not `.` or `..`. A
search term is at most 256 characters. A list holds at most 300 items, each at most 64 characters with no comma.

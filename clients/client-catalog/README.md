# @open-music-sdk/client-catalog

The catalog of the Apple Music API, with a function for each of its endpoints: songs, albums, artists,
playlists, music videos, stations, genres, curators, record labels, storefronts, search and charts.
Every function takes a client from [`@open-music-sdk/core`](../../packages/core) and resolves to what
Apple answered, typed by [`@open-music-sdk/types`](../../packages/types). The developer token is the
only token any of them sends.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/client-catalog @open-music-sdk/core
```

Keep the two on the same version. If your app does end up with a different copy of `core` than the
one this package resolves, nothing breaks: a client from either copy is a client here, and an
`AppleMusicError` is recognised whichever copy made it.

```ts
import { catalog, getAlbum, searchCatalog } from "@open-music-sdk/client-catalog";
import { createClient } from "@open-music-sdk/core";

const music = createClient({ developerToken, storefront: "us" });

// Called with the client, a function resolves to Apple's answer.
const { data } = await getAlbum(music, "1613600183", { include: ["artists"], views: ["other-versions"] });
const found = await searchCatalog(music, "james brown", { types: ["songs", "albums"], limit: 5 });

// Bound to the client, the same functions hand over what the answer holds.
const store = catalog(music);
const album = await store.getAlbum("1613600183"); // the album
for await (const track of store.getAlbumRelationship("1613600183", "tracks")) {
  // every track, asked for a page at a time
}
```

The listener's side of the API, which needs a Music User Token, is
[`@open-music-sdk/client-user`](../client-user). The two are used in the same way.

## What is in it

58 functions, one for each endpoint. A function's noun is the generated type it is about: `getSong`
resolves to a `tSongsResponse`, whose `data` holds a `tSong`.

| Pattern | Asks for | Functions |
| --- | --- | --- |
| `get<X>(client, id, options?)` | The resource with an id | `getSong`, `getAlbum`, `getArtist`, `getPlaylist`, `getMusicVideo`, `getStation`, `getStationGenre`, `getGenre`, `getCurator`, `getAppleCurator`, `getActivity`, `getRecordLabel`, `getStorefront` |
| `get<X>s(client, ids, options?)` | The resources with some ids | The same 13, in the plural: `getSongs`, `getAlbums`, …, `getActivities`, `getStorefronts` |
| `get<X>sBy<Filter>(client, values, options?)` | The resources a filter picks out | `getSongsByIsrc`, `getMusicVideosByIsrc`, `getAlbumsByUpc`, `getSongsByEquivalents`, `getAlbumsByEquivalents`, `getMusicVideosByEquivalents`, `getPlaylistsByStorefrontChart` |
| `list<X>s(client, options?)` | A whole collection | `listGenres`, `listStationGenres`, `listStorefronts` |
| `get<X>Relationship(client, id, name, options?)` | One relationship of a resource | For `Song`, `Album`, `Artist`, `Playlist`, `MusicVideo`, `Station`, `StationGenre`, `Curator`, `AppleCurator`, `Activity` |
| `get<X>View(client, id, name, options?)` | One view of a resource | For `Album`, `Artist`, `Playlist`, `MusicVideo`, `RecordLabel` |

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

And `catalog(client)`, which is all 58 bound to one client.

## Two ways to call

| | `getSong(client, id)` | `catalog(client).getSong(id)` |
| --- | --- | --- |
| One resource: `get<X>` | Apple's answer, `{ data: [song] }` | The resource. A success that holds none is an `ApiError` with the status it came with, not `undefined`. |
| Several: `get<X>s`, `get<X>sBy…`, `getCatalogResources`, `getLiveRadioStations` | Apple's answer, `{ data: [...] }` | The list, empty when Apple sent none |
| A collection, a relationship or a view | Apple's answer, which is the first page: `{ data, next }` | Every item of every page, as an `AsyncIterable` |
| `searchCatalog`, `getSearchHints`, `getSearchSuggestions`, `getCharts`, `getLanguageTag` | Apple's answer | The same answer: it holds no `data` to hand over in its place |

The functions called with a client are separate exports, so a bundler leaves out of an app the ones it
did not import. `catalog(client)` holds all of them, and suits code that holds a client and passes it
around; it is what an integration offers as `music.catalog`. Each call of `catalog(client)` makes a new
one, so make it once and keep it. It cannot be changed.

What walks pages asks for nothing until it is looped over, asks for each page as the one before runs
out, and stops asking when the loop is left. The first page a function resolved to can be walked from
without asking for it again:

```ts
const page = await listGenres(music, { limit: 50 });
for await (const genre of music.paginate(page, { user: false })) {
  // the genres of that page, then the rest
}
```

`user: false` there is what the functions of this package pass themselves: no Music User Token,
wherever a next link points.

## The storefront

Every storefront has a catalog of its own. A function asks the catalog of:

1. `options.storefront`, when the call names one: `getSong(music, id, { storefront: "gb" })`;
2. otherwise the storefront the client was created with;
3. otherwise the listener's, when the client holds a Music User Token. The client looks it up once,
   with that token, and then asks the catalog without it.

With none of the three there is no catalog to ask, and the call is rejected by the client before Apple
is asked. The storefronts themselves are in no storefront's catalog, so `getStorefront`,
`getStorefronts` and `listStorefronts` take no `storefront`.

## Options

Every function takes the same options last, all of them optional unless a row above says otherwise:

| Option | |
| --- | --- |
| `storefront` | Whose catalog to ask. See above. |
| `language` | The language to answer in, as a tag such as `"en-GB"`. Default: the storefront's own. |
| `include` | The relationships to send in full with each resource, such as `["albums", "artists"]` |
| `extend` | The attributes to add to those sent by default, such as `["artistUrl"]` |
| `limit`, `offset` | How many to send in one answer, and where to start |
| `params` | Any other query parameter, for what Apple takes and no option names. An option, or an argument of the function, wins over the same name here. |
| `schema` | A [Standard Schema](https://standardschema.dev) the answer is held to. A failure is a `ValidationError`. |
| `signal` | An `AbortSignal`. Aborts the request. |

Some functions take one more:

| Option | Of | |
| --- | --- | --- |
| `maxPages` | Every `list…`, `get<X>Relationship` and `get<X>View` | The most pages a walk may ask for, when the function is one of `catalog(client)`'s. Default: no limit. Called with a client, the function asks for one page whatever this says. |
| `views` | `getAlbum`, `getArtist`, `getPlaylist`, `getMusicVideo`, `getRecordLabel` | The views to send with the resource, such as `["top-songs"]` |
| `restrict` | The three `…ByEquivalents` | `["explicit"]` leaves explicit content out |
| `with` | The five `get<X>View` | `["attributes"]` sends the view's own attributes, such as its title |
| `types`, `with` | `searchCatalog` | The types to look for, and `["topResults"]` for the best matches of any type |
| `kinds`, `types` | `getSearchSuggestions` | `"terms"`, `"topResults"` or both, and the types the top results may be |
| `types`, `chart`, `genre`, `with` | `getCharts` | The types to chart, one chart by name, one genre by id, and the city or global charts |

Nothing is validated unless a `schema` is passed, and this package does not depend on a validator. The
ones in [`@open-music-sdk/validate`](../../packages/validate) fit:

```ts
import { songsResponse } from "@open-music-sdk/validate";

const { data } = await getSong(music, "1613600188", { schema: songsResponse });
```

An option a function does not take is not sent. An object written in place with a misspelt option does
not compile; a caller without the types is not told.

## Relationships and views

The name is typed from the generated types, and decides what comes back:

```ts
const artists = await getAlbumRelationship(music, "1613600183", "artists"); // data: tArtist[]
const tracks = await getAlbumRelationship(music, "1613600183", "tracks"); // data: (tSong | tMusicVideo)[]
const versions = await getAlbumView(music, "1613600183", "other-versions"); // data: tAlbum[]
```

A `schema` for one is a schema of that page, and `validate` has one for each: a relationship's is
named for the resource and the relationship, such as `albumRelationshipsAlbumTracksRelationship`, and a
view's likewise, such as `albumViewsAlbumOtherVersionsView`. A view's validator wants the view's
attributes, so pass `with: ["attributes"]` beside it. The validators of the answers as Apple documents
them, `relationshipResponse` and `relationshipViewResponse`, do not fit: they say only that a page holds
resources, and these functions say which.

At runtime a name is any one segment of a path, and Apple says whether there is such a relationship or
view.

A relationship is a page whatever it holds. One that holds a single resource at most, such as a song's
`station`, is still `{ data: [station] }` when called with a client, and an `AsyncIterable` of that one
from `catalog(client)`.

The `library` relationship of a song, an album, a playlist and a music video is the listener's copy of
it, and needs their token. It is not among the names these functions take.

## Search and charts

A search answers with its results by type, each type a first page of its own: `results.songs` is
`{ data, next, href }`. The charts answer by type as well, and each type is a list of charts, since one
type can have several: `results.songs` is `[{ chart, name, data, next, href }]`. `limit` and `offset`
apply to every type asked for.

To get more of one type, ask again with a larger `offset`. The pages after the first cannot be walked
with `paginate`: a `next` link of a search answers with results by type again, not with a page, so a
walk yields the first page and stops.

## Mistakes and errors

What a function is handed is checked before Apple is asked, in the order of its arguments. A mistake
is a `TypeError` that names the function and the argument and describes the value without repeating
it, since a value in the wrong place may be a token:

```
getSong: id must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 228 characters
searchCatalog: types must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got undefined
```

- An id, a relationship's or a view's name and a storefront are each one segment of a path. One that
  holds a slash, a backslash, a percent sign or a control character is refused, as `.` and `..` are:
  none of Apple's does, and `../../me/library` is a request for somewhere else. Anything else is
  encoded, so the request stays in the catalog whatever it holds.
- An id, a name, a type or a storefront is at most 64 characters, which is longer than any of Apple's
  and shorter than a token, so a token put where one belongs is refused before it is sent.
- A search term is at most 256 characters. Lists are at most 300 long.
- Called with a client, a function rejects with the mistake. A function of `catalog(client)` that
  walks pages throws it as it is called, before any loop.

What Apple answers with is an `AppleMusicError` from `core`, to be told apart by its `_tag`: a missing
resource is an `ApiError` with `status: 404`, a rejected developer token a `DeveloperTokenInvalid`, a
rate limit a `RateLimited`.

## Tokens

No function here sends a Music User Token, whichever client it is handed. Every request is made with
`user: false`, which holds for each page of a walk as well: if an answer's next link pointed at the
listener's library, the walk would go there without their token. A value in a path cannot make a
catalog's path the listener's either.

The one request that does carry the token is the client's own lookup of the listener's storefront,
described above, which happens when neither the call nor the client names a storefront.

## What Apple documents, and what it does not

Every request is held to Apple's documentation by the tests: the method, the path, every documented
parameter and the answer of each endpoint. None of it has been run against the live API, so what Apple
does where its documentation is silent is not known here. Where this package differs from the
documentation, it is in these:

- Every function takes the same options, so most take some their endpoint is not documented with:
  `limit` and `offset` where resources are asked for by id or by a filter, `offset` on a relationship
  or a view, `include` and `extend` on a search or the charts. Only the three `list…` are documented
  with all of them. One that is given is sent, and Apple says what it makes of it.
- `getCharts` takes any name as its `chart`. The documentation lists `most-played` alone, and says the
  others are the names an answer gives its charts.
- The `library` relationship of a song, an album, a playlist and a music video is documented with the
  others, and is left out here: see above.
- The answer of `getLanguageTag` is a `tLangageTagResponse`. The spelling is the documentation's.

## Not here

- The listener's library, ratings, recommendations and history, and their personal station, which is
  kept in the catalog and needs their token: [`@open-music-sdk/client-user`](../client-user).
- Validators: [`@open-music-sdk/validate`](../../packages/validate), through the `schema` option.
- Artwork URLs: [`@open-music-sdk/util-artwork`](../../packages/util-artwork).
- Apple's endpoint for testing a connection, `v1/test`, which names no resource. `client.request("v1/test")`
  reaches it.

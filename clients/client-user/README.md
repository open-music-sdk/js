# @open-music-sdk/client-user

A listener's side of the Apple Music API, with a function for each of its endpoints: their library and
its playlists, their ratings, the recommendations made for them, what they have played, their replay,
and their own station. Every function takes a client from [`@open-music-sdk/core`](../../packages/core)
that holds the listener's Music User Token, and resolves to what Apple answered, typed by
[`@open-music-sdk/types`](../../packages/types).

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/client-user @open-music-sdk/core
```

Keep the two on the same version. If your app does end up with a different copy of `core` than the
one this package resolves, nothing breaks: a client from either copy is a client here, and an
`AppleMusicError` is recognised whichever copy made it.

```ts
import { createLibraryPlaylist, listLibrarySongs, setSongRating, user } from "@open-music-sdk/client-user";
import { createClient } from "@open-music-sdk/core";

const music = createClient({ developerToken });
const listener = music.as(userToken); // a client for one listener

// Called with the client, a function resolves to Apple's answer.
const page = await listLibrarySongs(listener, { limit: 100 });
await setSongRating(listener, "1613600188", 1);
const { data } = await createLibraryPlaylist(listener, { attributes: { name: "Road" } });

// Bound to the client, the same functions hand over what the answer holds.
const mine = user(listener);
const playlist = await mine.getLibraryPlaylist("p.MoGJYM3CYXW09B"); // the playlist
for await (const song of mine.listLibrarySongs()) {
  // every song in the library, asked for a page at a time
}
```

Where the Music User Token comes from, and how to check and keep one, is
[`@open-music-sdk/user-token`](../../packages/user-token). The catalog, which needs no listener, is
[`@open-music-sdk/client-catalog`](../client-catalog). The two client packages are used in the same
way: what the catalog has as `getSong`, the library has as `getLibrarySong`.

## What is in it

79 functions, one for each endpoint. A function's noun is the generated type it is about:
`getLibrarySong` resolves to a `tLibrarySongsResponse`, whose `data` holds a `tLibrarySong`.

| Pattern | Asks for | Functions |
| --- | --- | --- |
| `get<X>(client, id, options?)` | The resource with an id | `getLibrarySong`, `getLibraryAlbum`, `getLibraryArtist`, `getLibraryMusicVideo`, `getLibraryPlaylist`, `getLibraryPlaylistFolder`, `getPersonalRecommendation` |
| `get<X>s(client, ids, options?)` | The resources with some ids | The same 7, in the plural |
| `list<X>s(client, options?)` | A whole collection | `listLibrarySongs`, `listLibraryAlbums`, `listLibraryArtists`, `listLibraryMusicVideos`, `listLibraryPlaylists`, `listPersonalRecommendations` |
| `get<X>Relationship(client, id, name, options?)` | One relationship of a resource | For the same 7 |
| `create<X>(client, resource, options?)` | A new resource | `createLibraryPlaylist`, `createLibraryPlaylistFolder` |

Ratings have four functions for each of nine types: `Song`, `Album`, `MusicVideo`, `Playlist`,
`Station`, `LibrarySong`, `LibraryAlbum`, `LibraryMusicVideo` and `LibraryPlaylist`.

| Pattern | Does |
| --- | --- |
| `get<X>Rating(client, id, options?)` | The listener's rating of one |
| `get<X>Ratings(client, ids, options?)` | Their ratings of several. What they have not rated is left out. |
| `set<X>Rating(client, id, value, options?)` | Sets it: `1` for a like, `-1` for a dislike |
| `delete<X>Rating(client, id, options?)` | Takes it away |

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
| `getPersonalStation(client, options?)` | The listener's own station |
| `getUserStorefront(client, options?)` | The storefront the listener's account is in |

And `user(client)`, which is all 79 bound to one client.

## Two ways to call

| | `getLibrarySong(client, id)` | `user(client).getLibrarySong(id)` |
| --- | --- | --- |
| One resource: `get<X>`, `get<X>Rating`, `getRootLibraryPlaylistFolder`, `getPersonalStation`, `getUserStorefront` | Apple's answer, `{ data: [song] }` | The resource. A success that holds none is an `ApiError` with the status it came with, not `undefined`. |
| A write that answers with a resource: `create<X>`, `set<X>Rating` | Apple's answer, `{ data: [playlist] }` | The resource, or `undefined` if Apple's answer holds none. The write happened either way, so it is not an error. |
| Several: `get<X>s`, `get<X>Ratings`, `getLibraryResources`, `getMusicSummariesByYear` | Apple's answer, `{ data: [...] }` | The list, empty when Apple sent none |
| A collection or a relationship: every `list…`, `get<X>Relationship` | Apple's answer, which is the first page: `{ data, next }` | Every item of every page, as an `AsyncIterable` |
| `searchLibrary` | Apple's answer | The same answer: it holds no `data` to hand over in its place |
| `delete<X>Rating`, `addToLibrary`, `addToFavorites`, `addLibraryPlaylistTracks` | Nothing | Nothing |

The functions called with a client are separate exports, so a bundler leaves out of an app the ones it
did not import. `user(client)` holds all of them, and suits code that holds a listener's client and
passes it around; it is what an integration offers as `music.user`. It is made once per client and
cannot be changed.

What walks pages asks for nothing until it is looped over, asks for each page as the one before runs
out, and stops asking when the loop is left. The first page a function resolved to can be walked from
without asking for it again, with `listener.paginate(page)`.

## The listener

Every function here asks for one listener's own things, so the client has to be that listener's: one
created with a `userToken`, or given by `music.as(token)` or `music.forUser(id)`. A client that holds
no Music User Token rejects each call with `UserTokenInvalid` before Apple is asked.

Every path but one is under `/v1/me`, where the client sends the token. The exception is
`getPersonalStation`: the station is kept in a storefront's catalog, and is the one thing there that
is asked for with the listener's token. It takes a `storefront` option, whose default is the client's,
or else the listener's own, which the client looks up once.

## Options

Every function takes the same options last, all of them optional unless a row above says otherwise:

| Option | |
| --- | --- |
| `language` | The language to answer in, as a tag such as `"en-GB"`. Default: the storefront's own. |
| `include` | The relationships to send in full with each resource, such as `["catalog"]` |
| `extend` | The attributes to add to those sent by default |
| `limit`, `offset` | How many to send in one answer, and where to start |
| `params` | Any other query parameter, for what Apple takes and no option names. An option, or an argument of the function, wins over the same name here. |
| `schema` | A [Standard Schema](https://standardschema.dev) the answer is held to. A failure is a `ValidationError`. |
| `signal` | An `AbortSignal`. Aborts the request. |

Some functions take one more:

| Option | Of | |
| --- | --- | --- |
| `maxPages` | Every `list…` and `get<X>Relationship` | The most pages a walk may ask for, when the function is one of `user(client)`'s. Default: no limit. Called with a client, the function asks for one page whatever this says. |
| `types` | `searchLibrary` | The types to look for, such as `["library-songs"]`. Required. |
| `types` | `listRecentlyPlayed`, `listRecentlyPlayedTracks` | The types to keep to |
| `views` | `getMusicSummariesByYear` | The views to send with each summary, such as `["top-songs"]` |
| `storefront` | `getPersonalStation` | The storefront whose catalog the station is in |

Nothing is validated unless a `schema` is passed, and this package does not depend on a validator. The
ones in [`@open-music-sdk/validate`](../../packages/validate) fit, such as `librarySongsResponse`.

An option a function does not take is not sent. An object written in place with a misspelt option does
not compile; a caller without the types is not told.

## Writing

```ts
const mine = user(listener);
const root = await mine.getRootLibraryPlaylistFolder();
const playlist = await mine.createLibraryPlaylist({
  attributes: { name: "Road", description: "For the drive" },
  relationships: { tracks: { data: [{ id: "1613600188", type: "songs" }] }, parent: { data: [{ id: root.id, type: "library-playlist-folders" }] } },
});
await mine.addLibraryPlaylistTracks(playlist.id, [{ id: "i.eoDlqXxsaz8Nb", type: "library-songs" }]);
await mine.addToLibrary({ albums: ["1613600183"] });
await mine.setAlbumRating("1613600183", 1);
```

- What a function is handed to send is copied as the function is called, all the way down, so nothing
  done to your object afterwards changes what is sent.
- A playlist or a folder to create has to be a plain object. What it holds beyond that is Apple's to
  judge: it is sent as it is, and a refusal is Apple's `ApiError`.
- Of each track, its `id` and its `type` are sent and nothing else it held. A call takes 1 to 300
  tracks.
- A rating's value is `1` or `-1`. Anything else is a `TypeError`.
- `addToLibrary` and `addToFavorites` take ids by type of catalog resource. Apple's documentation does
  not list the types either takes, so a type is any name that could be one, and Apple says whether it
  is. Both resolve once Apple has accepted the request, which is before the resources appear.

## Mistakes and errors

What a function is handed is checked before Apple is asked, in the order of its arguments. A mistake
is a `TypeError` that names the function and the argument and describes the value without repeating
it, since a value in the wrong place may be a token:

```
getLibrarySong: id must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 228 characters
setSongRating: value must be 1, for a like, or -1, for a dislike; got 5
```

- An id, a relationship's name and a storefront are each one segment of a path. One that holds a
  slash, a backslash, a percent sign or a control character is refused, as `.` and `..` are: none of
  Apple's does, and `../../ratings/songs/1` is a request for somewhere else. Anything else is encoded,
  so the request stays where it was going whatever it holds.
- An id, a name or a type is at most 64 characters, which is longer than any of Apple's and shorter
  than a token, so a token put where one belongs is refused before it is sent.
- A search term is at most 256 characters. Lists are at most 300 long.
- Called with a client, a function rejects with the mistake. A function of `user(client)` that walks
  pages throws it as it is called, before any loop.

What Apple answers with is an `AppleMusicError` from `core`, to be told apart by its `_tag`: a token
Apple no longer accepts is a `UserTokenInvalid`, a missing resource or a rating that was never set an
`ApiError` with `status: 404`, a rate limit a `RateLimited`.

## What Apple documents, and what it does not

- Apple's documentation marks `types` as required for `listRecentlyPlayed` and
  `listRecentlyPlayedTracks`. It is optional here, so a call without it is sent as it is, and Apple
  says whether it will answer.
- `listRecentlyAdded` is documented with `language` alone. The other options are sent if given.
- A search answers with its results by type, each type a first page of its own. To get more of one
  type, ask again with a larger `offset`: the pages after the first cannot be walked with `paginate`.
- The generated type for a playlist to create wants `tracks` and `parent` together under
  `relationships`, because Apple's documentation marks both as required there.
- Every request is held to Apple's documentation by the tests: the method, the path and every
  documented parameter of each endpoint. None of it has been run against the live API.

## Not here

- The catalog: [`@open-music-sdk/client-catalog`](../client-catalog). The `library` relationship of a
  catalog song, album, playlist or music video, which is the listener's copy of it, is in neither
  package yet; `listener.request(path, { user: true })` reaches it.
- Taking in, checking and keeping a Music User Token: [`@open-music-sdk/user-token`](../../packages/user-token).
- Validators: [`@open-music-sdk/validate`](../../packages/validate), through the `schema` option.
- Changing or deleting a playlist or its tracks, which Apple's documentation has no endpoint for.

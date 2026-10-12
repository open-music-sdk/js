# @open-music-sdk/lib-playlists

Apple's API can make a playlist in a listener's library and add tracks to the end of one. It cannot
take a track out, move one, or delete a playlist. This package is the work every app does around
that: finding tracks known from somewhere else in Apple's catalog, reading a playlist whole, working
out what it is missing, and adding that without adding anything twice.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/lib-playlists @open-music-sdk/core
```

Keep the two on the same version. If your app does end up with a different copy of `core` than the
one this package resolves, nothing breaks: a client from either copy is a client here, and an
`AppleMusicError` is recognised whichever copy made it.

**Runs on a server or in a browser**: nothing here needs either.

```ts
import { createClient } from "@open-music-sdk/core";
import { playlists } from "@open-music-sdk/lib-playlists";

const music = createClient({ developerToken, storefront: "us" });
const lists = playlists(music.as(userToken)); // the four verbs, for one listener

// Tracks known from somewhere else, found in Apple's catalog.
const { tracks, skipped } = await lists.resolve([
  { isrc: "GBAYE0601498" },
  { name: "Yesterday", artistName: "The Beatles" },
]);

// What a playlist is missing. Nothing is asked of Apple here: looking at the plan is the dry run.
const plan = lists.plan({ name: "Imported", description: "from my-app" }, tracks);

// The plan carried out: the playlist found or made, and what it was missing added to its end.
const { id, created, appended, verified } = await lists.apply(plan);

// Later: the playlist as it is now, and what it would take for it to hold another list.
const playlist = await lists.read(id);
const next = lists.plan(playlist, moreTracks);
```

Where the developer token comes from is [`@open-music-sdk/developer-token`](../../packages/developer-token),
and the Music User Token [`@open-music-sdk/user-token`](../../packages/user-token). Playing the songs
`resolve` found is [`@open-music-sdk/lib-preview-player`](../lib-preview-player), which is used in the
same way: one noun, an object of short verbs, and a list of tracks answered with `{ tracks, skipped }`.

## What is in it

One function, `playlists(client)`. It checks the client, asks nothing of it, and gives a frozen object
of four verbs. It is what an integration offers as `music.playlists`. Each verb can be handed on by
itself: none of them needs `this`.

| Verb | Does | Asks |
| --- | --- | --- |
| `resolve(descriptions, options?)` | Finds a song in the catalog for each description of a track | The catalog, with the developer token alone |
| `read(id, options?)` | A playlist of the listener's library, whole, as plain JSON | The library, with both tokens |
| `plan(playlist, tracks)` | What the playlist is missing of the tracks, and what cannot be done | Nothing |
| `apply(plan, options?)` | Finds or makes the playlist and adds what it is missing | The library, with both tokens |

`read` and `apply` are the listener's, so the client has to hold a Music User Token: one created with
a `userToken`, or given by `music.as(token)` or `music.forUser(id)`. `resolve` asks the catalog, sends
no Music User Token whichever client it is given, and works with a client that has none.

| Type | Is |
| --- | --- |
| `tPlaylists` | What `playlists(client)` gives |
| `tTrackDescription`, `tResolvedTracks`, `tSkippedTrack`, `tResolveOptions` | What `resolve` takes and answers with |
| `tPlaylistSnapshot`, `tPlaylistSnapshotTrack`, `tReadPlaylistOptions` | What `read` answers with, and takes |
| `tNewPlaylist`, `tPlaylistPlan`, `tPlaylistTrack` | What `plan` takes and gives |
| `tAppliedPlan`, `tApplyOptions`, `tSettleOptions` | What `apply` answers with, and takes |
| `tAskOptions`, `tPaceOptions`, `tProgress`, `tStorefrontOption` | The options the verbs share |

## Resolving tracks

A description says what is known of a track from outside Apple's catalog. Its fields are named as a
song's attributes are, so a song's attributes are a description, and so is a track of a playlist that
was read.

| Field | |
| --- | --- |
| `isrc` | The recording's International Standard Recording Code. It names a recording whoever sells it. |
| `name`, `artistName` | What the track is searched for by, where its ISRC finds nothing |
| `albumName`, `durationInMillis` | Decide between several songs that fit: the one on that album, then the one nearest that length. Before either, a song whose name and artist are written exactly as the description's are is taken over one that only compares equal. |

Tracks with an ISRC are looked up by it first, 25 to a request, which is the most Apple documents
taking. Each track still not found that has a name is searched for, one request each. A song the
search found is taken only when its name and its artist are the description's, compared without case,
apostrophes or punctuation, and without the accents on Latin letters:

| These are the same | These are not |
| --- | --- |
| `Beyoncé` and `beyonce` | `Hey Jude` and `Hey Jude (Remastered 2015)` |
| `Don't Stop Me Now` and `Dont stop me now` | `The Beatles` and `Beatles` |
| `AC/DC` and `AC-DC` | `Simon & Garfunkel` and `Simon and Garfunkel` |

A mark on a letter of another script is part of the letter and is kept, so a Japanese ハード is not
ハート, and a Russian мой is not мои.

The rule is strict on purpose. A wrong match cannot be taken back, since Apple's API cannot take a
track out of a playlist, and whether a remaster or a live take is the same song is not for a rule to
say. A description with a name and no artist is searched for and never matched by the name alone.

It resolves to `{ tracks, skipped }`. `tracks` are the songs, as Apple sent them, in the order of the
descriptions they were found for. Each of `skipped` is a description left over:

| | |
| --- | --- |
| `index` | Where the description was in the list handed over |
| `track` | The description, as it was handed over |
| `reason` | `"no-match"` |
| `candidates` | The songs its search came back with, best first as Apple ranks them: what to show a listener to choose from. None, when there was nothing to search for. |

A description that finds nothing is never an error. A field that is a string and of no use, an empty
name or an ISRC with a comma in it, is taken as not given. An ISRC may be written as it is printed,
with hyphens or spaces, and in small letters: `GB-AYE-06-01498` is `GBAYE0601498`. A request that fails rejects the call, and
nothing found so far is handed over: resolve a long list a part at a time if that matters.

| Option | |
| --- | --- |
| `storefront` | Whose catalog to look in, by its id, such as `"gb"`. Default: the client's. An id of the catalog is good in one storefront only. |
| `delayMs`, `onProgress`, `signal` | See [Progress, pace and stopping](#progress-pace-and-stopping) |

## Reading a playlist

`read(id)` asks for the playlist and then for every page of its tracks, and resolves to plain, frozen
JSON:

```ts
{
  id: "p.MoGJYM3CYXW09B",
  name: "Road trip",
  description: "from my-app",
  canEdit: true,
  tracks: [
    { id: "i.eoD8XJ3TKlNV3M", type: "library-songs", catalogId: "1441164430", isrc: "GBAYE0601498",
      name: "Hey Jude", artistName: "The Beatles", albumName: "1", durationInMillis: 425653 },
  ],
}
```

It takes `onProgress`, `signal` and `maxPages`: see [Progress, pace and stopping](#progress-pace-and-stopping).

A track's `id` is its id in the listener's library. `catalogId` is the id of the same track in the
catalog, and `isrc` the recording's, where the library knows them: a track the listener uploaded has
neither. A field Apple did not give is left out.

**It is also the export.** Written to a file with `JSON.stringify`, a playlist that was read holds
what another listener, another storefront or another service needs to find the same recordings: each
track's ISRC, with its name, artist, album and length to fall back on. Its `tracks` are descriptions,
so `resolve(playlist.tracks)` reads it back in.

## Planning

`plan(playlist, tracks)` asks nothing and changes nothing. `playlist` is what `read` gave, or
`{ name, description }` for a playlist that `apply` is to find or make. `tracks` are the tracks it is
to hold, in order: songs as `resolve` gave them, or anything else with an `id` and a `type`.

| A plan holds | |
| --- | --- |
| `playlist` | `{ id }`, or `{ name, description }` |
| `tracks` | The tracks wanted, each as `{ id, type }` |
| `append` | The ones the playlist does not hold yet, in order: what `apply` will add to its end |
| `extra` | The tracks it holds that are not wanted. They stay: Apple's API cannot take a track out. |
| `reordered` | Whether the playlist, once what is missing is added, will hold the wanted tracks in another order than wanted: it holds some of them in another order already, or a track to add belongs before one it holds. Apple's API cannot move a track, or add one anywhere but at the end. |

A wanted track is held when one of the playlist's tracks has its id, as its `catalogId` or as its own
`id`. Each track of the playlist answers for one wanted track at most, so a song wanted twice and
held once is added once more. A plan is plain and frozen, and can be written to a file and applied
later.

## Applying

`apply(plan)` does four things, in order:

1. **Finds the playlist.** By the plan's `id`; or, for `{ name, description }`, by looking through the
   listener's playlists for one they may add to with exactly that name and that description. If there
   is none, it makes one, and only then.
2. **Reads it**, and works out afresh what it is missing. What the plan said was missing is not taken
   at its word: the playlist may have changed since.
3. **Adds what is missing** to its end, in order, `chunk` tracks to a request.
4. **Reads it once more**, to see whether what was added shows; and, for a playlist it made, looks
   for it among the listener's playlists, where the next run will look.

The description is the place for a mark of your own, such as `"from my-app, list 42"`: Apple keeps
nothing else of yours with a playlist, and a listener may have another by the same name. Better still,
keep the `id` that `apply` resolves with and plan for that.

| It resolves to | |
| --- | --- |
| `id` | The playlist's id in the listener's library |
| `created` | Whether this run made it |
| `appended` | How many tracks this run added |
| `verified` | Whether what this run wrote showed before it resolved: every track wanted in a read of the playlist and, for a playlist this run made, the playlist itself among the listener's playlists. `false` does not mean a write failed: Apple took every one, and not all of it showed within the reads `settle` allows. |

| Option | |
| --- | --- |
| `chunk` | How many tracks go in one request: 1 to 300. Default 100. |
| `settle` | `{ tries, waitMs }`: how many times the playlist is read to see a write, and how long is waited between one such read and the next. Default 5 and 1000. |
| `delayMs`, `onProgress`, `signal`, `maxPages` | See [Progress, pace and stopping](#progress-pace-and-stopping) |

### A write is sent once

`core` does not send a `POST` again after a lost answer, because it cannot tell whether Apple carried
it out, and a second one would add the tracks a second time. Neither does `apply`. When the outcome of
a write is not known, the playlist is read back and what it holds decides.

| What becomes of a write | What `apply` does |
| --- | --- |
| Apple answers that it was done | Carries on |
| The answer is lost, or is a 5xx, and the tracks show at the playlist's end | Carries on |
| The answer is lost, or is a 5xx, and the tracks do not show within the reads `settle` allows | Rejects with the error it got. Nothing is sent again. |
| Apple refuses it: a 4xx, or a 429 the client already waited out | Rejects at once |

Making the playlist goes the same way: after a lost answer the listener's playlists are looked through
for it, and it is not made a second time.

Whatever stops a run, what it wrote stays written. **Calling `apply` again with the same plan carries
on**: it reads the playlist first and adds only what is still missing.

One thing to know: Apple takes a write in and carries it out afterwards, so a read made straight away
may not show it. A run begun again before a lost write shows cannot see it, and adds those tracks a
second time. A run begun again before a playlist the first run made is among the listener's playlists
cannot find it, and makes a second one, which nothing in the API can take away. So:

- After a run that rejected, wait before running it again, and prefer a larger `settle` to a quick
  second run.
- After a run that resolved with `verified: false`, do the same.
- For a playlist a run made, plan for the `id` it resolved with from then on. Finding it again by its
  name and description rests on Apple handing both back as they were sent.

## Progress, pace and stopping

| Option | On | |
| --- | --- | --- |
| `onProgress({ done, total })` | `resolve`, `read`, `apply` | Called each time more tracks are done with. What it throws stops the verb, and is what the verb rejects with. |
| `delayMs` | `resolve`, `apply` | How long to wait after one request before the next. Default 0. |
| `signal` | `resolve`, `read`, `apply` | Aborts the request in flight and any wait. An abort is rethrown as it is. |
| `maxPages` | `read`, `apply` | The most pages one walk may ask for: of a playlist's tracks, or of the listener's playlists. Default: no limit. |

What `done` and `total` count:

| Verb | `done` | `total` |
| --- | --- | --- |
| `resolve` | Descriptions settled, found or not. An answer by ISRC can settle 25 at once. | The descriptions handed over |
| `read` | Tracks read, told a page at a time | `undefined`: Apple does not say how many there are until the last page |
| `apply` | Tracks added, told after each request | The tracks there are to add |

A walk that reaches `maxPages` with another page named does not stop short. The verb rejects with an
`ApiError`, and `apply` writes nothing: a playlist read short would be taken to hold less than it
does, and have the rest added again. Without `maxPages` a walk goes on for as long as Apple names a
next page, and only `signal` ends it sooner.

Each verb makes one request at a time. The client's own rate limiter, and its wait after a 429, apply
underneath whatever `delayMs` says: these options say how hard one call pushes, and the client says
how hard your app does.

## Mistakes and errors

A mistake in how a verb was called is a `TypeError` that names the verb and the argument, such as
`playlists.read: id must be …`, raised before Apple is asked. The verbs that wait on Apple reject with
it; `plan` and `playlists` throw it. No error repeats a value: a string is described by its length and
anything else by its kind.

What happens at runtime with Apple is an `AppleMusicError` from the client, with a `_tag` to switch
on: `UserTokenInvalid` when the listener has to reconnect, `ApiError` with a `status` of 404 for a
playlist that is not there, `NetworkError` for an answer that never came.

## What Apple documents, and what it does not

Documented: making a library playlist, adding tracks to the end of one, reading one and its tracks;
that `filter[isrc]` takes 25 values at most, and that one ISRC may come back as several songs. Not
documented, and so not here: taking a track out, moving one, renaming or deleting a playlist.

Nothing in this package has been run against the live API. These are what it takes on trust:

- **That a playlist's tracks can be asked for with `include=catalog`**, and that each then carries its
  catalog song, which is where the ISRC is. Where an answer has no such relationship, the id Apple
  puts under `attributes.playParams.catalogId` is used: its documentation does not list that field,
  and its answers carry it.
- **That a `next` link keeps what the first page was asked with.** If it drops `include`, tracks after
  the first hundred are read with their catalog id and without their ISRC.
- **That a 404 for the tracks of a playlist that is there means it has none.** Before that is believed
  the playlist is asked once more, with `include=tracks`, and a playlist that then shows a track is
  not empty: the 404 is what the verb rejects with. A playlist wrongly taken for empty would have
  everything it holds added again.
- **That a track added by its catalog id is then held under that id.** `plan` goes by it. If the
  library answers with another id for the same recording, the track will look missing.
- **How long a write takes to show**, which the defaults of `settle` are a guess at, and **how many
  tracks one request takes**, which `chunk` is held to 300 for because that is the most the client's
  function takes.
- **That a playlist's description comes back as it was sent**, which finding a playlist by it needs.

## Not here

The endpoints themselves, one function each, are
[`@open-music-sdk/client-user`](../../clients/client-user) and
[`@open-music-sdk/client-catalog`](../../clients/client-catalog); this package is made of seven of
them. Playing a preview of what was found is
[`@open-music-sdk/lib-preview-player`](../lib-preview-player). Taking tracks out of a playlist, or
putting them in another order, is not here because Apple's API has no way to do either.

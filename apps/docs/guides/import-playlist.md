# Import a playlist

Apple's API can make a playlist in a listener's [library](../glossary#library) and add tracks to the end of one.
It can't take a track out, move one, rename a playlist or delete one. In this guide you take a list of tracks
from somewhere else, such as another service or a file, find each one in Apple's catalog, and add them to a
playlist without adding any twice.

Before you start, you need:

- a client that acts for the listener: `music.as(token)` or `music.forUser(userId)` on a server, or `useMusic()`
  in React once the listener has signed in. See [Sign a listener in](./sign-in) and
  [Keep a listener's token on your server](./store-user-tokens).
- the tracks to import, each with its [ISRC](../glossary#isrc) where you have it, or its name and artist.

Every client from an integration has the four playlist functions on it, as `playlists`: `resolve`, `plan`,
`apply` and `read`. They run on a server or in a page. The examples run on your server, where `userId` is your
own id for the signed-in listener.

## 1. Find the tracks in Apple's catalog

On your server, describe each track and hand the list to `resolve`:

```ts
const listener = music.forUser(userId);

const { tracks, skipped } = await listener.playlists.resolve([
  { isrc: "GBAYE0601498" },
  { name: "Yesterday", artistName: "The Beatles", albumName: "Help!" },
]);
```

A description's fields are named as a song's attributes are, so a song's attributes are a description too:

| Field | What it's for |
| --- | --- |
| `isrc` | The recording's ISRC. It names one recording, whoever sells it. You can write it as it's printed, with hyphens or spaces, in either case. |
| `name`, `artistName` | What the track is searched for by, where its ISRC finds nothing |
| `albumName`, `durationInMillis` | Which of several matching songs to take: the one on that album, then the one nearest that length |

`resolve` looks tracks up by ISRC first, 25 to a request. Then it searches for each track still not found that
has a name, one request each. It takes a song the search found only when its name and its artist are the
description's, compared without case, apostrophes, punctuation or the accents on Latin letters:

| The same | Not the same |
| --- | --- |
| `Beyoncé` and `beyonce` | `Hey Jude` and `Hey Jude (Remastered 2015)` |
| `Don't Stop Me Now` and `Dont stop me now` | `The Beatles` and `Beatles` |
| `AC/DC` and `AC-DC` | `Simon & Garfunkel` and `Simon and Garfunkel` |

A mark on a letter of another script is part of the letter and is kept, so Japanese ハード isn't ハート. A
description with a name and no artist is searched for, and never matched by the name alone.

The rule is strict on purpose. A wrong match can't be taken back, because Apple's API can't take a track out of a
playlist. Whether a remaster or a live take is the same song is for you or the listener to say.

`tracks` holds the songs found, in the order of their descriptions. Each entry of `skipped` is a description that
found no song:

| Field | What it holds |
| --- | --- |
| `index` | Where the description was in your list, counted from 0 |
| `track` | The description, as you gave it |
| `reason` | `"no-match"` |
| `candidates` | The songs its search found, best first as Apple ranks them: what to show the listener to choose from. Empty when there was nothing to search for. |

A description that finds nothing is never an error. A request that fails is: it rejects the whole call, and
nothing found so far is handed over. If that matters, resolve a long list a part at a time.

`resolve` asks the catalog only, and never sends the listener's Music User Token. A client without one works too,
as long as the client or the call names a [storefront](../glossary#storefront): pass `storefront: "gb"` to look in
another one. Where neither names one, the client looks up the listener's storefront with their token.

## 2. Plan the change

On your server, plan what the playlist needs:

```ts
const plan = listener.playlists.plan({ name: "Imported", description: "from my-app, list 42" }, tracks);
```

`plan` asks nothing of Apple and changes nothing. It's the dry run: show the listener `plan.append` before you
write anything. A plan holds:

| Field | What it holds |
| --- | --- |
| `playlist` | `{ id }` for a playlist you read, or `{ name, description }` for one `apply` is to find or make |
| `tracks` | The tracks wanted, in order, each as `{ id, type }` |
| `append` | The wanted tracks the playlist doesn't hold yet, in order: what `apply` adds to its end |
| `extra` | The tracks it holds that aren't wanted. They stay, because Apple's API can't take a track out. |
| `reordered` | Whether the playlist, once the missing tracks are added, holds the wanted tracks in another order than you asked. Apple's API can't move a track, or add one anywhere but the end. |

Use the description for a mark of your own, such as `"from my-app, list 42"`. Apple keeps nothing else of yours
with a playlist, and a listener may have another playlist by the same name.

A plan is plain, frozen JSON. You can write it to a file and apply it later.

## 3. Apply the plan

On your server, carry the plan out:

```ts
const { id, created, appended, verified } = await listener.playlists.apply(plan);
```

`apply` does four things, in order:

1. It finds the playlist: by the plan's `id`, or among the listener's playlists they may add to, by exactly the
   plan's name and description. If there is none, it makes one, and only then.
2. It reads the playlist and works out again what is missing, since the playlist may have changed since you
   planned. A playlist it has just made holds nothing, and isn't read.
3. It adds what is missing to the end, in order, `chunk` tracks to a request: 100 by default, 300 at most.
4. Where it added anything, it reads the playlist once more to see the tracks. For a playlist it made, it also
   looks for the playlist among the listener's playlists, where the next run will look.

It resolves to:

| Field | What it holds |
| --- | --- |
| `id` | The playlist's id in the listener's library. Keep it, and plan for it from now on. |
| `created` | Whether this run made the playlist |
| `appended` | How many tracks this run added |
| `verified` | Whether what this run wrote showed before it resolved. `false` doesn't mean a write failed: Apple took every one, and not all of it showed within the reads `settle` allows. |

`settle` is an option of `apply`: `{ tries, waitMs }`, how many times the playlist is read to see a write, and how
long to wait between reads. It defaults to 5 tries, 1,000 milliseconds apart.

### A write is sent once

The client never sends a write again after a lost answer, because it can't tell whether Apple carried it out,
and a second one would add the tracks twice. Neither does `apply`: when it doesn't know what became of a write, it
reads the playlist back and lets what the playlist holds decide. Making a playlist works the same way. Whatever
stops a run, what it wrote stays written, and calling `apply` again with the same plan adds only what is still
missing. See [Errors](../concepts/errors) for why the client retries what it does.

::: warning Wait before you run a plan again
Apple takes a write in and carries it out afterwards, so a read made at once may not show it. A run started again
before a lost write shows can't see it, and adds those tracks a second time. A run started again before a
playlist the first run made is listed can't find it, and makes a second playlist, which nothing in the API can
delete.

- After a run that rejected, or resolved with `verified: false`, wait before you run it again. Prefer a larger
  `settle` to a quick second run.
- For a playlist a run made, plan for the `id` it resolved with from then on. Finding it again by its name and
  description relies on Apple handing both back as they were sent.
:::

## 4. Read the playlist back later

On your server, `read` gives the playlist as it is now, and you can plan against it:

```ts
const playlist = await listener.playlists.read(id);
const more = listener.playlists.plan(playlist, moreTracks);
await listener.playlists.apply(more);
```

`read` asks for the playlist and every page of its tracks, and resolves to plain, frozen JSON:

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

A track's `id` is its id in the listener's library. `catalogId` is the same track's id in the catalog, and `isrc`
the recording's, where the library knows them. A track the listener uploaded has neither. A field Apple didn't
send is left out.

A plan counts a wanted track as held when one of the playlist's tracks has its id, as its `catalogId` or its own
`id`. Each track in the playlist counts for one wanted track at most, so a song wanted twice and held once is
added once more.

The playlist you read is also an export. Written to a file with `JSON.stringify`, it holds what another listener,
another storefront or another service needs to find the same recordings. Its tracks are descriptions, so
`resolve(playlist.tracks)` reads it back in.

## 5. Report progress, pace requests, and stop

On your server, pass the same options to `resolve`, `read` and `apply`:

```ts
const controller = new AbortController();

await listener.playlists.apply(plan, {
  onProgress: ({ done, total }) => console.log(`${done} of ${total ?? "?"}`),
  delayMs: 500,
  signal: controller.signal,
});
```

| Option | Taken by | What it does |
| --- | --- | --- |
| `onProgress({ done, total })` | `resolve`, `read`, `apply` | Called each time more tracks are done with. What it throws stops the call, and is what the call rejects with. |
| `delayMs` | `resolve`, `apply` | How long to wait between requests, in milliseconds: every request of `resolve`, and the requests of `apply` that add tracks. Default 0. |
| `signal` | `resolve`, `read`, `apply` | Aborts the request in flight and any wait. The call rejects with the signal's reason, as it is. |
| `maxPages` | `read`, `apply` | The most pages one walk may ask for: of a playlist's tracks, or of the listener's playlists. Default: no limit. |

What `done` and `total` count:

| Function | `done` | `total` |
| --- | --- | --- |
| `resolve` | Descriptions settled, found or not. One ISRC request can settle 25 at once. | The descriptions you gave |
| `read` | Tracks read, a page at a time | `undefined`: Apple doesn't say how many there are until the last page |
| `apply` | Tracks added, after each request | The tracks there are to add |

A walk that reaches `maxPages` while Apple names another page doesn't stop short. The call rejects with an
`ApiError`, and `apply` writes nothing: a playlist read short would look as if it held less, and have the rest
added again.

Each function makes one request at a time. The client's own rate limiter, and its wait after a `429`, apply
underneath `delayMs`. These options set how hard one call pushes; the client sets how hard your whole app does.

## When something goes wrong

- A mistake in how you call a function is a `TypeError` that names it and the argument, such as
  `playlists.read: id must be …`, raised before Apple is asked. `plan` throws it, and the others reject with it.
  No such error repeats the value you passed.
- What goes wrong with Apple is an `AppleMusicError` with a `_tag`: `UserTokenInvalid` when the listener has to
  sign in again, an `ApiError` with `status: 404` for a playlist that isn't there, a `NetworkError` for an answer
  that never came. Its message names the path that was asked for, so it holds the playlist's id or the storefront.
  See [Handle errors](./errors).

::: info Not yet run against the live API
What these functions take on trust:

- That a playlist's tracks can be asked for with `include=catalog`, and that each then carries its catalog song,
  which holds the ISRC. Where an answer has none, the id under `attributes.playParams.catalogId` is used.
- That a `next` link keeps what the first page was asked with. If it drops `include`, tracks after the first
  hundred are read without their ISRC.
- That a `404` for the tracks of a playlist that exists means it has none. Before that's believed, the playlist is
  asked for once more with `include=tracks`, and one that then shows a track isn't taken for empty.
- That a track added by its catalog id is then held under that id. `plan` relies on it: if the library answers
  with another id for the same recording, the track looks missing.
- How long a write takes to show, which `settle`'s defaults guess at, and how many tracks one request takes,
  which `chunk` holds to 300.
- That a playlist's name and description come back as they were sent, which finding a playlist by them needs.
:::

## Next steps

- [Play song previews](./previews) of the songs `resolve` found.
- [Errors](../concepts/errors), for which errors the client retries and which it hands to you.
- The reference for [`playlists`](../reference/@open-music-sdk/lib-playlists/functions/playlists), and the
  options of [`apply`](../reference/@open-music-sdk/lib-playlists/interfaces/tApplyOptions).

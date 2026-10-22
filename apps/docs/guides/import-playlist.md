# Import a playlist

Apple's API can make a playlist in a listener's [library](../glossary#library) and add tracks to the end of one.
It can't take a track out, move one, rename a playlist or delete one. In this guide you take a list of tracks
from somewhere else, such as another service or a file, find each one in Apple's catalog, and add them to a
playlist without adding any twice.

Before you start, you need:

- a client from an integration that acts for the listener. See [Sign a listener in](./sign-in) and
  [Keep a listener's token on your server](./store-user-tokens).
- the tracks to import, each with its [ISRC](../glossary#isrc) where you have it, or its name and artist.

Every client from an integration has the four playlist functions on it, as `playlists`: `resolve`, `plan`,
`apply` and `read`. They run on a server or in a page. The examples run on your server.

In the code below, `listener` is that client. On a server, it's what your client's `as(token)` gives for the
listener's Music User Token, or `forUser(userId)` for your own id of the listener. In a page, it's what
`as(token)` gives once the listener has signed in, or `useMusic()` in React.

## 1. Find the tracks in Apple's catalog

On your server, describe each track and hand the list to `resolve`:

```ts
const { tracks, skipped } = await listener.playlists.resolve([
  { isrc: "GBAYE0601498" },
  { name: "Yesterday", artistName: "The Beatles", albumName: "Help!" },
]);
```

A description's fields are named as a song's attributes are, so a song's attributes are a description too. See
[`tTrackDescription`](../reference/@open-music-sdk/lib-playlists/interfaces/tTrackDescription) for how each one
is read.

`resolve` looks tracks up by `isrc` first, 25 to a request. Then it searches by `name` and `artistName` for each
track still not found, one request each, and takes the song on `albumName`, then the one nearest
`durationInMillis`, where several match. It takes a song the search found only when its name and its artist are
the description's, compared without case, apostrophes, punctuation or the accents on Latin letters:

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
found no song, with its `index` in your list and the `candidates` its search found, best first: show those to the
listener to choose from. See [`tSkippedTrack`](../reference/@open-music-sdk/lib-playlists/interfaces/tSkippedTrack).

A description that finds nothing is never an error. A request that fails is: it rejects the whole call, and
nothing found so far is handed over. If that matters, resolve a long list a part at a time.

`resolve` asks the catalog only, and never sends the listener's Music User Token. A client without one works too,
as long as the client or the call names a [storefront](../glossary#storefront): pass `storefront: "gb"` to look in
another one. Where neither names one, the client looks up the listener's storefront with their token.

## 2. Plan the change

On your server, plan what the playlist needs:

```ts
const plan = listener.playlists.plan(
  { name: "Imported", description: "from my-app, list 42" },
  tracks,
);
```

`plan` asks nothing of Apple and changes nothing. It's the dry run: before you write anything, show the listener
`plan.append`, the tracks `apply` will add to the playlist's end. Show them `plan.extra` and `plan.reordered` too.
Apple's API can't take a track out or move one, so tracks the playlist holds that you don't want stay, and the
order may not be yours. See [`tPlaylistPlan`](../reference/@open-music-sdk/lib-playlists/interfaces/tPlaylistPlan).

Use the description for a mark of your own, such as `"from my-app, list 42"`. Apple keeps nothing else of yours
with a playlist, and a listener may have another playlist by the same name.

A plan is plain, frozen JSON. You can write it to a file and apply it later.

## 3. Apply the plan

On your server, carry the plan out:

```ts
const { id, created, appended, verified } =
  await listener.playlists.apply(plan);
```

`apply` does four things, in order:

1. It finds the playlist: by the plan's `id`, or among the listener's playlists they may add to, by exactly the
   plan's name and description. If there is none, it makes one, and only then.
2. It reads the playlist and works out again what is missing, since the playlist may have changed since you
   planned. A playlist it has just made holds nothing, and isn't read.
3. It adds what is missing to the end, in order, `chunk` tracks to a request: 300 by default, which is also the
   most.
4. Where it added anything, it reads the playlist once more to see the tracks. For a playlist it made, it also
   looks for the playlist among the listener's playlists, where the next run will look.

Keep the `id` it resolves with, and plan for it from now on. `verified` is `false` when not all of what this run
wrote showed within the reads `settle` allows. That doesn't mean a write failed. See
[`tAppliedPlan`](../reference/@open-music-sdk/lib-playlists/interfaces/tAppliedPlan).

`settle` is an option of `apply`: `{ tries, waitMs }`, how many times the playlist is read to see a write, and how
long to wait between reads. It defaults to 10 tries, 1,000 milliseconds apart. Against the live API, a new
playlist took 4 seconds to show among the listener's playlists, and its tracks 2 seconds to show in it.

### A write is sent once

The client never sends a `POST`, such as adding tracks, again after a lost answer, because it can't tell whether
Apple carried it out, and a second one would add the tracks twice. Neither does `apply`: when it doesn't know what
became of a write, it reads the playlist back and lets what the playlist holds decide. Making a playlist works the
same way. Whatever stops a run, what it wrote stays written, and calling `apply` again with the same plan adds
only what is still missing. See [Errors](../concepts/errors) for why the client retries what it does.

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

On your server, `read` gives the playlist as it is now, and you can plan against it. Here `moreTracks` stands for
the songs the playlist is to hold, in order, such as the `tracks` another `resolve` found:

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
    {
      id: "i.eoD8XJ3TKlNV3M",
      type: "library-songs",
      catalogId: "1441164430",
      isrc: "GBAYE0601498",
      name: "Hey Jude",
      artistName: "The Beatles",
      albumName: "1",
      durationInMillis: 425653,
    },
  ],
}
```

A track's `id` is its id in the listener's library. `catalogId` is the same track's id in the catalog, and `isrc`
the recording's, where the library knows them. A track the listener uploaded has neither. A field Apple didn't
send is left out.

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

- `onProgress` is called each time more tracks are done with. `total` is `undefined` for `read`, since Apple
  doesn't say how many tracks there are until the last page. For `resolve`, one ISRC request can settle many
  descriptions at once: it asks for up to 25 codes, and settles every description whose code it finds, however
  many share one.
- `delayMs` is how long to wait between requests, in milliseconds: every request of `resolve`, and the requests of
  `apply` that add tracks.
- `signal` stops the call, which rejects with the signal's reason, as it is.
- `maxPages` is the most pages one walk of `read` or `apply` may ask for.

See [`tApplyOptions`](../reference/@open-music-sdk/lib-playlists/interfaces/tApplyOptions) and
[`tProgress`](../reference/@open-music-sdk/lib-playlists/interfaces/tProgress).

A walk that reaches `maxPages` while Apple names another page doesn't stop short, since a playlist read short
would look as if it held less, and have the rest added again. `read` rejects with an `ApiError`. So does `apply`
in the reads it makes before it writes, and then it writes nothing. In the reads `apply` makes after it has
written, such a walk counts as one that didn't show the write: `apply` resolves with `verified: false`, or, where
a write's answer was lost, rejects with that write's own error.

Each function makes one request at a time. The client's own rate limiter, and its wait after a `429`, apply
underneath `delayMs`. These options set how hard one call pushes; the client sets how hard your whole app does.

## In the sample apps

Each [sample app](../samples) sends its crate of songs to the listener's library this way: it finds a pasted
tracklist, shows the plan in a dialog, and applies it only when the listener says to. The Vite samples call the
four functions in the page. The Next sample calls them in server actions, and plans again on the server before it
applies, rather than trusting a plan the page sends back.

## When something goes wrong

- A mistake in how you call a function is a `TypeError` that names it and the argument, such as
  `playlists.read: id must be …`, raised before Apple is asked. `plan` throws it, and the others reject with it.
  No such error repeats the value you passed.
- What goes wrong with Apple is an `AppleMusicError` with a `_tag`: `UserTokenInvalid` when Apple answers `403`
  and the listener has to sign in again, an `ApiError` with `status: 404` for a playlist that isn't there, a
  `NetworkError` for an answer that never came. A listener who isn't signed in, or has no subscription, can get a
  `401` instead, which arrives as `DeveloperTokenInvalid`. Its message names the path that was asked for, so it holds the playlist's id or the storefront.
  See [Handle errors](./errors).

::: info Run once against the live API
On 18 October 2026, in one storefront, a playlist was made, given 300 tracks in one request, read back with every
track under the catalog id it was added by, and found again by its name and description, and `apply` with the same
plan added nothing. One run is one sample: `settle`'s defaults leave room past what it took, not a promise. See
[Differences from Apple's documentation](../differences#lib-playlists) for what these functions still take on trust.
:::

## Next steps

- [Play song previews](./previews) of the songs `resolve` found.
- [Errors](../concepts/errors), for which errors the client retries and which it hands to you.
- The reference for [`playlists`](../reference/@open-music-sdk/lib-playlists/functions/playlists), and the
  options of [`apply`](../reference/@open-music-sdk/lib-playlists/interfaces/tApplyOptions).

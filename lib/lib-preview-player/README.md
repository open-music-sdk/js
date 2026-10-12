# @open-music-sdk/lib-preview-player

A song in Apple's catalog comes with a short preview clip, under `attributes.previews`, that any
audio element can play. This package is the small player every page would otherwise write around
that: a queue of tracks, play, pause, next and previous, one clip following another, and one snapshot
of where things stand for the page to draw. It has no framework in it, and asks Apple for nothing: it
is fed songs that were already fetched.

You probably want one of the integrations instead (`browser`, `react`, `next`) once they exist. Use
this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/lib-preview-player
```

**Runs in the browser.** It needs an audio element, which a server has not.

```ts
import { previewPlayer } from "@open-music-sdk/lib-preview-player";
import type { tSong } from "@open-music-sdk/types";

const player = previewPlayer<tSong>(); // nothing is played, and nothing is asked of the element, yet

// Songs as a client handed them over: from a search, a chart, an album's tracks.
const { tracks, skipped } = player.load(songs);

playButton.onclick = () => void player.play().catch(showWhyNot); // sound starts from a click
nextButton.onclick = () => void player.next().catch(showWhyNot);
pauseButton.onclick = () => player.pause();

player.subscribe(() => {
  const { status, track, position, duration } = player.state;
  title.textContent = track?.attributes?.name ?? "";
  bar.value = duration === 0 ? 0 : position / duration;
  playButton.hidden = status === "playing";
});
```

```tsx
// In a React component: subscribe and state are what useSyncExternalStore takes.
const state = useSyncExternalStore(player.subscribe, () => player.state);
```

The songs can come from any function of [`@open-music-sdk/client-catalog`](../../clients/client-catalog),
or from `resolve` in [`@open-music-sdk/lib-playlists`](../lib-playlists), which is used in the same
way as this package: one noun, an object of short verbs, and a list of tracks answered with
`{ tracks, skipped }`.

## What is in it

One function, `previewPlayer(options?)`. It gives a frozen object, and each of its functions can be
handed on by itself: none of them needs `this`.

| Member | Does |
| --- | --- |
| `load(tracks)` | Replaces the queue with the tracks that have a clip, and answers `{ tracks, skipped }`. Plays nothing. |
| `play(index?)` | Plays the track at `index` from its start. With no index: carries on with the current clip, or starts the first track. |
| `pause()` | Pauses the current clip |
| `next()`, `previous()` | Plays the neighbour of the current track from its start. At an end of the queue it does nothing. |
| `seek(seconds)` | Moves within the current clip |
| `setVolume(volume)` | Sets the element's volume, from 0 to 1 |
| `state` | Where the player stands now: a frozen snapshot, the same object for as long as nothing changes |
| `subscribe(listener)` | Calls `listener` after each change of `state`, and gives the function that stops it |
| `dispose()`, `[Symbol.asyncDispose]()` | Pauses, lets go of the element, forgets the queue and whoever listens |

| Option | |
| --- | --- |
| `audio` | The audio element to play through. Default: one made with `new Audio()`. |
| `hosts` | The hosts a clip may come from. Default: where a clip points is not checked. See [Where a clip points](#where-a-clip-points). |

Both are checked and taken when the player is made: a mistake is a `TypeError` then and not on the
first click, and nothing done to your options object afterwards changes anything.

The type parameter says what kind of track the player is fed, and is what `state.track` is typed as:
`previewPlayer<tSong>()`. Exported beside the function are `tPreviewPlayer`, `tPreviewPlayerOptions`,
`tPreviewPlayerState`, `tPreviewStatus`, `tLoadedPreviews`, `tSkippedPreview`, `tPreviewable` and
`tPreviewAudio`.

## The queue

`load` takes resources as a client handed them over and reads one thing of each: the URL of its
first preview. A song and a music video of the catalog have one. A library song has none, and neither
has a song whose `attributes` were not asked for.

It answers with `{ tracks, skipped }`. `tracks` is the queue: the tracks with a clip, in the order
they were handed over. Each of `skipped` is a track left out of it:

| | |
| --- | --- |
| `index` | Where the track was in the list handed over |
| `track` | The track, as it was handed over |
| `reason` | `"no-preview"`: it has no clip. `"host"`: its clip is not on one of the hosts allowed. |

A track that cannot be played is never an error, so a page can draw it with its play button off.
Loading a new queue stops what was playing and leaves no track current.

When a clip ends the next track of the queue starts. After the last one the player's status is
`ended`, and `play()` starts again from the first.

## State

| | |
| --- | --- |
| `status` | See below |
| `tracks` | The queue |
| `index`, `track` | Where in the queue the current track is, and the track; `-1` and `undefined` when none is |
| `position`, `duration` | How far into the current clip the element is and how long the clip is, in seconds. `duration` is 0 until the element knows it. |
| `volume` | The element's volume |

| `status` | |
| --- | --- |
| `idle` | No track is current: nothing was played yet, or a queue was just loaded |
| `loading` | A clip was asked for and has not begun, or has stopped to wait for more of itself |
| `playing` | |
| `paused` | A clip is current and is not playing |
| `ended` | The last clip of the queue ran out |
| `error` | The element could not play the current clip. `next()` moves on; `play()` asks for the same clip again. |

A listener is called once for each change, after the state has changed. While a clip plays the
position changes several times a second, as often as the element says so.

A listener may call the player back. The element is asked to play before anyone hears that a clip is
loading, so a listener that pauses, loads another queue or disposes on hearing it has the last word,
and no sound is left playing behind it.

A listener that throws stops neither the player nor the other listeners. Each one is told, the
player's own work is done first, and the first error is then thrown on: to whoever called the
function, or out through the element's event when it was the element that spoke.

## Sound starts from a click

Browsers do not let a page start sound by itself: the first sound has to follow something the
listener did. The player starts sound only from `play`, `next` and `previous`, and from the end of a
clip that was playing. So call the first of them from a click or a key press.

`play`, `next` and `previous` settle as the element's own `play()` does. When a browser will not
start the sound, they reject with the browser's own error, a `DOMException` named `NotAllowedError`,
and the clip is left paused. A call that another overtakes, as when `next` is clicked twice quickly,
rejects with the browser's `AbortError`, and the state is the later call's: catch it and carry on.

## The element

Hand over your own `<audio>` to keep its controls, or let the player make one. The player uses
`src`, `currentTime`, `volume`, `duration`, `paused`, `ended`, `play()`, `pause()` and eight of the
element's events, and nothing else: it never adds the element to the page or takes it out.

An element that something else pauses, such as its own controls, is paused in `state` too, and a
volume set on the element is the volume in `state`.

`dispose()` pauses, takes the player's listeners off the element, and forgets the queue and whoever
subscribed. The element is left as it is, for you to reuse or drop. Afterwards every other function
is a `TypeError`. `await using player = previewPlayer()` works where the runtime has it; in a browser
with no `Symbol.asyncDispose` yet a player has no such function, and `dispose()` is the way.

## Where a clip points

A clip's URL comes from the track it is handed. A track that came from Apple's API a moment ago can
be played as it is. One from a cache, a database others can write to or a shared link can hold any
URL, and the element will request it.

| Option | |
| --- | --- |
| `hosts` | Bare host names in small letters, 16 at most. With this, a track whose clip is not `https` on one of them or on a subdomain of one, with no port and no credentials, is skipped as `"host"`. |

The check is the one [`@open-music-sdk/util-artwork`](../../packages/util-artwork) makes for an
artwork, and both take it from [`@open-music-sdk/core`](../../packages/core). That check is all of
`core` an app carries because of this package: none of the client comes with it.

## Mistakes and errors

A mistake in how a function was called is a `TypeError` that names the function and the argument,
such as `previewPlayer.seek: seconds must be …`. `load`, `seek`, `setVolume` and `subscribe` throw
it, and `play`, `next` and `previous` reject with it. No error repeats a value: a string is described
by its length and anything else by its kind.

What the element refuses is passed on as the browser made it, as above. Nothing here is an
`AppleMusicError`: the player asks Apple for nothing.

## What Apple documents, and what it does not

Documented: that a song and a music video have `previews`, each with a `url`, and that a preview may
be available with or without an Apple Music subscription.

Not documented: which host the clips are served from. The host this package's errors name as an
example, `itunes.apple.com`, is a guess from clips seen elsewhere, on `audio-ssl.itunes.apple.com`,
and has not been checked here against the live API. Look at what your own answers hold before you
set `hosts`.

Nothing here has been run in a browser against a clip from the live API. What it takes on trust is
how browsers behave: that the first sound may follow a click, that one clip may follow another on the
same element without a second click, and that an element says it has ended only after it has paused.

## Not here

Fetching the songs is [`@open-music-sdk/client-catalog`](../../clients/client-catalog). Finding songs
for tracks known from elsewhere, and putting them in a playlist, is
[`@open-music-sdk/lib-playlists`](../lib-playlists). Artwork for the track that is playing is
[`@open-music-sdk/util-artwork`](../../packages/util-artwork). Playing a whole song is not here: the
API has no endpoint for it, and a preview is the one piece of audio it hands over.

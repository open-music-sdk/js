# Play song previews

Every song and music video in Apple's catalog comes with a short audio clip, its [preview](../glossary#preview).
In this guide you play those clips in a page: a queue of tracks, play, pause, next and previous, and a display
that follows along.

Before you start, you need:

- a page with a client from `createBrowserClient`, and the [token endpoint](./token-endpoint) it gets its
  developer token from.

No listener has to sign in. The player asks Apple for nothing: it plays the clips of tracks you already fetched.
It runs in a page only, because it needs an audio element. The API hands over no audio but previews, so there is
no way to play a whole song.

## 1. Get the tracks from the catalog

In your page, fetch songs or music videos with the catalog. Here they are an album's tracks:

```ts
import { createBrowserClient, previewPlayer, type tMusicVideo, type tSong } from "@open-music-sdk/browser";

const music = createBrowserClient({ tokenUrl: "/api/music/token", storefront: "us" });

const album = await music.catalog.getAlbum("1613600183", { include: ["tracks"] });
const tracks = album.relationships?.tracks?.data ?? [];
```

Any catalog function that hands over songs or music videos works: a search, a chart, or `resolve` from
[Import a playlist](./import-playlist). A song in a listener's library has no preview, and neither has a song
fetched without its attributes.

## 2. Load them into a player

In your page, make a player and load the tracks:

```ts
const player = previewPlayer<tSong | tMusicVideo>();
const { tracks: queue, skipped } = player.load(tracks);
```

`previewPlayer()` makes its own audio element with `new Audio()` and listens to it. The type parameter is the kind
of track you feed it, and is what `player.state.track` is typed as.

`load` replaces the queue with the tracks that have a clip, in the order you gave them, and plays nothing. Each
entry of `skipped` is a track it left out:

| Field | What it holds |
| --- | --- |
| `index` | Where the track was in the list you gave `load`, counted from 0 |
| `track` | The track, as you gave it |
| `reason` | `"no-preview"`: it has no clip. `"host"`: its clip isn't on a host you allow (see step 7). |

A track without a clip is never an error, so you can draw it with its play button turned off.

Loading a new queue stops what was playing, takes the old clip off the element, and leaves no track current.

## 3. Start sound from a click

Browsers don't let a page start sound on its own: the first sound has to follow something the listener did. So
call `play`, `next` or `previous` from a click or a key press. In your page:

```ts
playButton.onclick = () => void player.play().catch(showWhyNot);
pauseButton.onclick = () => player.pause();
nextButton.onclick = () => void player.next().catch(showWhyNot);
previousButton.onclick = () => void player.previous().catch(showWhyNot);
```

The buttons and `showWhyNot` stand for your own code.

- `play()` carries on with the current clip, or starts the first track. `play(2)` plays the third track from its
  start.
- `next()` and `previous()` play the neighbouring track from its start. At an end of the queue they do nothing.
- When a clip ends, the next track starts. After the last one the status is `ended`, and `play()` starts again
  from the first.
- `seek(seconds)` moves within the current clip, and `setVolume(volume)` takes a number from 0 to 1.

`play`, `next` and `previous` settle as the element's own `play()` does. They reject with the browser's own error:

- `NotAllowedError` when the browser won't start sound, because no click came before it. The clip stays paused.
- `AbortError` when a later call overtakes this one, as when `next` is clicked twice quickly. The state is the
  later call's, so catch the error and carry on.

::: info Not yet run against the live API
The player hasn't been run in a browser against a clip from the live API. It takes on trust how browsers behave:
that the first sound may follow a click, that one clip may follow another on the same element without a second
click, and that an element says it has ended only after it has paused.
:::

## 4. Draw the player's state

In your page, subscribe to the player and draw from `player.state`:

```ts
player.subscribe(() => {
  const { status, track, position, duration } = player.state;
  title.textContent = track?.attributes?.name ?? "";
  bar.value = duration === 0 ? 0 : position / duration;
  playButton.hidden = status === "playing";
});
```

`subscribe` calls your listener after each change and returns the function that stops it. While a clip plays,
`position` changes several times a second.

`player.state` is a frozen snapshot, and stays the same object until something changes. It holds:

| Field | What it holds |
| --- | --- |
| `status` | Where the player stands: see the next table |
| `tracks` | The queue |
| `index`, `track` | The current track's place in the queue, and the track. `-1` and `undefined` when none is current. |
| `position`, `duration` | How far into the current clip the element is, and how long the clip is, in seconds. `duration` is 0 until the element knows it. |
| `volume` | The element's volume, from 0 to 1 |

| `status` | Means |
| --- | --- |
| `idle` | No track is current: nothing has played yet, or a queue was just loaded |
| `loading` | A clip was asked for and hasn't begun, or has stopped to wait for more of itself |
| `playing` | A clip is playing |
| `paused` | A clip is current and isn't playing |
| `ended` | The last clip of the queue ran out |
| `error` | The element couldn't play the current clip. `next()` moves on, and `play()` asks for the same clip again. |

A listener may call the player back, for example to pause or load another queue, and what it does stands. A
listener that throws stops neither the player nor the other listeners. The first error is then thrown to
whoever called the player, or out through the element's event.

## 5. In React, use `usePreviewPlayer`

In a React component, `usePreviewPlayer` from `@open-music-sdk/react` gives you the player's state and its
functions:

```tsx
import { usePreviewPlayer, type tMusicVideo, type tSong } from "@open-music-sdk/react";
import { useEffect } from "react";

export function Previews({ tracks }: { tracks: readonly (tSong | tMusicVideo)[] }) {
  const { state, load, play, pause, next } = usePreviewPlayer<tSong | tMusicVideo>();

  useEffect(() => {
    load(tracks);
  }, [tracks, load]);

  return (
    <div>
      <p>{state.track?.attributes?.name}</p>
      {state.status === "playing" ?
        <button onClick={() => pause()}>Pause</button>
      : <button onClick={() => void play().catch(showWhyNot)}>Play</button>}
      <button onClick={() => void next().catch(showWhyNot)}>Next</button>
    </div>
  );
}
```

- The hook makes the player when the component mounts and disposes it when the component unmounts. It needs no
  `MusicProvider`.
- `state` is the player's own snapshot. On the server, and before the component mounts, it's one idle snapshot,
  so a server render and a hydration agree.
- `load`, `play`, `pause`, `next`, `previous`, `seek` and `setVolume` keep their identity for as long as the
  component lives, so you can list them in an effect's dependencies.
- Call them from a click or from an effect of the component that called the hook. One called before the player
  exists, which only a child's effect can do, throws a `TypeError`.
- The effect above loads the list again whenever `tracks` changes, which stops what is playing. Hand it a list that
  keeps its identity between renders, such as one from a query.

The hook reads its options on the first mount only.

## 6. Play through your own audio element

To keep an `<audio>` element's own controls on the page, hand the element to the player. In your page:

```ts
const audio = document.querySelector<HTMLAudioElement>("#preview")!;
const player = previewPlayer<tSong>({ audio });
```

In React, pass the element or a ref to it. The hook reads the ref when the component mounts, and a ref with
nothing in it then is a `TypeError`:

```tsx
import { usePreviewPlayer, type tSong } from "@open-music-sdk/react";
import { useRef } from "react";

export function Player() {
  const audio = useRef<HTMLAudioElement>(null);
  const { state, load, play } = usePreviewPlayer<tSong>({ audio });
  // … load and play as in step 5
  return <audio ref={audio} controls />;
}
```

The player never adds the element to the page or takes it out. It sets the element's `src`, `currentTime` and
`volume`, calls `play()`, `pause()`, `load()` and `removeAttribute("src")`, and listens to eight of its events.
Whatever else pauses the element, such as its own controls, shows as `paused` in the state, and a volume set on
the element shows as the state's volume.

When you're done with a player you made with `previewPlayer`, call `player.dispose()`. It pauses, takes the clip
and the player's listeners off the element, and forgets the queue and your subscribers. The element is yours
again. After that, every other function of the player throws a `TypeError`. Where the runtime has
`Symbol.asyncDispose`, `await using player = previewPlayer()` disposes it for you; in a browser without it, call
`dispose()`. In React, the hook disposes the player for you.

## 7. Check where clips point

A clip's URL comes from the track you load. A track that came from Apple's API a moment ago can be played as it
is.

::: warning A stored track can point anywhere
A track from a cache, a database that others can write to, or a shared link can hold any URL, and the audio
element will request it.
:::

For tracks like those, pass `hosts` when you make the player:

```ts
const player = previewPlayer<tSong>({ hosts: ["itunes.apple.com"] });
```

`hosts` takes up to 16 bare host names, in lowercase. With it, a track whose clip isn't `https` on one of those
hosts or a subdomain of one, with no port and no credentials, is skipped with the reason `"host"`. Without it,
where a clip points isn't checked at all.

::: info Not yet run against the live API
Apple doesn't document which host serves preview clips. `itunes.apple.com` is a guess, from clips seen elsewhere
on `audio-ssl.itunes.apple.com`, and hasn't been checked against the live API. Look at what your own answers
hold before you set `hosts`.
:::

`previewPlayer` checks `audio` and `hosts` when it makes the player, so a mistake in either is a `TypeError`
then, not on the first click. Changing your options object afterwards changes nothing.

## When something goes wrong

- A mistake in how you call a function is a `TypeError` that names the function and the argument, such as
  `previewPlayer.seek: seconds must be …`. `load`, `seek`, `setVolume` and `subscribe` throw it, and `play`,
  `next` and `previous` reject with it. No such error repeats the value you passed.
- What the element refuses reaches you as the browser made it, such as the `NotAllowedError` in step 3.
- No error here is an `AppleMusicError`, because the player asks Apple for nothing.

## Next steps

- [Show artwork](./artwork) for the track that is playing.
- [Import a playlist](./import-playlist): the songs `resolve` finds are tracks the player can play.
- The reference for [`previewPlayer`](../reference/@open-music-sdk/lib-preview-player/functions/previewPlayer) and
  [`usePreviewPlayer`](../reference/@open-music-sdk/react/functions/usePreviewPlayer).

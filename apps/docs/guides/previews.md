# Play song previews

Every song and music video in Apple's catalog comes with a short audio clip, its [preview](../glossary#preview).
In this guide you play those clips in a page: a queue of tracks, play, pause, next and previous, and a display
that follows along.

Before you start, you need:

- a page with a client from `createBrowserClient`, and the [token endpoint](./token-endpoint) it gets its
  developer token from.

No listener has to sign in. The player asks Apple for nothing: it plays the clips of tracks you already fetched.
It runs in a page only, because it needs an audio element. The API hands over no audio but previews, so this SDK
has no way to play a whole song. [MusicKit on the Web](../glossary#musickit-on-the-web) plays whole songs for a
listener with an Apple Music subscription.

## 1. Get the tracks from the catalog

In your page, fetch songs or music videos with the catalog. Here they are an album's tracks:

```ts
import {
  createBrowserClient,
  previewPlayer,
  type tMusicVideo,
  type tSong,
} from "@open-music-sdk/browser";

const music = createBrowserClient({
  tokenUrl: "/api/music/token",
  storefront: "us",
});

const album = await music.catalog.getAlbum("1613600183", {
  include: ["tracks"],
});
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
entry of `skipped` is a track it left out, with its `index` in your list and a `reason`: `"no-preview"` for a track
with no clip, `"host"` for a clip on a host you don't allow (see step 7). See
[`tSkippedPreview`](../reference/@open-music-sdk/lib-preview-player/interfaces/tSkippedPreview).

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
Don't count on the next clip starting without a second click until you've tried it in the browsers you support:
the player hasn't played a clip from the live API in a browser yet. See
[Differences from Apple's documentation](../differences#lib-preview-player) for what it takes on trust.
:::

A list with a Play button on each row plays the whole list, from the row that was clicked. The track's place in
the queue `load` gives back can differ from its place in your list, since tracks with no clip are left out. The
[vanilla sample](../samples) does it this way:

<<< @/../../samples/web-vanilla/src/player.ts#play-from{ts}

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

`player.state` is a frozen snapshot, and stays the same object until something changes. It holds the `status`,
the queue as `tracks`, the current `index` and `track`, the clip's `position` and `duration`, and the `volume`. See
[`tPreviewPlayerState`](../reference/@open-music-sdk/lib-preview-player/interfaces/tPreviewPlayerState).

`status` is one of `idle`, `loading`, `playing`, `paused`, `ended` and `error`, which
[`tPreviewStatus`](../reference/@open-music-sdk/lib-preview-player/type-aliases/tPreviewStatus) explains. After an
`error`, `next()` moves on, and `play()` asks for the same clip again.

A listener may call the player back, for example to pause or load another queue, and what it does stands. A
listener that throws stops neither the player nor the other listeners. The first error is then thrown to
whoever called the player, or out through the element's event.

## 5. In React, use `usePreviewPlayer`

In a React component, `usePreviewPlayer` from `@open-music-sdk/react` gives you the player's state and its
functions:

```tsx
import {
  usePreviewPlayer,
  type tMusicVideo,
  type tSong,
} from "@open-music-sdk/react";
import { useEffect } from "react";

type tTrack = tSong | tMusicVideo;

export function Previews({ tracks }: { tracks: readonly tTrack[] }) {
  const { state, load, play, pause, next } = usePreviewPlayer<tTrack>();

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
again. After that, `play`, `next` and `previous` reject with a `TypeError`, `load`, `pause`, `seek`, `setVolume`
and `subscribe` throw one, and `dispose()` again does nothing. Where the runtime has `Symbol.asyncDispose`,
`await using player = previewPlayer()` disposes it for you; in a browser without it, call `dispose()`. In React,
the hook disposes the player for you.

## 7. Check where clips point

A clip's URL comes from the track you load. A track that came from Apple's API a moment ago can be played as it
is.

::: warning A stored track can point anywhere
A track from a cache, a database that others can write to, or a shared link can hold any URL, and the audio
element will request it. See [URLs in Apple's answers](../concepts/security#urls-in-apple-s-answers).
:::

For tracks like those, pass `hosts` when you make the player:

```ts
const player = previewPlayer<tSong>({ hosts: ["itunes.apple.com"] });
```

`hosts` takes up to 16 bare host names, in lowercase. With it, a track whose clip isn't `https` on one of those
hosts or a subdomain of one, with no port and no credentials, is skipped with the reason `"host"`. Without it,
where a clip points isn't checked at all.

Apple doesn't document which host serves the clips. Against the live API on 18 October 2026, the clips of 50
chart songs were all on `audio-ssl.itunes.apple.com`, which `itunes.apple.com` allows: see
[Differences from Apple's documentation](../differences#lib-preview-player). Look at what your own answers hold
before you set `hosts`.

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

# @open-music-sdk/lib-preview-player

A song in Apple's catalog comes with a short preview clip, under `attributes.previews`, that any audio element can
play. This package is the small player every page would otherwise write around it: a queue of tracks, play, pause,
next and previous, one clip following another, and one snapshot of where things stand for your page to draw. It
has no framework in it, and asks Apple for nothing: you feed it songs you already fetched.

Most apps install [`browser`](../../integrations/browser/README.md) or [`react`](../../integrations/react/README.md)
instead, which re-export `previewPlayer`, and in React add `usePreviewPlayer`. Use this package to build your own
client.

```
pnpm add @open-music-sdk/lib-preview-player
pnpm add -D @open-music-sdk/types
```

The second line is for the types the example imports.

## Example

In your page, where `songs` came from a client and `playButton`, `title` and `showError` stand for your own code:

```ts
import { previewPlayer } from "@open-music-sdk/lib-preview-player";
import type { tSong } from "@open-music-sdk/types";

const player = previewPlayer<tSong>(); // makes its own audio element, and plays nothing yet

const { tracks, skipped } = player.load(songs); // skipped: the songs with no clip

playButton.onclick = () => void player.play().catch(showError); // sound has to start from a click

player.subscribe(() => {
  const { status, track } = player.state;
  title.textContent = status === "playing" ? (track?.attributes?.name ?? "") : "";
});
```

In React, `subscribe` and `state` are what `useSyncExternalStore` takes:
`useSyncExternalStore(player.subscribe, () => player.state)`.

## What's in it

One function, `previewPlayer(options?)`, which gives a frozen player. Each of its functions can be handed on by
itself.

| Member | What it does |
| --- | --- |
| `load(tracks)` | Replaces the queue with the tracks that have a clip, and answers `{ tracks, skipped }`. Plays nothing. |
| `play(index?)` | Plays the track at `index` from its start. With no index, carries on, or starts the first track. |
| `pause()` | Pauses the current clip |
| `next()`, `previous()` | Plays the next or the previous track from its start |
| `seek(seconds)` | Moves within the current clip |
| `setVolume(volume)` | Sets the element's volume, from 0 to 1 |
| `state` | Where the player stands: a frozen snapshot, the same object for as long as nothing changes |
| `subscribe(listener)` | Calls `listener` after each change of `state`, and gives you the function that stops it |
| `dispose()`, `[Symbol.asyncDispose]()` | Pauses, lets go of the element, and forgets the queue and the listeners |

Its two options are `audio`, the element to play through, and `hosts`, the hosts a clip may come from. The types
exported beside it are `tPreviewPlayer`, `tPreviewPlayerOptions`, `tPreviewPlayerState`, `tPreviewStatus`,
`tLoadedPreviews`, `tSkippedPreview`, `tPreviewable` and `tPreviewAudio`.

It uses a few checks from `core`, such as the host check `util-artwork` makes for artwork, and none of the client.

## Learn more

- [Play song previews](https://open-music-sdk.github.io/js/guides/previews)
- [Security model](https://open-music-sdk.github.io/js/concepts/security), for when to set `hosts`
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences), for what Apple doesn't
  document about clips
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/lib-preview-player/)

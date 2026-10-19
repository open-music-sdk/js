// Shows: previewPlayer, artworkUrl. Guide: /guides/previews
import { artworkUrl, previewPlayer, type tMusicVideo, type tSong } from "@open-music-sdk/browser";
import { byId } from "./dom";
import { say, showError } from "./errors";

type tTrack = tSong | tMusicVideo;

// One player for the page. It plays the previews of tracks already fetched, through an audio element of its own,
// and asks Apple for nothing.
const player = previewPlayer<tTrack>();

// #region play-from
/**
 * Plays a list of tracks, from one of them. Called from a click: a browser starts sound only
 * after one.
 */
export function playFrom(tracks: readonly tTrack[], track: tTrack): void {
  // Tracks with no preview are left out of the queue, so the track's place in the queue can differ
  // from its place in the list.
  const { tracks: queue, skipped } = player.load(tracks);
  if (skipped.length > 0) {
    say(`${String(skipped.length)} of these tracks have no preview, and are left out.`);
  }
  const place = queue.indexOf(track);
  // The track clicked is one of those with no preview.
  if (place === -1) return;
  player.play(place).catch(showError);
}
// #endregion play-from

const playButton = byId("play", HTMLButtonElement);
const previousButton = byId("previous", HTMLButtonElement);
const nextButton = byId("next", HTMLButtonElement);
const position = byId("position", HTMLInputElement);
const volume = byId("volume", HTMLInputElement);
const art = byId("now-art", HTMLImageElement);
const title = byId("now-title", HTMLElement);
const artist = byId("now-artist", HTMLElement);

playButton.onclick = () => {
  if (player.state.status === "playing") player.pause();
  else player.play().catch(showError);
};
previousButton.onclick = () => {
  player.previous().catch(showError);
};
nextButton.onclick = () => {
  player.next().catch(showError);
};
position.oninput = () => {
  player.seek(Number(position.value));
};
volume.oninput = () => {
  player.setVolume(Number(volume.value));
};

// The player tells its listeners after every change, several times a second while a preview plays.
player.subscribe(() => {
  const { status, track, position: at, duration } = player.state;
  title.textContent = track?.attributes?.name ?? "Nothing playing";
  artist.textContent = track?.attributes?.artistName ?? "";

  const artwork = track?.attributes?.artwork;
  art.hidden = artwork === undefined;
  if (artwork !== undefined) art.src = artworkUrl(artwork, 48);

  playButton.textContent = status === "playing" ? "Pause" : "Play";
  position.max = String(duration || 30);
  // Left alone while the listener drags it.
  if (document.activeElement !== position) position.value = String(at);
});

// Shows: previewPlayer, artworkUrl. Guide: /guides/previews
import { artworkUrl, previewPlayer, type tMusicVideo, type tSong } from "@open-music-sdk/browser";
import { byId } from "./dom";
import { say, showError } from "./errors";

type tTrack = tSong | tMusicVideo;

// One player for the page. It plays the previews of tracks already fetched, through an audio element of its own,
// and asks Apple for nothing.
const player = previewPlayer<tTrack>();

// #region play-from
/** Plays a list of tracks, from one of them. Called from a click: a browser starts sound only after one. */
export function playFrom(tracks: readonly tTrack[], track: tTrack): void {
  const { tracks: queue, skipped } = player.load(tracks);
  if (skipped.length > 0) say(`${String(skipped.length)} of these tracks have no preview, and are left out.`);
  if (!queue.includes(track)) return;
  player.play(queue.indexOf(track)).catch(showError);
}
// #endregion play-from

const play = byId("play", HTMLButtonElement);
const position = byId("position", HTMLInputElement);

play.onclick = () => {
  if (player.state.status === "playing") player.pause();
  else player.play().catch(showError);
};
byId("previous", HTMLButtonElement).onclick = () => {
  player.previous().catch(showError);
};
byId("next", HTMLButtonElement).onclick = () => {
  player.next().catch(showError);
};
position.oninput = () => {
  player.seek(Number(position.value));
};
const volume = byId("volume", HTMLInputElement);
volume.oninput = () => {
  player.setVolume(Number(volume.value));
};

const art = byId("now-art", HTMLImageElement);

// The player tells its listeners after every change, several times a second while a preview plays.
player.subscribe(() => {
  const { status, track, position: at, duration } = player.state;
  byId("now-title", HTMLElement).textContent = track?.attributes?.name ?? "Nothing playing";
  byId("now-artist", HTMLElement).textContent = track?.attributes?.artistName ?? "";
  const artwork = track?.attributes?.artwork;
  art.hidden = artwork === undefined;
  if (artwork !== undefined) art.src = artworkUrl(artwork, 48);
  play.textContent = status === "playing" ? "Pause" : "Play";
  position.max = String(duration || 30);
  // Left alone while the listener drags it.
  if (document.activeElement !== position) position.value = String(at);
});

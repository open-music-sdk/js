// Shows: getSongRatings, setSongRating, deleteSongRating, addToLibrary.
import type { tMusicVideo, tSong } from "@open-music-sdk/browser";
import { crate } from "./box";
import { pick } from "./crate";
import { h } from "./dom";
import { say, showError } from "./errors";
import { now } from "./music";
import { playFrom } from "./player";

type tTrack = tSong | tMusicVideo;

/** A crate of tracks. Pulling one out plays its preview; the one in front has the actions of `actions`. */
export async function songCrate(label: string, tracks: readonly tTrack[]): Promise<HTMLElement> {
  const loved = await lovedOf(tracks);
  const sleeve = (track: tTrack) => ({
    artwork: track.attributes?.artwork,
    name: track.attributes?.name ?? track.id,
    by: track.attributes?.artistName,
    open: () => { playFrom(tracks, track); },
    actions: () => actions(tracks, track, loved),
  });
  return crate(label, tracks.map(sleeve));
}

/** An album's or a playlist's tracklist, as the back of its sleeve prints it, each track with its actions. */
export async function songRows(tracks: readonly tTrack[]): Promise<HTMLOListElement> {
  const loved = await lovedOf(tracks);
  const row = (track: tTrack) => h("li", {}, h("span", { className: "name" }, track.attributes?.name ?? track.id, h("small", {}, track.attributes?.artistName ?? "")), ...actions(tracks, track, loved));
  return h("ol", { className: "tracklist" }, ...tracks.map(row));
}

/** Play and Into the crate, and Love and Add to library once someone is signed in. */
function actions(tracks: readonly tTrack[], track: tTrack, loved: Set<string>): HTMLElement[] {
  const { listener } = now;
  return [
    h("button", { type: "button", textContent: "Play", onclick: () => { playFrom(tracks, track); } }),
    track.type === "songs" && h("button", { type: "button", textContent: "Into the crate", onclick: () => { pick(track); } }),
    track.type === "songs" && listener !== undefined && love(track.id, loved),
    listener !== undefined && h("button", { type: "button", textContent: "Add to library", onclick: () => void add(track) }),
  ].filter((button) => button !== false);
}

/** Which of these songs the listener loves, from one request for all of them. Songs never rated are left out. */
async function lovedOf(tracks: readonly tTrack[]): Promise<Set<string>> {
  const ids = tracks.filter((track) => track.type === "songs").map((track) => track.id);
  if (now.listener === undefined || ids.length === 0) return new Set();
  try {
    const ratings = await now.listener.user.getSongRatings(ids.slice(0, 300));
    return new Set(ratings.filter((rating) => rating.attributes?.value === 1).map((rating) => rating.id));
  } catch (e) {
    // The hearts are an extra: songs whose ratings Apple will not give are drawn without them, and the page says why.
    showError(e);
    return new Set();
  }
}

/** A heart that loves the song, a rating of 1, or takes the rating away again. `loved` keeps what it did. */
function love(id: string, loved: Set<string>): HTMLButtonElement {
  const button = h("button", { type: "button", textContent: loved.has(id) ? "Loved" : "Love", ariaPressed: String(loved.has(id)) });
  button.onclick = async () => {
    try {
      const loving = !loved.has(id);
      if (loving) await now.listener?.user.setSongRating(id, 1);
      else await now.listener?.user.deleteSongRating(id);
      if (loving) loved.add(id);
      else loved.delete(id);
      button.ariaPressed = String(loving);
      button.textContent = loving ? "Loved" : "Love";
    } catch (e) {
      showError(e);
    }
  };
  return button;
}

async function add(track: tTrack): Promise<void> {
  try {
    await now.listener?.user.addToLibrary(track.type === "songs" ? { songs: [track.id] } : { "music-videos": [track.id] });
    // Apple accepts the request at once and adds the track afterwards, within seconds.
    say(`Added ${track.attributes?.name ?? "it"} to your library. It can take a few seconds to show there.`);
  } catch (e) {
    showError(e);
  }
}

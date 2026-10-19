// Shows: getSongRatings, setSongRating, deleteSongRating, addToLibrary.
import type { tMusicVideo, tSong } from "@open-music-sdk/browser";
import { crate } from "./box";
import { pick } from "./crate";
import { button, h } from "./dom";
import { say, showError } from "./errors";
import { now } from "./music";
import { playFrom } from "./player";
import type { tSleeve } from "./sleeve";

type tTrack = tSong | tMusicVideo;

/** A crate of tracks. Pulling one out plays its preview; the one in front has the buttons of `actions`. */
export async function songCrate(label: string, tracks: readonly tTrack[]): Promise<HTMLElement> {
  const loved = await lovedOf(tracks);
  const sleeve = (track: tTrack): tSleeve => ({
    artwork: track.attributes?.artwork,
    name: track.attributes?.name ?? track.id,
    by: track.attributes?.artistName,
    open: () => { playFrom(tracks, track); },
    actions: () => actions(tracks, track, loved),
  });
  return crate(label, tracks.map(sleeve));
}

/** An album's or a playlist's tracklist, as the back of its sleeve prints it, each track with its buttons. */
export async function songRows(tracks: readonly tTrack[]): Promise<HTMLOListElement> {
  const loved = await lovedOf(tracks);
  const row = (track: tTrack) => {
    const title = track.attributes?.name ?? track.id;
    const artist = track.attributes?.artistName ?? "";
    const name = h("span", { className: "name" }, title, h("small", {}, artist));
    return h("li", {}, name, ...actions(tracks, track, loved));
  };
  return h("ol", { className: "tracklist" }, ...tracks.map(row));
}

/**
 * Play and Into the crate, and, once someone is signed in, Love and Add to library. A music video has neither Into
 * the crate nor Love.
 */
function actions(tracks: readonly tTrack[], track: tTrack, loved: Set<string>): HTMLElement[] {
  const isSong = track.type === "songs";
  const signedIn = now.listener !== undefined;
  const buttons = [button("Play", () => { playFrom(tracks, track); })];
  if (isSong) buttons.push(button("Into the crate", () => { pick(track); }));
  if (isSong && signedIn) buttons.push(love(track.id, loved));
  if (signedIn) buttons.push(button("Add to library", () => { void add(track); }));
  return buttons;
}

/** Which of these songs the listener loves, from one request for all of them. Songs never rated are left out. */
async function lovedOf(tracks: readonly tTrack[]): Promise<Set<string>> {
  const ids = tracks.filter((track) => track.type === "songs").map((track) => track.id);
  if (now.listener === undefined || ids.length === 0) return new Set();
  try {
    const ratings = await now.listener.user.getSongRatings(ids.slice(0, 300));
    const loves = ratings.filter((rating) => rating.attributes?.value === 1);
    return new Set(loves.map((rating) => rating.id));
  } catch (e) {
    // The hearts are an extra: songs whose ratings Apple will not give are drawn without them, and the page says why.
    showError(e);
    return new Set();
  }
}

/**
 * A heart that loves the song, a rating of 1, or takes the rating away again. `loved` changes as soon as it is
 * clicked, and back if Apple refuses, so a heart drawn again before Apple answers shows what the listener asked for.
 */
function love(id: string, loved: Set<string>): HTMLButtonElement {
  const heart = h("button", { type: "button" });
  const show = (loving: boolean) => {
    if (loving) loved.add(id);
    else loved.delete(id);
    heart.ariaPressed = String(loving);
    heart.textContent = loving ? "Loved" : "Love";
  };
  show(loved.has(id));

  heart.onclick = async () => {
    const loving = !loved.has(id);
    show(loving);
    try {
      if (loving) await now.listener?.user.setSongRating(id, 1);
      else await now.listener?.user.deleteSongRating(id);
    } catch (e) {
      show(!loving);
      showError(e);
    }
  };
  return heart;
}

async function add(track: tTrack): Promise<void> {
  const ids = track.type === "songs" ? { songs: [track.id] } : { "music-videos": [track.id] };
  try {
    await now.listener?.user.addToLibrary(ids);
    // Apple accepts the request at once and adds the track afterwards, within seconds.
    say(`Added ${track.attributes?.name ?? "it"} to your library. It can take a few seconds to show there.`);
  } catch (e) {
    showError(e);
  }
}

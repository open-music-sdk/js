// Shows: artworkImage, getSongRatings, setSongRating, deleteSongRating, addToLibrary. Guide: /guides/artwork
import { artworkImage, type tArtwork, type tMusicVideo, type tSong } from "@open-music-sdk/browser";
import { pick } from "./crate";
import { h } from "./dom";
import { say, showError } from "./errors";
import { now } from "./music";
import { playFrom } from "./player";

type tTrack = tSong | tMusicVideo;

// #region artwork
/** An `<img>` for an artwork shown `size` CSS pixels wide, with a `srcset` for screens of higher density. */
export function cover(artwork: tArtwork | undefined, size: number): HTMLImageElement {
  if (artwork === undefined) return h("img", { alt: "", width: size, height: size });
  return h("img", { alt: "", ...artworkImage(artwork, size) });
}
// #endregion artwork

/** A list of tracks, each with Play and Into the crate, and Love and Add to library once someone is signed in. */
export async function songRows(tracks: readonly tTrack[]): Promise<HTMLUListElement> {
  const loved = await lovedOf(tracks);
  return h("ul", { className: "songs" }, ...tracks.map((track) => row(tracks, track, loved.has(track.id))));
}

function row(tracks: readonly tTrack[], track: tTrack, isLoved: boolean): HTMLLIElement {
  const { listener } = now;
  const name = track.attributes?.name ?? track.id;
  return h(
    "li",
    {},
    cover(track.attributes?.artwork, 40),
    h("span", { className: "name" }, name, h("small", {}, track.attributes?.artistName ?? "")),
    h("button", { type: "button", textContent: "Play", onclick: () => { playFrom(tracks, track); } }),
    track.type === "songs" && h("button", { type: "button", textContent: "Into the crate", onclick: () => { pick(track); } }),
    track.type === "songs" && listener !== undefined && love(track.id, isLoved),
    listener !== undefined && h("button", { type: "button", textContent: "Add to library", onclick: () => void add(track) }),
  );
}

// #region ratings
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

/** A heart that loves the song, a rating of 1, or takes the rating away again. */
function love(id: string, isLoved: boolean): HTMLButtonElement {
  const button = h("button", { type: "button", textContent: isLoved ? "Loved" : "Love", ariaPressed: String(isLoved) });
  button.onclick = async () => {
    try {
      const loving = button.ariaPressed !== "true";
      if (loving) await now.listener?.user.setSongRating(id, 1);
      else await now.listener?.user.deleteSongRating(id);
      button.ariaPressed = String(loving);
      button.textContent = loving ? "Loved" : "Love";
    } catch (e) {
      showError(e);
    }
  };
  return button;
}
// #endregion ratings

// #region add-to-library
async function add(track: tTrack): Promise<void> {
  try {
    await now.listener?.user.addToLibrary(track.type === "songs" ? { songs: [track.id] } : { "music-videos": [track.id] });
    // Apple accepts the request at once and adds the track afterwards, within seconds.
    say(`Added ${track.attributes?.name ?? "it"} to your library. It can take a few seconds to show there.`);
  } catch (e) {
    showError(e);
  }
}
// #endregion add-to-library

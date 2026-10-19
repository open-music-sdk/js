// Shows: playlists.resolve. Guide: /guides/import-playlist
import type { tSong, tTrackDescription } from "@open-music-sdk/browser";
import { byId, h } from "./dom";
import { say, showError } from "./errors";
import { music, now, onChange } from "./music";
import { playFrom } from "./player";

/** The songs picked so far, in order. Page state: a reload empties the crate. */
export const picks: tSong[] = [];
const unmatched = byId("unmatched", HTMLDivElement);

export function pick(song: tSong): void {
  if (!picks.some(({ id }) => id === song.id)) picks.push(song);
  draw();
  say(`${song.attributes?.name ?? "The song"} is in the crate.`);
}

// #region resolve
// A pasted tracklist, one "Artist - Title" a line, found in the catalog. No sign-in needed: it asks the catalog only.
byId("paste", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  find(byId("tracklist", HTMLTextAreaElement).value).catch(showError);
};

async function find(text: string): Promise<void> {
  const descriptions: tTrackDescription[] = text
    .split("\n")
    .map((line) => line.split(" - "))
    .filter((parts) => parts.length >= 2)
    .map(([artistName = "", ...title]) => ({ artistName: artistName.trim(), name: title.join(" - ").trim() }));
  const asked = now.storefront;
  const { tracks, skipped } = await music.playlists.resolve(descriptions, {
    storefront: asked,
    onProgress: ({ done, total = 0 }) => {
      say(`Finding songs: ${String(done)} of ${String(total)}.`);
    },
  });
  // Songs found in a storefront the page has left have other ids than the ones it shows now.
  if (now.storefront !== asked) return;
  for (const song of tracks) pick(song);
  // A line with no exact match comes back with the songs its search found, for the listener to choose from.
  const take = (song: tSong) => h("button", { type: "button", textContent: `Take ${song.attributes?.name ?? song.id} by ${song.attributes?.artistName ?? ""}`, onclick: () => { pick(song); } });
  const lines = skipped.map(({ track, candidates }) => h("li", {}, `Not found: ${track.artistName ?? ""} - ${track.name ?? ""}. `, ...candidates.slice(0, 3).map(take)));
  unmatched.replaceChildren(h("ul", {}, ...lines));
  say(`Found ${String(tracks.length)} of ${String(descriptions.length)} songs.`);
}
// #endregion resolve

function draw(): void {
  byId("crate-count", HTMLSpanElement).textContent = String(picks.length);
  const move = (from: number, to: number) => () => {
    if (to < 0 || to >= picks.length) return;
    picks.splice(to, 0, ...picks.splice(from, 1));
    draw();
  };
  const row = (song: tSong, at: number) =>
    h(
      "li",
      {},
      h("span", { className: "name" }, song.attributes?.name ?? song.id, h("small", {}, song.attributes?.artistName ?? "")),
      h("button", { type: "button", textContent: "Play", onclick: () => { playFrom(picks, song); } }),
      h("button", { type: "button", textContent: "Up", onclick: move(at, at - 1) }),
      h("button", { type: "button", textContent: "Down", onclick: move(at, at + 1) }),
      h("button", { type: "button", textContent: "Remove", onclick: () => { picks.splice(at, 1); draw(); } }),
    );
  byId("picks", HTMLOListElement).replaceChildren(...picks.map(row));
  byId("send", HTMLFormElement).hidden = now.listener === undefined || picks.length === 0;
}

// Another storefront has other ids, so the crate, and the songs offered for unmatched lines, empty.
let pickedIn = now.storefront;
onChange(() => {
  if (now.storefront !== pickedIn) {
    if (picks.length > 0) say("The crate is empty again: songs have other ids in another storefront.");
    picks.length = 0;
    unmatched.replaceChildren();
  }
  pickedIn = now.storefront;
  draw();
});

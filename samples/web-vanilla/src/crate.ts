// Shows: playlists.resolve. Guide: /guides/import-playlist
import type { tSong, tTrackDescription } from "@open-music-sdk/browser";
import { crate, type tSleeve } from "./box";
import { byId, h } from "./dom";
import { say, showError } from "./errors";
import { music, now, onChange } from "./music";
import { playFrom } from "./player";

/** The songs picked so far, in order. Page state: a reload empties the crate. */
export const picks: tSong[] = [];
const unmatched = byId("unmatched", HTMLDivElement);

export function pick(song: tSong): void {
  if (!picks.some(({ id }) => id === song.id)) picks.push(song);
  draw(picks.findIndex(({ id }) => id === song.id));
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

/** Your crate, drawn as the others are, with the sleeve at `at` in front. Its order is the playlist's. */
function draw(at = 0): void {
  byId("crate-count", HTMLSpanElement).textContent = String(picks.length);
  const move = (from: number, to: number, label: string) => () => {
    picks.splice(to, 0, ...picks.splice(from, 1));
    draw(to);
    again(label);
  };
  const takeOut = (i: number) => () => {
    picks.splice(i, 1);
    draw(i);
    again("Take out");
  };
  const sleeve = (song: tSong, i: number): tSleeve => ({
    artwork: song.attributes?.artwork,
    name: song.attributes?.name ?? song.id,
    by: song.attributes?.artistName,
    open: () => { playFrom(picks, song); },
    actions: () => [
      h("button", { type: "button", textContent: "Play", onclick: () => { playFrom(picks, song); } }),
      h("button", { type: "button", textContent: "Move earlier", disabled: i === 0, onclick: move(i, i - 1, "Move earlier") }),
      h("button", { type: "button", textContent: "Move later", disabled: i === picks.length - 1, onclick: move(i, i + 1, "Move later") }),
      h("button", { type: "button", textContent: "Take out", onclick: takeOut(i) }),
    ],
  });
  const empty = "Empty. Put songs in from Dig, or paste a tracklist below.";
  byId("picks", HTMLDivElement).replaceChildren(h("div", { className: "crates" }, crate("Your crate", picks.map(sleeve), { at, empty })));
  byId("send", HTMLFormElement).hidden = now.listener === undefined || picks.length === 0;
}

/** Focus back on the action just used, in the crate drawn again, so a song can be moved on with the keyboard. */
function again(label: string): void {
  const box = byId("picks", HTMLDivElement);
  const button = [...box.querySelectorAll<HTMLButtonElement>(".actions button")].find((each) => each.textContent === label && !each.disabled);
  (button ?? box.querySelector<HTMLElement>(".sleeve[tabindex='0']"))?.focus();
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

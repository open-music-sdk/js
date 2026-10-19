// Shows: playlists.resolve. Guide: /guides/import-playlist
import type { tSkippedTrack, tSong, tTrackDescription } from "@open-music-sdk/browser";
import { crate } from "./box";
import { button, byId, h } from "./dom";
import { say, showError } from "./errors";
import { music, now, onChange } from "./music";
import { playFrom } from "./player";
import type { tSleeve } from "./sleeve";

/** The songs picked so far, in order. Page state: a reload empties the crate. */
export const picks: tSong[] = [];
const unmatched = byId("unmatched", HTMLDivElement);

export function pick(song: tSong): void {
  if (!picks.some(({ id }) => id === song.id)) picks.push(song);
  draw(picks.findIndex(({ id }) => id === song.id));
  say(`${song.attributes?.name ?? "The song"} is in the crate.`);
}

byId("paste", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  const text = byId("tracklist", HTMLTextAreaElement).value;
  findTracklist(text).catch(showError);
};

/**
 * A description for each line written "Artist - Title", where the title may hold " - " too. Any other line is
 * left out.
 */
function parseTracklist(text: string): tTrackDescription[] {
  const descriptions: tTrackDescription[] = [];
  for (const line of text.split("\n")) {
    const [artistName = "", ...title] = line.split(" - ");
    if (title.length === 0) continue;
    descriptions.push({ artistName: artistName.trim(), name: title.join(" - ").trim() });
  }
  return descriptions;
}

// #region resolve
/**
 * Finds a pasted tracklist, one "Artist - Title" a line, in the catalog. No sign-in needed: it
 * asks the catalog only.
 */
async function findTracklist(text: string): Promise<void> {
  const descriptions = parseTracklist(text);
  const storefront = now.storefront;
  const { tracks, skipped } = await music.playlists.resolve(descriptions, {
    storefront,
    onProgress: ({ done, total = 0 }) => {
      say(`Finding songs: ${String(done)} of ${String(total)}.`);
    },
  });
  // Songs found in a storefront the page has left since have other ids than the ones it shows.
  if (now.storefront !== storefront) return;
  for (const song of tracks) pick(song);
  offerCandidates(skipped);
  say(`Found ${String(tracks.length)} of ${String(descriptions.length)} songs.`);
}

/**
 * A line with no exact match comes back with the songs its search found, best first: each is
 * offered with a button for the first three.
 */
function offerCandidates(skipped: readonly tSkippedTrack<tTrackDescription>[]): void {
  const take = (song: tSong) => {
    const title = song.attributes?.name ?? song.id;
    const artist = song.attributes?.artistName ?? "";
    return button(`Take ${title} by ${artist}`, () => { pick(song); });
  };
  const lines = skipped.map(({ track, candidates }) => {
    const notFound = `Not found: ${track.artistName ?? ""} - ${track.name ?? ""}. `;
    return h("li", {}, notFound, ...candidates.slice(0, 3).map(take));
  });
  unmatched.replaceChildren(h("ul", {}, ...lines));
}
// #endregion resolve

/** Your crate, drawn as the others are, with the sleeve at `at` in front. Its order is the playlist's. */
function draw(at = 0): void {
  byId("crate-count", HTMLSpanElement).textContent = String(picks.length);

  const move = (from: number, to: number, label: string) => () => {
    picks.splice(to, 0, ...picks.splice(from, 1));
    draw(to);
    focusAgain(label);
  };
  const takeOut = (index: number) => () => {
    picks.splice(index, 1);
    draw(index);
    focusAgain("Take out");
  };
  const sleeve = (song: tSong, index: number): tSleeve => ({
    artwork: song.attributes?.artwork,
    name: song.attributes?.name ?? song.id,
    by: song.attributes?.artistName,
    open: () => { playFrom(picks, song); },
    actions: () => [
      button("Play", () => { playFrom(picks, song); }),
      button("Move earlier", move(index, index - 1, "Move earlier"), { disabled: index === 0 }),
      button("Move later", move(index, index + 1, "Move later"), { disabled: index === picks.length - 1 }),
      button("Take out", takeOut(index)),
    ],
  });

  const empty = "Empty. Put songs in from Dig, or paste a tracklist below.";
  const yours = crate("Your crate", picks.map(sleeve), { at, empty });
  byId("picks", HTMLDivElement).replaceChildren(h("div", { className: "crates" }, yours));
  byId("send", HTMLFormElement).hidden = now.listener === undefined || picks.length === 0;
}

/** Focus back on the button just used, in the crate drawn again, so that a song can be moved on with the keyboard. */
function focusAgain(label: string): void {
  const box = byId("picks", HTMLDivElement);
  const buttons = [...box.querySelectorAll<HTMLButtonElement>(".actions button")];
  const same = buttons.find((each) => each.textContent === label && !each.disabled);
  // A song moved as far as it goes has that button disabled: the sleeve in front instead. Take out is
  // never disabled, so it is found again, unless the crate is empty and there is nothing to focus.
  const target = same ?? box.querySelector<HTMLElement>(".sleeve[tabindex='0']");
  target?.focus();
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

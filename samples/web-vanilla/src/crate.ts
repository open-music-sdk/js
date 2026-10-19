// Shows: playlists.resolve, playlists.read, playlists.plan, playlists.apply, listLibraryPlaylists.
// Guide: /guides/import-playlist
import type { tBrowserMusic, tPlaylistPlan, tSong, tTrackDescription } from "@open-music-sdk/browser";
import { byId, h } from "./dom";
import { say, showError } from "./errors";
import { music, now, onChange } from "./music";
import { playFrom } from "./player";

/** The songs picked so far, in order. Page state: a reload empties the crate. */
const picks: tSong[] = [];

export function pick(song: tSong): void {
  if (!picks.some(({ id }) => id === song.id)) picks.push(song);
  draw();
  say(`${song.attributes?.name ?? "The song"} is in the crate.`);
}

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
  const { tracks, skipped } = await music.playlists.resolve(descriptions, {
    storefront: now.storefront,
    onProgress: ({ done, total = 0 }) => { say(`Finding songs: ${String(done)} of ${String(total)}.`); },
  });
  for (const song of tracks) pick(song);
  // A line with no exact match comes back with the songs its search found, for the listener to choose from.
  const unmatched = skipped.map(({ track, candidates }) =>
    h("li", {}, `Not found: ${track.artistName ?? ""} - ${track.name ?? ""}. `, ...candidates.slice(0, 3).map((song) => h("button", { type: "button", textContent: `Take ${song.attributes?.name ?? song.id} by ${song.attributes?.artistName ?? ""}`, onclick: () => { pick(song); } }))),
  );
  byId("unmatched", HTMLDivElement).replaceChildren(h("ul", {}, ...unmatched));
  say(`Found ${String(tracks.length)} of ${String(descriptions.length)} songs.`);
}
// #endregion resolve

// #region plan
// Sending starts with a plan the listener sees before anything is written: Apple's API can add songs to the end of
// a playlist, but can neither take one out nor move one.
const dialog = byId("plan", HTMLDialogElement);
let pending: tPlaylistPlan | undefined;

byId("send", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  if (now.listener !== undefined) planFor(now.listener).catch(showError);
};

async function planFor(listener: tBrowserMusic): Promise<void> {
  const existing = new FormData(byId("send", HTMLFormElement)).get("to") === "existing";
  const name = byId("playlist-name", HTMLInputElement).value.trim() || "Crate Digger";
  // A new playlist is found again by its name and description, so the description carries the app's mark.
  const playlist = existing ? await listener.playlists.read(byId("playlist", HTMLSelectElement).value) : { name, description: "Made with Crate Digger" };
  pending = listener.playlists.plan(playlist, picks);
  const said = (text: string) => h("li", {}, text);
  byId("plan-summary", HTMLUListElement).replaceChildren(
    said(existing ? `Into "${playlist.name ?? ""}".` : `Into a playlist named "${name}", made unless you have one of that name made here.`),
    said(`${String(pending.append.length)} songs go on its end, and ${String(pending.tracks.length - pending.append.length)} are in it already.`),
    ...(pending.extra.length > 0 ? [said(`${String(pending.extra.length)} songs in it that are not in the crate stay, since none can be taken out.`)] : []),
    ...(pending.reordered ? [said("It will hold the songs in another order than the crate, since none can be moved.")] : []),
  );
  dialog.showModal();
}
// #endregion plan

// #region apply
dialog.onclose = () => {
  if (dialog.returnValue === "apply" && pending !== undefined && now.listener !== undefined) send(now.listener, pending).catch(showError);
};

async function send(listener: tBrowserMusic, plan: tPlaylistPlan): Promise<void> {
  const { created, appended, verified } = await listener.playlists.apply(plan, {
    onProgress: ({ done, total = 0 }) => { say(`Sending: ${String(done)} of ${String(total)} songs added.`); },
  });
  // Apple carries a write out after it answers; verified says whether it showed before apply returned.
  say(`${created ? "Made the playlist, and added" : "Added"} ${String(appended)} songs. ${verified ? "Apple shows them already." : "They can take a few seconds to show."}`);
}
// #endregion apply

// The listener's playlists they may add to, for the form. Another storefront has other ids, so the crate empties.
let pickedIn = now.storefront;
onChange(() => {
  if (now.storefront !== pickedIn && picks.length > 0) {
    picks.length = 0;
    say("The crate is empty again: songs have other ids in another storefront.");
  }
  pickedIn = now.storefront;
  draw();
  if (now.listener !== undefined) editable(now.listener).catch(showError);
});

async function editable(listener: tBrowserMusic): Promise<void> {
  const options: HTMLOptionElement[] = [];
  for await (const { id, attributes } of listener.user.listLibraryPlaylists({ limit: 100, maxPages: 1 })) {
    if (attributes?.canEdit === true) options.push(h("option", { value: id, textContent: attributes.name }));
  }
  byId("playlist", HTMLSelectElement).replaceChildren(...options);
}

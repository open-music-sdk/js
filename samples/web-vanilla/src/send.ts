// Shows: playlists.read, playlists.plan, playlists.apply, listLibraryPlaylists. Guide: /guides/import-playlist
import type { tBrowserMusic, tNewPlaylist, tPlaylistPlan, tPlaylistSnapshot } from "@open-music-sdk/browser";
import { picks } from "./crate";
import { byId, h } from "./dom";
import { say, showError } from "./errors";
import { now, onChange } from "./music";

const form = byId("send", HTMLFormElement);
const planButton = byId("plan-it", HTMLButtonElement);
const dialog = byId("plan", HTMLDialogElement);

/** The plan the dialog shows, until the listener closes it. */
let pending: tPlaylistPlan | undefined;

form.onsubmit = (event) => {
  event.preventDefault();
  if (now.listener !== undefined) planFor(now.listener).catch(showError);
};

// #region plan
// Sending starts with a plan the listener sees before anything is written: Apple's API can add
// songs to the end of a playlist, but can neither take one out nor move one.
async function planFor(listener: tBrowserMusic): Promise<void> {
  const { name, id } = chosenPlaylist();
  // A playlist that is there is read first, for the tracks it holds. A new one is found again by
  // its name and description, so the description carries the app's mark.
  const playlist = id !== undefined
    ? await listener.playlists.read(id)
    : { name, description: "Made with Vinyl Collector Simulator" };
  pending = listener.playlists.plan(playlist, picks);
  showPlan(describe(pending, playlist, name));
}

/** The plan in words: what goes on the playlist's end, and what stays as it is. */
function describe(
  plan: tPlaylistPlan,
  playlist: tPlaylistSnapshot | tNewPlaylist,
  name: string,
): string[] {
  const lines: string[] = [];
  if ("id" in playlist) {
    lines.push(`Into "${playlist.name ?? name}".`);
  } else {
    lines.push(`Into a new playlist named "${name}", unless you have one of that name made here.`);
  }
  const appended = String(plan.append.length);
  const already = String(plan.tracks.length - plan.append.length);
  lines.push(`${appended} songs go on its end, and ${already} are in it already.`);
  if (plan.extra.length > 0) {
    const extra = `${String(plan.extra.length)} songs in it that are not in the crate stay`;
    lines.push(`${extra}, since none can be taken out.`);
  }
  if (plan.reordered) {
    lines.push("It will hold the songs in another order than the crate, since none can be moved.");
  }
  return lines;
}
// #endregion plan

/** The playlist the form names: one of the listener's, by its id, or a new one, by its name. */
function chosenPlaylist(): { name: string; id: string | undefined } {
  const name = byId("playlist-name", HTMLInputElement).value.trim() || "Vinyl Collector Simulator";
  if (new FormData(form).get("to") === "existing") {
    return { name, id: byId("playlist", HTMLSelectElement).value };
  }
  // A playlist this page made is planned by its id, in case Apple does not list it yet.
  return { name, id: made.get(name) };
}

/** Shows the plan, in a dialog, before anything is sent. */
function showPlan(lines: readonly string[]): void {
  byId("plan-summary", HTMLUListElement).replaceChildren(...lines.map((line) => h("li", {}, line)));
  // Esc closes the dialog without a value of its own, so the value an earlier "Send it" left must not count.
  dialog.returnValue = "";
  dialog.showModal();
}

// #region apply
/**
 * The ids of the playlists this page made, by name. Apple lists a new playlist only seconds after
 * it is made, and a plan by its name before then would make a second one.
 */
const made = new Map<string, string>();

// The listener closed the dialog: with "Send it" the plan is applied, and with Cancel or Esc
// nothing is sent.
dialog.onclose = () => {
  const plan = pending;
  pending = undefined;
  const { listener } = now;
  if (dialog.returnValue !== "apply" || plan === undefined || listener === undefined) return;
  // One send at a time: a second, before Apple shows what the first wrote, would write it again.
  planButton.disabled = true;
  send(listener, plan)
    .catch(showError)
    .finally(() => {
      planButton.disabled = false;
    });
};

async function send(listener: tBrowserMusic, plan: tPlaylistPlan): Promise<void> {
  const { id, created, appended, verified } = await listener.playlists.apply(plan, {
    onProgress: ({ done, total = 0 }) => {
      say(`Sending: ${String(done)} of ${String(total)} songs added.`);
    },
  });
  // A playlist this page made is planned by its id from now on.
  if ("name" in plan.playlist) made.set(plan.playlist.name, id);
  // Apple carries a write out after it answers: verified says whether the write showed before
  // apply returned.
  const songs = `${String(appended)} songs`;
  const added = created ? `Made the playlist, and added ${songs}.` : `Added ${songs}.`;
  const shown = verified ? "Apple shows them already." : "They can take a few seconds to show.";
  say(`${added} ${shown}`);
}
// #endregion apply

// The listener's playlists they may add to, for the form.
onChange(() => {
  if (now.listener !== undefined) editable(now.listener).catch(showError);
});

async function editable(listener: tBrowserMusic): Promise<void> {
  const options: HTMLOptionElement[] = [];
  for await (const { id, attributes } of listener.user.listLibraryPlaylists({ limit: 100, maxPages: 1 })) {
    if (attributes?.canEdit === true) options.push(h("option", { value: id, textContent: attributes.name }));
  }
  // Drawn only for the listener they were asked for.
  if (now.listener === listener) byId("playlist", HTMLSelectElement).replaceChildren(...options);
}

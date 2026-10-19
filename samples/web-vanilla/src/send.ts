// Shows: playlists.read, playlists.plan, playlists.apply, listLibraryPlaylists. Guide: /guides/import-playlist
import type { tBrowserMusic, tPlaylistPlan } from "@open-music-sdk/browser";
import { picks } from "./crate";
import { byId, h } from "./dom";
import { say, showError } from "./errors";
import { now, onChange } from "./music";

const form = byId("send", HTMLFormElement);
const planButton = byId("plan-it", HTMLButtonElement);
const dialog = byId("plan", HTMLDialogElement);
let pending: tPlaylistPlan | undefined;
/** The playlists this page made, by name. Apple lists a new one seconds later, and a plan by name before then would make another. */
const made = new Map<string, string>();

// #region plan
// Sending starts with a plan the listener sees before anything is written: Apple's API can add songs to the end of
// a playlist, but can neither take one out nor move one.
form.onsubmit = (event) => {
  event.preventDefault();
  if (now.listener !== undefined) planFor(now.listener).catch(showError);
};

async function planFor(listener: tBrowserMusic): Promise<void> {
  const name = byId("playlist-name", HTMLInputElement).value.trim() || "Crate Digger";
  const id = new FormData(form).get("to") === "existing" ? byId("playlist", HTMLSelectElement).value : made.get(name);
  // A new playlist is found again by its name and description, so the description carries the app's mark.
  const playlist = id !== undefined ? await listener.playlists.read(id) : { name, description: "Made with Crate Digger" };
  pending = listener.playlists.plan(playlist, picks);
  const said = (text: string) => h("li", {}, text);
  byId("plan-summary", HTMLUListElement).replaceChildren(
    said("id" in playlist ? `Into "${playlist.name ?? name}".` : `Into a new playlist named "${name}", unless you have one of that name made here.`),
    said(`${String(pending.append.length)} songs go on its end, and ${String(pending.tracks.length - pending.append.length)} are in it already.`),
    ...(pending.extra.length > 0 ? [said(`${String(pending.extra.length)} songs in it that are not in the crate stay, since none can be taken out.`)] : []),
    ...(pending.reordered ? [said("It will hold the songs in another order than the crate, since none can be moved.")] : []),
  );
  // Esc closes the dialog without a value of its own, so the value an earlier "Send it" left must not count.
  dialog.returnValue = "";
  dialog.showModal();
}
// #endregion plan

// #region apply
dialog.onclose = () => {
  const plan = pending;
  pending = undefined;
  if (dialog.returnValue === "apply" && plan !== undefined && now.listener !== undefined) send(now.listener, plan).catch(showError);
};

async function send(listener: tBrowserMusic, plan: tPlaylistPlan): Promise<void> {
  // One send at a time: a second, before Apple shows what the first wrote, would write it again.
  planButton.disabled = true;
  try {
    const { id, created, appended, verified } = await listener.playlists.apply(plan, {
      onProgress: ({ done, total = 0 }) => {
        say(`Sending: ${String(done)} of ${String(total)} songs added.`);
      },
    });
    if ("name" in plan.playlist) made.set(plan.playlist.name, id);
    // Apple carries a write out after it answers; verified says whether it showed before apply returned.
    say(`${created ? "Made the playlist, and added" : "Added"} ${String(appended)} songs. ${verified ? "Apple shows them already." : "They can take a few seconds to show."}`);
  } finally {
    planButton.disabled = false;
  }
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
  if (now.listener === listener) byId("playlist", HTMLSelectElement).replaceChildren(...options);
}

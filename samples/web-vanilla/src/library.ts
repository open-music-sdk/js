// Shows: listHeavyRotation, listPersonalRecommendations, listRecentlyAdded, listLibraryPlaylists,
// getLibraryPlaylist, searchLibrary, and one list the server asks for. Guide: /guides/store-user-tokens
import type { tArtwork, tBrowserMusic, tLibraryPlaylist } from "@open-music-sdk/browser";
import { byId, h } from "./dom";
import { showError } from "./errors";
import { now, onChange } from "./music";
import { cover } from "./songs";

/** What every list of the listener's holds: albums, playlists, stations, each with a name and a cover. */
interface tCard {
  readonly id: string;
  readonly attributes?: { readonly name?: string | undefined; readonly artwork?: tArtwork | undefined } | undefined;
}

const view = byId("library-view", HTMLDivElement);
const found = h("div");

onChange(() => {
  document.querySelector<HTMLButtonElement>('nav button[value="library"]')?.toggleAttribute("hidden", now.listener === undefined);
  if (now.listener === undefined) view.replaceChildren();
  else draw(now.listener).catch(showError);
});

async function draw(listener: tBrowserMusic): Promise<void> {
  // #region lists
  // The first page of each list is enough here, so each walk stops after one.
  const heavy = await first(listener.user.listHeavyRotation({ limit: 10, maxPages: 1 }));
  const added = await first(listener.user.listRecentlyAdded({ limit: 10, maxPages: 1 }));
  const picked = await first(listener.user.listPersonalRecommendations({ limit: 3, maxPages: 1 }));
  // #endregion lists
  view.replaceChildren(
    found,
    ...(await fromTheServer()),
    h("h3", {}, "Heavy rotation"),
    cards(heavy),
    ...picked.flatMap((recommendation) => [h("h3", {}, recommendation.attributes?.title?.stringForDisplay ?? "Made for you"), cards(recommendation.relationships?.contents?.data ?? [])]),
    h("h3", {}, "Recently added"),
    cards(added),
    ...playlists(listener),
  );
}

// #region from-the-server
// One list the server asks for, with the token it kept for this listener when they signed in.
async function fromTheServer(): Promise<HTMLElement[]> {
  const title = h("h3", {}, "Recently played ", h("small", {}, "asked by the server"));
  const answer = await fetch("/api/me/recent");
  if (answer.status === 422) return [title, h("p", {}, "The server holds no working sign-in for you. Sign out, and in again.")];
  if (!answer.ok) throw new Error(`The server answered ${String(answer.status)} for what you played lately.`);
  return [title, cards((await answer.json()) as tCard[])];
}
// #endregion from-the-server

// #region playlists
/** The listener's playlists, 25 at a time. Each More asks Apple for the next page, and nothing is asked before. */
function playlists(listener: tBrowserMusic): HTMLElement[] {
  const walk = listener.user.listLibraryPlaylists({ limit: 25 })[Symbol.asyncIterator]();
  const list = h("ul", { className: "playlists" });
  const tracks = h("div");
  const more = h("button", { type: "button", textContent: "More playlists" });
  const next = async () => {
    for (let shown = 0; shown < 25; shown++) {
      const step = await walk.next();
      if (step.done === true) {
        more.hidden = true;
        return;
      }
      const playlist = step.value;
      list.append(h("li", {}, h("button", { type: "button", className: "link", textContent: playlist.attributes?.name ?? playlist.id, onclick: () => { open(listener, playlist, tracks).catch(showError); } })));
    }
  };
  more.onclick = () => { next().catch(showError); };
  next().catch(showError);
  return [h("h3", {}, "Your playlists"), list, more, tracks];
}

/** A playlist of the listener's, with its tracks. Songs in a library have no previews. */
async function open(listener: tBrowserMusic, { id }: tLibraryPlaylist, into: HTMLElement): Promise<void> {
  const playlist = await listener.user.getLibraryPlaylist(id, { include: ["tracks"] });
  const names = (playlist.relationships?.tracks?.data ?? []).map((track) => h("li", {}, `${track.attributes?.name ?? track.id}, ${track.attributes?.artistName ?? ""}`));
  into.replaceChildren(h("h3", {}, playlist.attributes?.name ?? id), h("ol", {}, ...names));
}
// #endregion playlists

// #region find
byId("library-search", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  const text = byId("library-term", HTMLInputElement).value.trim();
  if (now.listener !== undefined && text !== "") find(now.listener, text).catch(showError);
};

async function find(listener: tBrowserMusic, text: string): Promise<void> {
  const { results } = await listener.user.searchLibrary(text, { types: ["library-songs", "library-albums"], limit: 10 });
  const items = [...(results["library-songs"]?.data ?? []), ...(results["library-albums"]?.data ?? [])];
  found.replaceChildren(h("h3", {}, `In your library: "${text}"`), items.length === 0 ? h("p", {}, "Nothing. Apple's library search finds a song by the first word of its name more often than by the whole name.") : cards(items));
}
// #endregion find

async function first<T>(walk: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of walk) items.push(item);
  return items;
}

function cards(items: readonly tCard[]): HTMLElement {
  return h("div", { className: "shelf" }, ...items.map(({ id, attributes }) => h("figure", { className: "tile" }, cover(attributes?.artwork, 120), h("figcaption", {}, attributes?.name ?? id))));
}

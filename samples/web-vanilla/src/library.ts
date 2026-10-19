// Shows: listHeavyRotation, listPersonalRecommendations, listRecentlyAdded, listLibraryPlaylists,
// getLibraryPlaylist, searchLibrary, and one list the server asks for. Guide: /guides/store-user-tokens
import type { tArtwork, tBrowserMusic, tLibraryPlaylist } from "@open-music-sdk/browser";
import { crate } from "./box";
import { byId, h } from "./dom";
import { fromServer, showError } from "./errors";
import { now, onChange } from "./music";
import type { tSleeve } from "./sleeve";

/** What every list of the listener's holds: albums, playlists, stations, each with a name and a cover. */
interface tCard {
  readonly id: string;
  readonly attributes?: tCardAttributes | undefined;
}

interface tCardAttributes {
  readonly name?: string | undefined;
  readonly artistName?: string | undefined;
  readonly artwork?: tArtwork | undefined;
}

const view = byId("library-view", HTMLDivElement);
const found = h("div");
const tracks = h("div");

onChange(() => {
  const libraryTab = document.querySelector<HTMLButtonElement>('nav button[value="library"]');
  libraryTab?.toggleAttribute("hidden", now.listener === undefined);
  found.replaceChildren();
  tracks.replaceChildren();
  view.replaceChildren();
  if (now.listener !== undefined) {
    draw(now.listener).catch(showError);
  } else if (!byId("library", HTMLElement).hidden) {
    // Signed out with the Library open: back to Dig, since nothing of a listener's is left to show.
    document.querySelector<HTMLButtonElement>('nav button[value="dig"]')?.click();
  }
});

async function draw(listener: tBrowserMusic): Promise<void> {
  // The first page of each list is enough here, so each walk stops after one.
  const heavyRotation = await first(listener.user.listHeavyRotation({ limit: 10, maxPages: 1 }));
  const recentlyAdded = await first(listener.user.listRecentlyAdded({ limit: 10, maxPages: 1 }));
  const recommendations = await first(listener.user.listPersonalRecommendations({ limit: 3, maxPages: 1 }));
  const recentlyPlayed = await fromTheServer();
  // Drawn only for the listener it was asked for: one who signed out while it loaded is shown nothing of it.
  if (now.listener !== listener) return;

  const recommended = recommendations.map((recommendation) => {
    const title = recommendation.attributes?.title?.stringForDisplay ?? "Made for you";
    return crate(title, cards(recommendation.relationships?.contents?.data ?? []));
  });
  const crates = h(
    "div",
    { className: "crates" },
    recentlyPlayed,
    crate("Heavy rotation", cards(heavyRotation)),
    ...recommended,
    crate("Recently added", cards(recentlyAdded)),
    yourPlaylists(listener),
  );
  view.replaceChildren(found, crates, tracks);
}

// One list the server asks for, with the token it kept for this listener when they signed in.
async function fromTheServer(): Promise<HTMLElement> {
  const label = "Recently played, asked by the server";
  const answer = await fetch("/api/me/recent");
  // A list that cannot be had says why in its own crate, and the rest of the Library is drawn all the same.
  if (!answer.ok) return crate(label, [], { empty: fromServer(answer.status) });
  const items = (await answer.json()) as tCard[];
  return crate(label, cards(items));
}

/** The listener's playlists, 25 at a time: flipping near the back of the crate asks Apple for the next page. */
function yourPlaylists(listener: tBrowserMusic): HTMLElement {
  const walk = listener.user.listLibraryPlaylists({ limit: 25 })[Symbol.asyncIterator]();

  async function nextPage(): Promise<tSleeve[]> {
    const page: tSleeve[] = [];
    while (page.length < 25) {
      const step = await walk.next();
      if (step.done === true) break;
      const playlist = step.value;
      page.push({
        artwork: playlist.attributes?.artwork,
        name: playlist.attributes?.name ?? playlist.id,
        open: () => { open(listener, playlist).catch(showError); },
      });
    }
    return page;
  }

  return crate("Your playlists", [], { more: nextPage, empty: "No playlists in your library." });
}

/** A playlist of the listener's, with its tracks, under the crates. Songs in a library have no previews. */
async function open(listener: tBrowserMusic, { id }: tLibraryPlaylist): Promise<void> {
  const playlist = await listener.user.getLibraryPlaylist(id, { include: ["tracks"] });
  const rows = (playlist.relationships?.tracks?.data ?? []).map((track) => {
    const title = track.attributes?.name ?? track.id;
    const artist = track.attributes?.artistName ?? "";
    return h("li", {}, h("span", { className: "name" }, title, h("small", {}, artist)));
  });
  if (now.listener !== listener) return;
  tracks.replaceChildren(h("h2", {}, playlist.attributes?.name ?? id), h("ol", { className: "tracklist" }, ...rows));
}

byId("library-search", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  const text = byId("library-term", HTMLInputElement).value.trim();
  if (now.listener !== undefined && text !== "") find(now.listener, text).catch(showError);
};

async function find(listener: tBrowserMusic, text: string): Promise<void> {
  const { results } = await listener.user.searchLibrary(text, {
    types: ["library-songs", "library-albums"],
    limit: 10,
  });
  const items = [...(results["library-songs"]?.data ?? []), ...(results["library-albums"]?.data ?? [])];
  if (now.listener !== listener) return;
  const nothing = "Nothing. Apple's library search finds a song by the first word of its name "
    + "more often than by the whole name.";
  const inLibrary = crate(`In your library: "${text}"`, cards(items), { empty: nothing });
  found.replaceChildren(h("div", { className: "crates" }, inLibrary));
}

/** Every item of a walk, which here is one page of it. */
async function first<T>(walk: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of walk) items.push(item);
  return items;
}

function cards(items: readonly tCard[]): tSleeve[] {
  return items.map(({ id, attributes }) => ({
    artwork: attributes?.artwork,
    name: attributes?.name ?? id,
    by: attributes?.artistName,
  }));
}

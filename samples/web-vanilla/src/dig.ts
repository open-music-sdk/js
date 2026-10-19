// Shows: getCharts, listGenres, searchCatalog, getSearchHints, listStorefronts.
import { crate, later, type tSleeve } from "./box";
import { byId, h } from "./dom";
import { showError } from "./errors";
import { change, music, now, onChange } from "./music";
import { sleeves } from "./pages";
import { songCrate } from "./songs";
import { drawFloor, drawPage, go, route } from "./view";

// The floor, before anyone searches: the storefront's top charts, then a crate for each genre the charts are kept by.
async function theFloor(): Promise<HTMLElement[]> {
  const { storefront } = now;
  const { results } = await music.catalog.getCharts({ types: ["songs", "albums", "playlists"], limit: 20, storefront });
  const [songs, albums, playlists] = [results.songs[0], results.albums[0], results.playlists[0]];
  const genres: HTMLElement[] = [];
  for await (const { id, attributes } of music.catalog.listGenres({ storefront })) {
    // Every genre but Music, the one the others belong to.
    if (attributes?.parentId !== undefined) genres.push(later(attributes.name, () => genreCrate(id)));
  }
  return [
    h("h2", {}, "Top charts"),
    h("div", { className: "crates" }, await songCrate(songs?.name ?? "Top songs", songs?.data ?? []), crate(albums?.name ?? "Top albums", sleeves(albums?.data ?? [])), crate(playlists?.name ?? "Top playlists", sleeves(playlists?.data ?? []))),
    h("h2", {}, "Genres"),
    h("div", { className: "crates" }, ...genres),
  ];
}

/** A genre's crate: the albums of its chart. */
async function genreCrate(genre: string): Promise<tSleeve[]> {
  const { results } = await music.catalog.getCharts({ types: ["albums"], genre, limit: 20, storefront: now.storefront });
  return sleeves(results.albums[0]?.data ?? []);
}

const term = byId("term", HTMLInputElement);

byId("search", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  const text = term.value.trim();
  if (text === "") location.hash = "";
  else go("search", text);
};

route("search", async (text) => {
  term.value = text;
  const { results } = await music.catalog.searchCatalog(text, { types: ["songs", "albums", "artists", "playlists"], limit: 20, storefront: now.storefront });
  const { songs, albums, artists, playlists } = results;
  return [
    h("h2", {}, `Results for "${text}"`),
    h("div", { className: "crates" }, await songCrate("Songs", songs?.data ?? []), crate("Albums", sleeves(albums?.data ?? [])), crate("Artists", sleeves(artists?.data ?? [])), crate("Playlists", sleeves(playlists?.data ?? []))),
  ];
});

// Offered as the listener types, once typing pauses rather than on every key.
let typing: ReturnType<typeof setTimeout> | undefined;
term.oninput = () => {
  clearTimeout(typing);
  const text = term.value.trim();
  if (text !== "") typing = setTimeout(() => { hints(text).catch(showError); }, 250);
};

async function hints(text: string): Promise<void> {
  const { results } = await music.catalog.getSearchHints(text, { storefront: now.storefront });
  byId("hints", HTMLDataListElement).replaceChildren(...results.terms.map((value) => h("option", { value })));
}

// Signed out, the listener picks the storefront. Signed in, it is their own, from Apple, and the picker goes.
const picker = byId("storefront", HTMLSelectElement);
async function storefronts(): Promise<void> {
  const options: HTMLOptionElement[] = [];
  for await (const { id, attributes } of music.catalog.listStorefronts()) options.push(h("option", { value: id, textContent: attributes?.name ?? id }));
  picker.replaceChildren(...options.sort((a, b) => a.text.localeCompare(b.text)));
  picker.value = now.storefront;
}
picker.onchange = () => {
  change({ storefront: picker.value });
};

// Signing in or out, or another storefront, draws the floor and the open page again. A page a returning listener
// reloads opens in their storefront; an id another storefront does not sell is a 404, which the page says.
onChange(() => {
  byId("storefront-picker", HTMLLabelElement).hidden = now.listener !== undefined;
  picker.value = now.storefront;
  drawFloor(theFloor);
  drawPage();
});

storefronts().catch(showError);
drawFloor(theFloor);
drawPage();

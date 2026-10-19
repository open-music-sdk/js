// Shows: searchCatalog, getSearchHints, getCharts, listStorefronts. Guide: /guides/artwork
import type { tAlbum, tArtist, tMusicVideo, tPlaylist, tSong } from "@open-music-sdk/browser";
import { byId, h } from "./dom";
import { showError } from "./errors";
import { change, music, now, onChange } from "./music";
import { openAlbum, openArtist, openPlaylist } from "./pages";
import { songRows } from "./songs";
import { current, shelf, show } from "./view";

const term = byId("term", HTMLInputElement);

// #region search
byId("search", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  const text = term.value.trim();
  show(text === "" ? charts : () => search(text));
};

async function search(text: string): Promise<HTMLElement[]> {
  const { results } = await music.catalog.searchCatalog(text, { types: ["songs", "albums", "artists", "playlists"], limit: 10, storefront: now.storefront });
  return found(`Results for "${text}"`, results.songs?.data, results.albums?.data, results.artists?.data, results.playlists?.data);
}
// #endregion search

// #region hints
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
// #endregion hints

// #region charts
// What the page shows before anyone searches: the first chart of each type in the storefront.
async function charts(): Promise<HTMLElement[]> {
  const { results } = await music.catalog.getCharts({ types: ["songs", "albums", "playlists"], limit: 10, storefront: now.storefront });
  return found("Top charts", results.songs[0]?.data, results.albums[0]?.data, [], results.playlists[0]?.data);
}
// #endregion charts

/** What a search or the charts found, each type under its own heading. */
async function found(title: string, songs: readonly (tSong | tMusicVideo)[] = [], albums: readonly tAlbum[] = [], artists: readonly tArtist[] = [], playlists: readonly tPlaylist[] = []): Promise<HTMLElement[]> {
  return [
    h("h2", {}, title),
    ...(songs.length > 0 ? [h("h3", {}, "Songs"), await songRows(songs)] : []),
    ...shelf("Albums", albums, openAlbum),
    ...shelf("Artists", artists, openArtist),
    ...shelf("Playlists", playlists, openPlaylist),
  ];
}

// #region storefronts
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
// #endregion storefronts

// Another storefront has other ids, so the view starts again from its charts. Signing in or out redraws it.
let shownIn = now.storefront;
onChange(() => {
  byId("storefront-picker", HTMLLabelElement).hidden = now.listener !== undefined;
  picker.value = now.storefront;
  const sameStorefront = now.storefront === shownIn;
  shownIn = now.storefront;
  show(sameStorefront ? current : charts);
});

storefronts().catch(showError);
show(charts);

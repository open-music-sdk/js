// Shows: getCharts, listGenres, listStorefronts.
import { crate } from "./box";
import { byId, h } from "./dom";
import { showError } from "./errors";
import { change, music, now, onChange } from "./music";
import { sleeves } from "./pages";
import type { tSleeve } from "./sleeve";
import { songCrate } from "./songs";
import { drawFloor, drawPage } from "./view";

// The floor, before anyone searches: the storefront's top charts, then a crate
// for each genre the charts are kept by.
async function theFloor(): Promise<HTMLElement[]> {
  const { storefront } = now;
  const { results } = await music.catalog.getCharts({
    types: ["songs", "albums", "playlists"],
    limit: 20,
    storefront,
  });
  // Each type has a list of charts; the first is the storefront's most played.
  // Its name is the crate's label.
  const songs = results.songs[0];
  const albums = results.albums[0];
  const playlists = results.playlists[0];
  const charts = h(
    "div",
    { className: "crates" },
    await songCrate(songs?.name ?? "Top songs", songs?.data ?? []),
    crate(albums?.name ?? "Top albums", sleeves(albums?.data ?? [])),
    crate(playlists?.name ?? "Top playlists", sleeves(playlists?.data ?? [])),
  );
  const genres = h(
    "div",
    { className: "crates" },
    ...(await genreCrates(storefront)),
  );
  return [h("h2", {}, "Top charts"), charts, h("h2", {}, "Genres"), genres];
}

/**
 * A crate for each genre but Music, the one the others belong to. If Apple
 * won't list them, the charts still show.
 */
async function genreCrates(storefront: string): Promise<HTMLElement[]> {
  const crates: HTMLElement[] = [];
  try {
    const genres = music.catalog.listGenres({ storefront });
    for await (const { id, attributes } of genres) {
      if (attributes?.parentId === undefined) continue;
      const fill = () => genreAlbums(id, storefront);
      crates.push(fillWhenSeen(attributes.name, fill));
    }
  } catch (e) {
    showError(e);
  }
  return crates;
}

/**
 * The albums of a genre's chart, in the floor's storefront, even if another is
 * current by the time it scrolls in.
 */
async function genreAlbums(
  genre: string,
  storefront: string,
): Promise<tSleeve[]> {
  const { results } = await music.catalog.getCharts({
    types: ["albums"],
    genre,
    limit: 20,
    storefront,
  });
  return sleeves(results.albums[0]?.data ?? []);
}

/**
 * A crate filled once it scrolls into view, so a floor of them asks Apple only
 * for the ones the listener reaches.
 */
function fillWhenSeen(
  label: string,
  fill: () => Promise<readonly tSleeve[]>,
): HTMLElement {
  const waiting = crate(label, [], { empty: "Not looked through yet." });
  const filled = (sleeves: readonly tSleeve[]) => {
    waiting.replaceWith(crate(label, sleeves));
  };
  const watcher = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting !== true) return;
      watcher.disconnect();
      fill().then(filled, showError);
    },
    // Filled a little before it comes into view.
    { rootMargin: "200px" },
  );
  watcher.observe(waiting);
  return waiting;
}

// Signed out, the listener picks the storefront. Signed in, it is their own,
// from Apple, and the picker goes.
const picker = byId("storefront", HTMLSelectElement);

async function fillPicker(): Promise<void> {
  const options: HTMLOptionElement[] = [];
  for await (const { id, attributes } of music.catalog.listStorefronts()) {
    const name = attributes?.name ?? id;
    options.push(h("option", { value: id, textContent: name }));
  }
  options.sort((a, b) => a.text.localeCompare(b.text));
  picker.replaceChildren(...options);
  picker.value = now.storefront;
}

picker.onchange = () => {
  change({ storefront: picker.value });
};

// Signing in or out, or another storefront, draws the floor and the open page
// again. A page a returning listener reloads opens in their storefront; an id
// another storefront does not sell is a 404, which the page says.
onChange(() => {
  const signedIn = now.listener !== undefined;
  byId("storefront-picker", HTMLLabelElement).hidden = signedIn;
  picker.value = now.storefront;
  drawFloor(theFloor);
  drawPage();
});

fillPicker().catch(showError);
drawFloor(theFloor);

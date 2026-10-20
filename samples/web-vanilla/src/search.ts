// Shows: searchCatalog, getSearchHints.
import { crate } from "./box";
import { byId, h } from "./dom";
import { showError } from "./errors";
import { music, now } from "./music";
import { sleeves } from "./pages";
import { songCrate } from "./songs";
import { go, route } from "./view";

const term = byId("term", HTMLInputElement);

// A search is a page of its own, `#search/<term>`, so Back goes back to the
// crates.
byId("search", HTMLFormElement).onsubmit = (event) => {
  event.preventDefault();
  const text = term.value.trim();
  if (text === "") location.hash = "";
  else go("search", text);
};

route("search", async (text) => {
  term.value = text;
  const { results } = await music.catalog.searchCatalog(text, {
    types: ["songs", "albums", "artists", "playlists"],
    limit: 20,
    storefront: now.storefront,
  });
  const { songs, albums, artists, playlists } = results;
  const crates = h(
    "div",
    { className: "crates" },
    await songCrate("Songs", songs?.data ?? []),
    crate("Albums", sleeves(albums?.data ?? [])),
    crate("Artists", sleeves(artists?.data ?? [])),
    crate("Playlists", sleeves(playlists?.data ?? [])),
  );
  return [h("h2", {}, `Results for "${text}"`), crates];
});

// Terms offered as the listener types, once typing pauses rather than on every
// key.
let typing: ReturnType<typeof setTimeout> | undefined;
term.oninput = () => {
  clearTimeout(typing);
  const text = term.value.trim();
  if (text === "") return;
  typing = setTimeout(() => {
    hints(text).catch(showError);
  }, 250);
};

async function hints(text: string): Promise<void> {
  const { results } = await music.catalog.getSearchHints(text, {
    storefront: now.storefront,
  });
  const options = results.terms.map((value) => h("option", { value }));
  byId("hints", HTMLDataListElement).replaceChildren(...options);
}

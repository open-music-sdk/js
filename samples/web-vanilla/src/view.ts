// Where the Dig screen draws, and the shelf of covers its results and pages share. Nothing here asks Apple.
import type { tAlbum, tArtist, tPlaylist } from "@open-music-sdk/browser";
import { byId, h } from "./dom";
import { showError } from "./errors";
import { cover } from "./songs";

const view = byId("dig-view", HTMLDivElement);

/** What the view shows: a step that asks Apple and gives back what to draw. Drawn again when someone signs in or out. */
export let current: () => Promise<HTMLElement[]> = () => Promise.resolve([]);

export function show(step: () => Promise<HTMLElement[]>): void {
  current = step;
  step().then((elements) => {
    view.replaceChildren(...elements);
  }, showError);
}

/** A heading and a row of covers, each opening its page. Nothing when there are none. */
export function shelf<T extends tAlbum | tArtist | tPlaylist>(title: string, items: readonly T[], open: (item: T) => Promise<HTMLElement[]>): HTMLElement[] {
  if (items.length === 0) return [];
  const tile = (item: T) =>
    h("button", { type: "button", className: "tile", onclick: () => { show(() => open(item)); } }, cover(item.attributes?.artwork, 120), h("span", {}, item.attributes?.name ?? item.id));
  return [h("h3", {}, title), h("div", { className: "shelf" }, ...items.map(tile))];
}

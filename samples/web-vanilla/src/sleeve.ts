// One record in a crate: what it holds, how it is drawn, and where it stands.
// Nothing here asks Apple.
import type { tArtwork } from "@open-music-sdk/browser";
import { cover } from "./artwork";
import { h } from "./dom";

/**
 * A record: its cover and names, what pulling it out does, and what can be done
 * with it while it is in front.
 */
export interface tSleeve {
  readonly artwork: tArtwork | undefined;
  readonly name: string;
  readonly by?: string | undefined;
  readonly open?: (() => void) | undefined;
  readonly actions?: (() => HTMLElement[]) | undefined;
}

/** How many sleeves stand behind the one in front with their tops showing. */
const BEHIND = 5;

/**
 * A sleeve's button: its cover, or, for a record with no artwork, a plain
 * sleeve with its name written on.
 */
export function sleeveButton(
  sleeve: tSleeve,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const { name, by, artwork } = sleeve;
  const label = by === undefined ? name : `${name}, ${by}`;
  const face = artwork === undefined ? h("span", {}, name) : lazyCover(artwork);
  const button = h(
    "button",
    { type: "button", className: "sleeve", ariaLabel: label },
    face,
  );
  button.onclick = onClick;
  return button;
}

function lazyCover(artwork: tArtwork): HTMLImageElement {
  const image = cover(artwork, 240);
  image.loading = "lazy";
  return image;
}

/**
 * Stands a sleeve `d` places from the front: behind it when `d` is positive,
 * flipped past when it is negative. The stylesheet draws each place, from
 * `data-pos` and `--d`.
 */
export function place(button: HTMLButtonElement, d: number): void {
  button.style.setProperty("--d", String(d));
  if (d < 0) button.dataset.pos = "past";
  else if (d === 0) button.dataset.pos = "front";
  else if (d <= BEHIND) button.dataset.pos = "behind";
  else button.dataset.pos = "far";
  // Only the sleeve in front is in the Tab order, and only it and the ones
  // whose edges show can be clicked.
  button.tabIndex = d === 0 ? 0 : -1;
  button.inert = d < 0 || d > BEHIND;
}

// Shows: artworkImage. Guide: /guides/artwork. The rest is the crate every list is drawn as, and asks Apple nothing.
import { artworkImage, type tArtwork } from "@open-music-sdk/browser";
import { h } from "./dom";
import { showError } from "./errors";

// #region artwork
/** An `<img>` for an artwork shown `size` CSS pixels wide, with a `srcset` for screens of higher density. */
export function cover(artwork: tArtwork | undefined, size: number): HTMLImageElement {
  if (artwork === undefined) return h("img", { alt: "", width: size, height: size });
  return h("img", { alt: "", ...artworkImage(artwork, size) });
}
// #endregion artwork

/** One record in a crate: its cover and names, what pulling it out does, and what can be done with it in front. */
export interface tSleeve {
  readonly artwork: tArtwork | undefined;
  readonly name: string;
  readonly by?: string | undefined;
  readonly open?: (() => void) | undefined;
  readonly actions?: (() => HTMLElement[]) | undefined;
}

interface tCrateOptions {
  /** Which sleeve is in front to begin with. */
  readonly at?: number;
  /** The next sleeves, asked for as the listener nears the back of the crate. None means there are no more. */
  readonly more?: () => Promise<tSleeve[]>;
  /** What the crate says while it is empty. */
  readonly empty?: string;
}

/** How many sleeves stand behind the one in front with their top edges showing. */
const BEHIND = 5;

/** A labelled crate of sleeves, flipped through with its buttons, the arrow keys, a swipe, or a click on an edge. */
export function crate(label: string, sleeves: readonly tSleeve[], { at = 0, more, empty = "Nothing in this one." }: tCrateOptions = {}): HTMLElement {
  const all: tSleeve[] = [];
  const shown: HTMLButtonElement[] = [];
  const note = h("p", { className: "empty", textContent: empty });
  const bin = h("div", { className: "bin" }, note);
  const previous = h("button", { type: "button", textContent: "‹", ariaLabel: "Previous record", onclick: () => { flip(front - 1); } });
  const next = h("button", { type: "button", textContent: "›", ariaLabel: "Next record", onclick: () => { flip(front + 1); } });
  const count = h("output");
  const caption = h("div", { className: "caption", ariaLive: "polite" });
  let front = 0;
  let asking = false;
  let swiped = false;

  const add = (added: readonly tSleeve[]) => {
    for (const sleeve of added) {
      const index = all.push(sleeve) - 1;
      // A record with no artwork is a plain sleeve with its name written on.
      const art = sleeve.artwork === undefined ? h("span", {}, sleeve.name) : Object.assign(cover(sleeve.artwork, 240), { loading: "lazy" as const });
      const named = sleeve.by === undefined ? sleeve.name : `${sleeve.name}, ${sleeve.by}`;
      shown.push(bin.appendChild(h("button", { type: "button", className: "sleeve", ariaLabel: named, onclick: () => { pull(index); } }, art)));
    }
  };

  // In front, a click pulls the sleeve out; behind, it flips forward to it. A swipe that flipped is no click.
  const pull = (at: number) => {
    if (swiped) return;
    if (at === front) all[at]?.open?.();
    else flip(at);
  };

  const flip = (to: number) => {
    const focused = bin.contains(document.activeElement);
    front = Math.max(0, Math.min(to, all.length - 1));
    shown.forEach((sleeve, at) => {
      const d = at - front;
      sleeve.style.setProperty("--d", String(d));
      sleeve.style.zIndex = String(100 - d);
      sleeve.dataset.pos = d < 0 ? "past" : d === 0 ? "front" : d <= BEHIND ? "behind" : "far";
      sleeve.tabIndex = d === 0 ? 0 : -1;
      sleeve.inert = d < 0 || d > BEHIND;
    });
    if (focused) shown[front]?.focus({ preventScroll: true });
    const sleeve = all[front];
    note.hidden = sleeve !== undefined;
    count.value = all.length === 0 ? "" : `${String(front + 1)} / ${String(all.length)}`;
    previous.disabled = front === 0;
    next.disabled = front >= all.length - 1;
    caption.replaceChildren(...(sleeve === undefined ? [] : [h("strong", {}, sleeve.name), h("small", {}, sleeve.by ?? ""), h("div", { className: "actions" }, ...(sleeve.actions?.() ?? []))]));
    if (more !== undefined && !asking && front >= all.length - 3) {
      asking = true;
      more().then((added) => {
        add(added);
        asking = added.length === 0;
        flip(front);
      }, showError);
    }
  };

  let from: number | undefined;
  bin.onpointerdown = (event) => {
    from = event.clientX;
    swiped = false;
  };
  bin.onpointermove = (event) => {
    if (from === undefined || Math.abs(event.clientX - from) < 40) return;
    flip(front + (event.clientX < from ? 1 : -1));
    from = event.clientX;
    swiped = true;
  };
  const done = () => {
    from = undefined;
  };
  bin.onpointerup = done;
  bin.onpointercancel = done;
  bin.onpointerleave = done;

  const keys = new Map([["ArrowLeft", () => front - 1], ["ArrowUp", () => front - 1], ["ArrowRight", () => front + 1], ["ArrowDown", () => front + 1], ["Home", () => 0], ["End", () => all.length - 1]]);
  const onkeydown = (event: KeyboardEvent) => {
    const to = keys.get(event.key);
    if (to === undefined) return;
    event.preventDefault();
    flip(to());
  };

  add(sleeves);
  flip(at);
  return h("section", { className: "crate", onkeydown }, bin, h("div", { className: "wall" }, h("h3", {}, label)), h("div", { className: "flip" }, previous, count, next), caption);
}

/** A crate filled once it scrolls into view, so a floor of them asks Apple only for the ones the listener reaches. */
export function later(label: string, fill: () => Promise<readonly tSleeve[]>): HTMLElement {
  const waiting = crate(label, [], { empty: "Not looked through yet." });
  const seen = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting !== true) return;
    seen.disconnect();
    fill().then((sleeves) => { waiting.replaceWith(crate(label, sleeves)); }, showError);
  }, { rootMargin: "200px" });
  seen.observe(waiting);
  return waiting;
}

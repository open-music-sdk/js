// The crate every list is drawn as: sleeves standing in a box, flipped through one at a time. Nothing here asks Apple.
import { button, h } from "./dom";
import { explain, showError } from "./errors";
import { place, sleeveButton, type tSleeve } from "./sleeve";

interface tCrateOptions {
  /** Which sleeve is in front to begin with. */
  readonly at?: number;
  /** Gives the next sleeves, asked for as the listener nears the back of the crate. None means there are no more. */
  readonly more?: () => Promise<tSleeve[]>;
  /** What the crate says when it is empty, once it has asked for more if it can. */
  readonly empty?: string;
}

/** How far a swipe goes, in CSS pixels, to flip one sleeve. */
const SWIPE = 40;

/** A labelled crate of sleeves, flipped through with its buttons, the arrow keys, a swipe, or a click on an edge. */
export function crate(label: string, sleeves: readonly tSleeve[], options: tCrateOptions = {}): HTMLElement {
  const { at = 0, more, empty = "Nothing in this one." } = options;
  const all: tSleeve[] = [];
  const buttons: HTMLButtonElement[] = [];
  let front = 0;
  let inFront: tSleeve | undefined;
  let asking = false;
  let swiped = false;

  const note = h("p", { className: "empty", textContent: empty });
  const bin = h("div", { className: "bin" }, note);
  const previous = button("‹", () => { flip(front - 1); }, { ariaLabel: "Previous record" });
  const next = button("›", () => { flip(front + 1); }, { ariaLabel: "Next record" });
  const count = h("span");
  // What a screen reader says on a flip: the name and the artist, once for each record that comes to the front.
  const said = h("div", { className: "said", ariaLive: "polite" });
  const actions = h("div", { className: "actions" });

  function add(added: readonly tSleeve[]): void {
    for (const sleeve of added) {
      const index = all.push(sleeve) - 1;
      const drawn = sleeveButton(sleeve, (event) => { pull(index, event); });
      bin.append(drawn);
      buttons.push(drawn);
    }
  }

  // In front, a click pulls the sleeve out; behind, it flips forward to that sleeve. The click that ends a swipe is
  // not a click on a sleeve, though Enter afterwards is: a click from a key has no `detail`.
  function pull(index: number, event: MouseEvent): void {
    if (swiped && event.detail > 0) return;
    if (index === front) all[index]?.open?.();
    else flip(index);
  }

  function flip(to: number): void {
    const hadFocus = bin.contains(document.activeElement) || actions.contains(document.activeElement);
    front = Math.max(0, Math.min(to, all.length - 1));
    buttons.forEach((drawn, index) => { place(drawn, index - front); });

    const sleeve = all[front];
    note.hidden = sleeve !== undefined;
    count.textContent = all.length === 0 ? "" : `${String(front + 1)} / ${String(all.length)}`;
    previous.disabled = front === 0;
    next.disabled = front >= all.length - 1;
    if (sleeve !== inFront) showInFront(sleeve);

    // Focus on a sleeve, or on an action of the record that left the front, goes to the sleeve in front: the
    // arrow keys keep flipping, and Tab reaches its actions.
    if (hadFocus && !actions.contains(document.activeElement)) buttons[front]?.focus({ preventScroll: true });
    if (more !== undefined && !asking && front >= all.length - 3) askForMore(more);
  }

  function showInFront(sleeve: tSleeve | undefined): void {
    inFront = sleeve;
    if (sleeve === undefined) {
      said.replaceChildren();
      actions.replaceChildren();
      return;
    }
    said.replaceChildren(h("strong", {}, sleeve.name), h("small", {}, sleeve.by ?? ""));
    actions.replaceChildren(...(sleeve.actions?.() ?? []));
  }

  // An empty answer means there are no more, and a failure is said in the crate: neither is asked again.
  function askForMore(ask: () => Promise<tSleeve[]>): void {
    asking = true;
    note.textContent = "Looking…";
    ask().then(
      (added) => {
        note.textContent = empty;
        add(added);
        asking = added.length === 0;
        flip(front);
      },
      (e: unknown) => {
        note.textContent = explain(e);
        showError(e);
      },
    );
  }

  // A swipe across the sleeves flips one for each SWIPE pixels it goes: to the left for the next, to the right back.
  let swipeFrom: number | undefined;
  bin.onpointerdown = (event) => {
    swipeFrom = event.clientX;
    swiped = false;
  };
  bin.onpointermove = (event) => {
    if (swipeFrom === undefined || Math.abs(event.clientX - swipeFrom) < SWIPE) return;
    flip(event.clientX < swipeFrom ? front + 1 : front - 1);
    swipeFrom = event.clientX;
    swiped = true;
  };
  for (const end of ["pointerup", "pointercancel", "pointerleave"] as const) {
    bin.addEventListener(end, () => { swipeFrom = undefined; });
  }

  // Left and right only: up and down still scroll the page.
  function keyTarget(key: string): number | undefined {
    switch (key) {
      case "ArrowLeft":
        return front - 1;
      case "ArrowRight":
        return front + 1;
      case "Home":
        return 0;
      case "End":
        return all.length - 1;
      default:
        return undefined;
    }
  }
  const onkeydown = (event: KeyboardEvent) => {
    const to = keyTarget(event.key);
    if (to === undefined) return;
    event.preventDefault();
    flip(to);
  };

  add(sleeves);
  flip(at);
  return h(
    "div",
    { className: "crate", role: "group", ariaLabel: label, ariaRoleDescription: "crate", onkeydown },
    bin,
    h("div", { className: "wall" }, h("h3", {}, label)),
    h("div", { className: "flip" }, previous, count, next),
    h("div", { className: "caption" }, said, actions),
  );
}

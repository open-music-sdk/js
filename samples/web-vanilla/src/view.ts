// Where the Dig screen draws: the floor of crates, and a page pulled out of one, opened over the floor as a step the
// browser's Back goes back from. Nothing here asks Apple.
import { byId, h } from "./dom";
import { showError } from "./errors";

type tStep = () => Promise<HTMLElement[]>;

const floor = byId("floor", HTMLDivElement);
const page = byId("page", HTMLDivElement);
/** The pages a sleeve can open, by kind: `#albums/1440857781` draws `routes.get("albums")` with that id. */
const routes = new Map<string, (id: string) => Promise<HTMLElement[]>>();
let floorTurns = 0;
let pageTurns = 0;
let floorScroll = 0;

export function route(kind: string, draw: (id: string) => Promise<HTMLElement[]>): void {
  routes.set(kind, draw);
}

export function go(kind: string, id: string): void {
  location.hash = `${kind}/${encodeURIComponent(id)}`;
}

/** Draws the floor. It stays as the listener left it while a page is open, each crate at the sleeve they were on. */
export function drawFloor(step: tStep): void {
  const turn = ++floorTurns;
  step().then((elements) => {
    // Drawn only if nothing was asked for since: a slow answer must not cover the charts of a newer storefront.
    if (turn === floorTurns) floor.replaceChildren(...elements);
  }, showError);
}

/** Draws the page the address names, or shows the floor again when it names none. */
export function drawPage(): void {
  // The kind is up to the first slash, and the id all after it, whatever it holds.
  const [kind, id] = location.hash.slice(1).split(/\/(.*)/s);
  const draw = routes.get(kind ?? "");
  const turn = ++pageTurns;
  if (!floor.hidden) floorScroll = scrollY;
  floor.hidden = draw !== undefined;
  page.hidden = draw === undefined;
  if (draw === undefined) {
    page.replaceChildren();
    scrollTo(0, floorScroll);
    return;
  }
  const back = h("a", { href: "#", className: "back", textContent: "‹ Back to the crates" });
  page.replaceChildren(back, h("p", {}, "Pulling it out…"));
  scrollTo(0, 0);
  // An address typed by hand can hold a % that decodes to nothing: a URIError, said like any other.
  Promise.resolve().then(() => draw(decodeURIComponent(id ?? ""))).then((elements) => {
    if (turn === pageTurns) page.replaceChildren(back, ...elements);
  }, showError);
}

addEventListener("hashchange", drawPage);

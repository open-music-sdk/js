// Where the Dig screen draws: the floor of crates, and a page pulled out of
// one, opened over the floor as a step the browser's Back goes back from.
// Nothing here asks Apple.
import { button, byId, h } from "./dom";
import { showError } from "./errors";

type tDraw = () => Promise<HTMLElement[]>;
type tDrawPage = (id: string) => Promise<HTMLElement[]>;

const dig = byId("dig", HTMLElement);
const floor = byId("floor", HTMLDivElement);
const page = byId("page", HTMLDivElement);

/**
 * The pages a sleeve can open, by kind: the address `#albums/1440857781` draws
 * the "albums" page for that id.
 */
const routes = new Map<string, tDrawPage>();

// Each draw takes a turn. An answer, or an error, that comes back after a newer
// turn has started is dropped, so a slow answer never covers a newer one.
let floorTurn = 0;
let pageTurn = 0;
// Where the floor was scrolled to when a page opened over it, to go back to.
let floorScroll = 0;

export function route(kind: string, draw: tDrawPage): void {
  routes.set(kind, draw);
}

/**
 * Opens a page. When it is the page already open, as after an error, it is
 * drawn again.
 */
export function go(kind: string, id: string): void {
  const address = `#${kind}/${encodeURIComponent(id)}`;
  if (location.hash === address) drawPage();
  else location.hash = address;
}

/**
 * Draws the floor. It stays as the listener left it while a page is open, each
 * crate at the sleeve they were on.
 */
export function drawFloor(draw: tDraw): void {
  const turn = ++floorTurn;
  draw().then(
    (elements) => {
      if (turn === floorTurn) floor.replaceChildren(...elements);
    },
    (e: unknown) => {
      if (turn === floorTurn) showError(e);
    },
  );
}

/**
 * The kind of page the address names, and its id: everything after the first
 * slash, slashes and all.
 */
function parseAddress(): { kind: string; id: string } {
  const address = location.hash.slice(1);
  const slash = address.indexOf("/");
  if (slash === -1) return { kind: address, id: "" };
  return { kind: address.slice(0, slash), id: address.slice(slash + 1) };
}

/**
 * Draws the page the address names, or shows the floor again when it names
 * none.
 */
export function drawPage(): void {
  const { kind, id } = parseAddress();
  const draw = routes.get(kind);
  const turn = ++pageTurn;
  // The scroll belongs to the Dig screen: while another tab is open over it,
  // that tab keeps its place.
  const digShows = !dig.hidden;
  if (digShows && !floor.hidden) floorScroll = scrollY;

  floor.hidden = draw !== undefined;
  page.hidden = draw === undefined;
  if (draw === undefined) {
    page.replaceChildren();
    if (digShows) scrollTo(0, floorScroll);
    return;
  }

  const back = h("a", {
    href: "#",
    className: "back",
    textContent: "‹ Back to the crates",
  });
  page.replaceChildren(back, h("p", {}, "Pulling it out…"));
  if (digShows) scrollTo(0, 0);

  const drawn = (elements: HTMLElement[]) => {
    if (turn === pageTurn) page.replaceChildren(back, ...elements);
  };
  const failed = (e: unknown) => {
    if (turn !== pageTurn) return;
    showError(e);
    page.replaceChildren(back, h("p", {}, button("Try again", drawPage)));
  };
  // An address typed by hand can hold a % that decodes to nothing.
  // decodeURIComponent then throws a URIError, which is said like any other
  // error once it runs inside the promise.
  Promise.resolve()
    .then(() => draw(decodeURIComponent(id)))
    .then(drawn, failed);
}

// The address changed, by a sleeve, a link or the browser's Back: the Dig
// screen shows what it names.
addEventListener("hashchange", () => {
  document.querySelector<HTMLButtonElement>('nav button[value="dig"]')?.click();
  drawPage();
});

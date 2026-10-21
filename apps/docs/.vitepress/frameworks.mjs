// The reader's choice of frameworks: which page code and which server code the guides show. The config writes the
// choice into every page's head, the theme's picker changes it, and the snippet check holds the guides to it.

/** The two choices, each with its frameworks, the first the default. A Next app is its own server, so Next.js is on both. */
export const AXES = {
  page: [
    { value: "vanilla", label: "Vanilla" },
    { value: "react", label: "React" },
    { value: "nextjs", label: "Next.js" },
  ],
  server: [
    { value: "express", label: "Express" },
    { value: "workers", label: "Workers" },
    { value: "nextjs", label: "Next.js" },
  ],
};

/** What each choice is called where the reader makes it. */
export const AXIS_LABELS = { page: "Page", server: "Server" };

/** The frameworks of each choice, by value: `{ page: ["vanilla", "react", "nextjs"], server: [...] }`. */
export const VALUES = Object.fromEntries(Object.entries(AXES).map(([axis, frameworks]) => [axis, frameworks.map((framework) => framework.value)]));

/** Every page and server the samples run together: either Vite page with either server, and the Next app alone. */
export const PAIRS = [
  { page: "vanilla", server: "express" },
  { page: "vanilla", server: "workers" },
  { page: "react", server: "express" },
  { page: "react", server: "workers" },
  { page: "nextjs", server: "nextjs" },
];

/** A framework's name as a reader sees it, such as `Next.js` for `nextjs`. */
export const labelOf = (axis, value) => AXES[axis].find((framework) => framework.value === value)?.label ?? value;

/**
 * Settles the reader's choice, puts it on `<html>` as `data-page` and `data-server`, keeps it in the browser, and
 * returns it. `values` is `VALUES`, `url` the address being shown, and `wanted` a choice made in the picker.
 *
 * Each choice takes the first of these that names one of its frameworks: `wanted`; an anchor that names a variant,
 * such as `#after-sign-in--react`; the address's `?page=` or `?server=`; what was kept; and else the first framework.
 * Next.js on one side means Next.js on both, unless the other side was asked for by something earlier in that list,
 * and then the side with Next.js goes back to its first framework.
 *
 * Every page's head runs this, from its source, before the first paint, so it uses nothing from outside itself.
 */
export function settle(values, url, wanted = {}) {
  const KEY = "open-music-sdk:frameworks";
  const NEXT = "nextjs";
  let kept;
  try {
    kept = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    // Storage the browser blocks, or a value that isn't JSON, keeps nothing.
    kept = {};
  }
  const address = new URL(url);
  let hash = address.hash;
  try {
    hash = decodeURIComponent(hash);
  } catch {
    // An anchor such as #50% isn't escaped as a URL's should be, and names no variant either way.
  }
  const parts = hash.split("--");
  const named = parts.length > 1 ? parts[parts.length - 1].split("-") : [];
  const known = [...values.page, ...values.server];
  const variant = named.length > 0 && named.every((name) => known.includes(name)) ? named : [];

  const choice = {};
  const rank = {};
  for (const axis of ["page", "server"]) {
    const allowed = values[axis];
    const inVariant = variant.filter((name) => allowed.includes(name));
    const asked = [
      wanted[axis],
      inVariant.includes(kept[axis]) ? kept[axis] : inVariant[0],
      address.searchParams.get(axis),
      kept[axis],
    ];
    const found = asked.findIndex((value) => allowed.includes(value));
    choice[axis] = found === -1 ? allowed[0] : asked[found];
    rank[axis] = found === -1 ? asked.length : found;
  }
  if ((choice.page === NEXT) !== (choice.server === NEXT)) {
    const next = choice.page === NEXT ? "page" : "server";
    const other = next === "page" ? "server" : "page";
    if (rank[next] <= rank[other]) choice[other] = NEXT;
    else choice[next] = values[next][0];
  }

  document.documentElement.dataset.page = choice.page;
  document.documentElement.dataset.server = choice.server;
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // A browser that keeps nothing still shows this page in the chosen frameworks.
  }
  return choice;
}

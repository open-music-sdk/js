// The reader's choice of frameworks: which client code and which server code the guides show. The config writes the
// choice into every page's head, the theme's picker changes it, and the snippet check holds the guides to it.

/** The two choices, each with its frameworks, the first the default. A Next app is its own server, so Next.js is on both. */
export const AXES = {
  client: [
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
export const AXIS_LABELS = { client: "Client", server: "Server" };

/** The frameworks of each choice, by value: `{ client: ["vanilla", "react", "nextjs"], server: [...] }`. */
export const VALUES = Object.fromEntries(Object.entries(AXES).map(([axis, frameworks]) => [axis, frameworks.map((framework) => framework.value)]));

/** Every client and server the samples run together: either Vite client with either server, and the Next app alone. */
export const PAIRS = [
  { client: "vanilla", server: "express" },
  { client: "vanilla", server: "workers" },
  { client: "react", server: "express" },
  { client: "react", server: "workers" },
  { client: "nextjs", server: "nextjs" },
];

/** A framework's name as a reader sees it, such as `Next.js` for `nextjs`. */
export const labelOf = (axis, value) => AXES[axis].find((framework) => framework.value === value)?.label ?? value;

/**
 * What a block, or a page, is for, from what follows `for`: `client=vanilla,react server=workers` is
 * `{ client: ["vanilla", "react"], server: ["workers"] }`. A choice or a framework that doesn't exist is an error,
 * which stops the build at the page that names it.
 */
export function parseFor(text) {
  const wanted = {};
  for (const part of text.trim().split(/\s+/).filter(Boolean)) {
    const [axis, list] = part.split("=");
    if (!(axis in AXES) || list === undefined || axis in wanted) {
      throw new Error(`"for ${text.trim()}": write each choice once, as client=… or server=…`);
    }
    wanted[axis] = list.split(",");
    for (const value of wanted[axis]) {
      if (!AXES[axis].some((framework) => framework.value === value)) {
        throw new Error(`"for ${text.trim()}": ${axis} has no framework "${value}"`);
      }
    }
  }
  if (Object.keys(wanted).length === 0) throw new Error(`"for": name the frameworks, as client=react`);
  return wanted;
}

/** What a page is for, from the `for:` in its frontmatter, as `client=react,nextjs`: `{}` for a page for every one. */
export const pageScope = (markdown) => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1] ?? "";
  // Quoted or not, as YAML, and so the theme's notice, reads it.
  const line = /^for:\s*(["']?)(.+?)\1\s*$/m.exec(frontmatter)?.[2];
  return line === undefined ? {} : parseFor(line);
};

/** What something is for, as the attributes the CSS reads: ` data-client="vanilla react" data-server="workers"`. */
export const dataAttributes = (wanted) =>
  Object.entries(wanted)
    .map(([axis, values]) => ` data-${axis}="${values.join(" ")}"`)
    .join("");

/**
 * Settles the reader's choice, puts it on `<html>` as `data-client` and `data-server`, keeps it in the browser, and
 * returns it. `values` is `VALUES`, `url` the address being shown, and `wanted` a choice made in the picker.
 *
 * Each choice takes the first of these that names one of its frameworks: `wanted`; an anchor that names a variant,
 * such as `#after-sign-in--react`; the address's `?client=` or `?server=`, which it then takes out of the address;
 * what was kept; and else the first framework.
 * Next.js on one side means Next.js on both, unless the other side was asked for by something earlier in that list,
 * and then the side with Next.js goes back to the framework kept for it from before Next.js, else to its first.
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
  const known = [...values.client, ...values.server];
  const variant = named.length > 0 && named.every((name) => known.includes(name)) ? named : [];

  const choice = {};
  const rank = {};
  for (const axis of ["client", "server"]) {
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
  // Each side's last framework other than Next.js, so that leaving Next.js finds React and Workers again.
  const away = kept.away ?? {};
  if ((choice.client === NEXT) !== (choice.server === NEXT)) {
    const next = choice.client === NEXT ? "client" : "server";
    const other = next === "client" ? "server" : "client";
    if (rank[next] <= rank[other]) choice[other] = NEXT;
    else choice[next] = away[next] !== NEXT && values[next].includes(away[next]) ? away[next] : values[next][0];
  }

  document.documentElement.dataset.client = choice.client;
  document.documentElement.dataset.server = choice.server;
  try {
    const before = {};
    for (const axis of ["client", "server"]) before[axis] = choice[axis] === NEXT ? away[axis] : choice[axis];
    localStorage.setItem(KEY, JSON.stringify({ ...choice, away: before }));
  } catch {
    // A browser that keeps nothing still shows this page in the chosen frameworks.
  }
  // A link's choice is taken once. Left in the address, it would outrank every choice the reader makes after it.
  const here = new URL(location.href);
  if (here.searchParams.has("client") || here.searchParams.has("server")) {
    here.searchParams.delete("client");
    here.searchParams.delete("server");
    history.replaceState(history.state, "", here.href);
  }
  return choice;
}

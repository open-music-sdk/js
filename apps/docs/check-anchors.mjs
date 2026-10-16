// VitePress fails the build on a link to a page that is not there, but not on a link whose #anchor names nothing on
// the page, which is what a renamed heading leaves behind. This reads the built site and fails on any such link.
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const base = "/js/";

// Every page, by its path under the base without `.html`: `guides/sign-in`, `reference/@open-music-sdk/core/index`.
const pages = new Map(
  readdirSync(dist, { recursive: true })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => [file.slice(0, -".html".length), readFileSync(`${dist}/${file}`, "utf8")]),
);

const unescape = (text) => text.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const ids = new Map();
const idsOf = (page) => {
  if (!ids.has(page)) ids.set(page, new Set([...pages.get(page).matchAll(/\sid="([^"]*)"/g)].map((match) => unescape(match[1]))));
  return ids.get(page);
};

// A link's path, resolved from the page it is on, as a key of `pages`; undefined for a link that leaves the site.
const target = (from, path) => {
  if (path === "") return from;
  let resolved;
  if (path.startsWith(base)) resolved = path.slice(base.length);
  else if (path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return undefined;
  else resolved = posix.normalize(posix.join(posix.dirname(from), path));
  resolved = resolved.replace(/\.html$/, "");
  if (resolved === "" || resolved.endsWith("/")) resolved += "index";
  return pages.has(resolved) ? resolved : pages.has(`${resolved}/index`) ? `${resolved}/index` : undefined;
};

const broken = [];
for (const [page, html] of pages)
  for (const [, href] of html.matchAll(/\shref="([^"]*#[^"]*)"/g)) {
    const link = unescape(href);
    const hash = link.indexOf("#");
    const to = target(page, link.slice(0, hash));
    if (to === undefined) continue; // another site, or a missing page, which VitePress reports itself
    const anchor = decodeURIComponent(link.slice(hash + 1));
    if (anchor !== "" && !idsOf(to).has(anchor)) broken.push(`${page}.md links to ${link}, and ${to} has no #${anchor}`);
  }

if (broken.length) {
  console.error(`${broken.length} link(s) to an anchor that is not there:\n${broken.join("\n")}`);
  process.exit(1);
}
console.log(`Anchors checked on ${pages.size} pages.`);

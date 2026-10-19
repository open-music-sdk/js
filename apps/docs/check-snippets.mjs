// A page shows a sample's code with `<<< @/path#region`, and VitePress shows the whole file, with no error, when
// the region is not there: what a renamed or removed region leaves behind. This reads every page's sources and
// fails on a snippet whose file or region is missing.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
// What the site is built from, not what it depends on or what is generated.
const SKIPPED = new Set(["node_modules", "dist", "reference", ".vitepress"]);
const walk = (dir) =>
  readdirSync(`${root}/${dir}`, { withFileTypes: true }).flatMap((entry) => {
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : walk(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
const pages = walk("");

/**
 * Whether `text` has the region as VitePress finds one: a line that is `// #region <name>` and nothing else, then a
 * later `// #endregion`, with the name or without it. A name that only starts another, `play` for `play-from`, is not it.
 */
function hasRegion(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\/\/\s*#region\s+(\S+)\s*$/.exec(line)?.[1] === name);
  return start >= 0 && lines.slice(start + 1).some((line) => /^\s*\/\/\s*#endregion(?:\s+(\S+))?\s*$/.test(line) && [undefined, name].includes(/#endregion\s+(\S+)/.exec(line)?.[1]));
}

const broken = [];
let snippets = 0;
for (const page of pages)
  for (const [, path, region] of readFileSync(`${root}/${page}`, "utf8").matchAll(/^\s*<<<\s+@\/([^#{\s]+)(?:#([\w-]+))?/gm)) {
    snippets += 1;
    const file = `${root}/${path}`;
    if (!existsSync(file)) broken.push(`${page} shows ${path}, which is not there`);
    else if (region !== undefined && !hasRegion(readFileSync(file, "utf8"), region)) broken.push(`${page} shows ${path}#${region}, and the file has no such region, or none that ends`);
  }

if (broken.length) {
  console.error(`${broken.length} snippet(s) of a file or region that is not there:\n${broken.join("\n")}`);
  process.exit(1);
}
console.log(`Snippets checked: ${snippets}, on ${pages.length} pages.`);

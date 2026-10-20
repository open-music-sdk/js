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

// A code block on the site shows about 86 characters before it scrolls, margins aside, so a block of code a reader
// copies keeps every line to 80. The samples' own lines are held to 80 by ESLint. A block of data a line break would
// change, such as an HTTP header, a .env file's key or an error message quoted whole, is labelled for what it is
// (http, dotenv, or nothing) and left as it is.
const WIDTH = 80;
const CODE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "sh", "bash", "shell", "html", "vue", "css", "json", "jsonc", "yaml", "yml"]);
const wide = [];
let blocks = 0;
// README.md is the docs package's own, and not part of the site.
for (const page of pages.filter((page) => page !== "README.md")) {
  let language;
  readFileSync(`${root}/${page}`, "utf8").split(/\r?\n/).forEach((line, i) => {
    const fence = /^\s*```+\s*([\w-]*)/.exec(line);
    if (fence) {
      language = language === undefined ? fence[1] : undefined;
      if (language !== undefined && CODE.has(language)) blocks += 1;
      return;
    }
    if (language !== undefined && CODE.has(language) && line.length > WIDTH) wide.push(`${page}:${i + 1} is ${line.length} characters`);
  });
}

if (broken.length) console.error(`${broken.length} snippet(s) of a file or region that is not there:\n${broken.join("\n")}`);
if (wide.length) console.error(`${wide.length} line(s) of code blocks over ${WIDTH} characters, which the site would scroll:\n${wide.join("\n")}`);
if (broken.length || wide.length) process.exit(1);
console.log(`Snippets checked: ${snippets}, on ${pages.length} pages; ${blocks} code blocks within ${WIDTH} characters.`);

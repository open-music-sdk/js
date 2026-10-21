// A page shows a sample's code with `<<< @/path#region`, and VitePress shows the whole file, with no error, when
// the region is not there: what a renamed or removed region leaves behind. This reads every page's sources and
// fails on a snippet whose file or region is missing.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PAIRS, VALUES, labelOf } from "./.vitepress/frameworks.mjs";
import { parseFor } from "./.vitepress/variants.mjs";

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

// A region's lines, `// #region <name>` and `// #endregion <name>`, as VitePress 1.6 reads them.
const MARKER = /^\/\/ ?#?((?:end)?region) ([\w*-]+)$/;

/**
 * A region's lines as VitePress 1.6 shows them, or undefined when it finds none: from the line `// #region <name>`
 * to the first `// #endregion <name>` after it, an #endregion without the name not ending it, and with every region
 * line inside left out. A name that only starts another, `play` for `play-from`, is not it.
 */
function findRegion(text, name) {
  const lines = text.split(/\r?\n/);
  const marker = (line, tag) => {
    const [, found, named] = MARKER.exec(line.trim()) ?? [];
    return found === tag && named === name;
  };
  const start = lines.findIndex((line) => marker(line, "region"));
  const end = lines.findIndex((line, i) => i > start && marker(line, "endregion"));
  if (start === -1 || end === -1) return undefined;
  return lines.slice(start + 1, end).filter((line) => !MARKER.test(line.trim()));
}
const hasRegion = (text, name) => findRegion(text, name) !== undefined;

const broken = [];
let snippets = 0;
for (const page of pages)
  for (const [, path, region] of readFileSync(`${root}/${page}`, "utf8").matchAll(/^\s*<<<\s+@\/([^#{\s]+)(?:#([\w-]+))?/gm)) {
    snippets += 1;
    const file = `${root}/${path}`;
    if (!existsSync(file)) broken.push(`${page} shows ${path}, which is not there`);
    else if (region !== undefined && !hasRegion(readFileSync(file, "utf8"), region)) broken.push(`${page} shows ${path}#${region}, and the file has no such region, or none that an #endregion of its name ends`);
    // A whole file is shown as it is, its region lines among it; a region is shown without them.
    else if (region === undefined && /^\s*\/\/\s*#(?:end)?region\b/m.test(readFileSync(file, "utf8")))
      broken.push(`${page} shows the whole of ${path}, whose #region lines the reader would see; show a region around all of it instead`);
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

// A guide's code follows the reader's frameworks, in `::: for page=react` blocks (see .vitepress/variants.mjs).
// Blocks next to each other, with nothing but blank lines between them, are one group, and the reader sees exactly
// one block of a group: so a group covers every framework of its choice once, or, where its blocks name both
// choices, every page and server the samples run together once. Two blocks of a group that come out the same, once
// their snippets are read in, are one block for both frameworks. And a block holds no heading, which the page's
// outline would list while the block is hidden.
const regionText = (file, region) => {
  const text = readFileSync(file, "utf8");
  return region === undefined ? text.split(/\r?\n/) : (findRegion(text, region) ?? []);
};
/** What a block shows, with its snippets read in and blank lines and indentation left out, to compare blocks by. */
const resolved = (lines) =>
  lines
    .flatMap((line) => {
      const snippet = /^\s*<<<\s+@\/([^#{\s]+)(?:#([\w-]+))?/.exec(line);
      return snippet && existsSync(`${root}/${snippet[1]}`) ? regionText(`${root}/${snippet[1]}`, snippet[2]) : [line];
    })
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

/** The `::: for` blocks of a page, in groups: each block with its line, what it's for, and its lines. */
function variantGroups(page) {
  const lines = readFileSync(`${root}/${page}`, "utf8").split(/\r?\n/);
  const groups = [];
  let block;
  let fence;
  let lastClose = -2;
  lines.forEach((line, i) => {
    const fenceMark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    const [, colons = "", rest = ""] = /^\s*(:{3,})(.*)$/.exec(line) ?? [];
    if (block) {
      // As markdown-it-container does, the first line of at least the block's colons and nothing else closes it,
      // even inside a code fence. A container inside it, such as a code group, needs fewer colons than the block.
      if (colons.length >= block.colons) {
        if (rest.trim() === "") {
          if (fence !== undefined) block.fenceCut = true;
          lastClose = i;
          block = undefined;
          fence = undefined;
          return;
        }
        block.inner = true;
      }
      if (fence !== undefined) {
        if (fenceMark?.startsWith(fence)) fence = undefined;
      } else if (fenceMark) fence = fenceMark;
      else if (/^\s*#{1,6}\s/.test(line)) block.heading = true;
      block.lines.push(line);
      return;
    }
    if (fence !== undefined) {
      if (fenceMark?.startsWith(fence)) fence = undefined;
      return;
    }
    if (fenceMark) {
      fence = fenceMark;
      return;
    }
    const opening = /^for(?:\s+(.*))?$/.exec(rest.trim());
    if (colons === "" || opening === null) return;
    block = { page, line: i + 1, colons: colons.length, wanted: parseFor(opening[1] ?? ""), lines: [] };
    const between = lines.slice(lastClose + 1, i);
    if (lastClose >= 0 && between.every((text) => text.trim() === "")) groups.at(-1).push(block);
    else groups.push([block]);
  });
  return groups;
}

const named = (block) => Object.entries(block.wanted).map(([axis, values]) => `${axis}=${values.join(",")}`).join(" ");
const variants = [];
let groupCount = 0;
for (const page of pages.filter((page) => page !== "README.md"))
  for (const group of variantGroups(page)) {
    groupCount += 1;
    const where = `${page}:${group[0].line}`;
    const axes = [...new Set(group.flatMap((block) => Object.keys(block.wanted)))];
    for (const block of group) {
      if (block.heading) variants.push(`${page}:${block.line} has a heading inside "::: for ${named(block)}"; put it above the block`);
      if (block.inner)
        variants.push(`${page}:${block.line}: a container inside "::: for ${named(block)}" has as many colons as the block, so its closing line would end the block; give the block one more colon`);
      if (block.fenceCut)
        variants.push(`${page}:${block.line}: a code block inside "::: for ${named(block)}" has a line of colons alone, which ends the block; give the block more colons than that line`);
    }
    if (axes.length === 1) {
      const [axis] = axes;
      const seen = group.flatMap((block) => block.wanted[axis]);
      const missing = VALUES[axis].filter((value) => !seen.includes(value));
      const twice = VALUES[axis].filter((value) => seen.filter((other) => other === value).length > 1);
      if (missing.length) variants.push(`${where}: the group has no block for ${missing.map((value) => labelOf(axis, value)).join(", ")}`);
      if (twice.length) variants.push(`${where}: the group has more than one block for ${twice.map((value) => labelOf(axis, value)).join(", ")}`);
    } else if (group.some((block) => Object.keys(block.wanted).length !== 2)) {
      variants.push(`${where}: some blocks of the group name both choices, so each of them has to`);
    } else {
      const pairs = group.flatMap((block) => block.wanted.page.flatMap((page) => block.wanted.server.map((server) => `${page}+${server}`)));
      const runs = PAIRS.map(({ page, server }) => `${page}+${server}`);
      const missing = runs.filter((pair) => !pairs.includes(pair));
      const twice = runs.filter((pair) => pairs.filter((other) => other === pair).length > 1);
      const never = [...new Set(pairs.filter((pair) => !runs.includes(pair)))];
      const say = (pair) => pair.split("+").map((value, i) => labelOf(i === 0 ? "page" : "server", value)).join(" with ");
      if (missing.length) variants.push(`${where}: the group has no block for ${missing.map(say).join(", ")}`);
      if (twice.length) variants.push(`${where}: the group has more than one block for ${twice.map(say).join(", ")}`);
      if (never.length) variants.push(`${where}: no sample runs ${never.map(say).join(", ")}`);
    }
    for (let a = 0; a < group.length; a++)
      for (let b = a + 1; b < group.length; b++)
        if (resolved(group[a].lines) === resolved(group[b].lines))
          variants.push(`${page}:${group[b].line}: "::: for ${named(group[b])}" shows the same as "::: for ${named(group[a])}"; make them one block for both`);
  }

if (broken.length) console.error(`${broken.length} snippet(s) of a file or region that is not there, or of a whole file with region lines:\n${broken.join("\n")}`);
if (wide.length) console.error(`${wide.length} line(s) of code blocks over ${WIDTH} characters, which the site would scroll:\n${wide.join("\n")}`);
if (variants.length) console.error(`${variants.length} problem(s) with the framework variants:\n${variants.join("\n")}`);
if (broken.length || wide.length || variants.length) process.exit(1);
console.log(`Snippets checked: ${snippets}, on ${pages.length} pages; ${blocks} code blocks within ${WIDTH} characters; ${groupCount} groups of framework variants.`);

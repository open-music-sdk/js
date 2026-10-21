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

// A guide's code follows the reader's frameworks, in `::: for page=react` blocks (see .vitepress/variants.mjs).
// Blocks next to each other, with nothing but blank lines between them, are one group, and the reader sees exactly
// one block of a group: so a group covers every framework of its choice once, or, where its blocks name both
// choices, every page and server the samples run together once. Two blocks of a group that come out the same, once
// their snippets are read in, are one block for both frameworks. And a block holds no heading, which the page's
// outline would list while the block is hidden.
const regionText = (file, region) => {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (region === undefined) return lines;
  const start = lines.findIndex((line) => /^\s*\/\/\s*#region\s+(\S+)\s*$/.exec(line)?.[1] === region);
  const end = lines.findIndex((line, i) => i > start && /^\s*\/\/\s*#endregion\b/.test(line));
  return lines.slice(start + 1, end);
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
  let depth = 0;
  let fence;
  let lastClose = -2;
  lines.forEach((line, i) => {
    const fenceMark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (fenceMark?.startsWith(fence)) fence = undefined;
      if (block) block.lines.push(line);
      return;
    }
    if (fenceMark) fence = fenceMark;
    const opening = /^\s*:::+\s*for(?:\s+(.*))?$/.exec(line);
    if (opening && block === undefined) {
      block = { page, line: i + 1, wanted: parseFor(opening[1] ?? ""), lines: [] };
      const between = lines.slice(lastClose + 1, i);
      if (lastClose >= 0 && between.every((text) => text.trim() === "")) groups.at(-1).push(block);
      else groups.push([block]);
      return;
    }
    if (block === undefined) return;
    if (/^\s*:::+\s*\S/.test(line)) depth += 1;
    else if (/^\s*:::+\s*$/.test(line)) {
      if (depth === 0) {
        lastClose = i;
        block = undefined;
        return;
      }
      depth -= 1;
    }
    block.lines.push(line);
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
    for (const block of group)
      for (const line of block.lines)
        if (/^\s*#{1,6}\s/.test(line)) variants.push(`${page}:${block.line} has a heading inside "::: for ${named(block)}"; put it above the block`);
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

if (broken.length) console.error(`${broken.length} snippet(s) of a file or region that is not there:\n${broken.join("\n")}`);
if (wide.length) console.error(`${wide.length} line(s) of code blocks over ${WIDTH} characters, which the site would scroll:\n${wide.join("\n")}`);
if (variants.length) console.error(`${variants.length} problem(s) with the framework variants:\n${variants.join("\n")}`);
if (broken.length || wide.length || variants.length) process.exit(1);
console.log(`Snippets checked: ${snippets}, on ${pages.length} pages; ${blocks} code blocks within ${WIDTH} characters; ${groupCount} groups of framework variants.`);

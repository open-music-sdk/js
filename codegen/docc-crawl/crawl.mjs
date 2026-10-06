// Walks Apple's DocC render JSON for the Apple Music API once, caches every page under .cache/
// (ignored), and writes the normalized IR to ../docc-ir/ir.json (committed).
//
// Any documentation URL maps to its JSON by inserting /tutorials/data and appending .json:
//   /documentation/applemusicapi/songs  ->  https://developer.apple.com/tutorials/data/documentation/applemusicapi/songs.json
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SITE = "https://developer.apple.com";
const DOC_PREFIX = "/documentation/applemusicapi";
const SYMBOL_PREFIX = "data:music_api:";
const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, ".cache");
const OUT = path.join(here, "..", "docc-ir", "ir.json");

/** @type {Map<string, any>} docUrl -> page JSON */
const pages = new Map();

async function fetchPage(docUrl) {
  const file = path.join(CACHE, docUrl.slice(DOC_PREFIX.length + 1).replace(/[^A-Za-z0-9._-]/g, "_") + ".json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const res = await fetch(`${SITE}/tutorials/data${docUrl}.json`);
    if (!res.ok) return null;
    const text = await res.text();
    await writeFile(file, text);
    return JSON.parse(text);
  }
}

async function crawl(docUrl) {
  if (pages.has(docUrl)) return;
  pages.set(docUrl, null); // mark before awaiting so cycles stop
  const page = await fetchPage(docUrl);
  if (!page) {
    console.warn("missing", docUrl);
    return;
  }
  pages.set(docUrl, page);
  for (const ref of Object.values(page.references ?? {})) {
    const url = ref.url?.toLowerCase().split("#")[0];
    if (url === DOC_PREFIX || url?.startsWith(DOC_PREFIX + "/")) await crawl(url); // sequential: polite to Apple's CDN
  }
}

// ---- normalization -------------------------------------------------------------------------

const SCALARS = new Set(["string", "integer", "number", "boolean", "object"]);
const symbolName = (t) => (t.preciseIdentifier ?? t.text).replace(SYMBOL_PREFIX, "");

/**
 * DocC type tokens -> { kind: "scalar" | "ref" | "array" | "union" | "unknown", ... }.
 * `*` is a wildcard; DocC lists the concrete members in an `allowedTypes` attribute.
 * `(A | B)` is an inline union.
 */
function parseType(tokens, attributes, where) {
  const refs = [];
  let s = "";
  for (const t of tokens) {
    if (t.kind === "typeIdentifier") s += `@${refs.push(symbolName(t)) - 1}`;
    else s += t.text;
  }
  const allowedTypes = attributes?.find((a) => a.kind === "allowedTypes")?.values;
  const parse = (str) => {
    str = str.trim();
    const arr = /^\[(.+)\]$/.exec(str);
    if (arr) return { kind: "array", of: parse(arr[1]) };
    const group = /^\((.+)\)$/.exec(str);
    if (group) return { kind: "union", of: group[1].split("|").map(parse) };
    const ref = /^@(\d+)$/.exec(str);
    if (ref) return { kind: "ref", name: refs[Number(ref[1])] };
    if (SCALARS.has(str)) return { kind: "scalar", name: str };
    if (str === "*") {
      if (!allowedTypes) return { kind: "unknown" };
      return { kind: "union", of: allowedTypes.map((alt) => parseType(alt, undefined, where)) };
    }
    throw new Error(`unknown type ${JSON.stringify(str)} in ${where}`);
  };
  return parse(s);
}

const text = (content) =>
  (content ?? [])
    .flatMap((b) => b.inlineContent ?? [])
    .map((i) => i.text ?? i.code ?? "")
    .join("")
    .trim();

function property(item, where) {
  const allowed = item.attributes?.find((a) => a.kind === "allowedValues")?.values;
  return {
    name: item.name,
    required: item.required === true,
    type: parseType(item.type, item.attributes, `${where}.${item.name}`),
    ...(allowed && { allowed }),
    ...(text(item.content) && { doc: text(item.content) }),
  };
}

function normalize() {
  const dictionaries = [];
  const endpoints = [];
  for (const page of pages.values()) {
    if (!page) continue;
    const { metadata } = page;
    const sections = page.primaryContentSections ?? [];
    const section = (kind) => sections.filter((s) => s.kind === kind);
    const doc = text(page.abstract?.length ? [{ inlineContent: page.abstract }] : []);
    if (metadata.symbolKind === "dictionary") {
      const name = (metadata.externalID ?? metadata.title).replace(SYMBOL_PREFIX, "");
      dictionaries.push({
        name,
        ...(doc && { doc }),
        properties: (section("properties")[0]?.items ?? []).map((i) => property(i, name)),
      });
    } else if (metadata.symbolKind === "httpRequest") {
      const tokens = section("restEndpoint")[0]?.tokens ?? [];
      const params = (source) =>
        section("restParameters")
          .filter((s) => s.source === source)
          .flatMap((s) => s.items.map((i) => property(i, metadata.title)));
      endpoints.push({
        title: metadata.title,
        ...(doc && { doc }),
        method: tokens.find((t) => t.kind === "method")?.text,
        path: tokens
          .filter((t) => t.kind === "path" || t.kind === "parameter")
          .map((t) => t.text)
          .join(""),
        pathParams: params("path"),
        queryParams: params("query"),
        responses: (section("restResponses")[0]?.items ?? []).map((r) => ({
          status: r.status,
          type: parseType(r.type, undefined, `${metadata.title} ${r.status}`),
        })),
      });
    }
  }
  const byName = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
  return { dictionaries: dictionaries.sort(byName("name")), endpoints: endpoints.sort(byName("path")) };
}

await mkdir(CACHE, { recursive: true });
await crawl(DOC_PREFIX);
const ir = normalize();
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(ir, null, 2) + "\n");
console.log(`${pages.size} pages -> ${ir.dictionaries.length} dictionaries, ${ir.endpoints.length} endpoints -> ${path.relative(process.cwd(), OUT)}`);

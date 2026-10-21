// Every export of the integrations is used by name in a sample, or is listed below with the reason it is not. The
// endpoint functions are counted apart: the samples call some, and the CLI's check asks every one. And every snippet
// the docs show of a sample is there, since CI builds the docs only when they change, and runs every test.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as browser from "@open-music-sdk/browser";
import * as clientCatalog from "@open-music-sdk/client-catalog";
import * as clientUser from "@open-music-sdk/client-user";
import * as react from "@open-music-sdk/react";
import * as server from "@open-music-sdk/server";
import { describe, expect, test } from "vitest";

/** The exports no sample uses by name, each with the reason. */
const UNUSED: ReadonlyMap<string, string> = new Map([
  ["AppleMusicError", "isAppleMusicError is the guard the samples use, and the guard the docs recommend"],
  ["FORMATS", "the samples take the format Apple's artwork template names"],
  ["MUSICKIT_SCRIPT", "it is for a content security policy, which Vite's dev server cannot keep, since it injects inline scripts; the CLI's sign-in page sets one"],
  ["artworkSrcSet", "artworkImage gives the srcset together with the rest of what an <img> needs"],
  ["developerTokenFetcher", "createBrowserClient makes one from its tokenUrl"],
  ["developerTokenMinter", "createServerClient and tokenEndpoint each make one from the key"],
  ["mintDeveloperToken", "the clients mint for themselves; a server calls it only to hand a token to something else"],
  ["validateUserToken", "a page that posts the token to its server has the server check it, through the intake; validateUserToken is for a page that keeps the token to itself"],
]);

const samples = fileURLToPath(new URL("../..", import.meta.url));
const SKIPPED = new Set(["export-check", "node_modules", "dist", ".wrangler", ".next"]);

/** What a file says in code: a name in a comment, such as a file's "Shows:" line, is no use of it. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The code of every source file of every sample but this one, as one text. */
function sources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !SKIPPED.has(entry.name))
    .map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|tsx|html)$/.test(entry.name) ? code(readFileSync(path, "utf8")) : "";
    })
    .join("\n");
}
const text = sources(samples);
/** Whether a sample's code names it as a word: `music.playlists` counts for `playlists`. */
const used = (name: string) => new RegExp(`\\b${name}\\b`).test(text);

/** The endpoint functions, which every integration re-exports one by one beside its namespaces. */
const endpoints = new Set([...Object.keys(clientCatalog), ...Object.keys(clientUser)].filter((name) => name !== "catalog" && name !== "user"));

describe.each([
  ["server", server],
  ["browser", browser],
  ["react", react],
])("@open-music-sdk/%s", (_name, integration) => {
  const exports = Object.keys(integration).filter((name) => !endpoints.has(name));

  test("every export is used by a sample, or listed with the reason it is not", () => {
    expect(exports.filter((name) => !used(name) && !UNUSED.has(name))).toEqual([]);
  });

  test("the list names exports, and none a sample now uses", () => {
    const listed = [...UNUSED.keys()].filter((name) => name in integration);
    expect(listed.filter(used)).toEqual([]);
  });
});

test("the list holds no name that no integration exports", () => {
  const exported = (name: string) => name in server || name in browser || name in react;
  expect([...UNUSED.keys()].filter((name) => !exported(name))).toEqual([]);
});

test("the endpoint functions the samples call by name, for the status page", () => {
  const called = [...endpoints].filter(used);
  console.info(`The samples call ${String(called.length)} of the ${String(endpoints.size)} endpoint functions by name.`);
  expect(called.length).toBeGreaterThan(0);
});

test("every snippet a docs page shows of a sample is there, its region named exactly and ended", () => {
  const check = fileURLToPath(new URL("../../../apps/docs/check-snippets.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [check], { encoding: "utf8" });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import * as browser from "@open-music-sdk/browser";
import { build } from "tsdown";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

const OWN = ["MusicProvider", "musicQueries", "useConnect", "useMusic", "useMusicQueries", "useMusicUserToken", "usePreviewPlayer"];

/** The package as built, as its config builds it: one file per source file, by name. */
async function built(): Promise<Record<string, string>> {
  const { bundles } = await build({
    config: false,
    entry: ["src/index.ts"],
    unbundle: true,
    format: ["esm"],
    platform: "neutral",
    deps: { neverBundle: [/^@open-music-sdk\//, "react"] },
    treeshake: true,
    dts: false,
    write: false,
    clean: false,
    report: false,
    logLevel: "silent",
  });
  return Object.fromEntries(bundles.flatMap((bundle) => bundle.chunks.map((chunk) => [chunk.fileName, "code" in chunk ? chunk.code : ""])));
}

describe("the package entry", () => {
  test("exports everything the browser package does, the provider, the hooks and the query factory: nothing else, and nothing twice", () => {
    const expected = [...Object.keys(browser), ...OWN];
    expect(new Set(expected).size).toBe(expected.length);
    expect(Object.keys(api).sort()).toEqual([...expected].sort());
    expect(api.createBrowserClient).toBe(browser.createBrowserClient);
  });

  test("is the only one: the query factory is in it, since nothing of TanStack is imported to keep out of a server", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
    expect(typeof api.musicQueries).toBe("function");
  });

  test("the directive is at the top of the one built file that holds the hooks, which is where the hooks are, and on nothing else", { timeout: 60_000 }, async () => {
    const files = await built();
    expect(Object.keys(files).sort()).toEqual(["client.js", "index.js", "query.js"]);
    expect(files["client.js"]?.trimStart().startsWith('"use client";')).toBe(true);
    expect(files["client.js"]).toContain("useSyncExternalStore");
    for (const name of ["index.js", "query.js"]) expect(files[name], name).not.toContain("use client");
    expect(files["index.js"]).toMatch(/from\s*"\.\/client\.js"/);
    expect(files["index.js"]).not.toContain("useSyncExternalStore");
  });

  test("the source of the hooks begins with the directive, which is where the build takes it from", () => {
    expect(readFileSync(new URL("client.ts", import.meta.url), "utf8").startsWith('"use client";')).toBe(true);
  });

  test("no source file names process, env or a storage of the page", () => {
    for (const file of ["index.ts", "client.ts", "query.ts"]) expect(readFileSync(new URL(file, import.meta.url), "utf8"), file).not.toMatch(/\bprocess\b|\benv\b|localStorage|sessionStorage|\.cookie\b/i);
  });
});

describe("the package manifest", () => {
  test("react is the one peer; the feature packages the hooks and the factory are built on are ordinary dependencies on a caret range", () => {
    expect(manifest.peerDependencies).toEqual({ react: "catalog:" });
    expect(Object.entries(manifest.dependencies)).toEqual([
      ["@open-music-sdk/browser", "workspace:^"],
      ["@open-music-sdk/client-catalog", "workspace:^"],
      ["@open-music-sdk/client-user", "workspace:^"],
      ["@open-music-sdk/core", "workspace:^"],
      ["@open-music-sdk/lib-preview-player", "workspace:^"],
    ]);
  });

  test("TanStack Query is not a peer and not a dependency: it is here for the tests alone, with react-dom and a DOM", () => {
    expect(manifest.devDependencies).toHaveProperty("@tanstack/react-query", "catalog:");
    expect(manifest.devDependencies).toHaveProperty("react-dom", "catalog:");
    expect(manifest.devDependencies).toHaveProperty("happy-dom", "catalog:");
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

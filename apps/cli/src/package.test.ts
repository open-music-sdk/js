import { build } from "tsdown";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };

/** What the package's own build makes, by file name, without writing it. */
async function built(): Promise<Map<string, string>> {
  const { bundles } = await build({ config: "tsdown.config.ts", write: false, clean: false, report: false, logLevel: "silent" });
  return new Map(bundles.flatMap((bundle) => bundle.chunks.map((chunk): [string, string] => [chunk.fileName, "code" in chunk ? chunk.code : ""])));
}

/** What an import of anything but Node's own modules looks like in a built file. */
const imports = (code: string) => Array.from(code.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g), (match) => match[1] ?? match[2] ?? "").filter((name) => !name.startsWith("node:"));

const SIGNING = /jose|SignJWT|importPKCS8|mintDeveloperToken|BEGIN PRIVATE KEY|\bprocess\b/;

describe("what the build makes", () => {
  test("the sign-in page carries no signing code and nothing of Node, and imports nothing: it is served to a browser, and the key stays in the terminal", { timeout: 60_000 }, async () => {
    const page = (await built()).get("page.js") ?? "";
    expect(page).toContain("musickit");
    expect(page).not.toMatch(SIGNING);
    expect(imports(page)).toEqual([]);
  });

  test("the command carries the family it was built with, so a pinned version runs exactly that, and imports nothing but Node and jose", { timeout: 60_000 }, async () => {
    const bin = (await built()).get("bin.js") ?? "";
    expect(bin.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(new Set(imports(bin))).toEqual(new Set(["jose"]));
    // The check can tell: the family's signing code is in the command, where the key is.
    expect(bin).toMatch(SIGNING);
  });
});

describe("the package", () => {
  test("is the open-music-sdk command, run with npx, on the Node the family needs", () => {
    expect(manifest.name).toBe("@open-music-sdk/cli");
    expect(manifest.bin).toEqual({ "open-music-sdk": "./dist/bin.js" });
    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.engines.node).toBe(">=24");
    expect(manifest).not.toHaveProperty("private");
  });

  test("its one dependency at run time is jose; the family is bundled in, the server package into the command and the browser package into the page", () => {
    expect(manifest.dependencies).toEqual({ jose: "catalog:" });
    expect(manifest.devDependencies).toHaveProperty("@open-music-sdk/server", "workspace:*");
    expect(manifest.devDependencies).toHaveProperty("@open-music-sdk/browser", "workspace:*");
  });
});

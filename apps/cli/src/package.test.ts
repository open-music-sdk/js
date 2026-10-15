import { build } from "tsdown";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };

/** An entry as the CLI's build bundles the page: the family bundled in, minified so no comment is read. */
async function bundled(entry: string): Promise<string> {
  const { bundles } = await build({
    config: false,
    entry: [entry],
    format: ["esm"],
    platform: "browser",
    deps: { alwaysBundle: [/^@open-music-sdk\//] },
    treeshake: true,
    minify: true,
    dts: false,
    write: false,
    clean: false,
    report: false,
    logLevel: "silent",
  });
  return bundles.flatMap((bundle) => bundle.chunks.map((chunk) => ("code" in chunk ? chunk.code : ""))).join("\n");
}

const SIGNING = /jose|SignJWT|importPKCS8|mintDeveloperToken|BEGIN PRIVATE KEY|\bprocess\b/;

describe("the sign-in page", () => {
  test("carries no signing code and nothing of Node: it is served to a browser, and the key stays in the terminal", { timeout: 60_000 }, async () => {
    const code = await bundled("src/page.ts");
    expect(code).toContain("musickit");
    expect(code).not.toMatch(SIGNING);
    // Nothing is left for the browser to import: the page loads this file and Apple's script, and nothing else.
    expect(code).not.toMatch(/\bimport\s*[{*"']|\bimport\(/);
  });

  test("the check can tell: the server package, which the terminal side uses, does carry signing code", { timeout: 60_000 }, async () => {
    expect(await bundled("../../integrations/server/src/index.ts")).toMatch(SIGNING);
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

  test("its one dependency at run time is the server package; the browser package is bundled into the page", () => {
    expect(manifest.dependencies).toEqual({ "@open-music-sdk/server": "workspace:^" });
    expect(manifest.devDependencies).toHaveProperty("@open-music-sdk/browser", "workspace:*");
  });
});

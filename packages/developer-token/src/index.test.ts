import { readFileSync } from "node:fs";
import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index.js";
import * as remoteEntry from "./remote.js";

describe("the package entry", () => {
  test("exports the documented functions and nothing else", () => {
    expect(Object.keys(api).sort()).toEqual(["cachedMinter", "fromEnv", "mintDeveloperToken", "redacted", "remoteDeveloperToken"]);
  });

  test("is one of two: everything, and ./remote for code that must carry no signing code", () => {
    expect(Object.keys(manifest.exports)).toEqual([".", "./remote"]);
  });

  test("from an environment to a request, using nothing but the entry and core", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const names = { pem: "KEY", teamId: "TEAM", keyId: "KID" };
    const key = api.fromEnv(Object.fromEntries([["KEY", await exportPKCS8(pair.privateKey)], ["TEAM", "DEF123GHIJ"], ["KID", "ABC123DEFG"]]), names);
    const sent: string[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      sent.push(new Request(input).headers.get("authorization") ?? "");
      return Promise.resolve(new Response("{}"));
    };
    await createClient({ developerToken: api.cachedMinter(key), fetch, retry: false }).request("v1/test");
    const { payload, protectedHeader } = await jwtVerify((sent[0] ?? "").replace(/^Bearer /, ""), pair.publicKey);
    expect([payload.iss, protectedHeader.kid]).toEqual(["DEF123GHIJ", "ABC123DEFG"]);
  });

  test("the errors it throws are the ones core recognises", async () => {
    const provider = api.remoteDeveloperToken("https://app.example/token", { fetch: () => Promise.reject(new TypeError("fetch failed")) });
    const error: unknown = await provider().catch((e: unknown) => e);
    expect(isAppleMusicError(error, "DeveloperTokenUnavailable")).toBe(true);
  });
});

describe("the ./remote entry", () => {
  /** Every module reachable from `entry` through static imports and re-exports, and every package those name. */
  function reach(entry: string) {
    const modules = new Set<string>();
    const packages = new Set<string>();
    const visit = (file: string) => {
      if (modules.has(file)) return;
      modules.add(file);
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, `${file} must not import dynamically, where this walk cannot follow`).not.toMatch(/\bimport\s*\(/);
      for (const [, from, bare] of source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)) {
        const specifier = from ?? bare ?? "";
        if (specifier.startsWith(".")) visit(specifier.replace(/\.js$/, ".ts"));
        else packages.add(specifier);
      }
    };
    visit(entry);
    return { modules: [...modules].sort(), packages: [...packages].sort() };
  }

  test("exports remoteDeveloperToken and nothing else", () => {
    expect(Object.keys(remoteEntry)).toEqual(["remoteDeveloperToken"]);
    expect(remoteEntry.remoteDeveloperToken).toBe(api.remoteDeveloperToken);
  });

  test("reaches no signing code: nothing it imports, at any remove, names jose or the minter", () => {
    expect(reach("./remote.ts")).toEqual({ modules: ["./cache.ts", "./remote.ts"], packages: ["@open-music-sdk/core"] });
  });

  test("the walk that says so does find jose from the main entry, so its silence means something", () => {
    const main = reach("./index.ts");
    expect(main.packages).toContain("jose");
    expect(main.modules).toContain("./mint.ts");
  });

  test("is built and published under its own path", () => {
    expect(manifest.exports["./remote"]).toEqual({ types: "./dist/remote.d.ts", default: "./dist/remote.js" });
  });
});

describe("the package manifest", () => {
  const core = "@open-music-sdk/core";

  // The errors this package throws are core's class, and core recognises its own by instanceof. A second copy of
  // core nested under this package would throw errors the application's copy does not recognise or retry.
  test("core is a peer, so an application and this package share one copy of it", () => {
    expect(manifest.peerDependencies).toHaveProperty([core]);
    expect(manifest.dependencies).not.toHaveProperty([core]);
  });

  test("the peer is pinned to the workspace version, because the family is released in lockstep", () => {
    expect(manifest.peerDependencies[core]).toBe("workspace:*");
  });

  test("jose is the only runtime dependency", () => {
    expect(Object.keys(manifest.dependencies)).toEqual(["jose"]);
  });
});

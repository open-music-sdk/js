import { readFileSync } from "node:fs";
import { AppleMusicError, createClient, isAppleMusicError } from "@open-music-sdk/core";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, test, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index.js";
import * as remoteEntry from "./fetcher.js";

describe("the package entry", () => {
  test("exports the documented functions and nothing else", () => {
    expect(Object.keys(api).sort()).toEqual(["developerTokenFetcher", "developerTokenMinter", "mintDeveloperToken"]);
  });

  test("is one of two: everything, and ./fetcher for code that must carry no signing code", () => {
    expect(Object.keys(manifest.exports)).toEqual([".", "./fetcher"]);
  });

  test("from an environment to a request, using nothing but the entry and core", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const env = Object.fromEntries([["KEY", await exportPKCS8(pair.privateKey)], ["TEAM", "DEF123GHIJ"], ["KID", "ABC123DEFG"]]);
    const developerToken = api.developerTokenMinter({ env, variables: { pem: "KEY", teamId: "TEAM", keyId: "KID" } });
    const sent: string[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      sent.push(new Request(input).headers.get("authorization") ?? "");
      return Promise.resolve(new Response("{}"));
    };
    await createClient({ developerToken, fetch, retry: false }).request("v1/test");
    const { payload, protectedHeader } = await jwtVerify((sent[0] ?? "").replace(/^Bearer /, ""), pair.publicKey);
    expect([payload.iss, protectedHeader.kid]).toEqual(["DEF123GHIJ", "ABC123DEFG"]);
  });

  test("the errors it throws are the ones core recognises", async () => {
    const provider = api.developerTokenFetcher("https://app.example/token", { fetch: () => Promise.reject(new TypeError("fetch failed")) });
    const error: unknown = await provider().catch((e: unknown) => e);
    expect(isAppleMusicError(error, "DeveloperTokenUnavailable")).toBe(true);
  });
});

describe("the ./fetcher entry", () => {
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

  test("exports developerTokenFetcher and nothing else", () => {
    expect(Object.keys(remoteEntry)).toEqual(["developerTokenFetcher"]);
    expect(remoteEntry.developerTokenFetcher).toBe(api.developerTokenFetcher);
  });

  test("reaches no signing code: nothing it imports, at any remove, names jose or the minter", () => {
    expect(reach("./fetcher.ts")).toEqual({ modules: ["./cache.ts", "./fetcher.ts", "./got.ts"], packages: ["@open-music-sdk/core"] });
  });

  test("the walk that says so does find jose from the main entry, so its silence means something", () => {
    const main = reach("./index.ts");
    expect(main.packages).toContain("jose");
    expect(main.modules).toContain("./mint.ts");
  });

  test("is built and published under its own path", () => {
    expect(manifest.exports["./fetcher"]).toEqual({ types: "./dist/fetcher.d.ts", default: "./dist/fetcher.js" });
  });
});

describe("an app whose copy of core is not the one this package resolves", () => {
  const ENDPOINT = "https://app.example/api/token";
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${b64url({ alg: "ES256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;

  /** A second copy of core, as an app on another version of it has: its own error class, its own client. */
  async function foreignCore() {
    vi.resetModules();
    return import("@open-music-sdk/core");
  }

  /** One fetch for both hosts: the token endpoint answers from `replies`, Apple always with 200. */
  function world(...replies: (Error | number | string)[]) {
    const seen = { tokenCalls: 0, sent: [] as string[] };
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      if (input instanceof Request) {
        seen.sent.push(input.headers.get("authorization") ?? "");
        return Promise.resolve(new Response("{}"));
      }
      seen.tokenCalls++;
      const reply = replies.shift() ?? token;
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve(typeof reply === "number" ? new Response("", { status: reply }) : new Response(reply));
    };
    return { fetch, seen };
  }

  test("that copy has a class of its own, so its prototype chain cannot be what recognises an error from here", async () => {
    const foreign = await foreignCore();
    expect(foreign.AppleMusicError).not.toBe(AppleMusicError);
    const { fetch } = world(503);
    const error: unknown = await api.developerTokenFetcher(ENDPOINT, { fetch })().catch((e: unknown) => e);
    expect(Object.getPrototypeOf(error)).toBe(AppleMusicError.prototype);
    expect(Object.getPrototypeOf(error)).not.toBe(foreign.AppleMusicError.prototype);
  });

  test.each([
    ["an endpoint that cannot be reached", new TypeError("fetch failed"), undefined],
    ["an endpoint that is overloaded", 503, 503],
    ["an endpoint that refuses", 403, 403],
    ["an answer that is no token", "<!doctype html>", 200],
  ] as const)("%s is DeveloperTokenUnavailable to that copy's guard, status and all", async (_name, reply, status) => {
    const foreign = await foreignCore();
    const { fetch } = world(reply);
    const error: unknown = await api.developerTokenFetcher(ENDPOINT, { fetch })().catch((e: unknown) => e);
    expect(foreign.isAppleMusicError(error, "DeveloperTokenUnavailable")).toBe(true);
    expect(foreign.isAppleMusicError(error, "ApiError")).toBe(false);
    expect((error as { status?: number }).status).toBe(status);
  });

  test("that copy's client retries an endpoint that is briefly down, as this copy's would", async () => {
    const foreign = await foreignCore();
    const { fetch, seen } = world(new TypeError("fetch failed"), 503, token);
    const music = foreign.createClient({ developerToken: api.developerTokenFetcher(ENDPOINT, { fetch }), fetch, retry: { maxAttempts: 3, baseDelayMs: 0 } });
    await music.request("v1/test");
    expect(seen.tokenCalls).toBe(3);
    expect(seen.sent).toEqual([`Bearer ${token}`]);
  });

  test("that copy's client does not retry a refusal, and hands the error over with its tag", async () => {
    const foreign = await foreignCore();
    const { fetch, seen } = world(403);
    const music = foreign.createClient({ developerToken: api.developerTokenFetcher(ENDPOINT, { fetch }), fetch, retry: { maxAttempts: 3, baseDelayMs: 0 } });
    const error: unknown = await music.request("v1/test").catch((e: unknown) => e);
    expect(foreign.isAppleMusicError(error, "DeveloperTokenUnavailable")).toBe(true);
    expect(seen.tokenCalls).toBe(1);
    expect(seen.sent).toEqual([]);
  });

  test("that copy's client is served by a minter from here", async () => {
    const foreign = await foreignCore();
    const pair = await generateKeyPair("ES256", { extractable: true });
    const { fetch, seen } = world();
    const developerToken = api.developerTokenMinter({ pem: await exportPKCS8(pair.privateKey), teamId: "DEF123GHIJ", keyId: "ABC123DEFG" });
    await foreign.createClient({ developerToken, fetch, retry: false }).request("v1/test");
    expect((await jwtVerify((seen.sent[0] ?? "").replace(/^Bearer /, ""), pair.publicKey)).payload.iss).toBe("DEF123GHIJ");
  });
});

describe("the package manifest", () => {
  const core = "@open-music-sdk/core";

  test("core is an ordinary dependency on a caret range, as it is for the rest of the family", () => {
    expect(manifest.dependencies[core]).toBe("workspace:^");
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("jose is the only dependency from outside the family", () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([core, "jose"]);
  });
});

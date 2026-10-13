import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import * as catalogPackage from "@open-music-sdk/client-catalog";
import * as userPackage from "@open-music-sdk/client-user";
import * as core from "@open-music-sdk/core";
import * as fetcherEntry from "@open-music-sdk/developer-token/fetcher";
import * as playlistsPackage from "@open-music-sdk/lib-playlists";
import * as playerPackage from "@open-music-sdk/lib-preview-player";
import * as server from "@open-music-sdk/server";
import * as validate from "@open-music-sdk/validate";
import * as artwork from "@open-music-sdk/util-artwork";
import { build } from "tsdown";
import { describe, expect, test, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

/** What an app uses of core. The rest is what the clients are declared with, and `createClient`, which an assembly of one's own takes from core. */
const CORE = ["AppleMusicError", "createRateLimiter", "isAppleMusicError"];
const OWN = ["MUSICKIT_SCRIPT", "createBrowserClient", "createConnect"];
/** Of user-token, what a page uses: the rest keeps tokens for a server. */
const USER_TOKEN = ["validateUserToken"];
const siblings = { fetcherEntry, artwork, catalogPackage, userPackage, playlistsPackage, playerPackage };

/** This package as an app's bundler leaves it: the family bundled in, minified so no comment is read, and what nothing uses dropped. */
async function carried(): Promise<string> {
  const { bundles } = await build({
    config: false,
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
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

describe("the package entry", () => {
  test("exports its own three names, the app-facing names of core, what a page uses of the feature packages, and the validators as schemas: nothing else, and nothing twice", () => {
    const expected = [...OWN, ...CORE, ...USER_TOKEN, ...Object.values(siblings).flatMap((pkg) => Object.keys(pkg)), "schemas"];
    expect(new Set(expected).size).toBe(expected.length);
    expect(Object.keys(api).sort()).toEqual([...expected].sort());
  });

  test("what it leaves out is what a page has no business with: signing, the stores and the intake, core's builders and checks, createClient", () => {
    for (const name of ["createClient", "endpoint", "clientOf", "developerTokenMinter", "mintDeveloperToken", "userTokenIntake", "acceptUserToken", "MemoryUserTokenStore", "KvUserTokenStore", "tokenEndpoint", "createServerClient"]) expect(Object.hasOwn(api, name), name).toBe(false);
    expect(CORE.filter((name) => !Object.hasOwn(core, name))).toEqual([]);
  });

  test("schemas is the whole of validate, under one name", () => {
    expect(Object.keys(api.schemas).sort()).toEqual(Object.keys(validate).sort());
  });

  test("is the only one", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test("no source file reaches the developer-token package but through its fetcher entry, nor names process, env or a storage of the page", () => {
    const sources = readdirSync(new URL(".", import.meta.url)).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    expect(sources.sort()).toEqual(["client.ts", "connect.ts", "index.ts"]);
    for (const file of sources) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/"@open-music-sdk\/developer-token"/);
      expect(source, file).not.toMatch(/\bprocess\b|\benv\b|localStorage|sessionStorage|\.cookie\b|indexedDB/i);
    }
  });

  test("from a token endpoint to a clip playing, using nothing but the entry", async () => {
    const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${b64url({ alg: "ES256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 900 })}.c2ln`;
    const song = { id: "1", type: "songs", href: "/v1/catalog/us/songs/1", attributes: { name: "Hey Jude", previews: [{ url: "https://audio-ssl.itunes.apple.com/1.m4a" }] } };
    const asked: string[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      const req = input instanceof Request ? input : new Request(input);
      asked.push(`${new URL(req.url).pathname} ${req.headers.get("authorization") ?? "-"}`);
      return Promise.resolve(new Response(JSON.stringify(req.url.endsWith("/token") ? { token } : { data: [song] })));
    };
    const music = api.createBrowserClient({ tokenUrl: "https://app.example/api/music/token", endpoint: { fetch }, fetch, retry: false, storefront: "us" });
    const found = await music.catalog.getSong("1");
    const played: string[] = [];
    const audio = { src: "", currentTime: 0, volume: 1, duration: Number.NaN, paused: true, ended: false, error: null, play: () => (played.push(audio.src), Promise.resolve()), pause: () => undefined, load: () => undefined, removeAttribute: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
    const player = api.previewPlayer({ audio });
    expect(player.load([found])).toEqual({ tracks: [found], skipped: [] });
    await player.play();
    expect(played).toEqual(["https://audio-ssl.itunes.apple.com/1.m4a"]);
    expect(asked).toEqual(["/api/music/token -", `/v1/catalog/us/songs/1 Bearer ${token}`]);
    expect(api.isAppleMusicError(new api.AppleMusicError("ApiError", "x"))).toBe(true);
    expect(typeof api.artworkImage).toBe("function");
    expect(typeof api.createConnect).toBe("function");
    player.dispose();
  });
});

describe("what an app carries because of this package", () => {
  test("no signing code, no key, and no reach into the page's storage: a page can be read by anyone, and so can its bundle", { timeout: 60_000 }, async () => {
    const code = await carried();
    expect(code).toContain("createBrowserClient");
    expect(code).not.toContain("@open-music-sdk/");
    expect(code).not.toMatch(/jose|SignJWT|importPKCS8|mintDeveloperToken|BEGIN PRIVATE KEY/);
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
  });

  test("the check can tell: the main entry of developer-token does name jose, so its absence here means something", () => {
    const main = readFileSync(createRequire(import.meta.url).resolve("@open-music-sdk/developer-token"), "utf8");
    expect(main).toMatch(/from\s*"jose"/);
  });
});

describe("the two client factories are used in the same way", () => {
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${b64url({ alg: "ES256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 900 })}.c2ln`;
  const PEM = "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----";
  const IDS = { teamId: "DEF123GHIJ", keyId: "ABC123DEFG" };
  const fetch = vi.fn((): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ token }))));
  const both = () => [server.createServerClient({ pem: PEM, ...IDS, fetch, storefront: "us" }), api.createBrowserClient({ tokenUrl: "https://app.example/api/music/token", endpoint: { fetch }, fetch, storefront: "us" })] as const;

  test("each gives one frozen object inheriting nothing, with the same functions on it and the namespaces made for it; the page's has the provider beside", () => {
    const [onServer, onPage] = both();
    for (const music of [onServer, onPage]) {
      expect(Object.isFrozen(music)).toBe(true);
      expect(Object.getPrototypeOf(music)).toBeNull();
      expect(Object.values(Object.getOwnPropertyDescriptors(music)).every((each) => typeof each.value === "function" || Object.isFrozen(each.value))).toBe(true);
    }
    const shared = Object.keys(onServer).sort();
    expect(shared).toEqual(["as", "catalog", "forUser", "paginate", "playlists", "request", "storefront", "user"]);
    expect(Object.keys(onPage).sort()).toEqual([...shared, "developerToken"].sort());
    expect(Object.keys(onServer.as("t")).sort()).toEqual(shared);
    expect(Object.keys(onPage.as("t")).sort()).toEqual(Object.keys(onPage).sort());
  });

  test("making either asks nothing: not the key, not the endpoint, not Apple", () => {
    both();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("the same mistake is the same TypeError, under each one's own name, and what the feature packages check they name themselves", () => {
    expect(() => server.createServerClient([] as never)).toThrow(new TypeError("createServerClient: expected an options object with pem, teamId and keyId; got a list"));
    expect(() => api.createBrowserClient([] as never)).toThrow(new TypeError("createBrowserClient: expected an options object with tokenUrl; got a list"));
    expect(() => server.createServerClient({ pem: PEM, ...IDS, fetch: 42 as never })).toThrow(new TypeError("createClient: fetch must be a function; got 42"));
    expect(() => api.createBrowserClient({ tokenUrl: "/t", fetch: 42 as never })).toThrow(new TypeError("createClient: fetch must be a function; got 42"));
    expect(() => server.createServerClient({ pem: PEM, teamId: "x", keyId: IDS.keyId })).toThrow(/^developer token: teamId must be/);
    expect(() => api.createBrowserClient({ tokenUrl: "/t", endpoint: { timeoutMs: 0 } })).toThrow(/^developerTokenFetcher: timeoutMs must be/);
  });
});

describe("the package manifest", () => {
  test("the feature packages a page uses are ordinary dependencies on a caret range, the types on an exact one, and nothing is a peer", () => {
    const deps = Object.entries(manifest.dependencies);
    expect(deps.map(([name]) => name)).toEqual([
      "@open-music-sdk/client-catalog",
      "@open-music-sdk/client-user",
      "@open-music-sdk/core",
      "@open-music-sdk/developer-token",
      "@open-music-sdk/lib-playlists",
      "@open-music-sdk/lib-preview-player",
      "@open-music-sdk/types",
      "@open-music-sdk/user-token",
      "@open-music-sdk/util-artwork",
      "@open-music-sdk/validate",
    ]);
    expect(deps.filter(([name]) => name !== "@open-music-sdk/types").every(([, range]) => range === "workspace:^")).toBe(true);
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("nothing from outside the family is a dependency: the server package and jose are here for the tests alone", () => {
    expect(Object.keys(manifest.dependencies).every((name) => name.startsWith("@open-music-sdk/"))).toBe(true);
    expect(manifest.devDependencies).toHaveProperty("@open-music-sdk/server", "workspace:*");
    expect(manifest.devDependencies).toHaveProperty("jose", "catalog:");
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

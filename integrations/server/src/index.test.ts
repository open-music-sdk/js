import { readFileSync } from "node:fs";
import * as catalogPackage from "@open-music-sdk/client-catalog";
import * as userPackage from "@open-music-sdk/client-user";
import * as core from "@open-music-sdk/core";
import * as developerToken from "@open-music-sdk/developer-token";
import * as playlistsPackage from "@open-music-sdk/lib-playlists";
import * as userToken from "@open-music-sdk/user-token";
import * as artwork from "@open-music-sdk/util-artwork";
import * as validate from "@open-music-sdk/validate";
import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

/** What an app uses of core. The rest is what the clients are declared with, and `createClient`, which an assembly of one's own takes from core. */
const CORE = ["AppleMusicError", "createRateLimiter", "isAppleMusicError"];
const OWN = ["createServerClient", "tokenEndpoint"];
const siblings = { developerToken, userToken, artwork, catalogPackage, userPackage, playlistsPackage };

describe("the package entry", () => {
  test("exports its own two functions, the app-facing names of core, every runtime export of the feature packages, and the validators as schemas: nothing else, and nothing twice", () => {
    const expected = [...OWN, ...CORE, ...Object.values(siblings).flatMap((pkg) => Object.keys(pkg)), "schemas"];
    expect(new Set(expected).size).toBe(expected.length);
    expect(Object.keys(api).sort()).toEqual([...expected].sort());
  });

  test("the names of core it leaves out are the builders, the checks and createClient, and every one of them is there in core to leave out", () => {
    const left = Object.keys(core).filter((name) => !CORE.includes(name));
    expect(left).toContain("createClient");
    expect(left).toContain("endpoint");
    expect(left).toContain("clientOf");
    expect(left.filter((name) => Object.hasOwn(api, name))).toEqual([]);
    expect(CORE.filter((name) => !Object.hasOwn(core, name))).toEqual([]);
  });

  test("schemas is the whole of validate, under one name", () => {
    expect(Object.keys(api.schemas).sort()).toEqual(Object.keys(validate).sort());
    expect(api.schemas.song).toBe(validate.song);
  });

  test("the types it names are the siblings' own, read from the entry, and the generated ones whole", () => {
    const source = readFileSync(new URL("index.ts", import.meta.url), "utf8");
    expect(source).toMatch(/^export type \* from "@open-music-sdk\/types";$/m);
    const named = [...source.matchAll(/^export type \{([^}]+)\} from "([^"]+)";$/gms)].map((line) => [line[2] ?? "", (line[1] ?? "").split(",").map((name) => name.trim()).filter(Boolean)] as const);
    expect(named.map(([from]) => from)).toEqual(["./client", "./token-endpoint", "@open-music-sdk/core", "@open-music-sdk/developer-token", "@open-music-sdk/user-token", "@open-music-sdk/util-artwork", "@open-music-sdk/lib-playlists"]);
    expect(named.find(([from]) => from === "./client")?.[1]).toEqual(["tMusic", "tServerClientOptions"]);
  });

  test("is the only one", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test("from a key to a playlist read with a listener's token the intake stored, using nothing but the entry", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const calls: Request[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      const req = input instanceof Request ? input : new Request(input);
      calls.push(req);
      const path = new URL(req.url).pathname;
      const body = path.endsWith("/me/storefront") ? { data: [{ id: "us", type: "storefronts", href: "/v1/storefronts/us" }] } : { data: [{ id: "p.1", type: "library-playlists", href: "/v1/me/library/playlists/p.1", attributes: { name: "Road trip", canEdit: true } }] };
      return Promise.resolve(new Response(JSON.stringify(body)));
    };
    const store = new api.MemoryUserTokenStore();
    const music = api.createServerClient({ pem: await exportPKCS8(pair.privateKey), teamId: "DEF123GHIJ", keyId: "ABC123DEFG", fetch, retry: false, storefront: "us", userTokenStore: store });
    const intake = api.userTokenIntake(music, { store, userId: () => "u1" });
    const posted = await intake(new Request("https://app.example/music/user-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "listener" }) }));
    expect(posted.status).toBe(204);
    expect(await music.forUser("u1").user.getLibraryPlaylist("p.1")).toMatchObject({ id: "p.1" });
    expect(calls.map((c) => `${new URL(c.url).pathname} ${c.headers.get("music-user-token") ?? "-"}`)).toEqual(["/v1/me/storefront listener", "/v1/me/library/playlists/p.1 listener"]);
    expect(api.isAppleMusicError(new api.AppleMusicError("ApiError", "x"))).toBe(true);
    expect(typeof api.artworkImage).toBe("function");
    expect(typeof api.getAlbum).toBe("function");
    expect(typeof api.playlists).toBe("function");
    expect(typeof api.schemas.song["~standard"].validate).toBe("function");
  });

  test("no source file names process or env: the key and its ids are handed over, never read from an environment", () => {
    for (const file of ["index.ts", "client.ts", "token-endpoint.ts"]) expect(readFileSync(new URL(file, import.meta.url), "utf8"), file).not.toMatch(/\bprocess\b|\benv\b/i);
  });
});

describe("the package manifest", () => {
  test("the feature packages are ordinary dependencies on a caret range, the types on an exact one, and nothing is a peer", () => {
    const deps = Object.entries(manifest.dependencies);
    expect(deps.map(([name]) => name)).toEqual(["@open-music-sdk/client-catalog", "@open-music-sdk/client-user", "@open-music-sdk/core", "@open-music-sdk/developer-token", "@open-music-sdk/lib-playlists", "@open-music-sdk/types", "@open-music-sdk/user-token", "@open-music-sdk/util-artwork", "@open-music-sdk/validate"]);
    expect(deps.filter(([name]) => name !== "@open-music-sdk/types").every(([, range]) => range === "workspace:^")).toBe(true);
    expect(manifest.dependencies["@open-music-sdk/types"]).toBe("workspace:*");
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("nothing from outside the family is a dependency: jose arrives through developer-token, and is here for the tests alone", () => {
    expect(Object.keys(manifest.dependencies).every((name) => name.startsWith("@open-music-sdk/"))).toBe(true);
    expect(manifest.devDependencies).toHaveProperty("jose", "catalog:");
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

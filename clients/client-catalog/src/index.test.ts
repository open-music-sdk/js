import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { AppleMusicError, createClient, isAppleMusicError } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

/** One answer from Apple. */
interface tReply {
  status?: number;
  body?: unknown;
}

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A fetch that answers from a queue of replies, then with one song, and records every Request it saw. */
function apple(replies: tReply[] = []) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: { data: [{ id: "1", type: "songs" }] } };
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return { fetch, calls, sent: () => calls.map((c) => [new URL(c.url).pathname, c.headers.get("music-user-token")]) };
}

const all = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
};

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

/** The functions for endpoints, by the names they are exported under. */
const functions = Object.entries(api).filter(([, value]) => typeof (value as { bound?: unknown }).bound === "function") as [string, (...args: unknown[]) => Promise<unknown>][];

describe("the package entry", () => {
  test("exports the documented names and nothing else", () => {
    expect(Object.keys(api).sort()).toEqual([
      "catalog",
      "getActivities",
      "getActivity",
      "getActivityRelationship",
      "getAlbum",
      "getAlbumRelationship",
      "getAlbumView",
      "getAlbums",
      "getAlbumsByEquivalents",
      "getAlbumsByUpc",
      "getAppleCurator",
      "getAppleCuratorRelationship",
      "getAppleCurators",
      "getArtist",
      "getArtistRelationship",
      "getArtistView",
      "getArtists",
      "getCatalogResources",
      "getCharts",
      "getCurator",
      "getCuratorRelationship",
      "getCurators",
      "getGenre",
      "getGenres",
      "getLanguageTag",
      "getLiveRadioStations",
      "getMusicVideo",
      "getMusicVideoRelationship",
      "getMusicVideoView",
      "getMusicVideos",
      "getMusicVideosByEquivalents",
      "getMusicVideosByIsrc",
      "getPlaylist",
      "getPlaylistRelationship",
      "getPlaylistView",
      "getPlaylists",
      "getPlaylistsByStorefrontChart",
      "getRecordLabel",
      "getRecordLabelView",
      "getRecordLabels",
      "getSearchHints",
      "getSearchSuggestions",
      "getSong",
      "getSongRelationship",
      "getSongs",
      "getSongsByEquivalents",
      "getSongsByIsrc",
      "getStation",
      "getStationGenre",
      "getStationGenreRelationship",
      "getStationGenres",
      "getStationRelationship",
      "getStations",
      "getStorefront",
      "getStorefronts",
      "listGenres",
      "listStationGenres",
      "listStorefronts",
      "searchCatalog",
    ]);
  });

  test("is the only one", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test.each(functions)("%s is known in its errors by the name it is exported under", async (name, fn) => {
    const error: unknown = await fn(undefined).catch((e: unknown) => e);
    expect(error).toEqual(new TypeError(`${name}: client must be a client from createClient; got undefined`));
  });

  test("reads no environment: nothing it exports takes one, and none of them looks for one", async () => {
    const env = vi.fn();
    vi.stubGlobal("process", new Proxy({}, { get: env }));
    const { fetch } = apple();
    const music = createClient({ developerToken: "dev", storefront: "us", fetch, retry: false });
    try {
      await api.getSong(music, "1");
      await api.searchCatalog(music, "x", { types: ["songs"] });
      await api.catalog(music).getSongs(["1"]);
      await all(api.catalog(music).listGenres());
      expect(env).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("the errors it throws for Apple's verdicts are the ones core recognises", async () => {
    const { fetch } = apple([{ status: 404 }, { body: { data: [] } }]);
    const music = createClient({ developerToken: "dev", storefront: "us", fetch, retry: false });
    expect(isAppleMusicError(await api.getSong(music, "1").catch((e: unknown) => e), "ApiError")).toBe(true);
    expect(isAppleMusicError(await api.catalog(music).getSong("1").catch((e: unknown) => e), "ApiError")).toBe(true);
  });

  test("the errors it throws for a caller's mistakes are TypeErrors, which core does not take for Apple's", async () => {
    const { fetch, calls } = apple();
    const error: unknown = await api.getSong(createClient({ developerToken: "dev", storefront: "us", fetch, retry: false }), "").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(isAppleMusicError(error)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("the sources", () => {
  const sources = readdirSync(new URL(".", import.meta.url))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file): [string, string] => [file, readFileSync(new URL(file, import.meta.url), "utf8")]);

  test("every declaration is marked as having no effect of its own, so a bundler leaves out of an app the functions it did not import", () => {
    // A constant at the top of a module whose value is a call, such as a declaration: unmarked, it is kept whether or not it is used.
    const unmarked = sources.flatMap(([file, source]) => [...source.matchAll(/^(?:export )?const (\w+) = [A-Za-z_]\w*[<(]/gm)].map((match) => `${file}: ${match[1] ?? ""}`));
    expect(unmarked).toEqual([]);
    const marked = sources.flatMap(([, source]) => [...source.matchAll(/^export const \w+ = \/\*#__PURE__\*\/ /gm)]);
    expect(marked).toHaveLength(functions.length);
  });

  test("the check that says so can tell: a declaration written without the mark is found", () => {
    expect('export const getSong = resourceGetter<tSongsResponse>("getSong", songs);').toMatch(/^(?:export )?const (\w+) = [A-Za-z_]\w*[<(]/m);
  });
});

describe("an app whose copy of core is not the one this package resolves", () => {
  /** A second copy of core, as an app on another version of it has: its own error class, its own client. */
  async function foreign(replies: tReply[] = []) {
    vi.resetModules();
    const core = await import("@open-music-sdk/core");
    const { fetch, calls, sent } = apple(replies);
    return { core, calls, sent, music: core.createClient({ developerToken: "dev", storefront: "us", fetch, retry: false }) };
  }

  test("a client from that copy is a client to every function here, and to the namespace", async () => {
    const { music, sent } = await foreign();
    await api.getSong(music, "1");
    await api.getAlbumView(music, "1", "other-versions");
    await api.catalog(music).getSong("1");
    await all(api.catalog(music).listGenres());
    expect(sent().map(([path]) => path)).toEqual(["/v1/catalog/us/songs/1", "/v1/catalog/us/albums/1/view/other-versions", "/v1/catalog/us/songs/1", "/v1/catalog/us/genres"]);
  });

  test("an error Apple answered with is recognised by that copy's guard and by this one's", async () => {
    const { core, music } = await foreign([{ status: 429 }]);
    const error: unknown = await api.getSong(music, "1").catch((e: unknown) => e);
    expect([isAppleMusicError(error, "RateLimited"), core.isAppleMusicError(error, "RateLimited")]).toEqual([true, true]);
  });

  test("the error for a success that holds no resource is made by this package's copy, and is recognised by that copy all the same", async () => {
    const { core, music } = await foreign([{ body: { data: [] } }]);
    const error: unknown = await api.catalog(music).getSong("1").catch((e: unknown) => e);
    expect(core.AppleMusicError).not.toBe(AppleMusicError);
    expect(Object.getPrototypeOf(error)).toBe(AppleMusicError.prototype);
    expect([isAppleMusicError(error, "ApiError"), core.isAppleMusicError(error, "ApiError"), error instanceof core.AppleMusicError]).toEqual([true, true, true]);
  });
});

describe("what a server is asked, from a function to the wire", () => {
  /** A server that answers every request with an empty list, and records what it was asked. Requests for Apple are sent to it instead. */
  async function wire() {
    const asked: { method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders }[] = [];
    const server = createServer((req, res) => {
      asked.push({ method: req.method, url: req.url, headers: req.headers });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname, search } = new URL(request.url);
      return globalThis.fetch(`http://127.0.0.1:${String(port)}${pathname}${search}`, { method: request.method, headers: request.headers });
    };
    return { asked, music: createClient({ developerToken: "dev", storefront: "us", userToken: "listener", fetch, retry: false }), close: () => new Promise((resolve) => server.close(resolve)) };
  }

  test("the path and the query arrive as they were built, with the developer token and no listener's", async () => {
    const { asked, music, close } = await wire();
    try {
      await api.getAlbum(music, "1613600183", { storefront: "gb", language: "en-GB", views: ["other-versions"] });
      await api.searchCatalog(music, "james brown & co", { types: ["songs", "albums"] });
      expect(asked.map((each) => `${each.method ?? ""} ${each.url ?? ""}`)).toEqual([
        "GET /v1/catalog/gb/albums/1613600183?l=en-GB&views=other-versions",
        "GET /v1/catalog/us/search?term=james+brown+%26+co&types=songs%2Calbums",
      ]);
      expect(asked.map((each) => [each.headers.authorization, each.headers["music-user-token"]])).toEqual([
        ["Bearer dev", undefined],
        ["Bearer dev", undefined],
      ]);
    } finally {
      await close();
    }
  });

  test("an id, a name or a storefront that would leave the catalog never reaches the wire, and what is only odd arrives as one segment", async () => {
    const { asked, music, close } = await wire();
    try {
      const refused = [
        api.getSong(music, "../../../me/library/songs"),
        api.getSong(music, "1", { storefront: "../me" }),
        api.getAlbumRelationship(music, "1", "../../../../me/storefront" as "tracks"),
        api.getAlbumView(music, "..%2F..%2Fme", "other-versions"),
      ];
      for (const each of refused) expect(await each.catch((e: unknown) => e)).toBeInstanceOf(TypeError);
      expect(asked).toEqual([]);
      await api.getAlbumView(music, "1?include=library", "other-versions");
      await api.getSong(music, "1#x", { storefront: "u s" });
      expect(asked.map((each) => each.url)).toEqual(["/v1/catalog/us/albums/1%3Finclude%3Dlibrary/view/other-versions", "/v1/catalog/u%20s/songs/1%23x"]);
      expect(asked.every((each) => each.headers["music-user-token"] === undefined)).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("the package manifest", () => {
  const [core, types] = ["@open-music-sdk/core", "@open-music-sdk/types"] as const;

  test("core is an ordinary dependency on a caret range, as it is for the rest of the family", () => {
    expect(manifest.dependencies[core]).toBe("workspace:^");
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("the types are a dependency too, since what the functions resolve to is declared in terms of them", () => {
    expect(manifest.dependencies[types]).toBe("workspace:*");
  });

  test("those two are the only dependencies: nothing validates, and nothing signs", () => {
    expect(Object.keys(manifest.dependencies)).toEqual([core, types]);
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import * as catalog from "@open-music-sdk/client-catalog";
import { AppleMusicError, createClient, isAppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
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
    const reply = replies.shift() ?? { body: { data: [{ id: "i.1", type: "library-songs" }] } };
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    fetch,
    calls,
    sent: () => calls.map((c) => [new URL(c.url).pathname, c.headers.get("music-user-token")]),
    /** Each request as its method, path and query. */
    lines: () => calls.map((c) => `${c.method} ${new URL(c.url).pathname}${decodeURIComponent(new URL(c.url).search)}`),
  };
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
      "addLibraryPlaylistTracks",
      "addToFavorites",
      "addToLibrary",
      "createLibraryPlaylist",
      "createLibraryPlaylistFolder",
      "deleteAlbumRating",
      "deleteLibraryAlbumRating",
      "deleteLibraryMusicVideoRating",
      "deleteLibraryPlaylistRating",
      "deleteLibrarySongRating",
      "deleteMusicVideoRating",
      "deletePlaylistRating",
      "deleteSongRating",
      "deleteStationRating",
      "getAlbumRating",
      "getAlbumRatings",
      "getLibraryAlbum",
      "getLibraryAlbumRating",
      "getLibraryAlbumRatings",
      "getLibraryAlbumRelationship",
      "getLibraryAlbums",
      "getLibraryArtist",
      "getLibraryArtistRelationship",
      "getLibraryArtists",
      "getLibraryMusicVideo",
      "getLibraryMusicVideoRating",
      "getLibraryMusicVideoRatings",
      "getLibraryMusicVideoRelationship",
      "getLibraryMusicVideos",
      "getLibraryPlaylist",
      "getLibraryPlaylistFolder",
      "getLibraryPlaylistFolderRelationship",
      "getLibraryPlaylistFolders",
      "getLibraryPlaylistRating",
      "getLibraryPlaylistRatings",
      "getLibraryPlaylistRelationship",
      "getLibraryPlaylists",
      "getLibraryResources",
      "getLibrarySong",
      "getLibrarySongRating",
      "getLibrarySongRatings",
      "getLibrarySongRelationship",
      "getLibrarySongs",
      "getMusicSummariesByYear",
      "getMusicVideoRating",
      "getMusicVideoRatings",
      "getPersonalRecommendation",
      "getPersonalRecommendationRelationship",
      "getPersonalRecommendations",
      "getPersonalStation",
      "getPlaylistRating",
      "getPlaylistRatings",
      "getRootLibraryPlaylistFolder",
      "getSongRating",
      "getSongRatings",
      "getStationRating",
      "getStationRatings",
      "getUserStorefront",
      "listHeavyRotation",
      "listLibraryAlbums",
      "listLibraryArtists",
      "listLibraryMusicVideos",
      "listLibraryPlaylists",
      "listLibrarySongs",
      "listPersonalRecommendations",
      "listRecentlyAdded",
      "listRecentlyPlayed",
      "listRecentlyPlayedStations",
      "listRecentlyPlayedTracks",
      "searchLibrary",
      "setAlbumRating",
      "setLibraryAlbumRating",
      "setLibraryMusicVideoRating",
      "setLibraryPlaylistRating",
      "setLibrarySongRating",
      "setMusicVideoRating",
      "setPlaylistRating",
      "setSongRating",
      "setStationRating",
      "user",
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
    const music = createClient({ developerToken: "dev", userToken: "listener", fetch, retry: false });
    try {
      await api.getLibrarySong(music, "i.1");
      await api.setSongRating(music, "1", 1);
      await api.createLibraryPlaylist(music, { attributes: { name: "Road" } });
      await api.user(music).getLibrarySongs(["i.1"]);
      await all(api.user(music).listLibrarySongs());
      expect(env).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("the errors it throws for Apple's verdicts are the ones core recognises", async () => {
    const { fetch } = apple([{ status: 403 }, { body: { data: [] } }]);
    const music = createClient({ developerToken: "dev", userToken: "listener", fetch, retry: false });
    expect(isAppleMusicError(await api.getLibrarySong(music, "i.1").catch((e: unknown) => e), "UserTokenInvalid")).toBe(true);
    expect(isAppleMusicError(await api.user(music).getLibrarySong("i.1").catch((e: unknown) => e), "ApiError")).toBe(true);
  });

  test("the errors it throws for a caller's mistakes are TypeErrors, which core does not take for Apple's", async () => {
    const { fetch, calls } = apple();
    const error: unknown = await api.setSongRating(createClient({ developerToken: "dev", userToken: "listener", fetch, retry: false }), "1", 5 as 1).catch((e: unknown) => e);
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
    expect('export const getSongRating = resourceGetter<tRatingsResponse>("getSongRating", songs);').toMatch(/^(?:export )?const (\w+) = [A-Za-z_]\w*[<(]/m);
  });
});

describe("an app whose copy of core is not the one this package resolves", () => {
  /** A second copy of core, as an app on another version of it has: its own error class, its own client. */
  async function foreign(replies: tReply[] = []) {
    vi.resetModules();
    const core = await import("@open-music-sdk/core");
    const { fetch, calls, sent } = apple(replies);
    return { core, calls, sent, music: core.createClient({ developerToken: "dev", userToken: "listener", fetch, retry: false }) };
  }

  test("a client from that copy is a client to every function here, and to the namespace", async () => {
    const { music, sent } = await foreign();
    await api.getLibrarySong(music, "i.1");
    await api.setSongRating(music, "1", 1);
    await api.user(music).getLibrarySong("i.1");
    await all(api.user(music).listLibrarySongs());
    expect(sent()).toEqual([
      ["/v1/me/library/songs/i.1", "listener"],
      ["/v1/me/ratings/songs/1", "listener"],
      ["/v1/me/library/songs/i.1", "listener"],
      ["/v1/me/library/songs", "listener"],
    ]);
  });

  test("an error Apple answered with is recognised by that copy's guard and by this one's", async () => {
    const { core, music } = await foreign([{ status: 403 }]);
    const error: unknown = await api.getLibrarySong(music, "i.1").catch((e: unknown) => e);
    expect([isAppleMusicError(error, "UserTokenInvalid"), core.isAppleMusicError(error, "UserTokenInvalid")]).toEqual([true, true]);
  });

  test("the error for a success that holds no resource is made by this package's copy, and is recognised by that copy all the same", async () => {
    const { core, music } = await foreign([{ body: { data: [] } }]);
    const error: unknown = await api.user(music).getLibrarySong("i.1").catch((e: unknown) => e);
    expect(core.AppleMusicError).not.toBe(AppleMusicError);
    expect(Object.getPrototypeOf(error)).toBe(AppleMusicError.prototype);
    expect([isAppleMusicError(error, "ApiError"), core.isAppleMusicError(error, "ApiError"), error instanceof core.AppleMusicError]).toEqual([true, true, true]);
  });
});

describe("what a server is asked, from a function to the wire", () => {
  /** A server that answers every request with an empty list, and records what it was asked. Requests for Apple are sent to it instead. */
  async function wire() {
    const asked: { method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        asked.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname, search } = new URL(request.url);
      const body = request.body === null ? null : await request.text();
      return globalThis.fetch(`http://127.0.0.1:${String(port)}${pathname}${search}`, { method: request.method, headers: request.headers, body });
    };
    return { asked, music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false }), close: () => new Promise((resolve) => server.close(resolve)) };
  }

  test("the path, the query and the body arrive as they were built, with both tokens", async () => {
    const { asked, music, close } = await wire();
    try {
      await api.getLibraryPlaylistRelationship(music, "p.1", "tracks", { language: "en-GB", limit: 5 });
      await api.setSongRating(music, "1613600188", -1);
      await api.addLibraryPlaylistTracks(music, "p.1", [{ id: "1613600188", type: "songs" }]);
      await api.getPersonalStation(music);
      expect(asked.map((each) => `${each.method ?? ""} ${each.url ?? ""}`)).toEqual([
        "GET /v1/me/library/playlists/p.1/tracks?l=en-GB&limit=5",
        "PUT /v1/me/ratings/songs/1613600188",
        "POST /v1/me/library/playlists/p.1/tracks",
        "GET /v1/catalog/us/stations?filter%5Bidentity%5D=personal",
      ]);
      expect(asked.map((each) => each.body)).toEqual(["", '{"type":"ratings","attributes":{"value":-1}}', '{"data":[{"id":"1613600188","type":"songs"}]}', ""]);
      expect(asked.map((each) => [each.headers.authorization, each.headers["music-user-token"]])).toEqual(Array.from({ length: 4 }, () => ["Bearer dev", "listener"]));
    } finally {
      await close();
    }
  });

  test("an id, a name or a storefront that would leave its collection never reaches the wire, and what is only odd arrives as one segment", async () => {
    const { asked, music, close } = await wire();
    try {
      const refused = [
        api.getLibrarySong(music, "../../ratings/songs/1"),
        api.deleteSongRating(music, "../../library/songs/i.1"),
        api.getLibraryAlbumRelationship(music, "l.1", "../../../storefront" as "tracks"),
        api.getPersonalStation(music, { storefront: "../me/library" }),
        api.addLibraryPlaylistTracks(music, "p.1%2F..%2Fp.2", [{ id: "1", type: "songs" }]),
      ];
      for (const each of refused) expect(await each.catch((e: unknown) => e)).toBeInstanceOf(TypeError);
      expect(asked).toEqual([]);
      await api.getLibrarySong(music, "i.1?include=catalog");
      await api.deleteSongRating(music, "1#x");
      expect(asked.map((each) => `${each.method ?? ""} ${each.url ?? ""}`)).toEqual(["GET /v1/me/library/songs/i.1%3Finclude%3Dcatalog", "DELETE /v1/me/ratings/songs/1%23x"]);
    } finally {
      await close();
    }
  });
});

describe("the two client packages are used in the same way", () => {
  /** A client for each package over fetches of their own, and what each was asked with the part that says whose resource it is taken off. */
  function pair() {
    const [theirs, mine] = [apple(), apple()];
    const of = (each: ReturnType<typeof apple>, prefix: string) => each.lines().map((line) => line.replace(prefix, "/"));
    return {
      store: createClient({ developerToken: "dev", storefront: "us", fetch: theirs.fetch, retry: false }),
      listener: createClient({ developerToken: "dev", userToken: "listener", fetch: mine.fetch, retry: false }),
      asked: () => [of(theirs, "/v1/catalog/us/"), of(mine, "/v1/me/library/")],
    };
  }
  const options = { language: "en-GB", include: ["albums"], extend: ["artistUrl"], limit: 5, params: { "fields[albums]": "name" } };

  test.each(["Song", "Album", "Artist", "MusicVideo", "Playlist"] as const)("what the catalog has for a %s, the library has under the same name with Library in it", (noun) => {
    for (const [before, after] of [
      ["get", ""],
      ["get", "s"],
      ["get", "Relationship"],
    ]) {
      expect(catalog).toHaveProperty(`${before ?? ""}${noun}${after ?? ""}`);
      expect(api).toHaveProperty(`${before ?? ""}Library${noun}${after ?? ""}`);
    }
  });

  test("the ones that follow no pattern are paired the same way: a search, and resources by type", () => {
    expect([typeof catalog.searchCatalog, typeof api.searchLibrary, typeof catalog.getCatalogResources, typeof api.getLibraryResources]).toEqual(Array.from({ length: 4 }, () => "function"));
    expect([typeof catalog.catalog, typeof api.user]).toEqual(["function", "function"]);
  });

  test.each<[string, (store: tAppleMusicClient) => unknown, (listener: tAppleMusicClient) => unknown]>([
    ["one resource", (store) => catalog.getSong(store, "1", options), (listener) => api.getLibrarySong(listener, "1", options)],
    ["several", (store) => catalog.getSongs(store, ["1", "2"], options), (listener) => api.getLibrarySongs(listener, ["1", "2"], options)],
    ["a relationship", (store) => catalog.getAlbumRelationship(store, "1", "tracks", options), (listener) => api.getLibraryAlbumRelationship(listener, "1", "tracks", options)],
    ["one resource, bound", (store) => catalog.catalog(store).getAlbum("1", options), (listener) => api.user(listener).getLibraryAlbum("1", options)],
    ["several, bound", (store) => catalog.catalog(store).getArtists(["1"], options), (listener) => api.user(listener).getLibraryArtists(["1"], options)],
    ["a relationship, bound and walked", (store) => all(catalog.catalog(store).getPlaylistRelationship("1", "tracks", options)), (listener) => all(api.user(listener).getLibraryPlaylistRelationship("1", "tracks", options))],
    ["a search", (store) => catalog.searchCatalog(store, "james brown", { types: ["songs"], limit: 5 }), (listener) => api.searchLibrary(listener, "james brown", { types: ["songs" as "library-songs"], limit: 5 })],
  ])("the same call for %s sends the same request, to the library where the catalog's went to the catalog", async (_name, theirs, mine) => {
    const { store, listener, asked } = pair();
    await theirs(store);
    await mine(listener);
    const [catalogs, librarys] = asked();
    expect(librarys).toEqual(catalogs);
    expect(catalogs).toHaveLength(1);
  });

  test("a whole collection is listed the same way, whichever collection it is", async () => {
    const { store, listener, asked } = pair();
    const page = { ...options, offset: 10 };
    await catalog.listGenres(store, page);
    await api.listLibrarySongs(listener, page);
    await all(catalog.catalog(store).listGenres(page));
    await all(api.user(listener).listLibrarySongs(page));
    const [catalogs, librarys] = asked();
    expect(librarys?.map((line) => line.replace("songs", "genres"))).toEqual(catalogs);
  });

  test("the same mistake is the same TypeError, under each function's own name", async () => {
    const { store, listener } = pair();
    const message = async (asked: Promise<unknown>) => ((await asked.catch((e: unknown) => e)) as Error).message;
    expect(await message(api.getLibrarySong(listener, ".."))).toBe((await message(catalog.getSong(store, ".."))).replace("getSong", "getLibrarySong"));
    expect(await message(api.getLibrarySongs(listener, []))).toBe((await message(catalog.getSongs(store, []))).replace("getSongs", "getLibrarySongs"));
    expect(await message(api.listLibrarySongs(listener, { limit: 0 }))).toBe((await message(catalog.listGenres(store, { limit: 0 }))).replace("listGenres", "listLibrarySongs"));
    expect(await message(api.searchLibrary(listener, "", { types: ["library-songs"] }))).toBe((await message(catalog.searchCatalog(store, "", { types: ["songs"] }))).replace("searchCatalog", "searchLibrary"));
  });

  test("the types: what the two take differs only in what a catalog needs to be told and a library does not", () => {
    type tArgs<F> = F extends (client: tAppleMusicClient, ...args: infer A) => unknown ? A : never;
    type tOptions<F, At extends number> = Omit<NonNullable<tArgs<F>[At]>, "schema" | "storefront">;
    expectTypeOf<tArgs<typeof api.getLibrarySong>[0]>().toEqualTypeOf<tArgs<typeof catalog.getSong>[0]>();
    expectTypeOf<tArgs<typeof api.getLibrarySongs>[0]>().toEqualTypeOf<tArgs<typeof catalog.getSongs>[0]>();
    expectTypeOf<tOptions<typeof api.getLibrarySong, 1>>().toEqualTypeOf<tOptions<typeof catalog.getSong, 1>>();
    expectTypeOf<tOptions<typeof api.getLibrarySongs, 1>>().toEqualTypeOf<tOptions<typeof catalog.getSongs, 1>>();
    expectTypeOf<tOptions<typeof api.listLibrarySongs, 0>>().toEqualTypeOf<tOptions<typeof catalog.listGenres, 0>>();
    expectTypeOf<Parameters<typeof api.user>>().toEqualTypeOf<Parameters<typeof catalog.catalog>>();
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

  test("those two are the only dependencies: the catalog's package is here for the tests alone", () => {
    expect(Object.keys(manifest.dependencies)).toEqual([core, types]);
    expect(manifest.devDependencies).toHaveProperty("@open-music-sdk/client-catalog", "workspace:*");
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

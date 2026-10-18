import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { read } from "./read";

/** A track as the fake library keeps one. */
interface tKept {
  readonly id: string;
  readonly type?: string;
  readonly catalogId?: string;
  readonly isrc?: string;
  readonly name?: string;
  readonly artistName?: string;
  readonly albumName?: string;
  readonly durationInMillis?: number;
  /** Where the catalog's id is said: under the relationship, under playParams, or under both, as Apple's answers have it. */
  readonly said?: "relationship" | "playParams" | "both";
}

interface tReply {
  status?: number;
  body?: unknown;
}

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/**
 * A fetch that answers as Apple does for one playlist of the listener's library: the playlist itself, and its tracks
 * a page at a time. `override` answers in its place where it gives anything.
 */
function apple(
  tracks: readonly tKept[],
  options: { page?: number; empty?: "404" | "list"; nextKeeps?: boolean; override?: (path: string, offset: number) => tReply | undefined; attributes?: object; /** The tracks the playlist carries when it is asked for with them, where that differs from the tracks its relationship gives. */ says?: readonly tKept[] } = {},
) {
  const { page = 100, empty = "404", nextKeeps = true, attributes = { name: "Road trip", description: { standard: "made by my-app" }, canEdit: true } } = options;
  const calls: Request[] = [];
  const track = (kept: tKept, include: boolean) => {
    const said = kept.said ?? "both";
    return {
      id: kept.id,
      type: kept.type ?? "library-songs",
      href: `/v1/me/library/songs/${kept.id}`,
      attributes: {
        name: kept.name,
        artistName: kept.artistName,
        albumName: kept.albumName,
        durationInMillis: kept.durationInMillis,
        playParams: { id: kept.id, kind: "song", isLibrary: true, ...(kept.catalogId !== undefined && said !== "relationship" ? { catalogId: kept.catalogId } : {}) },
      },
      ...(include && kept.catalogId !== undefined && said !== "playParams" ? { relationships: { catalog: { data: [{ id: kept.catalogId, type: "songs", attributes: { isrc: kept.isrc } }] } } } : {}),
    };
  };
  const answer = (url: URL): tReply => {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const given = options.override?.(url.pathname, offset);
    if (given !== undefined) return given;
    if (url.pathname === "/v1/me/library/playlists/p.1") {
      // Asked for with its tracks, the playlist carries the first of them, as Apple documents.
      const withTracks = (url.searchParams.get("include") ?? "").split(",").includes("tracks");
      const relationships = withTracks ? { relationships: { tracks: { data: (options.says ?? tracks).slice(0, page).map((each) => track(each, false)) } } } : {};
      return { body: { data: [{ id: "p.1", type: "library-playlists", href: url.pathname, attributes, ...relationships }] } };
    }
    if (url.pathname === "/v1/me/library/playlists/p.1/tracks") {
      if (tracks.length === 0) return empty === "404" ? { status: 404, body: { errors: [{ status: "404", title: "Resource Not Found" }] } } : { body: { data: [] } };
      const include = (url.searchParams.get("include") ?? "").split(",").includes("catalog");
      const more = offset + page < tracks.length;
      const next = `${url.pathname}?offset=${String(offset + page)}${nextKeeps && include ? "&include=catalog" : ""}`;
      return { body: { data: tracks.slice(offset, offset + page).map((each) => track(each, include)), ...(more ? { next } : {}) } };
    }
    return { status: 404, body: { errors: [{ status: "404", title: "Resource Not Found" }] } };
  };
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    const reply = answer(new URL(request.url));
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false }),
    calls,
    /** Each request as its method, path and query. */
    lines: () => calls.map((c) => `${c.method} ${new URL(c.url).pathname}${decodeURIComponent(new URL(c.url).search)}`),
  };
}

/** `count` songs, each known to the catalog. */
const songs = (count: number): tKept[] => Array.from({ length: count }, (_, at) => ({ id: `i.${String(at)}`, catalogId: String(1000 + at), isrc: `ISRC${String(at)}`, name: `Song ${String(at)}`, artistName: "Artist" }));

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("read: a playlist whole, as plain JSON", () => {
  test("what it is called, and each track with the catalog's id for it and its ISRC", async () => {
    const { music } = apple([{ id: "i.1", catalogId: "900", isrc: "GBAYE0601498", name: "Hey Jude", artistName: "The Beatles", albumName: "1", durationInMillis: 425_653 }]);
    expect(await read(music, "p.1")).toEqual({
      id: "p.1",
      name: "Road trip",
      description: "made by my-app",
      canEdit: true,
      tracks: [{ id: "i.1", type: "library-songs", catalogId: "900", isrc: "GBAYE0601498", name: "Hey Jude", artistName: "The Beatles", albumName: "1", durationInMillis: 425_653 }],
    });
  });

  test("the playlist is asked for, and then its tracks with each one's catalog song", async () => {
    const { music, lines } = apple(songs(2));
    await read(music, "p.1");
    expect(lines()).toEqual(["GET /v1/me/library/playlists/p.1", "GET /v1/me/library/playlists/p.1/tracks?include=catalog"]);
  });

  test("every page is read, in order, however many there are", async () => {
    const { music, lines } = apple(songs(7), { page: 3 });
    const snapshot = await read(music, "p.1");
    expect(snapshot.tracks.map((track) => track.id)).toEqual(songs(7).map((track) => track.id));
    expect(lines().slice(1)).toEqual([
      "GET /v1/me/library/playlists/p.1/tracks?include=catalog",
      "GET /v1/me/library/playlists/p.1/tracks?offset=3&include=catalog",
      "GET /v1/me/library/playlists/p.1/tracks?offset=6&include=catalog",
    ]);
  });

  test("both tokens go with every request: the playlist is the listener's", async () => {
    const { music, calls } = apple(songs(4), { page: 2 });
    await read(music, "p.1");
    expect(calls.map((c) => [c.headers.get("authorization"), c.headers.get("music-user-token")])).toEqual(Array.from({ length: 3 }, () => ["Bearer dev", "listener"]));
  });

  test("it is plain JSON: the same after being written out and read back, with no field that holds nothing", async () => {
    const { music } = apple([{ id: "i.1", catalogId: "900", isrc: "A" }, { id: "i.2" }], { attributes: { name: "Bare", canEdit: false } });
    const snapshot = await read(music, "p.1");
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(Object.keys(snapshot)).toEqual(["id", "name", "canEdit", "tracks"]);
    expect(snapshot.tracks.map((track) => Object.keys(track))).toEqual([
      ["id", "type", "catalogId", "isrc"],
      ["id", "type"],
    ]);
  });

  test("it is frozen: the playlist, its list of tracks, and each track", async () => {
    const { music } = apple(songs(2));
    const snapshot = await read(music, "p.1");
    expect([snapshot, snapshot.tracks, ...snapshot.tracks].every((each) => Object.isFrozen(each))).toBe(true);
  });

  test("a music video in a playlist is a track like a song, under its own type", async () => {
    const { music } = apple([{ id: "i.v", type: "library-music-videos", catalogId: "77" }]);
    expect((await read(music, "p.1")).tracks).toEqual([{ id: "i.v", type: "library-music-videos", catalogId: "77" }]);
  });
});

describe("read: which catalog song a track is", () => {
  test("it is the song under the track's catalog relationship, which is where its ISRC is", async () => {
    const { music } = apple([{ id: "i.1", catalogId: "900", isrc: "A", said: "relationship" }]);
    expect((await read(music, "p.1")).tracks[0]).toEqual({ id: "i.1", type: "library-songs", catalogId: "900", isrc: "A" });
  });

  test("where an answer has no such relationship, the id under playParams is taken, and no ISRC is known", async () => {
    const { music } = apple([{ id: "i.1", catalogId: "900", isrc: "A", said: "playParams" }]);
    expect((await read(music, "p.1")).tracks[0]).toEqual({ id: "i.1", type: "library-songs", catalogId: "900" });
  });

  test("a track with neither is one the catalog does not know, such as an upload", async () => {
    const { music } = apple([{ id: "i.1", name: "A recording of my own" }]);
    expect((await read(music, "p.1")).tracks[0]).toEqual({ id: "i.1", type: "library-songs", name: "A recording of my own" });
  });

  test("a next link that drops include=catalog, as Apple's do, is asked with it again, so the tracks after the first page keep their ISRC", async () => {
    const { music, lines } = apple(songs(4), { page: 2, nextKeeps: false });
    const snapshot = await read(music, "p.1");
    expect(lines()[2]).toBe("GET /v1/me/library/playlists/p.1/tracks?offset=2&include=catalog");
    expect(snapshot.tracks.map((track) => track.catalogId)).toEqual(["1000", "1001", "1002", "1003"]);
    expect(snapshot.tracks.map((track) => track.isrc)).toEqual(["ISRC0", "ISRC1", "ISRC2", "ISRC3"]);
  });

  test("a next link that keeps include=catalog is asked as it is, with include once", async () => {
    const { music, lines } = apple(songs(4), { page: 2, nextKeeps: true });
    await read(music, "p.1");
    expect(lines()[2]).toBe("GET /v1/me/library/playlists/p.1/tracks?offset=2&include=catalog");
  });

  test.each<[string, object]>([
    ["a catalog id that is no string", { id: "i.1", type: "library-songs", attributes: { playParams: { catalogId: 900 } } }],
    ["a catalog id as long as a token", { id: "i.1", type: "library-songs", attributes: { playParams: { catalogId: "a".repeat(65) } } }],
    ["a relationship that holds no song", { id: "i.1", type: "library-songs", relationships: { catalog: { data: [] } } }],
    ["a relationship that is no relationship", { id: "i.1", type: "library-songs", relationships: { catalog: "900" } }],
    ["attributes that are no attributes", { id: "i.1", type: "library-songs", attributes: "none" }],
  ])("a track with %s is a track with no catalog id, and not an error", async (_name, track) => {
    const { music } = apple([], { override: (path) => (path.endsWith("/tracks") ? { body: { data: [track] } } : undefined) });
    expect((await read(music, "p.1")).tracks).toEqual([{ id: "i.1", type: "library-songs" }]);
  });

  test.each<[string, unknown]>([
    ["no id", { type: "library-songs" }],
    ["no type", { id: "i.1" }],
    ["nothing at all", null],
  ])("a track with %s is not a track: Apple's answer is the error, and says so", async (_name, track) => {
    const { music } = apple([], { override: (path) => (path.endsWith("/tracks") ? { body: { data: [track] } } : undefined) });
    const error: unknown = await read(music, "p.1").catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError")).toBe(true);
    expect((error as Error).message).toBe("playlists.read: Apple answered with a track that has no id or no type");
  });
});

describe("read: nothing on Object.prototype is read as Apple's", () => {
  const polluted = Object.prototype as Record<string, unknown>;
  const PLANTED = ["id", "type", "data", "catalogId", "isrc", "name", "artistName", "standard", "canEdit", "0"];

  afterEach(() => {
    for (const key of PLANTED) Reflect.deleteProperty(polluted, key);
  });

  test("a track with no catalog song and no playParams has no catalog id, whatever other code planted", async () => {
    const bare = { id: "i.1", type: "library-songs", attributes: { name: "Mine" } };
    const { music } = apple([], { override: (path) => (path.endsWith("/tracks") ? { body: { data: [bare] } } : undefined), attributes: { name: "Road trip" } });
    for (const key of PLANTED) polluted[key] = key === "0" ? { id: "planted", attributes: { isrc: "PLANTED00001" } } : "planted";
    const snapshot = await read(music, "p.1");
    for (const key of PLANTED) Reflect.deleteProperty(polluted, key);
    expect(snapshot).toEqual({ id: "p.1", name: "Road trip", tracks: [{ id: "i.1", type: "library-songs", name: "Mine" }] });
    expect(Object.keys(snapshot.tracks[0] ?? {})).toEqual(["id", "type", "name"]);
  });

  test("a track whose catalog relationship holds no song gets none from what is under 0 on Object.prototype", async () => {
    const empty = { id: "i.1", type: "library-songs", relationships: { catalog: { data: [] } } };
    const { music } = apple([], { override: (path) => (path.endsWith("/tracks") ? { body: { data: [empty] } } : undefined) });
    polluted["0"] = { id: "planted", attributes: { isrc: "PLANTED00001" } };
    const snapshot = await read(music, "p.1");
    Reflect.deleteProperty(polluted, "0");
    expect(snapshot.tracks).toEqual([{ id: "i.1", type: "library-songs" }]);
  });
});

describe("read: a playlist with nothing in it", () => {
  test("a 404 for the tracks of a playlist that is there is a playlist with no tracks, once the playlist asked for with its tracks bears that out", async () => {
    const { music, lines } = apple([], { empty: "404" });
    expect((await read(music, "p.1")).tracks).toEqual([]);
    expect(lines()).toEqual(["GET /v1/me/library/playlists/p.1", "GET /v1/me/library/playlists/p.1/tracks?include=catalog", "GET /v1/me/library/playlists/p.1?include=tracks"]);
  });

  test("a 404 for the tracks of a playlist that then shows it holds some is not an empty playlist: the 404 is what read rejects with", async () => {
    const { music } = apple([], { empty: "404", says: songs(2) });
    const error: unknown = await read(music, "p.1").catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError") && error.status).toBe(404);
    expect((error as Error).message).toContain("/tracks");
  });

  test("a playlist that carries no word of its tracks when asked for with them is taken at the 404's word", async () => {
    const { music } = apple([], { override: (path) => (path.endsWith("/p.1") ? { body: { data: [{ id: "p.1", type: "library-playlists", attributes: { name: "Road trip" } }] } } : undefined) });
    expect((await read(music, "p.1")).tracks).toEqual([]);
  });

  test("an empty list of tracks is the same", async () => {
    const { music } = apple([], { empty: "list" });
    expect((await read(music, "p.1")).tracks).toEqual([]);
  });

  test("a playlist that is not there is Apple's 404, and its tracks are not asked for", async () => {
    const { music, lines } = apple([], { override: () => ({ status: 404, body: { errors: [{ status: "404", title: "Resource Not Found" }] } }) });
    const error: unknown = await read(music, "p.1").catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError") && error.status).toBe(404);
    expect(lines()).toEqual(["GET /v1/me/library/playlists/p.1"]);
  });

  test("a 404 once some tracks have come is not an empty playlist: it rejects", async () => {
    const { music } = apple(songs(4), { page: 2, override: (path, offset) => (path.endsWith("/tracks") && offset > 0 ? { status: 404, body: { errors: [] } } : undefined) });
    const error: unknown = await read(music, "p.1").catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError") && error.status).toBe(404);
  });

  test.each([403, 429, 500])("a %s for the tracks is that error, and not a playlist with no tracks", async (status) => {
    const { music } = apple([], { override: (path) => (path.endsWith("/tracks") ? { status, body: { errors: [] } } : undefined) });
    const error: unknown = await read(music, "p.1").catch((e: unknown) => e);
    expect(isAppleMusicError(error) && error.status).toBe(status);
  });
});

describe("read: how far a walk may go, for a caller who says", () => {
  test("a playlist with more pages than maxPages allows is not read short: read rejects, and says why", async () => {
    const { music, lines } = apple(songs(7), { page: 3 });
    const error: unknown = await read(music, "p.1", { maxPages: 2 }).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError")).toBe(true);
    expect((error as Error).message).toBe("playlists.read: Apple names another page after the 2 that maxPages allows, so what was read is not all there is");
    expect(lines().filter((line) => line.includes("/tracks"))).toHaveLength(2);
  });

  test("a playlist that ends on the page maxPages allows, or before it, is read whole", async () => {
    const { music } = apple(songs(7), { page: 3 });
    expect((await read(music, "p.1", { maxPages: 3 })).tracks).toHaveLength(7);
    expect((await read(music, "p.1", { maxPages: 50 })).tracks).toHaveLength(7);
  });

  test("a page whose next link names itself is followed no further than maxPages allows", async () => {
    const again = { body: { data: [{ id: "i.1", type: "library-songs" }], next: "/v1/me/library/playlists/p.1/tracks?offset=0" } };
    const { music, lines } = apple([], { override: (path) => (path.endsWith("/tracks") ? again : undefined) });
    await expect(read(music, "p.1", { maxPages: 4 })).rejects.toThrow(/after the 4 that maxPages allows/);
    expect(lines().filter((line) => line.includes("/tracks"))).toHaveLength(4);
  });

  test("with no maxPages, every page is read however many there are", async () => {
    const { music } = apple(songs(60), { page: 1 });
    expect((await read(music, "p.1")).tracks).toHaveLength(60);
  });
});

describe("read: progress, and stopping", () => {
  test("it is told how many tracks have been read a page at a time, with no total, since Apple gives none until the end", async () => {
    const { music } = apple(songs(250));
    const heard = vi.fn();
    await read(music, "p.1", { onProgress: heard });
    expect(heard.mock.calls).toEqual([[{ done: 100, total: undefined }], [{ done: 200, total: undefined }], [{ done: 250, total: undefined }]]);
  });

  test("it is told after each page, whatever a page holds", async () => {
    const { music } = apple(songs(70), { page: 25 });
    const heard = vi.fn();
    await read(music, "p.1", { onProgress: heard });
    expect(heard.mock.calls).toEqual([[{ done: 25, total: undefined }], [{ done: 50, total: undefined }], [{ done: 70, total: undefined }]]);
  });

  test("a playlist that ends on a full page is not told of twice", async () => {
    const { music } = apple(songs(200));
    const heard = vi.fn();
    await read(music, "p.1", { onProgress: heard });
    expect(heard.mock.calls).toEqual([[{ done: 100, total: undefined }], [{ done: 200, total: undefined }]]);
  });

  test("a playlist with no tracks is never told of: nothing was done", async () => {
    const { music } = apple([]);
    const heard = vi.fn();
    await read(music, "p.1", { onProgress: heard });
    expect(heard).not.toHaveBeenCalled();
  });

  test("what onProgress throws stops the reading, and is what read rejects with", async () => {
    const { music, lines } = apple(songs(250));
    const stop = new Error("enough");
    await expect(
      read(music, "p.1", {
        onProgress: () => {
          throw stop;
        },
      }),
    ).rejects.toBe(stop);
    expect(lines()).toHaveLength(2);
  });

  test("a signal already aborted asks for nothing, and its reason is what read rejects with", async () => {
    const { music, calls } = apple(songs(2));
    const reason = new Error("gone");
    await expect(read(music, "p.1", { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(calls).toEqual([]);
  });

  test("the signal goes with every request, so an abort between pages stops the walk", async () => {
    const controller = new AbortController();
    const { music, calls } = apple(songs(250));
    const reason = new Error("gone");
    await expect(
      read(music, "p.1", {
        signal: controller.signal,
        onProgress: () => {
          controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(calls.every((c) => c.signal.aborted)).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe("read: what it is handed is checked before Apple is asked, and a mistake names the verb and the argument", () => {
  test.each<[string, unknown]>([
    ["a path", "p.1/tracks"],
    ["one that would leave its collection", "../../ratings/songs/1"],
    ["empty", ""],
    ["as long as a token", "p.".repeat(40)],
    ["a number", 1],
    ["nothing", undefined],
  ])("an id that is %s", async (_name, id) => {
    const { music, calls } = apple(songs(1));
    await expect(read(music, id as string)).rejects.toThrow(/^playlists\.read: id must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it/);
    expect(calls).toEqual([]);
  });

  test.each<[string, unknown, RegExp]>([
    ["options that are a list", [], /^playlists\.read: expected an options object; got a list$/],
    ["options that are a signal", new AbortController().signal, /^playlists\.read: expected an options object; got an object that is not a plain one$/],
    ["a signal that is none", { signal: true }, /^playlists\.read: signal must be an AbortSignal; got boolean$/],
    ["an onProgress that is no function", { onProgress: "tell me" }, /^playlists\.read: onProgress must be a function; got 7 characters$/],
    ["a maxPages of none", { maxPages: 0 }, /^playlists\.read: maxPages must be a whole number from 1; got 0$/],
  ])("%s", async (_name, options, message) => {
    const { music, calls } = apple(songs(1));
    await expect(read(music, "p.1", options as object)).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  test("an id short enough to be one is asked for, and comes back in the path Apple's error names; one as long as a token never gets that far", async () => {
    const { music } = apple(songs(1), { override: () => ({ status: 404, body: { errors: [{ status: "404", title: "Resource Not Found" }] } }) });
    const asked = (await read(music, "p.not-there").catch((e: unknown) => e)) as Error;
    expect(isAppleMusicError(asked, "ApiError")).toBe(true);
    expect(asked.message).toContain("/v1/me/library/playlists/p.not-there");
    const token = `eyJhbGciOiJFUzI1NiJ9.${"x".repeat(120)}`;
    const refused = (await read(music, token).catch((e: unknown) => e)) as Error;
    expect(refused).toBeInstanceOf(TypeError);
    expect(refused.message).not.toContain("eyJ");
  });

  test("the id is checked before the options, in the order they were handed over", async () => {
    const { music } = apple(songs(1));
    await expect(read(music, "", [] as object)).rejects.toThrow(/^playlists\.read: id must be /);
  });

  test("an option put on Object.prototype by other code is not an option anyone passed", async () => {
    const { music } = apple(songs(1));
    const polluted = Object.prototype as { onProgress?: unknown };
    polluted.onProgress = "not a function";
    try {
      await expect(read(music, "p.1")).resolves.toMatchObject({ id: "p.1" });
    } finally {
      delete polluted.onProgress;
    }
  });
});

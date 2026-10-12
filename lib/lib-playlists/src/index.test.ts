import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient, isAppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import * as player from "@open-music-sdk/lib-preview-player";
import type { tSong } from "@open-music-sdk/types";
import { afterEach, describe, expect, test, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

const clip = (id: string) => `https://audio-ssl.itunes.apple.com/previews/${id}.m4a`;
const HEY_JUDE = { id: "900", type: "songs", href: "/v1/catalog/us/songs/900", attributes: { isrc: "GBAYE0601498", name: "Hey Jude", artistName: "The Beatles", albumName: "1", durationInMillis: 425_653, previews: [{ url: clip("900") }] } };
const YESTERDAY = { id: "901", type: "songs", href: "/v1/catalog/us/songs/901", attributes: { isrc: "GBAYE0601477", name: "Yesterday", artistName: "The Beatles", albumName: "1", durationInMillis: 125_000, previews: [{ url: clip("901") }] } };
const CATALOG = [HEY_JUDE, YESTERDAY];

/**
 * Apple, so far as this package asks it: a catalog of two songs, found by ISRC or by a search that sends both, and
 * a library whose playlists can be listed, read, made and added to. `lose` loses the answer to the next request to
 * add tracks, which Apple carries out all the same.
 */
function apple() {
  const calls: Request[] = [];
  const library: { id: string; name: string; description?: string; tracks: string[] }[] = [];
  const lost = { next: false };
  const answer = async (request: Request, url: URL): Promise<{ status?: number; body?: unknown }> => {
    const path = url.pathname;
    if (path.endsWith("/songs")) return { body: { data: CATALOG.filter((song) => (url.searchParams.get("filter[isrc]") ?? "").split(",").includes(song.attributes.isrc)) } };
    if (path.endsWith("/search")) return { body: { results: { songs: { data: CATALOG } } } };
    const resource = (each: (typeof library)[number]) => ({ id: each.id, type: "library-playlists", attributes: { name: each.name, canEdit: true, ...(each.description === undefined ? {} : { description: { standard: each.description } }) } });
    if (path === "/v1/me/library/playlists" && request.method === "GET") return { body: { data: library.map(resource) } };
    if (path === "/v1/me/library/playlists") {
      const { attributes } = (await request.json()) as { attributes: { name: string; description?: string } };
      const made = { id: `p.${String(library.length + 1)}`, ...attributes, tracks: [] };
      library.push(made);
      return { status: 201, body: { data: [resource(made)] } };
    }
    const playlist = library.find((each) => path.startsWith(`/v1/me/library/playlists/${each.id}`));
    if (playlist === undefined) return { status: 404, body: { errors: [] } };
    if (request.method === "POST") {
      playlist.tracks.push(...((await request.json()) as { data: { id: string }[] }).data.map((each) => each.id));
      return { status: 204 };
    }
    if (!path.endsWith("/tracks")) return { body: { data: [resource(playlist)] } };
    if (playlist.tracks.length === 0) return { status: 404, body: { errors: [] } };
    const data = playlist.tracks.map((catalogId, at) => {
      const song = CATALOG.find((each) => each.id === catalogId);
      return { id: `i.${String(at)}`, type: "library-songs", attributes: { name: song?.attributes.name, artistName: song?.attributes.artistName }, relationships: { catalog: { data: song === undefined ? [] : [song] } } };
    });
    return { body: { data } };
  };
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    const reply = await answer(request, new URL(request.url));
    if (lost.next && request.method === "POST" && request.url.endsWith("/tracks")) {
      lost.next = false;
      throw new TypeError("fetch failed");
    }
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return res;
  };
  return {
    fetch,
    calls,
    library,
    lose: () => {
      lost.next = true;
    },
    music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false }),
    /** Each request as its method and path, and whether it carried the Music User Token. */
    sent: () => calls.map((c) => `${c.method} ${new URL(c.url).pathname} ${c.headers.get("music-user-token") ?? "-"}`),
  };
}

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("the package entry", () => {
  test("exports one name, the noun, and nothing else", () => {
    expect(Object.keys(api)).toEqual(["playlists"]);
  });

  test("exports the documented types and nothing else", () => {
    // A type leaves nothing at runtime to list, so the names are read from the entry.
    const named = [...readFileSync(new URL("index.ts", import.meta.url), "utf8").matchAll(/^export type \{ ([^}]+) \}/gm)].flatMap((line) => (line[1] ?? "").split(", "));
    expect(named.sort()).toEqual([
      "tAppliedPlan",
      "tApplyOptions",
      "tAskOptions",
      "tNewPlaylist",
      "tPaceOptions",
      "tPlaylistPlan",
      "tPlaylistSnapshot",
      "tPlaylistSnapshotTrack",
      "tPlaylistTrack",
      "tPlaylists",
      "tProgress",
      "tReadPlaylistOptions",
      "tResolveOptions",
      "tResolvedTracks",
      "tSettleOptions",
      "tSkippedTrack",
      "tStorefrontOption",
      "tTrackDescription",
    ]);
  });

  test("is the only one: nothing here holds a secret that has to be kept out of a browser", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test("from a list of tracks known elsewhere to a playlist that holds them, and back out again, using nothing but the entry", async () => {
    const { music, library, sent } = apple();
    const lists = api.playlists(music);

    const wanted = [{ isrc: "GBAYE0601498" }, { name: "yesterday", artistName: "the beatles" }, { name: "A song Apple does not have", artistName: "Nobody" }];
    const { tracks, skipped } = await lists.resolve(wanted);
    expect(tracks.map((song) => song.id)).toEqual(["900", "901"]);
    expect(skipped.map((each) => [each.index, each.reason, each.candidates.length])).toEqual([[2, "no-match", 2]]);

    const planned = lists.plan({ name: "Road trip", description: "made by my-app" }, tracks);
    expect([planned.append.length, planned.extra.length, planned.reordered]).toEqual([2, 0, false]);
    const applied = await lists.apply(planned);
    expect(applied).toEqual({ id: "p.1", created: true, appended: 2, verified: true });
    expect(library).toEqual([{ id: "p.1", name: "Road trip", description: "made by my-app", tracks: ["900", "901"] }]);

    // The export: what was read is plain JSON, and its tracks are descriptions that resolve again.
    const file = JSON.stringify(await lists.read(applied.id));
    const read = JSON.parse(file) as Awaited<ReturnType<typeof lists.read>>;
    expect(read.tracks.map((track) => [track.catalogId, track.isrc])).toEqual([
      ["900", "GBAYE0601498"],
      ["901", "GBAYE0601477"],
    ]);
    expect((await lists.resolve(read.tracks)).tracks.map((song) => song.id)).toEqual(["900", "901"]);
    expect(lists.plan(read, tracks)).toMatchObject({ append: [], extra: [], reordered: false });

    // The catalog was asked with the developer token alone, and the library with both.
    expect(sent().filter((line) => line.includes("/catalog/")).every((line) => line.endsWith(" -"))).toBe(true);
    expect(sent().filter((line) => line.includes("/me/")).every((line) => line.endsWith(" listener"))).toBe(true);
  });
});

describe("an app whose copy of core is not the one this package resolves", () => {
  /** A second copy of core, as an app on another version of it has: its own error class, its own client. */
  async function foreign() {
    vi.resetModules();
    const core = await import("@open-music-sdk/core");
    const fake = apple();
    return { ...fake, core, music: core.createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch: fake.fetch, retry: false }) };
  }

  test("a client from that copy is a client to the noun, and to every verb", async () => {
    const { music, library } = await foreign();
    const lists = api.playlists(music);
    const { tracks } = await lists.resolve([{ isrc: "GBAYE0601498" }]);
    const applied = await lists.apply(lists.plan({ name: "Road trip" }, tracks));
    expect((await lists.read(applied.id)).tracks.map((track) => track.catalogId)).toEqual(["900"]);
    expect(library).toHaveLength(1);
  });

  test("an error that copy made is known for what it is here: a lost answer is settled by reading back, and a 404 for no tracks is no tracks", async () => {
    const { core, music, library, lose } = await foreign();
    expect(core.isAppleMusicError).not.toBe(isAppleMusicError);
    const lists = api.playlists(music);
    library.push({ id: "p.9", name: "Empty", tracks: [] });
    expect((await lists.read("p.9")).tracks).toEqual([]);
    lose();
    expect(await lists.apply(lists.plan({ id: "p.9", tracks: [] }, [{ id: "900", type: "songs" }]), { settle: { waitMs: 0 } })).toMatchObject({ appended: 1, verified: true });
    expect(library[0]?.tracks).toEqual(["900"]);
  });

  test("an error Apple answered with is recognised by that copy's guard and by this one's", async () => {
    const { core, music } = await foreign();
    const error: unknown = await api.playlists(music).read("p.gone").catch((e: unknown) => e);
    expect([isAppleMusicError(error, "ApiError"), core.isAppleMusicError(error, "ApiError")]).toEqual([true, true]);
  });
});

describe("what a server is asked, from a verb to the wire", () => {
  /** A server that keeps one playlist as Apple does, and records what it was asked. Requests for Apple are sent to it instead. */
  async function wire() {
    const asked: { method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders; body: string }[] = [];
    const tracks: { id: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        asked.push({ method: req.method, url: req.url, headers: req.headers, body });
        const path = (req.url ?? "").split("?")[0] ?? "";
        const playlist = { id: "p.1", type: "library-playlists", attributes: { name: "Road trip", canEdit: true } };
        res.setHeader("content-type", "application/json");
        if (req.method === "POST" && path.endsWith("/tracks")) {
          tracks.push(...(JSON.parse(body) as { data: { id: string }[] }).data);
          res.statusCode = 204;
          res.end();
        } else if (req.method === "POST") {
          res.statusCode = 201;
          res.end(JSON.stringify({ data: [playlist] }));
        } else if (path.endsWith("/tracks")) {
          res.end(JSON.stringify({ data: tracks.map((each, at) => ({ id: `i.${String(at)}`, type: "library-songs", attributes: { playParams: { catalogId: each.id } } })) }));
        } else if (path.endsWith("/p.1")) res.end(JSON.stringify({ data: [playlist] }));
        else res.end(JSON.stringify({ data: [] }));
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

  test("the paths, the queries and the bodies arrive as they were built: the catalog with one token, the library with both", async () => {
    const { asked, music, close } = await wire();
    try {
      const lists = api.playlists(music);
      await lists.resolve([{ isrc: "GBAYE0601498", name: "Hey Jude", artistName: "The Beatles" }]);
      await lists.apply(lists.plan({ name: "Road trip", description: "made by my-app" }, [{ id: "900", type: "songs" }]));
      expect(asked.map((each) => `${each.method ?? ""} ${each.url ?? ""}`)).toEqual([
        "GET /v1/catalog/us/songs?filter%5Bisrc%5D=GBAYE0601498",
        "GET /v1/catalog/us/search?term=Hey+Jude+The+Beatles&types=songs",
        "GET /v1/me/library/playlists",
        "POST /v1/me/library/playlists",
        "POST /v1/me/library/playlists/p.1/tracks",
        "GET /v1/me/library/playlists/p.1",
        "GET /v1/me/library/playlists/p.1/tracks?include=catalog",
      ]);
      expect(asked.map((each) => each.body).filter((body) => body !== "")).toEqual(['{"attributes":{"name":"Road trip","description":"made by my-app"}}', '{"data":[{"id":"900","type":"songs"}]}']);
      expect(asked.map((each) => [each.headers.authorization, each.headers["music-user-token"]])).toEqual([
        ["Bearer dev", undefined],
        ["Bearer dev", undefined],
        ...Array.from({ length: 5 }, () => ["Bearer dev", "listener"]),
      ]);
    } finally {
      await close();
    }
  });

  test("an id or a storefront that would leave its collection never reaches the wire", async () => {
    const { asked, music, close } = await wire();
    try {
      const lists = api.playlists(music);
      const refused = [
        lists.read("../../ratings/songs/1"),
        lists.read("p.1%2F..%2Fp.2"),
        lists.resolve([{ isrc: "A" }], { storefront: "../me/library" }),
        lists.apply({ playlist: { id: "p.1/tracks" }, tracks: [], append: [], extra: [], reordered: false }),
      ];
      for (const each of refused) expect(await each.catch((e: unknown) => e)).toBeInstanceOf(TypeError);
      expect(asked).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("the two lib packages are used in the same way", () => {
  /** A stand-in for an audio element that plays nothing and says nothing. */
  const audio = () => ({ src: "", currentTime: 0, volume: 1, duration: Number.NaN, paused: true, ended: false, play: vi.fn(() => Promise.resolve()), pause: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });

  test("each exports one name: a noun, which is a function", () => {
    expect([Object.keys(api), Object.keys(player)]).toEqual([["playlists"], ["previewPlayer"]]);
    expect([typeof api.playlists, typeof player.previewPlayer]).toEqual(["function", "function"]);
  });

  test("each noun gives one object, frozen and inheriting nothing, whose functions need no `this`", () => {
    for (const made of [api.playlists(apple().music), player.previewPlayer({ audio: audio() })]) {
      expect(Object.isFrozen(made)).toBe(true);
      expect(Object.getPrototypeOf(made)).toBeNull();
      expect(Object.values(Object.getOwnPropertyDescriptors(made)).every((each) => typeof each.value === "function" || each.get !== undefined)).toBe(true);
    }
  });

  test("making either does nothing yet: Apple is not asked, and the element is not played", () => {
    const [fake, element] = [apple(), audio()];
    api.playlists(fake.music);
    player.previewPlayer({ audio: element });
    expect(fake.calls).toEqual([]);
    expect([element.play.mock.calls.length, element.src]).toEqual([0, ""]);
  });

  test("a list of tracks is answered with the ones that could be used and the ones that could not, each of those with where it was and why", async () => {
    const resolved = await api.playlists(apple().music).resolve([{ isrc: "GBAYE0601498" }, { name: "Unknown", artistName: "Nobody" }]);
    const withoutClip = { id: "902", type: "songs", href: "/902", attributes: { previews: [] } };
    const loaded = player.previewPlayer({ audio: audio() }).load([HEY_JUDE, withoutClip]);
    for (const answer of [resolved, loaded]) {
      expect(Object.keys(answer)).toEqual(["tracks", "skipped"]);
      expect(answer.tracks).toHaveLength(1);
      expect(answer.skipped).toHaveLength(1);
      expect(Object.keys(answer.skipped[0] ?? {}).slice(0, 3)).toEqual(["index", "track", "reason"]);
      expect(answer.skipped[0]?.index).toBe(1);
      expect(Object.isFrozen(answer)).toBe(true);
    }
    expect([resolved.skipped[0]?.reason, loaded.skipped[0]?.reason]).toEqual(["no-match", "no-preview"]);
  });

  test("a track that cannot be used is never an error, in either", async () => {
    await expect(api.playlists(apple().music).resolve([{}, { name: "" }])).resolves.toMatchObject({ tracks: [] });
    expect(() => player.previewPlayer({ audio: audio() }).load([{}, { attributes: {} }])).not.toThrow();
  });

  test("what the one finds, the other plays: songs as resolve gives them are tracks as load takes them", async () => {
    const { tracks } = await api.playlists(apple().music).resolve([{ isrc: "GBAYE0601498" }, { isrc: "GBAYE0601477" }]);
    const element = audio();
    const made = player.previewPlayer<tSong>({ audio: element });
    expect(made.load(tracks)).toEqual({ tracks, skipped: [] });
    await made.play(1);
    expect(element.src).toBe(clip("901"));
  });

  test("the same mistake is the same TypeError, under each one's own name", async () => {
    const lists = api.playlists(apple().music);
    const made = player.previewPlayer({ audio: audio() });
    const message = async (asked: Promise<unknown>) => ((await asked.catch((e: unknown) => e)) as Error).message;
    expect(await message(lists.read("p.1", [] as object))).toBe("playlists.read: expected an options object; got a list");
    expect(() => player.previewPlayer([] as object)).toThrow(new TypeError("previewPlayer: expected an options object; got a list"));
    expect(await message(lists.resolve("songs" as unknown as []))).toMatch(/^playlists\.resolve: descriptions must be a list of .*; got 5 characters$/);
    expect(() => made.load("songs" as unknown as [])).toThrow(/^previewPlayer\.load: tracks must be a list of .*; got 5 characters$/);
    expect(() => api.playlists("a-token" as unknown as tAppleMusicClient)).toThrow(/^playlists: client must be .*; got 7 characters$/);
    expect(() => player.previewPlayer({ audio: "a-token" as never })).toThrow(/^previewPlayer: audio must be .*; got 7 characters$/);
  });
});

describe("the package manifest", () => {
  const [catalog, user, core, types] = ["@open-music-sdk/client-catalog", "@open-music-sdk/client-user", "@open-music-sdk/core", "@open-music-sdk/types"] as const;

  test("core and the two clients are ordinary dependencies on a caret range, as for the rest of the family", () => {
    expect([manifest.dependencies[catalog], manifest.dependencies[user], manifest.dependencies[core]]).toEqual(["workspace:^", "workspace:^", "workspace:^"]);
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("the types are a dependency too, since what the verbs resolve to is declared in terms of them", () => {
    expect(manifest.dependencies[types]).toBe("workspace:*");
  });

  test("those four are the only dependencies: the player's package is here for the tests alone", () => {
    expect(Object.keys(manifest.dependencies)).toEqual([catalog, user, core, types]);
    expect(manifest.devDependencies).toHaveProperty("@open-music-sdk/lib-preview-player", "workspace:*");
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

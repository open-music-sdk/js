import { createClient, isAppleMusicError, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import type {
  tLibraryAlbum,
  tLibraryArtist,
  tLibraryMusicVideo,
  tLibraryPlaylist,
  tLibraryPlaylistFolder,
  tLibraryPlaylistsResponse,
  tLibrarySong,
  tLibrarySongsResponse,
  tPersonalRecommendation,
  tResource,
} from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import * as api from "./resources";

/** One answer from Apple. */
interface tReply {
  status?: number;
  body?: unknown;
}

const SECRET = "s3cretT0ken";
const SEGMENT = 'must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';
const song = (id: string) => ({ id, type: "library-songs", href: `/v1/me/library/songs/${id}` });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A listener's client over a fetch that answers from a queue of replies, then with one song, and records every Request it saw. */
function apple(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: { data: [song("i.1")] } };
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", userToken: "listener", fetch, retry: false, ...options }),
    calls,
    /** Each request as its method, path and query. */
    sent: () => calls.map((call) => `${call.method} ${new URL(call.url).pathname}${decodeURIComponent(new URL(call.url).search)}`),
    /** The body of each request, parsed, or undefined where there was none. */
    bodies: () => Promise.all(calls.map(async (call) => (call.body === null ? undefined : (JSON.parse(await call.text()) as unknown)))),
  };
}

/** What a promise rejects with. One that resolves fails the test. */
const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error("expected a rejection");
};

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("whose library is asked", () => {
  test("the listener's whose token the client holds: there is no storefront in a library's path, and none is looked up", async () => {
    const { music, sent } = apple();
    await api.getLibrarySong(music, "i.1");
    await api.getLibrarySongs(music, ["i.1"]);
    await api.listLibrarySongs(music);
    await api.getLibrarySongRelationship(music, "i.1", "albums");
    expect(sent()).toEqual(["GET /v1/me/library/songs/i.1", "GET /v1/me/library/songs?ids=i.1", "GET /v1/me/library/songs", "GET /v1/me/library/songs/i.1/albums"]);
  });

  test("another listener's is asked through their own client, which the first client gives", async () => {
    const { music, calls } = apple();
    await api.getLibrarySong(music.as("another"), "i.1");
    expect(calls.map((request) => request.headers.get("music-user-token"))).toEqual(["another"]);
  });

  test("a client that holds no listener's token cannot ask: it says so, and Apple is not asked", async () => {
    const { music, calls } = apple([], { userToken: undefined });
    const error = await rejection(api.getLibrarySong(music, "i.1"));
    expect(isAppleMusicError(error, "UserTokenInvalid")).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("a value put in a path stays where it was put, so a request for one of the listener's resources cannot become one for another", () => {
  /** What a URL, or a server that decodes a path before it reads it, would take for a way out of the segment. */
  const leaving = ["../../ratings/songs/1", "..\\..\\storefront", "%2e%2e/%2e%2e/storefront", "..%2F..%2Fratings", "/v1/me/storefront", "//evil.example/x", "i.1\nx"];
  /** What means something elsewhere in a URL, and nothing in a path once it is encoded. */
  const hostile = ["i.1?include=catalog", "i.1#fragment", "a b", "i.1&ids=i.2"];

  test.each(leaving)("an id or a relationship's name of %j is refused, and Apple is not asked", async (value) => {
    const { music, calls } = apple();
    const what = `${String(value.length)} characters`;
    expect(await rejection(api.getLibrarySong(music, value))).toEqual(new TypeError(`getLibrarySong: id ${SEGMENT}${what}`));
    expect(await rejection(api.getLibraryAlbumRelationship(music, value, "tracks"))).toEqual(new TypeError(`getLibraryAlbumRelationship: id ${SEGMENT}${what}`));
    expect(await rejection(api.getLibraryAlbumRelationship(music, "l.1", value as "tracks"))).toEqual(new TypeError(`getLibraryAlbumRelationship: name ${SEGMENT}${what}`));
    expect(calls).toHaveLength(0);
  });
  /** The path of the one request sent, in segments, and what followed it. */
  const asked = async (call: (music: tAppleMusicClient) => Promise<unknown>) => {
    const { music, calls } = apple();
    await call(music);
    const url = new URL(calls[0]?.url ?? "");
    return { segments: url.pathname.split("/").slice(1), rest: url.search + url.hash, origin: url.origin };
  };

  test.each(hostile)("an id of %j is one segment after the collection", async (id) => {
    const { segments, rest, origin } = await asked((music) => api.getLibrarySong(music, id));
    expect(segments.slice(0, 4)).toEqual(["v1", "me", "library", "songs"]);
    expect(segments).toHaveLength(5);
    expect(decodeURIComponent(segments[4] ?? "")).toBe(id);
    expect([rest, origin]).toEqual(["", "https://api.music.apple.com"]);
  });

  test.each(hostile)("a relationship's name of %j is one segment after the id", async (name) => {
    const { segments, rest } = await asked((music) => api.getLibraryAlbumRelationship(music, "l.1", name as "tracks"));
    expect(segments.slice(0, 5)).toEqual(["v1", "me", "library", "albums", "l.1"]);
    expect(segments).toHaveLength(6);
    expect([decodeURIComponent(segments[5] ?? ""), rest]).toEqual([name, ""]);
  });

  test("the check that says so can tell: put into a path as it is, the same id does reach another of the listener's resources", async () => {
    const { music, sent } = apple();
    await music.request("v1/me/library/songs/../../ratings/songs/1");
    expect(sent()).toEqual(["GET /v1/me/ratings/songs/1"]);
  });

  test.each<[string, (music: tAppleMusicClient) => Promise<unknown>, string]>([
    ["getLibrarySong: an id that is two dots", (music) => api.getLibrarySong(music, ".."), `getLibrarySong: id ${SEGMENT}2 characters`],
    ["getLibraryPlaylist: an id that is empty", (music) => api.getLibraryPlaylist(music, ""), `getLibraryPlaylist: id ${SEGMENT}0 characters`],
    ["getLibraryAlbumRelationship: a name that is one dot", (music) => api.getLibraryAlbumRelationship(music, "l.1", "." as "tracks"), `getLibraryAlbumRelationship: name ${SEGMENT}1 characters`],
    ["getPersonalRecommendation: an id that is a number", (music) => api.getPersonalRecommendation(music, 5 as unknown as string), `getPersonalRecommendation: id ${SEGMENT}5`],
    [
      "getLibrarySongs: ids that are one string",
      (music) => api.getLibrarySongs(music, "i.1" as unknown as string[]),
      "getLibrarySongs: ids must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got 3 characters",
    ],
    ["listLibrarySongs: a limit of zero", (music) => api.listLibrarySongs(music, { limit: 0 }), "listLibrarySongs: limit must be a whole number above 0; got 0"],
  ])("%s is a TypeError, and Apple is not asked", async (_name, call, message) => {
    const { music, calls } = apple();
    expect(await rejection(call(music))).toEqual(new TypeError(message));
    expect(calls).toHaveLength(0);
  });

  test("a token put where an id belongs is refused before it is sent, and is not shown", async () => {
    const token = `${SECRET}.${"p".repeat(75)}.${"s".repeat(86)}`;
    const { music, calls } = apple();
    for (const call of [api.getLibrarySong(music, token), api.getLibrarySongs(music, [token]), api.getLibraryAlbumRelationship(music, "l.1", token as "tracks")]) {
      const error = await rejection(call);
      expect(error).toBeInstanceOf(TypeError);
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("a new playlist, and a new playlist folder", () => {
  const PLAYLIST = "createLibraryPlaylist: expected a playlist to create, as { attributes: { name } }";
  const FOLDER = "createLibraryPlaylistFolder: expected a playlist folder to create, as { attributes: { name } }";
  const created = { data: [{ id: "p.new", type: "library-playlists", href: "/v1/me/library/playlists/p.new", attributes: { name: "Road" } }] };

  test("what is handed over is posted as the body, and the answer that holds the new resource is what comes back", async () => {
    const { music, sent, bodies } = apple([{ status: 201, body: created }, { status: 201, body: created }]);
    expect(await api.createLibraryPlaylist(music, { attributes: { name: "Road" } })).toEqual(created);
    expect(await api.createLibraryPlaylistFolder(music, { attributes: { name: "Trips" } })).toEqual(created);
    expect(sent()).toEqual(["POST /v1/me/library/playlists", "POST /v1/me/library/playlist-folders"]);
    expect(await bodies()).toEqual([{ attributes: { name: "Road" } }, { attributes: { name: "Trips" } }]);
  });

  test("bound, each gives the new resource, and undefined when Apple's answer holds none: it was made either way, and an error would have it made twice", async () => {
    const { music, sent } = apple([{ status: 201, body: created }, { status: 201, body: { data: [] } }, { status: 201 }, { status: 201, body: created }]);
    expect(await api.createLibraryPlaylist.bound(music)({ attributes: { name: "Road" } })).toEqual(created.data[0]);
    expect(await api.createLibraryPlaylist.bound(music)({ attributes: { name: "Road" } })).toBeUndefined();
    expect(await api.createLibraryPlaylistFolder.bound(music)({ attributes: { name: "Trips" } })).toBeUndefined();
    expect(await api.createLibraryPlaylistFolder.bound(music)({ attributes: { name: "Trips" } })).toEqual(created.data[0]);
    expect(sent()).toEqual(["POST /v1/me/library/playlists", "POST /v1/me/library/playlists", "POST /v1/me/library/playlist-folders", "POST /v1/me/library/playlist-folders"]);
  });

  test("the body is this call's own copy, all the way down: changing what was handed over afterwards changes nothing", async () => {
    const { music, bodies } = apple([{ status: 201, body: created }]);
    const playlist = { attributes: { name: "Road" }, relationships: { tracks: { data: [{ id: "1", type: "songs" as const }] }, parent: { data: [{ id: "p.root", type: "library-playlist-folders" as const }] } } };
    const pending = api.createLibraryPlaylist(music, playlist);
    playlist.attributes.name = "Changed";
    playlist.relationships.tracks.data.push({ id: "2", type: "songs" });
    await pending;
    expect(await bodies()).toEqual([{ attributes: { name: "Road" }, relationships: { tracks: { data: [{ id: "1", type: "songs" }] }, parent: { data: [{ id: "p.root", type: "library-playlist-folders" }] } } }]);
  });

  test("what it holds beyond being an object is Apple's to judge: it is sent as it is, and Apple's refusal is the error", async () => {
    const { music, bodies } = apple([{ status: 400, body: { errors: [{ status: "400", code: "40007", title: "Invalid Request Body" }] } }]);
    const error = await rejection(api.createLibraryPlaylist(music, { attributes: {} } as never));
    expect([isAppleMusicError(error, "ApiError"), (error as { status?: number }).status]).toEqual([true, 400]);
    expect(await bodies()).toEqual([{ attributes: {} }]);
  });

  test.each<[string, unknown, string]>([
    ["nothing", undefined, "undefined"],
    ["null", null, "null"],
    ["a name alone, not an object", "Road", "4 characters"],
    ["a list", [{ attributes: { name: "Road" } }], "a list"],
    ["a Map, which JSON would send as an empty object", new Map([["attributes", { name: "Road" }]]), "an object that is not a plain one"],
  ])("handed %s, each is a TypeError naming the function, and Apple is not asked", async (_name, body, what) => {
    const { music, calls } = apple();
    expect(await rejection(api.createLibraryPlaylist(music, body as never))).toEqual(new TypeError(`${PLAYLIST}; got ${what}`));
    expect(await rejection(api.createLibraryPlaylistFolder(music, body as never))).toEqual(new TypeError(`${FOLDER}; got ${what}`));
    expect(calls).toHaveLength(0);
  });

  test("handed what JSON cannot hold, each is a TypeError that does not repeat what the runtime said about it", async () => {
    const { music, calls } = apple();
    const cycle: { attributes: { name: string; self?: unknown } } = { attributes: { name: SECRET } };
    cycle.attributes.self = cycle;
    for (const body of [cycle, { attributes: { name: "Road", plays: 5n } }]) {
      const error = await rejection(api.createLibraryPlaylist(music, body));
      expect(error).toEqual(new TypeError(`${PLAYLIST}, holding only what JSON can; got one that holds something else`));
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
    }
    expect(calls).toHaveLength(0);
  });

  test("what is handed over is checked before the options are, and both before Apple is asked", async () => {
    const { music, calls } = apple();
    expect((await rejection(api.createLibraryPlaylist(music, [] as never, { limit: 0 }))).message).toContain("expected a playlist to create");
    expect(await rejection(api.createLibraryPlaylist(music, { attributes: { name: "Road" } }, { language: "" }))).toEqual(new TypeError("createLibraryPlaylist: language must be a string of 1 to 64 characters; got 0 characters"));
    expect(calls).toHaveLength(0);
  });

  test("nothing of the body is read through a getter twice, and nothing is called on it but what JSON calls", async () => {
    const { music, bodies } = apple([{ status: 201, body: created }]);
    const name = vi.fn(() => "Road");
    await api.createLibraryPlaylist(music, { attributes: Object.defineProperty({}, "name", { get: name, enumerable: true }) as { name: string } });
    expect(name).toHaveBeenCalledTimes(1);
    expect(await bodies()).toEqual([{ attributes: { name: "Road" } }]);
  });
});

describe("the types: a function is about the generated type its name says, and a name asked for decides what comes back", () => {
  const { music } = apple();

  test("called with a client, a function resolves to Apple's answer", () => {
    expectTypeOf(api.getLibrarySong).returns.resolves.toEqualTypeOf<tLibrarySongsResponse>();
    expectTypeOf(api.getLibrarySongs).returns.resolves.toEqualTypeOf<tLibrarySongsResponse>();
    expectTypeOf(api.createLibraryPlaylist).returns.resolves.toEqualTypeOf<tLibraryPlaylistsResponse>();
    expectTypeOf(api.listLibrarySongs(music)).resolves.toExtend<{ data: tLibrarySong[]; next?: string | undefined }>();
  });

  test("bound, it hands over the resource, the list, or every item of every page", () => {
    expectTypeOf(api.getLibrarySong.bound(music)).returns.resolves.toEqualTypeOf<tLibrarySong>();
    expectTypeOf(api.getLibraryAlbums.bound(music)).returns.resolves.toEqualTypeOf<tLibraryAlbum[]>();
    expectTypeOf(api.listLibraryPlaylists.bound(music)).returns.toEqualTypeOf<AsyncIterable<tLibraryPlaylist>>();
    expectTypeOf(api.listPersonalRecommendations.bound(music)).returns.toEqualTypeOf<AsyncIterable<tPersonalRecommendation>>();
    expectTypeOf(api.createLibraryPlaylist.bound(music)).returns.resolves.toEqualTypeOf<tLibraryPlaylist | undefined>();
    expectTypeOf(api.createLibraryPlaylistFolder.bound(music)).returns.resolves.toEqualTypeOf<tLibraryPlaylistFolder | undefined>();
  });

  test("a relationship's name decides the resources it gives, called with a client or bound", () => {
    expectTypeOf(api.getLibraryAlbumRelationship(music, "l.1", "artists")).resolves.toHaveProperty("data").toEqualTypeOf<tLibraryArtist[]>();
    expectTypeOf(api.getLibraryAlbumRelationship.bound(music)("l.1", "tracks")).toEqualTypeOf<AsyncIterable<tLibraryMusicVideo | tLibrarySong>>();
    expectTypeOf(api.getLibraryPlaylistFolderRelationship.bound(music)("p.f1", "parent")).toEqualTypeOf<AsyncIterable<tLibraryPlaylistFolder>>();
    expectTypeOf(api.getPersonalRecommendationRelationship.bound(music)("1", "contents")).toEqualTypeOf<AsyncIterable<tResource>>();
  });

  test("what does not fit does not compile", () => {
    const calls = [
      // @ts-expect-error -- a relationship a library song does not have
      () => api.getLibrarySongRelationship(music, "i.1", "tracks"),
      // @ts-expect-error -- a library has no storefront: it is the listener's, wherever they are
      () => api.getLibrarySong(music, "i.1", { storefront: "gb" }),
      // @ts-expect-error -- a playlist has to have a name
      () => api.createLibraryPlaylist(music, { attributes: {} }),
      // @ts-expect-error -- a playlist's tracks are of the four types a track can be
      () => api.createLibraryPlaylist(music, { attributes: { name: "Road" }, relationships: { tracks: { data: [{ id: "1", type: "albums" }] }, parent: { data: [] } } }),
      // @ts-expect-error -- one id is not a list of them
      () => api.getLibrarySongs(music, "i.1"),
    ];
    expect(calls).toHaveLength(5);
  });
});

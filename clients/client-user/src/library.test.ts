import { createClient, isAppleMusicError, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import type { tLibraryPlaylistFolder, tLibrarySearchResponse, tMusicSummary, tResource, tStation, tStorefront } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import * as api from "./library";

/** One answer from Apple. */
interface tReply {
  status?: number;
  body?: unknown;
}

const SECRET = "s3cretT0ken";
const LIST = "must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";
const TERM = "term must be a string of 1 to 256 characters; got ";
const SEGMENT = 'must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';
const TRACKS =
  'addLibraryPlaylistTracks: tracks must be a list of 1 to 300 tracks, each a plain object with an id and a type of its own that are strings of 1 to 64 characters, such as { id: "1", type: "songs" }; got ';
const item = (id: string) => ({ id, type: "library-songs" });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A listener's client over a fetch that answers from a queue of replies, then with one item, and records every Request it saw. */
function apple(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: { data: [item("i.1")] } };
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false, ...options }),
    calls,
    /** Each request as its method, path and query. */
    sent: () => calls.map((call) => `${call.method} ${new URL(call.url).pathname}${decodeURIComponent(new URL(call.url).search)}`),
    /** The Music User Token each request carried, or null. */
    userTokens: () => calls.map((call) => call.headers.get("music-user-token")),
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

const all = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const each of items) out.push(each);
  return out;
};

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

/** A call as a caller without the types could make it. */
type tLoose = (music: tAppleMusicClient, ...args: unknown[]) => Promise<unknown>;
const loose = (fn: unknown) => fn as tLoose;

describe("what a function resolves to, called with a client or bound", () => {
  test("a search gives Apple's answer as it is, which holds no data to hand over in its place", async () => {
    const answer = { results: { "library-songs": { data: [item("i.1")], next: "/v1/me/library/search?offset=1", href: "/v1/me/library/search" } } };
    const { music } = apple([{ body: answer }, { body: answer }]);
    expect(await api.searchLibrary(music, "x", { types: ["library-songs"] })).toEqual(answer);
    expect(await api.searchLibrary.bound(music)("x", { types: ["library-songs"] })).toEqual(answer);
  });

  test("resources by type and replay summaries give the answer, and bound the list it holds", async () => {
    const answer = { data: [item("i.1"), item("i.2")] };
    const { music } = apple(Array.from({ length: 4 }, () => ({ body: answer })));
    expect(await api.getLibraryResources(music, { "library-songs": ["i.1", "i.2"] })).toEqual(answer);
    expect(await api.getLibraryResources.bound(music)({ "library-songs": ["i.1", "i.2"] })).toEqual(answer.data);
    expect(await api.getMusicSummariesByYear(music, ["latest"])).toEqual(answer);
    expect(await api.getMusicSummariesByYear.bound(music)(["latest"])).toEqual(answer.data);
  });

  test("the root folder, the personal station and the listener's storefront give the answer, and bound the one resource it holds", async () => {
    const answer = { data: [item("p.root")] };
    const { music } = apple(Array.from({ length: 6 }, () => ({ body: answer })));
    for (const fn of [api.getRootLibraryPlaylistFolder, api.getPersonalStation, api.getUserStorefront]) {
      expect(await fn(music)).toEqual(answer);
      expect(await fn.bound(music)()).toEqual(answer.data[0]);
    }
  });

  test("bound, each of those says so with Apple's status when the answer holds no resource", async () => {
    const { music } = apple([{ body: { data: [] } }]);
    const error = await rejection(api.getRootLibraryPlaylistFolder.bound(music)());
    expect([isAppleMusicError(error, "ApiError"), error.message]).toEqual([true, "getRootLibraryPlaylistFolder: Apple answered with no resource"]);
  });

  test("what adds resolves to nothing, called with a client or bound, since Apple answers with nothing", async () => {
    const { music, sent } = apple(Array.from({ length: 6 }, (_, index) => ({ status: index < 4 ? 202 : 204 })));
    await expect(api.addToLibrary(music, { songs: ["1"] })).resolves.toBeUndefined();
    await expect(api.addToLibrary.bound(music)({ songs: ["1"] })).resolves.toBeUndefined();
    await expect(api.addToFavorites(music, { songs: ["1"] })).resolves.toBeUndefined();
    await expect(api.addToFavorites.bound(music)({ songs: ["1"] })).resolves.toBeUndefined();
    await expect(api.addLibraryPlaylistTracks(music, "p.1", [{ id: "1", type: "songs" }])).resolves.toBeUndefined();
    await expect(api.addLibraryPlaylistTracks.bound(music)("p.1", [{ id: "1", type: "songs" }])).resolves.toBeUndefined();
    expect(sent()).toEqual([
      "POST /v1/me/library?ids[songs]=1",
      "POST /v1/me/library?ids[songs]=1",
      "POST /v1/me/favorites?ids[songs]=1",
      "POST /v1/me/favorites?ids[songs]=1",
      "POST /v1/me/library/playlists/p.1/tracks",
      "POST /v1/me/library/playlists/p.1/tracks",
    ]);
  });

  test.each<[string, (music: tAppleMusicClient) => AsyncIterable<unknown>, string]>([
    ["listRecentlyAdded", (music) => api.listRecentlyAdded.bound(music)(), "/v1/me/library/recently-added"],
    ["listHeavyRotation", (music) => api.listHeavyRotation.bound(music)(), "/v1/me/history/heavy-rotation"],
    ["listRecentlyPlayed", (music) => api.listRecentlyPlayed.bound(music)(), "/v1/me/recent/played"],
    ["listRecentlyPlayedTracks", (music) => api.listRecentlyPlayedTracks.bound(music)(), "/v1/me/recent/played/tracks"],
    ["listRecentlyPlayedStations", (music) => api.listRecentlyPlayedStations.bound(music)(), "/v1/me/recent/radio-stations"],
  ])("%s, bound, gives every item of every page", async (_name, walk, path) => {
    const { music, sent } = apple([{ body: { data: [item("1")], next: `${path}?offset=1` } }, { body: { data: [item("2")] } }]);
    expect(await all(walk(music))).toEqual([item("1"), item("2")]);
    expect(sent()).toEqual([`GET ${path}`, `GET ${path}?offset=1`]);
  });

  test("what was played lately is asked for without types when none are named, and with them when they are", async () => {
    const { music, sent } = apple();
    await api.listRecentlyPlayed(music);
    await api.listRecentlyPlayed(music, { types: ["albums"] });
    await api.listRecentlyPlayedTracks(music, { types: ["songs", "music-videos"] });
    expect(sent()).toEqual(["GET /v1/me/recent/played", "GET /v1/me/recent/played?types=albums", "GET /v1/me/recent/played/tracks?types=songs,music-videos"]);
  });
});

describe("the listener's own station is in the catalog, and is asked for with their token", () => {
  test("it is asked of the storefront the call names, or the client's, with the Music User Token either way", async () => {
    const { music, sent, userTokens } = apple();
    await api.getPersonalStation(music, { storefront: "gb" });
    await api.getPersonalStation(music);
    expect(sent()).toEqual(["GET /v1/catalog/gb/stations?filter[identity]=personal", "GET /v1/catalog/us/stations?filter[identity]=personal"]);
    expect(userTokens()).toEqual(["listener", "listener"]);
  });

  test("a client with no storefront of its own is asked for the listener's, which it looks up once", async () => {
    const { music, sent } = apple([{ body: { data: [{ id: "jp", type: "storefronts" }] } }], { storefront: undefined });
    await api.getPersonalStation(music);
    await api.getPersonalStation(music);
    expect(sent()).toEqual(["GET /v1/me/storefront", "GET /v1/catalog/jp/stations?filter[identity]=personal", "GET /v1/catalog/jp/stations?filter[identity]=personal"]);
  });

  test("a client that answers with its storefront itself, and not a promise of it, is asked the same: a client is known by its methods", async () => {
    const { music, sent } = apple();
    const wrapped = { request: music.request.bind(music), paginate: music.paginate.bind(music), storefront: () => "gb" } as unknown as tAppleMusicClient;
    await api.getPersonalStation(wrapped);
    expect(sent()).toEqual(["GET /v1/catalog/gb/stations?filter[identity]=personal"]);
  });

  test("it is always asked for by the one filter there is, whatever the caller's params say", async () => {
    const { music, sent } = apple();
    await api.getPersonalStation(music, { params: { "filter[identity]": "someone-else", "filter[featured]": "x" } });
    expect(sent()).toEqual(["GET /v1/catalog/us/stations?filter[identity]=personal&filter[featured]=x"]);
  });

  test.each(["../../me/library/songs", "..\\me", "us/stations/ra.1?x=", "//evil.example/x", "..%2F..%2Fme", "us\nx"])("a storefront of %j is refused, so the token is sent nowhere at all", async (storefront) => {
    const { music, calls } = apple();
    expect(await rejection(api.getPersonalStation(music, { storefront }))).toEqual(new TypeError(`getPersonalStation: storefront ${SEGMENT}${String(storefront.length)} characters`));
    expect(calls).toHaveLength(0);
  });

  test("a client's own storefront is held to the same, so one that is no storefront takes the token nowhere either", async () => {
    const { music, calls } = apple([], { storefront: "../me/library" });
    expect(await rejection(api.getPersonalStation(music))).toEqual(new TypeError(`getPersonalStation: storefront ${SEGMENT}13 characters`));
    expect(calls).toHaveLength(0);
  });

  test.each(["u s", "us?filter[identity]=x", "us#x"])("a storefront of %j is one segment after /v1/catalog, so the token goes nowhere but to the stations", async (storefront) => {
    const { music, calls } = apple();
    await api.getPersonalStation(music, { storefront });
    const url = new URL(calls[0]?.url ?? "");
    const segments = url.pathname.split("/").slice(1);
    expect([segments.length, segments.slice(0, 2), segments[3], decodeURIComponent(segments[2] ?? "")]).toEqual([4, ["v1", "catalog"], "stations", storefront]);
    expect([url.origin, url.search]).toEqual(["https://api.music.apple.com", "?filter%5Bidentity%5D=personal"]);
  });

  test.each<[string, unknown, string]>([
    ["two dots", "..", "2 characters"],
    ["empty", "", "0 characters"],
    ["a number", 5, "5"],
  ])("a storefront that is %s is a TypeError, and Apple is not asked", async (_name, storefront, what) => {
    const { music, calls } = apple();
    expect(await rejection(api.getPersonalStation(music, { storefront: storefront as string }))).toEqual(new TypeError(`getPersonalStation: storefront ${SEGMENT}${what}`));
    expect(calls).toHaveLength(0);
  });

  test("a client that holds no listener's token cannot ask for it: the client says so, and Apple is not asked", async () => {
    const { music, calls } = apple([], { userToken: undefined });
    const error = await rejection(api.getPersonalStation(music));
    expect(isAppleMusicError(error, "UserTokenInvalid")).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("what a function is handed is checked before Apple is asked, and a mistake names the function and the argument", () => {
  const track = { id: "1", type: "songs" };

  test.each<[string, tLoose, unknown[], string]>([
    ["searchLibrary: a term that is empty", loose(api.searchLibrary), ["", { types: ["library-songs"] }], `searchLibrary: ${TERM}0 characters`],
    ["searchLibrary: a term that is missing", loose(api.searchLibrary), [undefined, { types: ["library-songs"] }], `searchLibrary: ${TERM}undefined`],
    ["searchLibrary: a term one character too long", loose(api.searchLibrary), ["t".repeat(257), { types: ["library-songs"] }], `searchLibrary: ${TERM}257 characters`],
    ["searchLibrary: no options, and so no types", loose(api.searchLibrary), ["x"], `searchLibrary: types ${LIST}undefined`],
    ["searchLibrary: types that are one string", loose(api.searchLibrary), ["x", { types: "library-songs" }], `searchLibrary: types ${LIST}13 characters`],
    ["searchLibrary: options that are a list", loose(api.searchLibrary), ["x", ["library-songs"]], "searchLibrary: expected an options object; got a list"],
    ["getLibraryResources: ids that are a list", loose(api.getLibraryResources), [["i.1"]], 'getLibraryResources: ids must be a plain object of ids by type, such as { songs: ["1"] }; got a list'],
    ["getLibraryResources: ids of no type", loose(api.getLibraryResources), [{}], "getLibraryResources: ids must hold the ids of 1 to 32 types; got 0"],
    ["addToLibrary: ids that are missing", loose(api.addToLibrary), [], 'addToLibrary: ids must be a plain object of ids by type, such as { songs: ["1"] }; got undefined'],
    ["addToLibrary: a type's ids that are one string", loose(api.addToLibrary), [{ songs: "1" }], `addToLibrary: ids.songs ${LIST}1 characters`],
    ["addToLibrary: a type whose name would add a parameter", loose(api.addToLibrary), [{ "songs]&ids[albums": ["1"] }], "addToLibrary: ids holds a name that is no type of resource, which is lowercase words with hyphens between, as library-songs is; got 17 characters"],
    ["addToFavorites: ids that are a string", loose(api.addToFavorites), ["1"], 'addToFavorites: ids must be a plain object of ids by type, such as { songs: ["1"] }; got 1 characters'],
    ["addToFavorites: a type's ids that are empty", loose(api.addToFavorites), [{ songs: [] }], `addToFavorites: ids.songs ${LIST}a list of 0`],
    ["addLibraryPlaylistTracks: an id that is two dots", loose(api.addLibraryPlaylistTracks), ["..", [track]], `addLibraryPlaylistTracks: id ${SEGMENT}2 characters`],
    ["addLibraryPlaylistTracks: tracks that are missing", loose(api.addLibraryPlaylistTracks), ["p.1"], `${TRACKS}undefined`],
    ["addLibraryPlaylistTracks: tracks that are one track, not a list", loose(api.addLibraryPlaylistTracks), ["p.1", track], `${TRACKS}object`],
    ["addLibraryPlaylistTracks: no tracks", loose(api.addLibraryPlaylistTracks), ["p.1", []], `${TRACKS}a list of 0`],
    ["addLibraryPlaylistTracks: one track too many", loose(api.addLibraryPlaylistTracks), ["p.1", Array.from({ length: 301 }, () => track)], `${TRACKS}a list of 301`],
    ["addLibraryPlaylistTracks: a track that is an id alone", loose(api.addLibraryPlaylistTracks), ["p.1", [track, "2"]], `${TRACKS}1 characters at index 1`],
    ["addLibraryPlaylistTracks: a track with no type", loose(api.addLibraryPlaylistTracks), ["p.1", [{ id: "1" }]], `${TRACKS}object at index 0`],
    ["addLibraryPlaylistTracks: a track whose id is a number", loose(api.addLibraryPlaylistTracks), ["p.1", [{ id: 1, type: "songs" }]], `${TRACKS}object at index 0`],
    ["addLibraryPlaylistTracks: a track that is null", loose(api.addLibraryPlaylistTracks), ["p.1", [null]], `${TRACKS}null at index 0`],
    ["addLibraryPlaylistTracks: a track whose id and type are inherited", loose(api.addLibraryPlaylistTracks), ["p.1", [track, Object.create(track)]], `${TRACKS}object at index 1`],
    ["addLibraryPlaylistTracks: a track that is a list with an id and a type put on it", loose(api.addLibraryPlaylistTracks), ["p.1", [Object.assign(["x"], track)]], `${TRACKS}object at index 0`],
    ["addLibraryPlaylistTracks: a track that is a Map", loose(api.addLibraryPlaylistTracks), ["p.1", [new Map(Object.entries(track))]], `${TRACKS}object at index 0`],
    ["getRootLibraryPlaylistFolder: options that are a string", loose(api.getRootLibraryPlaylistFolder), ["root"], "getRootLibraryPlaylistFolder: expected an options object; got 4 characters"],
    ["listRecentlyPlayed: types that hold two in one", loose(api.listRecentlyPlayed), [{ types: ["albums,playlists"] }], `listRecentlyPlayed: types ${LIST}16 characters at index 0`],
    ["listRecentlyPlayed: types that are one string, not a list", loose(api.listRecentlyPlayed), [{ types: "albums" }], `listRecentlyPlayed: types ${LIST}6 characters`],
    ["listRecentlyPlayedTracks: types that are a number", loose(api.listRecentlyPlayedTracks), [{ types: 5 }], `listRecentlyPlayedTracks: types ${LIST}5`],
    ["getMusicSummariesByYear: views that are one string, not a list", loose(api.getMusicSummariesByYear), [["latest"], { views: "top-songs" }], `getMusicSummariesByYear: views ${LIST}9 characters`],
    ["getMusicSummariesByYear: a year that is one string", loose(api.getMusicSummariesByYear), ["latest"], `getMusicSummariesByYear: values ${LIST}6 characters`],
    ["getMusicSummariesByYear: no years", loose(api.getMusicSummariesByYear), [[]], `getMusicSummariesByYear: values ${LIST}a list of 0`],
    ["getUserStorefront: a limit of zero", loose(api.getUserStorefront), [{ limit: 0 }], "getUserStorefront: limit must be a whole number above 0; got 0"],
  ])("%s", async (_name, fn, args, message) => {
    const { music, calls } = apple();
    expect(await rejection(fn(music, ...args))).toEqual(new TypeError(message));
    expect(calls).toHaveLength(0);
  });

  test("a mistake is named in the order of the arguments", async () => {
    const { music } = apple();
    expect((await rejection(loose(api.searchLibrary)(music, "", { limit: 0 }))).message).toContain("searchLibrary: term ");
    expect((await rejection(loose(api.addLibraryPlaylistTracks)(music, "", [], { limit: 0 }))).message).toContain("addLibraryPlaylistTracks: id ");
    expect((await rejection(loose(api.addLibraryPlaylistTracks)(music, "p.1", [], { limit: 0 }))).message).toContain("addLibraryPlaylistTracks: tracks ");
    expect((await rejection(loose(api.addLibraryPlaylistTracks)(music, "p.1", [{ id: "1", type: "songs" }], { limit: 0 }))).message).toContain("addLibraryPlaylistTracks: limit ");
  });

  test("an argument is checked before the options are looked at at all: options that are no object do not hide an earlier mistake", async () => {
    const { music } = apple();
    expect((await rejection(loose(api.searchLibrary)(music, "", "library-songs"))).message).toContain("searchLibrary: term ");
    expect((await rejection(loose(api.getLibraryResources)(music, {}, "en-GB"))).message).toContain("getLibraryResources: ids ");
    expect((await rejection(loose(api.searchLibrary)(music, "x", "library-songs"))).message).toBe("searchLibrary: expected an options object; got 13 characters");
  });

  test("what is the most there may be is taken, so the checks can tell: 300 tracks, an id and a type of 64 characters, a term of 256", async () => {
    const { music, calls, bodies } = apple([{ status: 204 }, { status: 204 }]);
    await api.addLibraryPlaylistTracks(
      music,
      "p.1",
      Array.from({ length: 300 }, (_, i) => ({ id: String(i), type: "songs" as const })),
    );
    await loose(api.addLibraryPlaylistTracks)(music, "p.1", [{ id: "i".repeat(64), type: "t".repeat(64) }]);
    await api.searchLibrary(music, "t".repeat(256), { types: ["library-songs"] });
    const [most, longest] = (await bodies()) as { data: { id: string; type: string }[] }[];
    expect(most?.data).toHaveLength(300);
    expect(longest?.data).toEqual([{ id: "i".repeat(64), type: "t".repeat(64) }]);
    expect(new URL(calls[2]?.url ?? "").searchParams.get("term")).toHaveLength(256);
  });

  test("a mistake does not show a value: a token put where the term, the ids, a type or a track belongs", async () => {
    const token = `${SECRET}.${"p".repeat(260)}`;
    const { music, calls } = apple();
    const mistakes = [
      loose(api.searchLibrary)(music, token, { types: ["library-songs"] }),
      loose(api.searchLibrary)(music, "x", { types: [token] }),
      loose(api.getLibraryResources)(music, { [token]: ["i.1"] }),
      loose(api.addToLibrary)(music, { songs: [token] }),
      loose(api.addToFavorites)(music, token),
      loose(api.addLibraryPlaylistTracks)(music, token, [{ id: "1", type: "songs" }]),
      loose(api.addLibraryPlaylistTracks)(music, "p.1", [{ id: token, type: "songs" }]),
      loose(api.addLibraryPlaylistTracks)(music, "p.1", [{ id: "1", type: token }]),
      loose(api.getMusicSummariesByYear)(music, [token]),
    ];
    for (const mistake of mistakes) {
      const error = await rejection(mistake);
      expect(error).toBeInstanceOf(TypeError);
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("what a caller puts in is what is sent, and nothing more", () => {
  test("a term is sent as one parameter, whatever it holds", async () => {
    const { music, calls } = apple();
    const term = "a&types=library-albums #1 ?x=y/../é";
    await api.searchLibrary(music, term, { types: ["library-songs"] });
    const url = new URL(calls[0]?.url ?? "");
    expect([url.pathname, url.hash]).toEqual(["/v1/me/library/search", ""]);
    expect([...url.searchParams]).toEqual([
      ["term", term],
      ["types", "library-songs"],
    ]);
  });

  test("a type put on Object.prototype by other code is not a track's: a track that holds only its id is still refused", async () => {
    Object.assign(Object.prototype, { type: "songs" });
    try {
      const { music, calls } = apple();
      expect((await rejection(loose(api.addLibraryPlaylistTracks)(music, "p.1", [{ id: "1" }]))).message).toBe(`${TRACKS}object at index 0`);
      expect(calls).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(Object.prototype, "type");
    }
  });

  test("a track with no prototype at all is a track like any other", async () => {
    const { music, bodies } = apple([{ status: 204 }]);
    await api.addLibraryPlaylistTracks(music, "p.1", [Object.assign(Object.create(null) as object, { id: "1", type: "songs" }) as api.tPlaylistTrack]);
    expect(await bodies()).toEqual([{ data: [{ id: "1", type: "songs" }] }]);
  });

  test("of each track, its id and its type are sent and nothing else it held", async () => {
    const { music, bodies } = apple([{ status: 204 }]);
    await api.addLibraryPlaylistTracks(music, "p.1", [{ id: "1", type: "songs", attributes: { name: "x" }, token: SECRET } as never, { id: "i.2", type: "library-songs" }]);
    expect(await bodies()).toEqual([
      {
        data: [
          { id: "1", type: "songs" },
          { id: "i.2", type: "library-songs" },
        ],
      },
    ]);
  });

  test("the tracks and the ids are copied when the call is made: changing the caller's afterwards changes nothing", async () => {
    const { music, sent, bodies } = apple([{ status: 204 }, { status: 202 }]);
    const tracks: api.tPlaylistTrack[] = [{ id: "1", type: "songs" }];
    const songs = ["1"];
    const pending = [api.addLibraryPlaylistTracks(music, "p.1", tracks), api.addToLibrary(music, { songs })];
    tracks.push({ id: "2", type: "songs" });
    (tracks[0] as { id: string }).id = "changed";
    songs.push("2");
    await Promise.all(pending);
    expect(sent()).toEqual(["POST /v1/me/library/playlists/p.1/tracks", "POST /v1/me/library?ids[songs]=1"]);
    expect((await bodies())[0]).toEqual({ data: [{ id: "1", type: "songs" }] });
  });

  test("a playlist's id cannot move the tracks to another playlist's, or out of the playlists", async () => {
    const { music, calls } = apple([{ status: 204 }]);
    for (const id of ["../p.2", "p.1/../p.2", "p.1%2F..%2Fp.2", ".."]) {
      expect(await rejection(api.addLibraryPlaylistTracks(music, id, [{ id: "1", type: "songs" }]))).toEqual(new TypeError(`addLibraryPlaylistTracks: id ${SEGMENT}${String(id.length)} characters`));
    }
    expect(calls).toHaveLength(0);
    await api.addLibraryPlaylistTracks(music, "p.1?x=2", [{ id: "1", type: "songs" }]);
    expect(calls.map((call) => new URL(call.url).pathname + new URL(call.url).search)).toEqual(["/v1/me/library/playlists/p.1%3Fx%3D2/tracks"]);
  });

  test("the root folder is always asked for by the one filter there is, whatever the caller's params say", async () => {
    const { music, sent } = apple();
    await api.getRootLibraryPlaylistFolder(music, { params: { "filter[identity]": "something-else" } });
    expect(sent()).toEqual(["GET /v1/me/library/playlist-folders?filter[identity]=playlistsroot"]);
  });
});

describe("the types", () => {
  const { music } = apple();

  test("each function resolves to the answer Apple documents for it, and bound to what the answer holds", () => {
    expectTypeOf(api.searchLibrary).returns.resolves.toEqualTypeOf<tLibrarySearchResponse>();
    expectTypeOf(api.getLibraryResources.bound(music)).returns.resolves.toEqualTypeOf<tResource[]>();
    expectTypeOf(api.getRootLibraryPlaylistFolder.bound(music)).returns.resolves.toEqualTypeOf<tLibraryPlaylistFolder>();
    expectTypeOf(api.getPersonalStation.bound(music)).returns.resolves.toEqualTypeOf<tStation>();
    expectTypeOf(api.getUserStorefront.bound(music)).returns.resolves.toEqualTypeOf<tStorefront>();
    expectTypeOf(api.getMusicSummariesByYear.bound(music)).returns.resolves.toEqualTypeOf<tMusicSummary[]>();
    expectTypeOf(api.listRecentlyPlayed.bound(music)).returns.toEqualTypeOf<AsyncIterable<tResource>>();
    expectTypeOf(api.addToLibrary).returns.resolves.toBeVoid();
    expectTypeOf(api.addLibraryPlaylistTracks.bound(music)).returns.resolves.toBeVoid();
  });

  test("what does not fit does not compile", () => {
    const calls = [
      // @ts-expect-error -- a search has to say what types to look for
      () => api.searchLibrary(music, "x"),
      // @ts-expect-error -- a catalog's type is not one a library search looks for
      () => api.searchLibrary(music, "x", { types: ["songs"] }),
      // @ts-expect-error -- a catalog's type is not one the library is asked for by id
      () => api.getLibraryResources(music, { songs: ["1"] }),
      // @ts-expect-error -- a track is of one of the four types a track can be
      () => api.addLibraryPlaylistTracks(music, "p.1", [{ id: "1", type: "albums" }]),
      // @ts-expect-error -- a view a summary does not have
      () => api.getMusicSummariesByYear(music, ["latest"], { views: ["top-playlists"] }),
      // @ts-expect-error -- a type of track is not a type of what was played
      () => api.listRecentlyPlayed(music, { types: ["songs"] }),
      // @ts-expect-error -- ids are by type, not a list
      () => api.addToLibrary(music, ["1"]),
    ];
    expect(calls).toHaveLength(7);
  });
});

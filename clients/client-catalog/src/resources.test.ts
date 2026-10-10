import { createClient, isAppleMusicError, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import type { tAlbum, tAlbumsResponse, tArtist, tGenre, tMusicVideo, tPlaylist, tRecordLabel, tSong, tSongsResponse, tStorefront } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import * as api from "./resources";

/** One answer from Apple: a response, or a fetch that throws. */
type tReply = { status?: number; body?: unknown } | Error;

const SECRET = "s3cretT0ken";
const SEGMENT = 'must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';
const LIST = "must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";
const song = (id: string) => ({ id, type: "songs", href: `/v1/catalog/us/songs/${id}` });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A client over a fetch that answers from a queue of replies, then with one song, and records every Request it saw. */
function apple(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: { data: [song("1")] } };
    if (reply instanceof Error) return Promise.reject(reply);
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", storefront: "us", fetch, retry: false, ...options }),
    calls,
    /** Each request as its method, path and query. */
    sent: () => calls.map((call) => `${call.method} ${new URL(call.url).pathname}${decodeURIComponent(new URL(call.url).search)}`),
    /** The Music User Token each request carried, or null. */
    userTokens: () => calls.map((call) => call.headers.get("music-user-token")),
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

/** What `fn` throws. A call that returns fails the test. */
const thrown = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error("expected a throw");
};

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

/** One function of each pattern, called with whatever storefront option it is handed. */
const patterns: [string, (music: tAppleMusicClient, options?: { storefront?: string }) => Promise<unknown>, string][] = [
  ["getSong", (music, options) => api.getSong(music, "1", options), "songs/1"],
  ["getSongs", (music, options) => api.getSongs(music, ["1"], options), "songs?ids=1"],
  ["getSongsByIsrc", (music, options) => api.getSongsByIsrc(music, ["A"], options), "songs?filter[isrc]=A"],
  ["listGenres", (music, options) => api.listGenres(music, options), "genres"],
  ["getAlbumRelationship", (music, options) => api.getAlbumRelationship(music, "1", "tracks", options), "albums/1/tracks"],
  ["getAlbumView", (music, options) => api.getAlbumView(music, "1", "other-versions", options), "albums/1/view/other-versions"],
];

describe("whose catalog is asked", () => {
  test.each(patterns)("%s asks the catalog of the storefront the call names, whatever the client's is", async (_name, call, rest) => {
    const { music, sent } = apple();
    await call(music, { storefront: "gb" });
    expect(sent()).toEqual([`GET /v1/catalog/gb/${rest}`]);
  });

  test.each(patterns)("%s asks the client's storefront when the call names none", async (_name, call, rest) => {
    const { music, sent } = apple();
    await call(music);
    await call(music, {});
    expect(sent()).toEqual([`GET /v1/catalog/us/${rest}`, `GET /v1/catalog/us/${rest}`]);
  });

  test("a client with no storefront of its own is asked for the listener's, which it looks up once, and the catalog is then asked without the listener's token", async () => {
    const { music, sent, userTokens } = apple([{ body: { data: [{ id: "jp", type: "storefronts" }] } }], { storefront: undefined, userToken: "listener" });
    await api.getSong(music, "1");
    await api.getAlbum(music, "2");
    expect(sent()).toEqual(["GET /v1/me/storefront", "GET /v1/catalog/jp/songs/1", "GET /v1/catalog/jp/albums/2"]);
    expect(userTokens()).toEqual(["listener", null, null]);
  });

  test("a function that walks pages asks for nothing as it is called, the listener's storefront included", async () => {
    const { music, calls } = apple([], { storefront: undefined, userToken: "listener" });
    api.listGenres.bound(music)();
    api.getAlbumRelationship.bound(music)("1", "tracks");
    api.getAlbumView.bound(music)("1", "other-versions");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(0);
  });

  test("the loop is what looks the storefront up, and a lookup that fails is tried again by the next loop", async () => {
    const { music, sent } = apple([{ status: 500 }, { body: { data: [{ id: "jp", type: "storefronts" }] } }, { body: { data: [song("1")] } }], { storefront: undefined, userToken: "listener" });
    const genres = api.listGenres.bound(music)();
    expect(isAppleMusicError(await rejection(all(genres)), "ApiError")).toBe(true);
    expect(await all(genres)).toEqual([song("1")]);
    expect(sent()).toEqual(["GET /v1/me/storefront", "GET /v1/me/storefront", "GET /v1/catalog/jp/genres"]);
  });

  test("a storefront the call names saves that lookup", async () => {
    const { music, sent } = apple([], { storefront: undefined, userToken: "listener" });
    await api.getSong(music, "1", { storefront: "gb" });
    expect(sent()).toEqual(["GET /v1/catalog/gb/songs/1"]);
  });

  test("with no storefront from the call, the client or a listener, there is no catalog to ask: the client says so, and Apple is not asked", async () => {
    const { music, calls } = apple([], { storefront: undefined });
    const error = await rejection(api.getSong(music, "1"));
    expect(isAppleMusicError(error, "UserTokenInvalid")).toBe(true);
    expect(error.message).toContain("pass storefront");
    expect(calls).toHaveLength(0);
  });

  test("storefronts are in no storefront's catalog: they are asked for where they are, whatever the client's is", async () => {
    const { music, sent } = apple();
    await api.getStorefront(music, "jp");
    await api.getStorefronts(music, ["jp", "fr"]);
    await api.listStorefronts(music);
    expect(sent()).toEqual(["GET /v1/storefronts/jp", "GET /v1/storefronts?ids=jp,fr", "GET /v1/storefronts"]);
  });

  test.each<[string, unknown, string]>([
    ["empty", "", "0 characters"],
    ["two dots, which a URL reads as one up", "..", "2 characters"],
    ["a number", 143444, "143444"],
    ["null", null, "null"],
    ["a list", ["gb"], "object"],
    ["longer than a storefront's id is", "s".repeat(65), "65 characters"],
  ])("a storefront that is %s is a TypeError naming the function and the option, and Apple is not asked", async (_name, storefront, what) => {
    for (const [name, call] of patterns) {
      const { music, calls } = apple();
      expect(await rejection(call(music, { storefront: storefront as string }))).toEqual(new TypeError(`${name}: storefront ${SEGMENT}${what}`));
      expect(calls).toHaveLength(0);
    }
  });

  test("a mistake in the storefront does not show it: one that is a token is described by its length", async () => {
    const token = `${SECRET}.${"p".repeat(75)}.${"s".repeat(86)}`;
    const error = await rejection(api.getSong(apple().music, "1", { storefront: token }));
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
  });
});

describe("a value put in a path stays where it was put, so a request for the catalog cannot become one for the listener", () => {
  /** What a URL, or a server that decodes a path before it reads it, would take for a way out of the segment. */
  const leaving = ["../../../me/library/songs", "..\\..\\me", "%2e%2e/%2e%2e/me", "..%2F..%2Fme", "/v1/me/storefront", "//evil.example/x", "us\nx"];
  /** What means something elsewhere in a URL, and nothing in a path once it is encoded. */
  const hostile = ["1?include=library", "1#fragment", "a b", "1&ids=2"];

  test.each(leaving)("an id, a storefront, or a relationship's or view's name of %j is refused, and Apple is not asked", async (value) => {
    const { music, calls } = apple([], { userToken: "listener" });
    const what = `${String(value.length)} characters`;
    expect(await rejection(api.getSong(music, value))).toEqual(new TypeError(`getSong: id ${SEGMENT}${what}`));
    expect(await rejection(api.getSong(music, "1", { storefront: value }))).toEqual(new TypeError(`getSong: storefront ${SEGMENT}${what}`));
    expect(await rejection(api.getAlbumRelationship(music, "1", value as "tracks"))).toEqual(new TypeError(`getAlbumRelationship: name ${SEGMENT}${what}`));
    expect(await rejection(api.getAlbumView(music, "1", value as "other-versions"))).toEqual(new TypeError(`getAlbumView: name ${SEGMENT}${what}`));
    expect(await rejection(api.getAlbumView(music, value, "other-versions"))).toEqual(new TypeError(`getAlbumView: id ${SEGMENT}${what}`));
    expect(calls).toHaveLength(0);
  });

  test("a client's own storefront is held to the same, whether it was given to the client or is the one Apple answered with", async () => {
    const given = apple([], { storefront: "../me/library" });
    expect(await rejection(api.getSong(given.music, "1"))).toEqual(new TypeError(`getSong: storefront ${SEGMENT}13 characters`));
    expect(await rejection(api.getAlbumView(given.music, "1", "other-versions"))).toEqual(new TypeError(`getAlbumView: storefront ${SEGMENT}13 characters`));
    const answered = apple([{ body: { data: [{ id: "../../me/library", type: "storefronts" }] } }], { storefront: undefined, userToken: "listener" });
    expect(await rejection(api.getSong(answered.music, "1"))).toEqual(new TypeError(`getSong: storefront ${SEGMENT}16 characters`));
    expect([given.calls.length, answered.sent()]).toEqual([0, ["GET /v1/me/storefront"]]);
  });
  /** The path of the one request sent, in segments, and whether it carried the listener's token. */
  const asked = async (call: (music: tAppleMusicClient) => Promise<unknown>) => {
    const { music, calls, userTokens } = apple([], { userToken: "listener" });
    await call(music);
    const url = new URL(calls[0]?.url ?? "");
    return { segments: url.pathname.split("/").slice(1), rest: url.search + url.hash, origin: url.origin, tokens: userTokens() };
  };

  test.each(hostile)("an id of %j is one segment after the collection", async (id) => {
    const { segments, rest, origin, tokens } = await asked((music) => api.getSong(music, id));
    expect(segments.slice(0, 4)).toEqual(["v1", "catalog", "us", "songs"]);
    expect(segments).toHaveLength(5);
    expect(decodeURIComponent(segments[4] ?? "")).toBe(id);
    expect([rest, origin, tokens]).toEqual(["", "https://api.music.apple.com", [null]]);
  });

  test.each(hostile)("a storefront of %j is one segment after /v1/catalog", async (storefront) => {
    const { segments, rest, tokens } = await asked((music) => api.getSong(music, "1", { storefront }));
    expect(segments.slice(0, 2)).toEqual(["v1", "catalog"]);
    expect(segments).toHaveLength(5);
    expect(decodeURIComponent(segments[2] ?? "")).toBe(storefront);
    expect([segments.slice(3), rest, tokens]).toEqual([["songs", "1"], "", [null]]);
  });

  test.each(hostile)("a relationship's or a view's name of %j is one segment after the id", async (name) => {
    const related = await asked((music) => api.getAlbumRelationship(music, "1", name as "tracks"));
    const viewed = await asked((music) => api.getAlbumView(music, "1", name as "other-versions"));
    expect(related.segments.slice(0, 5)).toEqual(["v1", "catalog", "us", "albums", "1"]);
    expect(viewed.segments.slice(0, 6)).toEqual(["v1", "catalog", "us", "albums", "1", "view"]);
    expect([related.segments.length, viewed.segments.length]).toEqual([6, 7]);
    expect([decodeURIComponent(related.segments[5] ?? ""), decodeURIComponent(viewed.segments[6] ?? "")]).toEqual([name, name]);
    expect([related.tokens, viewed.tokens]).toEqual([[null], [null]]);
  });

  test("the check that says so can tell: put into a path as it is, the same id does reach the listener's library, with the listener's token", async () => {
    const { music, sent, userTokens } = apple([], { userToken: "listener" });
    await music.request("v1/catalog/us/songs/../../../me/library/songs");
    expect([sent(), userTokens()]).toEqual([["GET /v1/me/library/songs"], ["listener"]]);
  });

  test.each<[string, (music: tAppleMusicClient) => Promise<unknown>, string]>([
    ["getSong: an id that is two dots", (music) => api.getSong(music, ".."), `getSong: id ${SEGMENT}2 characters`],
    ["getSong: an id that is empty", (music) => api.getSong(music, ""), `getSong: id ${SEGMENT}0 characters`],
    ["getAlbumRelationship: a name that is one dot", (music) => api.getAlbumRelationship(music, "1", "." as "tracks"), `getAlbumRelationship: name ${SEGMENT}1 characters`],
    ["getAlbumView: an id that is missing", (music) => api.getAlbumView(music, undefined as unknown as string, "other-versions"), `getAlbumView: id ${SEGMENT}undefined`],
    ["getAlbumView: a name that is two dots", (music) => api.getAlbumView(music, "1", ".." as "other-versions"), `getAlbumView: name ${SEGMENT}2 characters`],
    ["getAlbumView: a name that is a number", (music) => api.getAlbumView(music, "1", 5 as unknown as "other-versions"), `getAlbumView: name ${SEGMENT}5`],
    ["getAlbum: views that are one string, not a list", (music) => api.getAlbum(music, "1", { views: "other-versions" as never }), `getAlbum: views ${LIST}14 characters`],
    ["getSongsByEquivalents: a restrict that is true", (music) => api.getSongsByEquivalents(music, ["1"], { restrict: true as never }), `getSongsByEquivalents: restrict ${LIST}boolean`],
    ["getAlbumView: a with that is one string, not a list", (music) => api.getAlbumView(music, "1", "other-versions", { with: "attributes" as never }), `getAlbumView: with ${LIST}10 characters`],
  ])("%s is a TypeError, and Apple is not asked", async (_name, call, message) => {
    const { music, calls } = apple();
    expect(await rejection(call(music))).toEqual(new TypeError(message));
    expect(calls).toHaveLength(0);
  });

  test("a token put where an id belongs is refused before it is sent, and is not shown", async () => {
    const token = `${SECRET}.${"p".repeat(75)}.${"s".repeat(86)}`;
    const { music, calls } = apple();
    for (const call of [api.getSong(music, token), api.getSongs(music, [token]), api.getAlbumView(music, token, "other-versions"), api.getAlbumRelationship(music, "1", token as "tracks")]) {
      const error = await rejection(call);
      expect(error).toBeInstanceOf(TypeError);
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("a view of a resource", () => {
  test("called with a client it resolves to the page Apple answers with, and bound it gives every item of every page", async () => {
    const first = { data: [song("1")], next: "/v1/catalog/us/albums/9/view/other-versions?offset=1", attributes: { title: "Other Versions" } };
    const { music, sent } = apple([{ body: first }, { body: first }, { body: { data: [song("2")] } }]);
    expect(await api.getAlbumView(music, "9", "other-versions", { with: ["attributes"] })).toEqual(first);
    expect(await all(api.getAlbumView.bound(music)("9", "other-versions", { limit: 1 }))).toEqual([song("1"), song("2")]);
    expect(sent()).toEqual([
      "GET /v1/catalog/us/albums/9/view/other-versions?with=attributes",
      "GET /v1/catalog/us/albums/9/view/other-versions?limit=1",
      "GET /v1/catalog/us/albums/9/view/other-versions?offset=1",
    ]);
  });

  test("bound, a mistake is thrown as the function is called, before any loop, when the call names its storefront", () => {
    const { music, calls } = apple();
    const view = api.getAlbumView.bound(music);
    expect(thrown(() => view("..", "other-versions", { storefront: "gb" }))).toEqual(new TypeError(`getAlbumView: id ${SEGMENT}2 characters`));
    expect(thrown(() => view("1", "other-versions", { storefront: ".." }))).toEqual(new TypeError(`getAlbumView: storefront ${SEGMENT}2 characters`));
    expect(thrown(() => view("1", "other-versions", { limit: 0 }))).toEqual(new TypeError("getAlbumView: limit must be a whole number above 0; got 0"));
    expect(calls).toHaveLength(0);
  });

  test("what it is handed is checked in the order it was handed over: the id, the name, then the options", async () => {
    const { music } = apple();
    const wrong = { limit: 0 };
    expect((await rejection(api.getAlbumView(music, "", "." as "other-versions", wrong))).message).toContain("getAlbumView: id ");
    expect((await rejection(api.getAlbumView(music, "1", "." as "other-versions", wrong))).message).toContain("getAlbumView: name ");
    expect((await rejection(api.getAlbumView(music, "1", "other-versions", wrong))).message).toContain("getAlbumView: limit ");
  });

  test("options that are not an options object are a TypeError naming the function", async () => {
    const { music, calls } = apple();
    expect(await rejection(api.getAlbumView(music, "1", "other-versions", ["attributes"] as never))).toEqual(new TypeError("getAlbumView: expected an options object; got a list"));
    expect(calls).toHaveLength(0);
  });

  test("an option that is not a view's is not sent", async () => {
    const { music, sent } = apple();
    await api.getAlbumView(music, "1", "other-versions", { views: ["appears-on"] } as never);
    expect(sent()).toEqual(["GET /v1/catalog/us/albums/1/view/other-versions"]);
  });
});

describe("the types: a function is about the generated type its name says, and a name asked for decides what comes back", () => {
  const { music } = apple();

  test("called with a client, a function resolves to Apple's answer", () => {
    expectTypeOf(api.getSong).returns.resolves.toEqualTypeOf<tSongsResponse>();
    expectTypeOf(api.getSongs).returns.resolves.toEqualTypeOf<tSongsResponse>();
    expectTypeOf(api.getSongsByIsrc).returns.resolves.toEqualTypeOf<tSongsResponse>();
    expectTypeOf(api.getAlbum).returns.resolves.toEqualTypeOf<tAlbumsResponse>();
    expectTypeOf(api.listGenres(music)).resolves.toExtend<{ data: tGenre[]; next?: string | undefined }>();
  });

  test("bound, it hands over the resource, the list, or every item of every page", () => {
    expectTypeOf(api.getSong.bound(music)).returns.resolves.toEqualTypeOf<tSong>();
    expectTypeOf(api.getSongs.bound(music)).returns.resolves.toEqualTypeOf<tSong[]>();
    expectTypeOf(api.getAlbumsByUpc.bound(music)).returns.resolves.toEqualTypeOf<tAlbum[]>();
    expectTypeOf(api.listStorefronts.bound(music)).returns.toEqualTypeOf<AsyncIterable<tStorefront>>();
  });

  test("a relationship's name decides the resources it gives, called with a client or bound", () => {
    expectTypeOf(api.getAlbumRelationship(music, "1", "artists")).resolves.toHaveProperty("data").toEqualTypeOf<tArtist[]>();
    expectTypeOf(api.getAlbumRelationship(music, "1", "tracks")).resolves.toHaveProperty("data").toEqualTypeOf<(tMusicVideo | tSong)[]>();
    expectTypeOf(api.getAlbumRelationship.bound(music)("1", "genres")).toEqualTypeOf<AsyncIterable<tGenre>>();
    expectTypeOf(api.getPlaylistRelationship.bound(music)("1", "tracks")).toEqualTypeOf<AsyncIterable<tMusicVideo | tSong>>();
  });

  test("a view's name decides the resources it gives, called with a client or bound", () => {
    expectTypeOf(api.getAlbumView(music, "1", "appears-on")).resolves.toHaveProperty("data").toEqualTypeOf<tPlaylist[]>();
    expectTypeOf(api.getArtistView.bound(music)("1", "top-songs")).toEqualTypeOf<AsyncIterable<tSong>>();
    expectTypeOf(api.getRecordLabelView.bound(music)("1", "latest-releases")).toEqualTypeOf<AsyncIterable<tAlbum>>();
    expectTypeOf(api.getArtistView.bound(music)("1", "similar-artists")).toEqualTypeOf<AsyncIterable<tArtist>>();
    expectTypeOf<tRecordLabel>().not.toBeAny();
  });

  test("what does not fit does not compile", () => {
    const calls = [
      // @ts-expect-error -- the library relationship needs the listener, and is not a name the catalog takes
      () => api.getSongRelationship(music, "1", "library"),
      // @ts-expect-error -- nor for an album
      () => api.getAlbumRelationship(music, "1", "library"),
      // @ts-expect-error -- nor for a playlist
      () => api.getPlaylistRelationship(music, "1", "library"),
      // @ts-expect-error -- nor for a music video
      () => api.getMusicVideoRelationship(music, "1", "library"),
      // @ts-expect-error -- a relationship an album does not have
      () => api.getAlbumRelationship(music, "1", "composers"),
      // @ts-expect-error -- a view an album does not have
      () => api.getAlbumView(music, "1", "top-songs"),
      // @ts-expect-error -- a view an album does not have, among the ones sent with it
      () => api.getAlbum(music, "1", { views: ["top-songs"] }),
      // @ts-expect-error -- a song has no views
      () => api.getSong(music, "1", { views: ["top-songs"] }),
      // @ts-expect-error -- only a search for equivalents can be restricted
      () => api.getSongsByIsrc(music, ["A"], { restrict: ["explicit"] }),
      // @ts-expect-error -- a storefront is in no storefront's catalog
      () => api.getStorefront(music, "jp", { storefront: "gb" }),
      // @ts-expect-error -- one id is not a list of them
      () => api.getSongs(music, "1"),
    ];
    expect(calls).toHaveLength(11);
  });
});

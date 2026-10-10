import { createClient, isAppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import type { tRating, tRatingsResponse } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import * as api from "./ratings";

/** One answer from Apple. */
interface tReply {
  status?: number;
  body?: unknown;
}

const SECRET = "s3cretT0ken";
const SEGMENT = 'must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';
const VALUE = "value must be 1, for a like, or -1, for a dislike; got ";
const rating = (id: string, value: 1 | -1 = 1) => ({ id, type: "ratings", href: `/v1/me/ratings/songs/${id}`, attributes: { value } });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A listener's client over a fetch that answers from a queue of replies, then with one rating, and records every Request it saw. */
function apple(replies: tReply[] = []) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: { data: [rating("1")] } };
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", userToken: "listener", fetch, retry: false }),
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

/** The four functions of each type that can be rated, and where that type's ratings are. */
const types = [
  ["Song", "songs"],
  ["Album", "albums"],
  ["MusicVideo", "music-videos"],
  ["Playlist", "playlists"],
  ["Station", "stations"],
  ["LibrarySong", "library-songs"],
  ["LibraryAlbum", "library-albums"],
  ["LibraryMusicVideo", "library-music-videos"],
  ["LibraryPlaylist", "library-playlists"],
] as const;
const all = api as unknown as Record<string, (music: tAppleMusicClient, ...args: unknown[]) => Promise<unknown>>;

describe("nine types can be rated, and each has the same four functions", () => {
  test("the package's rating functions are those four for each type, and no others", () => {
    expect(Object.keys(api).sort()).toEqual(types.flatMap(([noun]) => [`get${noun}Rating`, `get${noun}Ratings`, `set${noun}Rating`, `delete${noun}Rating`]).sort());
  });

  test.each(types)("a %s's rating is read, read among several, set and taken away where that type's ratings are", async (noun, path) => {
    const { music, sent, bodies } = apple();
    await all[`get${noun}Rating`]?.(music, "1");
    await all[`get${noun}Ratings`]?.(music, ["1", "2"]);
    await all[`set${noun}Rating`]?.(music, "1", -1);
    await all[`delete${noun}Rating`]?.(music, "1");
    expect(sent()).toEqual([`GET /v1/me/ratings/${path}/1`, `GET /v1/me/ratings/${path}?ids=1,2`, `PUT /v1/me/ratings/${path}/1`, `DELETE /v1/me/ratings/${path}/1`]);
    expect(await bodies()).toEqual([undefined, undefined, { type: "ratings", attributes: { value: -1 } }, undefined]);
  });
});

describe("what a rating function resolves to", () => {
  test("a rating read or set is Apple's answer, and bound it is the rating", async () => {
    const answer = { data: [rating("1", -1)] };
    const { music } = apple(Array.from({ length: 4 }, () => ({ body: answer })));
    expect(await api.getSongRating(music, "1")).toEqual(answer);
    expect(await api.setSongRating(music, "1", -1)).toEqual(answer);
    expect(await api.getSongRating.bound(music)("1")).toEqual(answer.data[0]);
    expect(await api.setSongRating.bound(music)("1", -1)).toEqual(answer.data[0]);
  });

  test("the ratings of several are Apple's answer, and bound they are the list, which leaves out what has no rating", async () => {
    const answer = { data: [rating("1"), rating("3", -1)] };
    const { music } = apple([{ body: answer }, { body: answer }]);
    expect(await api.getSongRatings(music, ["1", "2", "3"])).toEqual(answer);
    expect(await api.getSongRatings.bound(music)(["1", "2", "3"])).toEqual(answer.data);
  });

  test("a resource the listener has not rated is the error Apple answers with, called with a client or bound", async () => {
    const missing = { status: 404, body: { errors: [{ status: "404", code: "40400", title: "Resource Not Found" }] } };
    const { music } = apple([missing, missing]);
    for (const asked of [api.getSongRating(music, "1"), api.getSongRating.bound(music)("1")]) {
      const error = await rejection(asked);
      expect([isAppleMusicError(error, "ApiError"), (error as { status?: number }).status]).toEqual([true, 404]);
    }
  });

  test("a rating that is set and answered with nothing is set all the same: bound, it gives undefined and no error", async () => {
    const { music, sent } = apple([{ status: 204 }, { body: { data: [] } }]);
    expect(await api.setSongRating.bound(music)("1", 1)).toBeUndefined();
    expect(await api.setLibrarySongRating.bound(music)("i.1", -1)).toBeUndefined();
    expect(sent()).toEqual(["PUT /v1/me/ratings/songs/1", "PUT /v1/me/ratings/library-songs/i.1"]);
  });

  test("a rating taken away resolves to nothing, called with a client or bound, since Apple answers with nothing", async () => {
    const { music } = apple([{ status: 204 }, { status: 204 }]);
    await expect(api.deleteSongRating(music, "1")).resolves.toBeUndefined();
    await expect(api.deleteSongRating.bound(music)("1")).resolves.toBeUndefined();
  });
});

describe("what a rating function is handed is checked before Apple is asked", () => {
  test.each<[string, unknown, string]>([
    ["zero", 0, "0"],
    ["two", 2, "2"],
    ["a like as a string", "1", "1 characters"],
    ["true", true, "boolean"],
    ["missing", undefined, "undefined"],
    ["null", null, "null"],
    ["not a number", Number.NaN, "NaN"],
    ["the options, put where the value belongs", { language: "en-GB" }, "object"],
  ])("a value that is %s is a TypeError naming the function and the argument", async (_name, value, what) => {
    const { music, calls } = apple();
    expect(await rejection(api.setSongRating(music, "1", value as 1))).toEqual(new TypeError(`setSongRating: ${VALUE}${what}`));
    expect(await rejection(api.setLibraryAlbumRating.bound(music)("l.1", value as 1))).toEqual(new TypeError(`setLibraryAlbumRating: ${VALUE}${what}`));
    expect(calls).toHaveLength(0);
  });

  test.each<[string, (music: tAppleMusicClient) => Promise<unknown>, string]>([
    ["getSongRating: an id that is two dots", (music) => api.getSongRating(music, ".."), `getSongRating: id ${SEGMENT}2 characters`],
    ["setSongRating: an id that is empty", (music) => api.setSongRating(music, "", 1), `setSongRating: id ${SEGMENT}0 characters`],
    ["deleteSongRating: an id that is missing", (music) => api.deleteSongRating(music, undefined as unknown as string), `deleteSongRating: id ${SEGMENT}undefined`],
    ["deleteStationRating: an id that is a list", (music) => api.deleteStationRating(music, ["ra.1"] as unknown as string), `deleteStationRating: id ${SEGMENT}object`],
    ["setSongRating: options that are a string", (music) => api.setSongRating(music, "1", 1, "en-GB" as never), "setSongRating: expected an options object; got 5 characters"],
    ["deleteSongRating: a language that is empty", (music) => api.deleteSongRating(music, "1", { language: "" }), "deleteSongRating: language must be a string of 1 to 64 characters; got 0 characters"],
  ])("%s is a TypeError, and Apple is not asked", async (_name, call, message) => {
    const { music, calls } = apple();
    expect(await rejection(call(music))).toEqual(new TypeError(message));
    expect(calls).toHaveLength(0);
  });

  test("a mistake is named in the order of the arguments: the id, the value, then the options", async () => {
    const { music } = apple();
    expect((await rejection(api.setSongRating(music, "", 0 as 1, { language: "" }))).message).toContain("setSongRating: id ");
    expect((await rejection(api.setSongRating(music, "1", 0 as 1, { language: "" }))).message).toContain("setSongRating: value ");
    expect((await rejection(api.setSongRating(music, "1", 1, { language: "" }))).message).toContain("setSongRating: language ");
  });

  test("a rating to take away is named in the same order: the id before the options, whatever the options are", async () => {
    const { music, calls } = apple();
    expect((await rejection(api.deleteSongRating(music, "", { language: "" }))).message).toContain("deleteSongRating: id ");
    expect((await rejection(api.deleteSongRating(music, "", "en-GB" as never))).message).toContain("deleteSongRating: id ");
    expect((await rejection(api.deleteSongRating(music, "1", { language: "" }))).message).toContain("deleteSongRating: language ");
    expect(calls).toHaveLength(0);
  });

  test("an id cannot move a rating to another resource's, or out of the ratings", async () => {
    const { music, calls } = apple();
    for (const id of ["../albums/1", "../../library/playlists/p.1", "..%2Falbums%2F1", "1\\..\\2"]) {
      const what = `${String(id.length)} characters`;
      expect(await rejection(api.setSongRating(music, id, 1))).toEqual(new TypeError(`setSongRating: id ${SEGMENT}${what}`));
      expect(await rejection(api.deleteSongRating(music, id))).toEqual(new TypeError(`deleteSongRating: id ${SEGMENT}${what}`));
      expect(await rejection(api.getSongRating(music, id))).toEqual(new TypeError(`getSongRating: id ${SEGMENT}${what}`));
    }
    expect(calls).toHaveLength(0);
    await api.deleteSongRating(music, "1?ids=2");
    expect(calls.map((request) => new URL(request.url).pathname + new URL(request.url).search)).toEqual(["/v1/me/ratings/songs/1%3Fids%3D2"]);
  });

  test("a token put where an id belongs is refused before it is sent, and is not shown", async () => {
    const token = `${SECRET}.${"p".repeat(75)}.${"s".repeat(86)}`;
    const { music, calls } = apple();
    for (const asked of [api.getSongRating(music, token), api.setSongRating(music, token, 1), api.deleteSongRating(music, token), api.setSongRating(music, "1", token as unknown as 1)]) {
      const error = await rejection(asked);
      expect(error).toBeInstanceOf(TypeError);
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("the types", () => {
  const { music } = apple();

  test("a rating read or set resolves to Apple's answer, and bound to the rating; one taken away resolves to nothing", () => {
    expectTypeOf(api.getSongRating).returns.resolves.toEqualTypeOf<tRatingsResponse>();
    expectTypeOf(api.setSongRating).returns.resolves.toEqualTypeOf<tRatingsResponse>();
    expectTypeOf(api.getSongRating.bound(music)).returns.resolves.toEqualTypeOf<tRating>();
    expectTypeOf(api.getSongRatings.bound(music)).returns.resolves.toEqualTypeOf<tRating[]>();
    expectTypeOf(api.setLibraryPlaylistRating.bound(music)).returns.resolves.toEqualTypeOf<tRating | undefined>();
    expectTypeOf(api.deleteSongRating).returns.resolves.toBeVoid();
    expectTypeOf(api.deleteSongRating.bound(music)).returns.resolves.toBeVoid();
  });

  test("a value is 1 or -1, and nothing else compiles", () => {
    expectTypeOf(api.setSongRating).parameter(2).toEqualTypeOf<1 | -1>();
    expectTypeOf<api.tRatingValue>().toEqualTypeOf<1 | -1>();
    const calls = [
      // @ts-expect-error -- a rating is a like or a dislike, not a score
      () => api.setSongRating(music, "1", 5),
      // @ts-expect-error -- and has to be given
      () => api.setSongRating(music, "1"),
      // @ts-expect-error -- a rating taken away takes no value
      () => api.deleteSongRating(music, "1", 1),
    ];
    expect(calls).toHaveLength(3);
  });
});

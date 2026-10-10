import { createClient, isAppleMusicError, type tClientOptions } from "@open-music-sdk/core";
import type { tAlbum, tArtist, tChartResponse, tGenre, tMusicVideo, tResource, tSearchResponse, tSong } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import * as api from "./index";
import { catalog, type tCatalog } from "./namespace";

/** One answer from Apple. */
interface tReply {
  status?: number;
  body?: unknown;
}

const song = (id: string) => ({ id, type: "songs", href: `/v1/catalog/us/songs/${id}` });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A client over a fetch that answers from a queue of replies, then with an empty list, and records every Request it saw. */
function apple(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: { data: [] } };
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", storefront: "us", fetch, retry: false, ...options }),
    calls,
    /** Each request as its method, path and query. */
    sent: () => calls.map((call) => `${call.method} ${new URL(call.url).pathname}${decodeURIComponent(new URL(call.url).search)}`),
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
  for await (const item of items) out.push(item);
  return out;
};

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("the catalog for one client", () => {
  const declared = Object.entries(api)
    .filter(([, value]) => typeof (value as { bound?: unknown }).bound === "function")
    .map(([name]) => name);

  test("it holds every function the package exports, under the same name, and nothing else", () => {
    expect(Object.keys(catalog(apple().music)).sort()).toEqual(declared.sort());
    expect(declared).toHaveLength(58);
  });

  test("each of them is a function that needs no client", () => {
    for (const bound of Object.values(catalog(apple().music))) expect(bound).toBeTypeOf("function");
  });

  test("it cannot be changed: a function cannot be put in another's place, nor one added", () => {
    const music = catalog(apple().music);
    expect(Object.isFrozen(music)).toBe(true);
    expect(() => {
      (music as { getSong: unknown }).getSong = () => undefined;
    }).toThrow(TypeError);
  });

  test("it does not hold itself: the function that makes it is not one of the catalog's", () => {
    expect(catalog(apple().music)).not.toHaveProperty("catalog");
  });

  test.each<[string, unknown, string]>([
    ["nothing", undefined, "undefined"],
    ["the developer token, put where the client belongs", "dev", "3 characters"],
    ["options for a client, not a client", { developerToken: "dev" }, "object"],
    ["an object with only some of a client's methods", { request: () => undefined }, "object"],
  ])("made with %s, it is a TypeError naming catalog, there and then", (_name, client, what) => {
    expect(() => catalog(client as never)).toThrow(new TypeError(`catalog: client must be a client from createClient; got ${what}`));
  });

  test("it is the client's own: two clients' catalogs ask as their own clients would", async () => {
    const [us, gb] = [apple(), apple([], { storefront: "gb" })];
    await catalog(us.music).getSong("1").catch(() => undefined);
    await catalog(gb.music).getSong("1").catch(() => undefined);
    expect([us.sent(), gb.sent()]).toEqual([["GET /v1/catalog/us/songs/1"], ["GET /v1/catalog/gb/songs/1"]]);
  });
});

describe("what its functions hand over", () => {
  test("a get of one resource gives the resource", async () => {
    const { music } = apple([{ body: { data: [song("1")] } }]);
    expect(await catalog(music).getSong("1")).toEqual(song("1"));
  });

  test.each<[string, tReply]>([
    ["an empty list", { body: { data: [] } }],
    ["no data", { body: {} }],
    ["no body at all", { status: 204 }],
  ])("a get of one resource that Apple answers with %s is an ApiError with the status it came with, not undefined", async (_name, reply) => {
    const { music } = apple([reply]);
    const error = await rejection(catalog(music).getSong("1"));
    expect(isAppleMusicError(error, "ApiError")).toBe(true);
    expect(error.message).toBe("getSong: Apple answered with no resource");
    expect((error as { status?: number }).status).toBe(reply.status ?? 200);
  });

  test("a resource Apple does not have is the error Apple answered with", async () => {
    const { music } = apple([{ status: 404, body: { errors: [{ status: "404", code: "40400", title: "Resource Not Found" }] } }]);
    const error = await rejection(catalog(music).getSong("1"));
    expect([isAppleMusicError(error, "ApiError"), (error as { status?: number }).status]).toEqual([true, 404]);
  });

  test("a get of several gives the list, which is empty when Apple sends none", async () => {
    const { music } = apple([{ body: { data: [song("1"), song("2")] } }]);
    expect(await catalog(music).getSongs(["1", "2"])).toEqual([song("1"), song("2")]);
    expect(await catalog(music).getSongsByIsrc(["A"])).toEqual([]);
  });

  test("a list gives every item of every page, asking for each page as the one before runs out", async () => {
    const { music, sent } = apple([{ body: { data: [song("1")], next: "/v1/catalog/us/genres?offset=1" } }, { body: { data: [song("2")], next: "/v1/catalog/us/genres?offset=2" } }, { body: { data: [song("3")] } }]);
    expect(await all(catalog(music).listGenres({ limit: 1 }))).toEqual([song("1"), song("2"), song("3")]);
    expect(sent()).toEqual(["GET /v1/catalog/us/genres?limit=1", "GET /v1/catalog/us/genres?offset=1", "GET /v1/catalog/us/genres?offset=2"]);
  });

  test("a list stops asking when the loop is left", async () => {
    const { music, calls } = apple([{ body: { data: [song("1"), song("2")], next: "/v1/catalog/us/genres?offset=2" } }, { body: { data: [song("3")] } }]);
    for await (const genre of catalog(music).listGenres()) if (genre.id === "1") break;
    expect(calls).toHaveLength(1);
  });

  test("a list asks for nothing until it is looped over, and can be looped over again", async () => {
    const { music, calls } = apple([{ body: { data: [song("1")] } }, { body: { data: [song("2")] } }]);
    const genres = catalog(music).listGenres();
    expect(calls).toHaveLength(0);
    expect([await all(genres), await all(genres)]).toEqual([[song("1")], [song("2")]]);
  });

  test("a relationship and a view are walked as a list is", async () => {
    const page = (id: string, next?: string) => ({ body: { data: [song(id)], next } });
    const { music, sent } = apple([page("1", "/v1/catalog/us/albums/9/tracks?offset=1"), page("2"), page("3", "/v1/catalog/us/albums/9/view/other-versions?offset=1"), page("4")]);
    expect(await all(catalog(music).getAlbumRelationship("9", "tracks"))).toEqual([song("1"), song("2")]);
    expect(await all(catalog(music).getAlbumView("9", "other-versions"))).toEqual([song("3"), song("4")]);
    expect(sent()).toEqual([
      "GET /v1/catalog/us/albums/9/tracks",
      "GET /v1/catalog/us/albums/9/tracks?offset=1",
      "GET /v1/catalog/us/albums/9/view/other-versions",
      "GET /v1/catalog/us/albums/9/view/other-versions?offset=1",
    ]);
  });

  test("a mistake in what a function is handed is a TypeError naming the function, as it is with a client", async () => {
    const { music, calls } = apple();
    expect(await rejection(catalog(music).getSong(".."))).toEqual(new TypeError('getSong: id must be a string of 1 to 64 characters, and not "." or ".."; got 2 characters'));
    expect(() => catalog(music).listGenres({ limit: 0 })).toThrow(new TypeError("listGenres: limit must be a whole number above 0; got 0"));
    expect(calls).toHaveLength(0);
  });
});

describe("the types: a function of the namespace takes what the package's takes, without the client", () => {
  const music = catalog(apple().music);

  test("a get gives the resource, a get of several the list, and a list every item", () => {
    expectTypeOf(music.getSong).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(music.getSong).returns.resolves.toEqualTypeOf<tSong>();
    expectTypeOf(music.getAlbums).returns.resolves.toEqualTypeOf<tAlbum[]>();
    expectTypeOf(music.listGenres).returns.toEqualTypeOf<AsyncIterable<tGenre>>();
    expectTypeOf(music.getCatalogResources).returns.resolves.toEqualTypeOf<tResource[]>();
  });

  test("a relationship's and a view's name still decide what comes back", () => {
    expectTypeOf(music.getAlbumRelationship("1", "artists")).toEqualTypeOf<AsyncIterable<tArtist>>();
    expectTypeOf(music.getAlbumRelationship("1", "tracks")).toEqualTypeOf<AsyncIterable<tMusicVideo | tSong>>();
    expectTypeOf(music.getArtistView("1", "top-songs")).toEqualTypeOf<AsyncIterable<tSong>>();
    const wrong = [
      // @ts-expect-error -- the library relationship is not a name the catalog takes, here as with a client
      () => music.getAlbumRelationship("1", "library"),
    ];
    expect(wrong).toHaveLength(1);
  });

  test("search and the charts give Apple's answer as it is", () => {
    expectTypeOf(music.searchCatalog).returns.resolves.toEqualTypeOf<tSearchResponse>();
    expectTypeOf(music.getCharts).returns.resolves.toEqualTypeOf<tChartResponse>();
  });

  test("the namespace's type is the one the function gives", () => {
    expectTypeOf(music).toEqualTypeOf<tCatalog>();
    expectTypeOf<keyof tCatalog>().toEqualTypeOf<Exclude<keyof typeof api, "catalog">>();
  });
});

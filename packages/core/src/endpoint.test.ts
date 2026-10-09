import type { tAlbumRelationships, tArtist, tGenre, tLibrarySong, tLibrarySongsResponse, tMusicVideo, tRelationshipResponse, tSong, tSongsResponse } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createClient, type tAppleMusicClient, type tClientOptions, type tSchemaLike } from "./client";
import { endpoint, endpointNamespace, relationshipGetter, resourceGetter, resourceLister, resourcesGetter, type tCollection, type tRequestPlan } from "./endpoint";
import { isAppleMusicError, type tErrorTag } from "./errors";
import type { tReadOptions } from "./options";

/** One answer from Apple: a response, or a fetch that throws. */
type tReply = { status?: number; body?: unknown } | Error;

const SECRET = "s3cretT0ken";
const noop = () => undefined;
const SONGS = "v1/catalog/us/songs";
const song = (id: string) => ({ id, type: "songs", href: `/v1/catalog/us/songs/${id}` });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A client over a fetch that answers from a queue of replies, then with an empty list, and records every Request it saw. */
function apple(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: { data: [] } };
    if (reply instanceof Error) return Promise.reject(reply);
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  const music = createClient({ developerToken: "dev", fetch, retry: false, ...options });
  return {
    music,
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

// One declaration of each pattern, as a client package makes them.
const getSong = resourceGetter<tSongsResponse>("getSong", () => SONGS);
const getSongs = resourcesGetter<tSongsResponse>("getSongs", () => SONGS);
const listLibrarySongs = resourceLister<tLibrarySongsResponse>("listLibrarySongs", () => "v1/me/library/songs");
const getAlbumRelationship = relationshipGetter<tAlbumRelationships>("getAlbumRelationship", () => "v1/catalog/us/albums");
const searchCatalog = endpoint("searchCatalog", "answer", (_client, term: string): tRequestPlan<{ results: { songs?: { data: tSong[] } } }> => ["v1/catalog/us/search", { params: { term, types: ["songs"] } }]);
const declared = { getSong, getSongs, listLibrarySongs, getAlbumRelationship, searchCatalog };

describe("the types: one declaration gives both forms, and the name asked for decides what comes back", () => {
  const bound = endpointNamespace("catalog", apple().music, { ...declared, version: 1, helper: noop });

  test("called with a client, a function resolves to what Apple answers", () => {
    expectTypeOf(getSong).parameters.toEqualTypeOf<[client: tAppleMusicClient, id: string, options?: tReadOptions<tSongsResponse>]>();
    expectTypeOf(getSong).returns.resolves.toEqualTypeOf<tSongsResponse>();
    expectTypeOf(getSongs).parameters.toEqualTypeOf<[client: tAppleMusicClient, ids: readonly string[], options?: tReadOptions<tSongsResponse>]>();
    expectTypeOf(getSongs).returns.resolves.toEqualTypeOf<tSongsResponse>();
    expectTypeOf(listLibrarySongs).returns.resolves.toEqualTypeOf<tLibrarySongsResponse & { readonly next?: string | undefined }>();
    expectTypeOf(searchCatalog).parameters.toEqualTypeOf<[client: tAppleMusicClient, term: string]>();
  });

  test("bound, it takes the same arguments without the client and hands over what the answer holds", () => {
    expectTypeOf(bound.getSong).parameters.toEqualTypeOf<[id: string, options?: tReadOptions<tSongsResponse>]>();
    expectTypeOf(bound.getSong).returns.resolves.toEqualTypeOf<tSong>();
    expectTypeOf(bound.getSongs).returns.resolves.toEqualTypeOf<tSong[]>();
    expectTypeOf(bound.listLibrarySongs).returns.toEqualTypeOf<AsyncIterable<tLibrarySong>>();
    expectTypeOf(bound.searchCatalog).returns.resolves.toEqualTypeOf<{ results: { songs?: { data: tSong[] } } }>();
  });

  test("a relationship is typed by its name, with or without a client", () => {
    const tracks = () => getAlbumRelationship(apple().music, "1", "tracks");
    const artists = () => getAlbumRelationship(apple().music, "1", "artists");
    expectTypeOf(tracks).returns.resolves.toEqualTypeOf<Omit<tRelationshipResponse, "data"> & { data: (tMusicVideo | tSong)[] }>();
    expectTypeOf(artists).returns.resolves.toEqualTypeOf<Omit<tRelationshipResponse, "data"> & { data: tArtist[] }>();

    const boundTracks = () => bound.getAlbumRelationship("1", "tracks");
    const boundArtists = () => bound.getAlbumRelationship("1", "artists");
    const boundGenres = () => bound.getAlbumRelationship("1", "genres", { limit: 5 });
    expectTypeOf(boundTracks).returns.toEqualTypeOf<AsyncIterable<tMusicVideo | tSong>>();
    expectTypeOf(boundArtists).returns.toEqualTypeOf<AsyncIterable<tArtist>>();
    expectTypeOf(boundGenres).returns.toEqualTypeOf<AsyncIterable<tGenre>>();
  });

  test("a name the resource has no relationship of is refused by the types, in both forms", () => {
    const wrong = [
      // @ts-expect-error -- an album has no composers
      () => getAlbumRelationship(apple().music, "1", "composers"),
      // @ts-expect-error -- an album has no composers
      () => bound.getAlbumRelationship("1", "composers"),
      // @ts-expect-error -- a name is one of the resource's own, not any string
      (name: string) => bound.getAlbumRelationship("1", name),
    ];
    expect(wrong).toHaveLength(3);
  });

  test("a set of names can be narrowed, as a catalog narrows away the one that needs the listener", () => {
    const withoutLibrary = relationshipGetter<Omit<tAlbumRelationships, "library">>("getAlbumRelationship", () => "v1/catalog/us/albums");
    const calls = [
      () => getAlbumRelationship(apple().music, "1", "library"),
      () => withoutLibrary(apple().music, "1", "record-labels"),
      // @ts-expect-error -- narrowed away: this set of names has no library
      () => withoutLibrary(apple().music, "1", "library"),
      // @ts-expect-error -- and so it is for the bound form
      () => withoutLibrary.bound(apple().music)("1", "library"),
    ];
    expect(calls).toHaveLength(4);
  });

  test("what is not a function for an endpoint is not in the namespace, to the types or at runtime", () => {
    expectTypeOf(bound).toHaveProperty("getSong");
    expectTypeOf(bound).not.toHaveProperty("version");
    expectTypeOf(bound).not.toHaveProperty("helper");
    expect(Object.keys(bound).sort()).toEqual(Object.keys(declared).sort());
  });

  test("the options a function takes are the ones its declaration names", () => {
    type tOptions = tReadOptions<tSongsResponse> & { readonly storefront?: string | undefined; readonly views?: readonly "top-songs"[] | undefined };
    const collection: tCollection<tOptions> = (_fn, _client, options) => `v1/catalog/${options.storefront ?? "us"}/artists`;
    const getArtist = resourceGetter<tSongsResponse, tOptions>("getArtist", collection, ["views"]);
    expectTypeOf(getArtist).parameter(2).toEqualTypeOf<tOptions | undefined>();
    expectTypeOf(endpointNamespace("catalog", apple().music, { getArtist }).getArtist).parameter(1).toEqualTypeOf<tOptions | undefined>();
  });
});

describe("endpoint: called with a client, a function asks for what its plan says and resolves to what Apple answered", () => {
  const body = { data: [song("1"), song("2")], meta: { total: 2 }, next: "/v1/x?offset=2" };

  test.each(["resource", "resources", "pages", "answer"] as const)("declared to unwrap %s, it still resolves to the whole answer", async (unwrap) => {
    const { music, sent } = apple([{ body }]);
    const plan = (): tRequestPlan<typeof body> => ["v1/x", { params: { limit: 2 } }];
    const fn = unwrap === "resource" ? endpoint("fn", unwrap, plan) : unwrap === "resources" ? endpoint("fn", unwrap, plan) : unwrap === "pages" ? endpoint("fn", unwrap, plan) : endpoint("fn", unwrap, plan);
    expect(await fn(music)).toEqual(body);
    expect(sent()).toEqual(["GET /v1/x?limit=2"]);
  });

  test("the plan is handed the client and the arguments, and may take its time", async () => {
    const { music, sent } = apple();
    const plan = vi.fn(async (_client: tAppleMusicClient, id: string, flag: boolean): Promise<tRequestPlan<unknown>> => {
      await Promise.resolve();
      return [`v1/x/${id}`, { params: { flag } }];
    });
    await endpoint("fn", "answer", plan)(music, "7", true);
    expect(plan).toHaveBeenCalledWith(music, "7", true);
    expect(sent()).toEqual(["GET /v1/x/7?flag=true"]);
  });

  test("a plan with no init asks with nothing but the path", async () => {
    const { music, sent } = apple();
    await endpoint("fn", "answer", (): tRequestPlan<unknown> => ["v1/test"])(music);
    expect(sent()).toEqual(["GET /v1/test"]);
  });

  test("a plan can write: its method and body are what is sent", async () => {
    const { music, calls } = apple([{ status: 201, body: { data: [{ id: "p.1" }] } }]);
    const create = endpoint("createLibraryPlaylist", "resource", (_client, name: string): tRequestPlan<{ data: { id: string }[] }> => ["v1/me/library/playlists", { method: "POST", body: { attributes: { name } }, user: false }]);
    expect(await create(music, "Road trip")).toEqual({ data: [{ id: "p.1" }] });
    expect(calls[0]?.method).toBe("POST");
    expect(await calls[0]?.json()).toEqual({ attributes: { name: "Road trip" } });
  });

  test("each call is planned afresh", async () => {
    const { music, sent } = apple();
    const fn = endpoint("fn", "answer", (_client, id: string): tRequestPlan<unknown> => [`v1/x/${id}`]);
    await fn(music, "1");
    await fn(music, "2");
    expect(sent()).toEqual(["GET /v1/x/1", "GET /v1/x/2"]);
  });

  test("what the plan throws is the function's rejection, and Apple is not asked", async () => {
    const { music, calls } = apple();
    const mistake = new TypeError("fn: id must be something else");
    const fn = endpoint("fn", "answer", (): tRequestPlan<unknown> => {
      throw mistake;
    });
    expect(await rejection(fn(music))).toBe(mistake);
    expect(calls).toHaveLength(0);
  });

  test.each<[string, tReply, tErrorTag]>([
    ["404", { status: 404 }, "ApiError"],
    ["403", { status: 403 }, "UserTokenInvalid"],
    ["401", { status: 401 }, "DeveloperTokenInvalid"],
    ["429", { status: 429 }, "RateLimited"],
    ["failed fetch", new TypeError("fetch failed"), "NetworkError"],
  ])("Apple's %s is the client's own error, in either form", async (_name, reply, tag) => {
    for (const run of [(music: tAppleMusicClient) => getSong(music, "1"), (music: tAppleMusicClient) => getSong.bound(music)("1"), (music: tAppleMusicClient) => all(listLibrarySongs.bound(music)())]) {
      const { music } = apple([reply], { userToken: "user" });
      expect(isAppleMusicError(await rejection(run(music)), tag)).toBe(true);
    }
  });

  test("the answer is held to the schema the plan passes on", async () => {
    const { music } = apple([{ body: { data: "no list" } }]);
    const schema: tSchemaLike<never> = { "~standard": { validate: () => ({ issues: [{ message: "expected a list", path: ["data"] }] }) } };
    expect(isAppleMusicError(await rejection(getSong(music, "1", { schema })), "ValidationError")).toBe(true);
  });
});

describe("endpoint: the client it is handed is checked, in either form", () => {
  const strangers: [string, unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["a string that is a token", SECRET],
    ["a number", 42],
    ["an empty object", {}],
    ["an object with request alone, which could not walk pages", { request: noop }],
    ["an object missing storefront", { request: noop, paginate: noop }],
    ["an object missing paginate", { request: noop, storefront: noop }],
    ["a function with the methods on it", Object.assign(noop, { request: noop, paginate: noop, storefront: noop })],
  ];

  test.each(strangers)("called with %s, it rejects with a TypeError naming the function, and the plan is not asked", async (_name, client) => {
    const plan = vi.fn((): tRequestPlan<unknown> => ["v1/x"]);
    const error = await rejection(endpoint("getSong", "answer", plan)(client as tAppleMusicClient));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^getSong: client must be a client from createClient; got /);
    expect(error.message).not.toContain(SECRET);
    expect(plan).not.toHaveBeenCalled();
  });

  test.each(strangers)("bound to %s, it throws the same TypeError there and then", (_name, client) => {
    for (const unwrap of ["resource", "resources", "pages", "answer"] as const) {
      const fn = endpoint("getSong", unwrap as "answer", (): tRequestPlan<unknown> => ["v1/x"]);
      expect(() => fn.bound(client as tAppleMusicClient)).toThrow(new TypeError(`getSong: client must be a client from createClient; got ${client === SECRET ? "11 characters" : client === 42 ? "42" : client === null ? "null" : typeof client}`));
    }
  });

  test("anything with the three methods a function may call will do: a wrapped client, or a test's own", async () => {
    const request = vi.fn(() => Promise.resolve({ data: [song("1")] }));
    const client = { request, paginate: noop, storefront: noop } as unknown as tAppleMusicClient;
    expect(await getSong(client, "1")).toEqual({ data: [song("1")] });
    expect(await getSong.bound(client)("1")).toEqual(song("1"));
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("endpoint: bound to a client, a function hands over what the answer holds", () => {
  describe("the one resource", () => {
    test("is the first under data", async () => {
      const { music, sent } = apple([{ body: { data: [song("1")] } }]);
      expect(await getSong.bound(music)("1")).toEqual(song("1"));
      expect(sent()).toEqual(["GET /v1/catalog/us/songs/1"]);
    });

    test("is still the first when Apple sends more than one", async () => {
      const { music } = apple([{ body: { data: [song("1"), song("2")] } }]);
      expect(await getSong.bound(music)("1")).toEqual(song("1"));
    });

    test.each<[string, tReply]>([
      ["an empty list", { body: { data: [] } }],
      ["a list holding null", { body: { data: [null] } }],
      ["no data at all", { body: {} }],
      ["data that is null", { body: { data: null } }],
      ["an empty body", { status: 204 }],
    ])("a success with %s is an ApiError that says there was no resource, not undefined", async (_name, reply) => {
      const { music } = apple([reply]);
      const error = await rejection(getSong.bound(music)("1"));
      expect(isAppleMusicError(error, "ApiError")).toBe(true);
      expect(error.message).toBe("getSong: Apple answered with no resource");
      expect((error as { status?: number }).status).toBe(200);
    });

    test.each<[string, unknown]>([
      ["data that is a string", { data: "1" }],
      ["data that is an object", { data: song("1") }],
      ["a list where an object should be", [song("1")]],
      ["a string", "1"],
      ["null", null],
    ])("an answer with %s is an ApiError naming the function, not a TypeError", async (_name, body) => {
      const { music } = apple([{ body }]);
      const error = await rejection(getSong.bound(music)("1"));
      expect(isAppleMusicError(error, "ApiError")).toBe(true);
      expect(error.message).toMatch(/^getSong: /);
    });
  });

  describe("the resources", () => {
    test("are the list under data, as Apple sent it", async () => {
      const { music, sent } = apple([{ body: { data: [song("1"), song("2")], meta: { ignored: true } } }]);
      expect(await getSongs.bound(music)(["1", "2"])).toEqual([song("1"), song("2")]);
      expect(sent()).toEqual(["GET /v1/catalog/us/songs?ids=1,2"]);
    });

    test.each<[string, tReply]>([
      ["an empty list", { body: { data: [] } }],
      ["no data at all", { body: {} }],
      ["data that is null", { body: { data: null } }],
      ["an empty body", { status: 204 }],
    ])("a success with %s is no resources: an empty list", async (_name, reply) => {
      const { music } = apple([reply]);
      expect(await getSongs.bound(music)(["1"])).toEqual([]);
    });

    test.each<[string, unknown]>([
      ["data that is a string", { data: "1,2" }],
      ["data that is an object", { data: { 0: song("1") } }],
      ["null", null],
    ])("an answer with %s is an ApiError naming the function", async (_name, body) => {
      const { music } = apple([{ body }]);
      const error = await rejection(getSongs.bound(music)(["1"]));
      expect(isAppleMusicError(error, "ApiError")).toBe(true);
      expect(error.message).toMatch(/^getSongs: /);
    });
  });

  describe("every item of every page", () => {
    const pages = (): tReply[] => [{ body: { data: [1, 2], next: "/v1/me/library/songs?offset=2&limit=2" } }, { body: { data: [3] } }];

    test("the first page is asked for with the options, and each one after it by its next link alone", async () => {
      const { music, sent } = apple(pages(), { userToken: "user" });
      expect(await all(listLibrarySongs.bound(music)({ limit: 2, language: "en-GB" }))).toEqual([1, 2, 3]);
      expect(sent()).toEqual(["GET /v1/me/library/songs?l=en-GB&limit=2", "GET /v1/me/library/songs?offset=2&limit=2"]);
    });

    test("nothing is asked for, and nothing checked, until the loop starts", async () => {
      const { music, calls } = apple(pages(), { userToken: "user" });
      const walk = listLibrarySongs.bound(music)({ limit: 0 });
      expect(calls).toHaveLength(0);
      const error = await rejection(all(walk));
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatch(/^listLibrarySongs: limit must be /);
      expect(calls).toHaveLength(0);
    });

    test("pages are fetched one at a time, and breaking out of the loop stops fetching", async () => {
      const { music, calls } = apple(pages(), { userToken: "user" });
      for await (const item of listLibrarySongs.bound(music)()) if ((item as unknown) === 1) break;
      expect(calls).toHaveLength(1);
    });

    test("the signal aborts the walk between pages", async () => {
      const { music, calls } = apple(pages(), { userToken: "user" });
      const controller = new AbortController();
      const seen: unknown[] = [];
      const error = await rejection(
        (async () => {
          for await (const item of listLibrarySongs.bound(music)({ signal: controller.signal })) {
            seen.push(item);
            if (seen.length === 2) controller.abort(new Error("stopped"));
          }
        })(),
      );
      expect(error.message).toBe("stopped");
      expect(seen).toEqual([1, 2]);
      expect(calls).toHaveLength(1);
    });

    test("the schema is applied to every page", async () => {
      const validate = vi.fn((value: unknown) => ({ value: value as tLibrarySongsResponse }));
      const { music } = apple(pages(), { userToken: "user" });
      await all(listLibrarySongs.bound(music)({ schema: { "~standard": { validate } } }));
      expect(validate).toHaveBeenCalledTimes(2);
    });

    test("an error on a later page surfaces from the loop, after the items before it", async () => {
      const { music } = apple([{ body: { data: [1], next: "/v1/me/library/songs?offset=1" } }, { status: 500 }], { userToken: "user" });
      const seen: unknown[] = [];
      const error = await rejection(
        (async () => {
          for await (const item of listLibrarySongs.bound(music)()) seen.push(item);
        })(),
      );
      expect(isAppleMusicError(error, "ApiError")).toBe(true);
      expect(seen).toEqual([1]);
    });

    test("each walk is its own: the same bound function can be walked twice", async () => {
      const { music, calls } = apple([{ body: { data: [1] } }, { body: { data: [2] } }], { userToken: "user" });
      const list = listLibrarySongs.bound(music);
      expect([await all(list()), await all(list())]).toEqual([[1], [2]]);
      expect(calls).toHaveLength(2);
    });
  });

  test("the answer as it is, for an answer with nothing to unwrap", async () => {
    const answer = { results: { songs: { data: [song("1")] } } };
    const { music, sent } = apple([{ body: answer }]);
    expect(await searchCatalog.bound(music)("beach bunny")).toEqual(answer);
    expect(sent()).toEqual(["GET /v1/catalog/us/search?term=beach+bunny&types=songs"]);
  });

  test("a bound function belongs to its client: two listeners do not share one", async () => {
    const first = apple([{ body: { data: [] } }], { userToken: "one" });
    const second = apple([{ body: { data: [] } }], { userToken: "two" });
    await all(listLibrarySongs.bound(first.music)());
    await all(listLibrarySongs.bound(second.music)());
    expect([first.userTokens(), second.userTokens()]).toEqual([["one"], ["two"]]);
  });
});

describe("the resource patterns: what each asks Apple for", () => {
  test.each<[string, (music: tAppleMusicClient) => Promise<unknown>, string]>([
    ["one, by id", (music) => getSong(music, "1613600188"), "GET /v1/catalog/us/songs/1613600188"],
    ["one, with options", (music) => getSong(music, "1", { language: "en-GB", include: ["albums", "artists"], extend: ["artistUrl"] }), "GET /v1/catalog/us/songs/1?l=en-GB&include=albums,artists&extend=artistUrl"],
    ["several, by id", (music) => getSongs(music, ["1", "2", "3"]), "GET /v1/catalog/us/songs?ids=1,2,3"],
    ["several, with options", (music) => getSongs(music, ["1"], { include: ["albums"], params: { "fields[songs]": "name" } }), "GET /v1/catalog/us/songs?fields[songs]=name&include=albums&ids=1"],
    ["a collection", (music) => listLibrarySongs(music), "GET /v1/me/library/songs"],
    ["a collection, from somewhere in it", (music) => listLibrarySongs(music, { limit: 100, offset: 200 }), "GET /v1/me/library/songs?limit=100&offset=200"],
    ["a relationship, by name", (music) => getAlbumRelationship(music, "1", "tracks"), "GET /v1/catalog/us/albums/1/tracks"],
    ["a relationship, with options", (music) => getAlbumRelationship(music, "1", "record-labels", { limit: 5, include: ["latest-releases"] }), "GET /v1/catalog/us/albums/1/record-labels?include=latest-releases&limit=5"],
  ])("%s", async (_name, call, request) => {
    const { music, sent } = apple([], { userToken: "user" });
    await call(music);
    expect(sent()).toEqual([request]);
  });

  test("the ids a function is handed win over ids among the caller's params", async () => {
    const { music, sent } = apple();
    await getSongs(music, ["1", "2"], { params: { ids: ["9"] } });
    expect(sent()).toEqual(["GET /v1/catalog/us/songs?ids=1,2"]);
  });

  test("an option is sent only by a function declared to take it", async () => {
    type tOptions = tReadOptions<tSongsResponse> & { readonly views?: readonly string[] | undefined };
    const getArtist = resourceGetter<tSongsResponse, tOptions>("getArtist", () => "v1/catalog/us/artists", ["views"]);
    const { music, sent } = apple();
    await getArtist(music, "1", { views: ["top-songs", "singles"] });
    await getSong(music, "1", { views: ["top-songs"] } as tReadOptions<tSongsResponse>);
    expect(sent()).toEqual(["GET /v1/catalog/us/artists/1?views=top-songs,singles", "GET /v1/catalog/us/songs/1"]);
  });

  test("a relationship answers with a page, and bound it is walked", async () => {
    const { music, sent } = apple([{ body: { data: [song("1")], next: "/v1/catalog/us/albums/9/tracks?offset=1" } }, { body: { data: [song("2")] } }]);
    expect(await all(getAlbumRelationship.bound(music)("9", "tracks", { limit: 1 }))).toEqual([song("1"), song("2")]);
    expect(sent()).toEqual(["GET /v1/catalog/us/albums/9/tracks?limit=1", "GET /v1/catalog/us/albums/9/tracks?offset=1"]);
  });
});

describe("the resource patterns: where the collection is", () => {
  test("it is asked with the function's name, the client and the options the call was given", async () => {
    const { music } = apple();
    const collection = vi.fn<tCollection<tReadOptions<tSongsResponse>>>(() => SONGS);
    const options = { language: "en-GB" };
    await resourceGetter<tSongsResponse>("getSong", collection)(music, "1", options);
    expect(collection).toHaveBeenCalledWith("getSong", music, options);
  });

  test("a call with no options hands it an empty bag, never undefined", async () => {
    const { music } = apple();
    const collection = vi.fn<tCollection<tReadOptions<tSongsResponse>>>(() => SONGS);
    await resourcesGetter<tSongsResponse>("getSongs", collection)(music, ["1"]);
    expect(collection).toHaveBeenCalledWith("getSongs", music, {});
  });

  test("it may ask the client, as a catalog asks for a storefront no option named", async () => {
    type tOptions = tReadOptions<tSongsResponse> & { readonly storefront?: string | undefined };
    const collection: tCollection<tOptions> = async (_fn, client, options) => `v1/catalog/${options.storefront ?? (await client.storefront())}/songs`;
    const inStorefront = resourceGetter<tSongsResponse, tOptions>("getSong", collection);
    const { music, sent } = apple([], { storefront: "gb" });
    await inStorefront(music, "1");
    await inStorefront(music, "1", { storefront: "jp" });
    expect(sent()).toEqual(["GET /v1/catalog/gb/songs/1", "GET /v1/catalog/jp/songs/1"]);
  });

  test("what it throws is the function's rejection, and Apple is not asked", async () => {
    const { music, calls } = apple();
    const mistake = new TypeError("getSong: storefront must be something else");
    const fn = resourceGetter<tSongsResponse>("getSong", () => {
      throw mistake;
    });
    expect(await rejection(fn(music, "1"))).toBe(mistake);
    expect(calls).toHaveLength(0);
  });
});

describe("the resource patterns: what a function is handed is checked before anything is asked, of Apple or of the collection", () => {
  const collection = vi.fn<tCollection<tReadOptions>>(() => SONGS);
  const one = resourceGetter<tSongsResponse>("getSong", collection);
  const several = resourcesGetter<tSongsResponse>("getSongs", collection);
  const whole = resourceLister<tLibrarySongsResponse>("listLibrarySongs", collection);
  const related = relationshipGetter<tAlbumRelationships>("getAlbumRelationship", collection);
  const SEGMENT = 'must be a string of 1 to 64 characters, and not "." or ".."; got ';
  const LIST = "must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";

  test.each<[string, (music: tAppleMusicClient) => Promise<unknown>, string]>([
    ["an empty id", (music) => one(music, ""), `getSong: id ${SEGMENT}0 characters`],
    ["an id that is one up", (music) => one(music, ".."), `getSong: id ${SEGMENT}2 characters`],
    ["an id that is a number", (music) => one(music, 1613600188 as unknown as string), `getSong: id ${SEGMENT}1613600188`],
    ["no id", (music) => one(music, undefined as unknown as string), `getSong: id ${SEGMENT}undefined`],
    ["options that are no object", (music) => one(music, "1", "en-GB" as unknown as tReadOptions<tSongsResponse>), "getSong: expected an options object; got 5 characters"],
    ["options that are null", (music) => one(music, "1", null as unknown as tReadOptions<tSongsResponse>), "getSong: expected an options object; got null"],
    ["a wrong option", (music) => one(music, "1", { limit: 0 }), "getSong: limit must be a whole number above 0; got 0"],
    ["a signal that is no signal", (music) => one(music, "1", { signal: {} as AbortSignal }), "getSong: signal must be an AbortSignal; got object"],
    ["one id where a list belongs", (music) => several(music, "1" as unknown as string[]), `getSongs: ids ${LIST}1 characters`],
    ["no ids", (music) => several(music, []), `getSongs: ids ${LIST}a list of 0`],
    ["two ids in one", (music) => several(music, ["1,2"]), `getSongs: ids ${LIST}3 characters at index 0`],
    ["a wrong option beside good ids", (music) => several(music, ["1"], { language: "" }), "getSongs: language must be a string of 1 to 64 characters; got 0 characters"],
    ["a wrong option for a collection", (music) => whole(music, { offset: -1 }), "listLibrarySongs: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got -1"],
    ["an empty id for a relationship", (music) => related(music, "", "tracks"), `getAlbumRelationship: id ${SEGMENT}0 characters`],
    ["an empty name", (music) => related(music, "1", "" as "tracks"), `getAlbumRelationship: name ${SEGMENT}0 characters`],
    ["a name that is here", (music) => related(music, "1", "." as "tracks"), `getAlbumRelationship: name ${SEGMENT}1 characters`],
    ["no name", (music) => related(music, "1", undefined as unknown as "tracks"), `getAlbumRelationship: name ${SEGMENT}undefined`],
  ])("%s is a TypeError naming the function and the argument", async (_name, call, message) => {
    collection.mockClear();
    const { music, calls } = apple();
    const error = await rejection(call(music));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(message);
    expect(collection).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  test("a token put where an id, a name or a list of ids belongs is refused for its length: it is not sent, and not shown", async () => {
    // The size and shape of a developer token: three runs of base64url with dots between.
    const token = `eyJhbGciOiJFUzI1NiIsImtpZCI6IkFCQzEyM0RFRkcifQ.${"p".repeat(75)}.${"s".repeat(86)}`;
    const { music, calls } = apple();
    for (const call of [one(music, token), several(music, [token]), several(music, ["1", token]), related(music, token, "tracks"), related(music, "1", token as "tracks"), one(music, "1", { language: token })]) {
      const error = await rejection(call);
      expect(error).toBeInstanceOf(TypeError);
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(token);
    }
    expect(calls).toHaveLength(0);
  });

  test("the check that says so can catch it: a token that did reach a path is in the error Apple's answer becomes", async () => {
    const { music } = apple([{ status: 404 }]);
    const error = await rejection(music.request(`${SONGS}/${SECRET}`));
    expect(error.message).toContain(SECRET);
  });

  test("a value that is refused for another reason is not shown either", async () => {
    const { music } = apple();
    for (const call of [several(music, [`${SECRET},${SECRET}`]), one(music, "1", SECRET as unknown as tReadOptions<tSongsResponse>), one(music, "1", { limit: SECRET as unknown as number })]) {
      const error = await rejection(call);
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
    }
  });
});

describe("the resource patterns: a value in a path cannot move the request to another endpoint", () => {
  const hostile = ["../../../me/library/songs", "..\\..\\..\\me\\library\\songs", "%2e%2e/%2e%2e/%2e%2e/me/library/songs", "/v1/me/library/songs", "1/../../../../me/storefront", "1?include=library", "1#x"];

  test.each(hostile)("an id of %j stays the one segment after the collection, and a listener's token is not sent with it", async (id) => {
    const { music, calls, userTokens } = apple([], { userToken: "user" });
    await getSong(music, id);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname.split("/").slice(0, 5)).toEqual(["", "v1", "catalog", "us", "songs"]);
    expect(url.pathname.split("/")).toHaveLength(6);
    expect(decodeURIComponent(url.pathname.split("/")[5] ?? "")).toBe(id);
    expect([url.search, url.hash]).toEqual(["", ""]);
    expect(userTokens()).toEqual([null]);
  });

  test.each(hostile)("a relationship name of %j stays the one segment after the id", async (name) => {
    const { music, calls, userTokens } = apple([], { userToken: "user" });
    await getAlbumRelationship(music, "1", name as "tracks");
    const segments = new URL(calls[0]?.url ?? "").pathname.split("/");
    expect(segments.slice(0, 6)).toEqual(["", "v1", "catalog", "us", "albums", "1"]);
    expect(segments).toHaveLength(7);
    expect(userTokens()).toEqual([null]);
  });

  test("the check that says so can catch it: the same id put into a path as it is does reach the listener's library, token and all", async () => {
    const { music, sent, userTokens } = apple([], { userToken: "user" });
    await music.request(`${SONGS}/../../../me/library/songs`);
    expect(sent()).toEqual(["GET /v1/me/library/songs"]);
    expect(userTokens()).toEqual(["user"]);
  });
});

describe("endpointNamespace", () => {
  test("every function for an endpoint is there under its own name, bound to the client", async () => {
    const { music, sent } = apple([{ body: { data: [song("1")] } }, { body: { data: [song("1"), song("2")] } }]);
    const catalog = endpointNamespace("catalog", music, declared);
    expect(Object.keys(catalog).sort()).toEqual(["getAlbumRelationship", "getSong", "getSongs", "listLibrarySongs", "searchCatalog"]);
    expect(await catalog.getSong("1")).toEqual(song("1"));
    expect(await catalog.getSongs(["1", "2"])).toEqual([song("1"), song("2")]);
    expect(sent()).toEqual(["GET /v1/catalog/us/songs/1", "GET /v1/catalog/us/songs?ids=1,2"]);
  });

  test("what is not one is left out: a number, a plain function, an object with bound on it, a function whose bound is no function", () => {
    const others = { version: 1, helper: noop, lookalike: { bound: noop }, halfway: Object.assign(() => undefined, { bound: "getSong" }), nothing: undefined, none: null };
    const catalog = endpointNamespace("catalog", apple().music, { getSong, ...others });
    expect(Object.keys(catalog)).toEqual(["getSong"]);
  });

  test("a module of other things gives a namespace with nothing in it", async () => {
    expect(endpointNamespace("catalog", apple().music, await import("./check"))).toEqual({});
  });

  test("a function made by another copy of this package is bound all the same: it is known by its shape", async () => {
    vi.resetModules();
    const other = await import("./endpoint");
    expect(other.resourceGetter).not.toBe(resourceGetter);
    const foreign = other.resourceGetter<tSongsResponse>("getSong", () => SONGS);
    const { music } = apple([{ body: { data: [song("1")] } }]);
    expect(await endpointNamespace("catalog", music, { getSong: foreign }).getSong("1")).toEqual(song("1"));
  });

  test("it cannot be changed, so one part of an app cannot swap a function under another", () => {
    const catalog = endpointNamespace("catalog", apple().music, declared);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(() => {
      (catalog as { getSong: unknown }).getSong = noop;
    }).toThrow(TypeError);
  });

  test("the endpoints are read once, and changing the object afterwards changes nothing", () => {
    const read = vi.fn(() => getSong);
    const mine: { getSong?: typeof getSong; getSongs?: typeof getSongs } = { getSongs };
    const endpoints = Object.defineProperty(mine, "getSong", { get: read, enumerable: true });
    const catalog = endpointNamespace("catalog", apple().music, endpoints);
    delete endpoints.getSongs;
    expect(read).toHaveBeenCalledTimes(1);
    expect(Object.keys(catalog).sort()).toEqual(["getSong", "getSongs"]);
  });

  test("only what the object itself holds is bound, not what it inherits", () => {
    const catalog = endpointNamespace("catalog", apple().music, Object.create({ getSong }) as { getSong: typeof getSong });
    expect(Object.keys(catalog)).toEqual([]);
  });

  test("a function named __proto__ is one more function and nothing else", () => {
    const endpoints = JSON.parse('{"__proto__": null}') as Record<string, unknown>;
    endpoints.__proto__ = getSong;
    const catalog = endpointNamespace("catalog", apple().music, endpoints);
    expect(Object.keys(catalog)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(catalog)).toBe(Object.prototype);
  });

  test.each<[string, unknown, string]>([
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a string that is a token", SECRET, "11 characters"],
    ["an empty object", {}, "object"],
    ["an object with request alone", { request: noop }, "object"],
  ])("a client that is %s is a TypeError naming the namespace, when it is made", (_name, client, what) => {
    expect(() => endpointNamespace("catalog", client as tAppleMusicClient, declared)).toThrow(new TypeError(`catalog: client must be a client from createClient; got ${what}`));
  });

  test.each<[string, unknown, string]>([
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a function", getSong, "function"],
    ["a string", "getSong", "7 characters"],
  ])("endpoints that are %s are a TypeError naming the namespace", (_name, endpoints, what) => {
    expect(() => endpointNamespace("catalog", apple().music, endpoints as object)).toThrow(new TypeError(`catalog: endpoints must be an object of functions for endpoints; got ${what}`));
  });
});

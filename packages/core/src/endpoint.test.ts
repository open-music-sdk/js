import type {
  tAlbumRelationships,
  tAlbumRelationshipsAlbumArtistsRelationship,
  tAlbumRelationshipsAlbumTracksRelationship,
  tArtist,
  tGenre,
  tLibrarySong,
  tLibrarySongsResponse,
  tMusicVideo,
  tRelationshipResponse,
  tSong,
  tSongsResponse,
} from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createClient, type tAppleMusicClient, type tClientOptions, type tSchemaLike } from "./client";
import {
  endpoint,
  endpointNamespace,
  inStorefront,
  relationshipGetter,
  resourceGetter,
  resourceLister,
  resourcesFinder,
  resourcesGetter,
  type tCollection,
  type tEndpointOptions,
  type tNone,
  type tRelationshipPage,
  type tRequestPlan,
} from "./endpoint";
import { isAppleMusicError, type tErrorTag } from "./errors";
import type { tReadOptions } from "./options";

/** One answer from Apple: a response, or a fetch that throws. */
type tReply = { status?: number; body?: unknown } | Error;

const SECRET = "s3cretT0ken";
const noop = () => undefined;
const SONGS = "v1/catalog/us/songs";
/** The option a catalog's collection reads. */
interface tStore {
  readonly storefront?: string | undefined;
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
    expectTypeOf(getSong).parameters.toEqualTypeOf<[client: tAppleMusicClient, id: string, options?: tEndpointOptions<tSongsResponse>]>();
    expectTypeOf(getSong).returns.resolves.toEqualTypeOf<tSongsResponse>();
    expectTypeOf(getSongs).parameters.toEqualTypeOf<[client: tAppleMusicClient, ids: readonly string[], options?: tEndpointOptions<tSongsResponse>]>();
    expectTypeOf(getSongs).returns.resolves.toEqualTypeOf<tSongsResponse>();
    expectTypeOf(listLibrarySongs).returns.resolves.toEqualTypeOf<tLibrarySongsResponse & { readonly next?: string | undefined }>();
    expectTypeOf(searchCatalog).parameters.toEqualTypeOf<[client: tAppleMusicClient, term: string]>();
  });

  test("bound, it takes the same arguments without the client and hands over what the answer holds", () => {
    expectTypeOf(bound.getSong).parameters.toEqualTypeOf<[id: string, options?: tEndpointOptions<tSongsResponse>]>();
    // With no options of its collection's or its own, what a function takes is what every function takes.
    expectTypeOf<tEndpointOptions<tSongsResponse>>().toExtend<tReadOptions<tSongsResponse>>();
    expectTypeOf<tReadOptions<tSongsResponse>>().toExtend<tEndpointOptions<tSongsResponse>>();
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

  test("a relationship's schema is a schema of what its name gives, in both forms", () => {
    const music = apple().music;
    const artists = {} as tSchemaLike<tRelationshipPage<tAlbumRelationships, "artists">>;
    // What @open-music-sdk/validate has for this relationship: a validator of the relationship as a resource carries it.
    const generated = {} as tSchemaLike<tAlbumRelationshipsAlbumArtistsRelationship>;
    const tracks = {} as tSchemaLike<tAlbumRelationshipsAlbumTracksRelationship>;
    const anything = {} as tSchemaLike<tRelationshipResponse>;
    const calls = [
      () => getAlbumRelationship(music, "1", "artists", { schema: artists }),
      () => getAlbumRelationship(music, "1", "artists", { schema: generated }),
      () => getAlbumRelationship(music, "1", "tracks", { schema: tracks }),
      () => bound.getAlbumRelationship("1", "artists", { schema: artists }),
      () => bound.getAlbumRelationship("1", "artists", { schema: generated }),
      // @ts-expect-error -- a schema of tracks says nothing of artists
      () => getAlbumRelationship(music, "1", "artists", { schema: tracks }),
      // @ts-expect-error -- and so it is for the bound form
      () => bound.getAlbumRelationship("1", "artists", { schema: tracks }),
      // @ts-expect-error -- a schema of any relationship at all would leave artists typed as artists and checked as nothing in particular
      () => getAlbumRelationship(music, "1", "artists", { schema: anything }),
    ];
    expect(calls).toHaveLength(8);
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

  test("what is no options object, or an option the function does not take, is refused by the types", () => {
    const wrong = [
      // @ts-expect-error -- a string is not an options object
      () => getSong(apple().music, "1", "en-GB"),
      // @ts-expect-error -- an option that is misspelt is not one the function takes
      () => getSong(apple().music, "1", { includ: ["albums"] }),
      // @ts-expect-error -- views is not an option of a function whose declaration does not add it
      () => getSong(apple().music, "1", { views: ["top-songs"] }),
      // @ts-expect-error -- and so it is for the bound form
      () => bound.getSong("1", { views: ["top-songs"] }),
    ];
    expect(wrong).toHaveLength(4);
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

  test("the types leave out what the namespace leaves out: an object that only has a bound on it is no function for an endpoint", () => {
    const lookalike: { bound: (client: tAppleMusicClient) => number } = { bound: () => 5 };
    const catalog = endpointNamespace("catalog", apple().music, { getSong, lookalike });
    expectTypeOf(catalog).toHaveProperty("getSong");
    expectTypeOf(catalog).not.toHaveProperty("lookalike");
    expect(Object.keys(catalog)).toEqual(["getSong"]);
  });

  test("a function that may or may not be there is one the namespace may or may not hold, to the types as at runtime", () => {
    const maybe: { getSong?: typeof getSong; getSongs: typeof getSongs } = { getSongs };
    const without = endpointNamespace("catalog", apple().music, maybe);
    const withIt = endpointNamespace("catalog", apple().music, { ...maybe, getSong });
    expectTypeOf(without).toHaveProperty("getSong");
    expectTypeOf(without.getSong).toEqualTypeOf<typeof bound.getSong | undefined>();
    expectTypeOf(without.getSongs).toEqualTypeOf<typeof bound.getSongs>();
    expect([Object.keys(without), Object.keys(withIt).sort()]).toEqual([["getSongs"], ["getSong", "getSongs"]]);
  });

  test("the options a function takes are the ones its declaration names", () => {
    interface tViews {
      readonly views?: readonly "top-songs"[] | undefined;
    }
    type tOptions = tReadOptions<tSongsResponse> & tStore & tViews;
    const collection: tCollection<tStore> = (_fn, _client, options) => `v1/catalog/${options.storefront ?? "us"}/artists`;
    const getArtist = resourceGetter<tSongsResponse, tStore, tViews>("getArtist", collection, { views: "list" });
    expectTypeOf(getArtist).parameter(2).toEqualTypeOf<tOptions | undefined>();
    expectTypeOf(endpointNamespace("catalog", apple().music, { getArtist }).getArtist).parameter(1).toEqualTypeOf<tOptions | undefined>();
  });
});

describe("a declaration is checked as it is made, so a mistake in one is found when its module loads", () => {
  const plan = (): tRequestPlan<unknown> => ["v1/x"];
  /** The builders as someone without the types could call them. */
  const builders: [string, (fn: unknown, collection: unknown, also?: unknown) => unknown][] = [
    ["resourceGetter", resourceGetter as never],
    ["resourcesGetter", resourcesGetter as never],
    ["resourceLister", resourceLister as never],
    ["resourcesFinder", (fn, collection, also) => (resourcesFinder as unknown as (fn: unknown, filter: string, collection: unknown, also: unknown) => unknown)(fn, "isrc", collection, also)],
    ["relationshipGetter", relationshipGetter as never],
  ];

  test.each<[string, unknown, string]>([
    ["missing", undefined, "undefined"],
    ["empty", "", "0 characters"],
    ["a number", 5, "5"],
    ["the plan, put where the name belongs", plan, "function"],
  ])("endpoint: a name that is %s is a TypeError naming endpoint", (_name, fn, what) => {
    expect(() => endpoint(fn as string, "answer", plan)).toThrow(new TypeError(`endpoint: fn must be the name of the function, a string with something in it; got ${what}`));
  });

  test.each<[string, unknown, string]>([
    ["misspelt", "resorce", "7 characters"],
    ["missing", undefined, "undefined"],
    ["a number", 1, "1"],
  ])("endpoint: an unwrap that is %s is a TypeError, and is not taken for one of the five", (_name, unwrap, what) => {
    expect(() => endpoint("getSong", unwrap as "answer", plan)).toThrow(new TypeError(`endpoint: unwrap must be "resource", "resources", "pages", "written" or "answer"; got ${what}`));
  });

  test.each<[string, unknown, string]>([
    ["a path where the plan belongs", "v1/x", "4 characters"],
    ["missing", undefined, "undefined"],
    ["what a plan gives, not the plan", ["v1/x"], "object"],
  ])("endpoint: a plan that is %s is a TypeError", (_name, wrong, what) => {
    expect(() => endpoint("getSong", "answer", wrong as typeof plan)).toThrow(new TypeError(`endpoint: plan must be a function; got ${what}`));
  });

  test.each(builders)("%s: a name that is no name is a TypeError naming it", (name, builder) => {
    expect(() => builder("", () => SONGS)).toThrow(new TypeError(`${name}: fn must be the name of the function, a string with something in it; got 0 characters`));
    expect(() => builder(undefined, () => SONGS)).toThrow(new TypeError(`${name}: fn must be the name of the function, a string with something in it; got undefined`));
  });

  test.each(builders)("%s: a mistake in a declaration is named in the order it was written, the name before the collection and the rest", (name, builder) => {
    const unnamed = new TypeError(`${name}: fn must be the name of the function, a string with something in it; got 5`);
    expect(() => builder(5, 5)).toThrow(unnamed);
    expect(() => builder(5, () => SONGS, ["views"])).toThrow(unnamed);
  });

  test("resourcesFinder: the name comes before the filter, and the filter before the collection", () => {
    const finder = resourcesFinder as unknown as (fn: unknown, filter: unknown, collection: unknown) => unknown;
    expect(() => finder(5, 5, 5)).toThrow(new TypeError("resourcesFinder: fn must be the name of the function, a string with something in it; got 5"));
    expect(() => finder("", "isrc", 5)).toThrow(new TypeError("resourcesFinder: fn must be the name of the function, a string with something in it; got 0 characters"));
    expect(() => finder("find", 5, 5)).toThrow(/^resourcesFinder: filter must be the name of a filter/);
    expect(() => finder("find", "isrc", 5)).toThrow(new TypeError("resourcesFinder: collection must be a function that gives the collection's path; got 5"));
  });

  test.each(builders)("%s: a collection that is a path, and not a function that gives one, is a TypeError naming it", (name, builder) => {
    expect(() => builder("getSong", SONGS)).toThrow(new TypeError(`${name}: collection must be a function that gives the collection's path; got 19 characters`));
    expect(() => builder("getSong", undefined)).toThrow(new TypeError(`${name}: collection must be a function that gives the collection's path; got undefined`));
  });

  test.each(builders.slice(0, 4))("%s: an also that is not an object naming the options is a TypeError naming it", (name, builder) => {
    const message = (what: string) => new TypeError(`${name}: also must be an object that says what each further option is, a "list" or a "name", such as { views: "list" }; got ${what}`);
    expect(() => builder("getSong", () => SONGS, ["views"])).toThrow(message("object"));
    // What an option is has to be said: naming it is not enough, and neither is a kind there is not.
    expect(() => builder("getSong", () => SONGS, { views: Boolean("named") })).toThrow(message("object"));
    expect(() => builder("getSong", () => SONGS, { views: "list", chart: "text" })).toThrow(message("object"));
    expect(() => builder("getSong", () => SONGS, "views")).toThrow(message("5 characters"));
    expect(() => builder("getSong", () => SONGS, null)).toThrow(message("null"));
  });

  test("what a declaration gives is frozen: nothing can put another bound in its place", () => {
    for (const fn of Object.values(declared)) {
      expect(Object.isFrozen(fn)).toBe(true);
      expect(() => {
        (fn as { bound: unknown }).bound = noop;
      }).toThrow(TypeError);
    }
  });

  test("the options it names are its own copy: naming another afterwards changes nothing", async () => {
    const also: { views: "list"; with?: "list" } = { views: "list" };
    const getArtist = resourceGetter<tSongsResponse, tNone, { readonly views?: readonly string[] | undefined }>("getArtist", () => "v1/catalog/us/artists", also);
    also.with = "list";
    const { music, sent } = apple();
    await getArtist(music, "1", { views: ["top-songs"], with: ["attributes"] } as { views: string[] });
    expect(sent()).toEqual(["GET /v1/catalog/us/artists/1?views=top-songs"]);
  });

  test("the types: a declaration has to say what its function's answer is, and to name every option it adds", () => {
    interface tAdded {
      readonly views?: readonly string[] | undefined;
      readonly with?: readonly string[] | undefined;
    }
    const declarations = [
      () => resourceGetter<tSongsResponse, tNone, tAdded>("getArtist", () => SONGS, { views: "list", with: "list" }),
      // @ts-expect-error -- the answer's type is not said, so there is nothing a collection can be
      () => resourceGetter("getSong", () => SONGS),
      // @ts-expect-error -- so too for the resources with some ids
      () => resourcesGetter("getSongs", () => SONGS),
      // @ts-expect-error -- and for a whole collection
      () => resourceLister("listSongs", () => SONGS),
      // @ts-expect-error -- and for a relationship, whose names would otherwise be anything
      () => relationshipGetter("getAlbumRelationship", () => SONGS),
      // @ts-expect-error -- two options are added and none is named
      () => resourceGetter<tSongsResponse, tNone, tAdded>("getArtist", () => SONGS),
      // @ts-expect-error -- one of the two is not named
      () => resourceGetter<tSongsResponse, tNone, tAdded>("getArtist", () => SONGS, { views: "list" }),
      // @ts-expect-error -- a name that is misspelt is not one of the options
      () => resourceGetter<tSongsResponse, tNone, tAdded>("getArtist", () => SONGS, { veiws: "list", with: "list" }),
      // @ts-expect-error -- an option is named that the function does not add
      () => resourceGetter<tSongsResponse>("getSong", () => SONGS, { views: "list" }),
      // @ts-expect-error -- an option whose type is a list is declared a name
      () => resourceGetter<tSongsResponse, tNone, tAdded>("getArtist", () => SONGS, { views: "name", with: "list" }),
      // @ts-expect-error -- an option whose type is one string is declared a list
      () => resourceGetter<tSongsResponse, tNone, { readonly chart?: string | undefined }>("getCharts", () => SONGS, { chart: "list" }),
      () => resourceGetter<tSongsResponse, tNone, { readonly chart?: string | undefined }>("getCharts", () => SONGS, { chart: "name" }),
    ];
    expect(declarations).toHaveLength(12);
  });
});

describe("what a plan gives is checked before it is asked for", () => {
  test.each<[string, unknown, string]>([
    ["a path alone, not in a list", "v1/x", "4 characters"],
    ["nothing", undefined, "undefined"],
    ["a list with nothing in it", [], "object"],
    ["a list whose path is no string", [5], "object"],
    ["an init that is no object", ["v1/x", "GET"], "object"],
    ["an init that is null", ["v1/x", null], "object"],
    ["an object with a path in it", { path: "v1/x" }, "object"],
  ])("a plan that gives %s is a TypeError naming the function, and nothing is asked for", async (_name, planned, what) => {
    const mistake = new TypeError(`getSong: its plan must give [path, init]; got ${what}`);
    const { music, calls } = apple();
    for (const unwrap of ["resource", "resources", "answer"] as const) {
      const fn = endpoint("getSong", unwrap as "answer", () => planned as tRequestPlan<unknown>);
      expect(await rejection(fn(music))).toEqual(mistake);
      expect(await rejection(fn.bound(music)())).toEqual(mistake);
    }
    const walker = endpoint("getSong", "pages", () => planned as tRequestPlan<{ data: unknown[] }>);
    expect(await rejection(walker(music))).toEqual(mistake);
    // A walk is planned as it is called, so a plan that is there at once is found wrong at the call, and one that comes later by the loop.
    expect(() => walker.bound(music)()).toThrow(mistake);
    const late = endpoint("getSong", "pages", () => Promise.resolve(planned as tRequestPlan<{ data: unknown[] }>));
    expect(await rejection(all(late.bound(music)()))).toEqual(mistake);
    expect(calls).toHaveLength(0);
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
    ["an object missing request", { paginate: noop, storefront: noop }],
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

    test.each<[string, tReply, number]>([
      ["an empty list", { body: { data: [] } }, 200],
      ["a list holding null", { body: { data: [null] } }, 200],
      ["no data at all", { body: {} }, 200],
      ["data that is null", { body: { data: null } }, 200],
      ["a created answer with an empty list", { status: 201, body: { data: [] } }, 201],
      ["an accepted answer with nothing in it", { status: 202 }, 202],
      ["an empty body", { status: 204 }, 204],
    ])("a success with %s is an ApiError that says there was no resource, not undefined, and carries the status it came with", async (_name, reply, status) => {
      const { music } = apple([reply]);
      const error = await rejection(getSong.bound(music)("1"));
      expect(isAppleMusicError(error, "ApiError")).toBe(true);
      expect(error.message).toBe("getSong: Apple answered with no resource");
      expect((error as { status?: number }).status).toBe(status);
    });

    test("an answer that is no page carries its own status too", async () => {
      const { music } = apple([{ status: 201, body: { data: "p.1" } }]);
      const error = await rejection(getSong.bound(music)("1"));
      expect(error.message).toBe("getSong: data is not an array");
      expect((error as { status?: number }).status).toBe(201);
    });

    test("with a client that does not say what the status was, the error does not make one up", async () => {
      const silent = { request: () => Promise.resolve({ data: [] }), paginate: noop, storefront: noop } as unknown as tAppleMusicClient;
      const error = await rejection(getSong.bound(silent)("1"));
      expect(error.message).toBe("getSong: Apple answered with no resource");
      expect(error).toHaveProperty("status", undefined);
    });

    test("a plan that has its own use for the response still gets it", async () => {
      const mine = vi.fn();
      const fn = endpoint("createLibraryPlaylist", "resource", (): tRequestPlan<{ data: unknown[] }> => ["v1/x", { onResponse: mine }]);
      const { music } = apple([{ status: 201, body: { data: [] } }, { status: 201, body: { data: [song("1")] } }]);
      expect((await rejection(fn.bound(music)())) as { status?: number }).toHaveProperty("status", 201);
      expect(await fn(music)).toEqual({ data: [song("1")] });
      expect(mine.mock.calls.map((call) => (call[0] as Response).status)).toEqual([201, 201]);
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

  describe("what a write has written", () => {
    const createPlaylist = endpoint("createPlaylist", "written", (_client, name: string): tRequestPlan<tSongsResponse> => ["v1/me/library/playlists", { method: "POST", body: { attributes: { name } } }]);
    const made = { id: "p.new", type: "library-playlists", href: "/v1/me/library/playlists/p.new" };

    test("called with a client it resolves to Apple's answer, and bound to the resource the answer holds", async () => {
      const { music } = apple([{ status: 201, body: { data: [made] } }, { status: 201, body: { data: [made] } }], { userToken: "user" });
      expect(await createPlaylist(music, "Road")).toEqual({ data: [made] });
      expect(await createPlaylist.bound(music)("Road")).toEqual(made);
    });

    test.each<[string, tReply]>([
      ["an empty list", { status: 201, body: { data: [] } }],
      ["no data", { status: 201, body: {} }],
      ["no body at all", { status: 204 }],
      ["a body that is no object", { status: 200, body: "done" }],
      ["data that is no list", { status: 200, body: { data: "done" } }],
    ])("bound, a success that holds %s is undefined and no error: the write happened, and saying it failed would have it done twice", async (_name, reply) => {
      const { music, sent } = apple([reply], { userToken: "user" });
      expect(await createPlaylist.bound(music)("Road")).toBeUndefined();
      expect(sent()).toEqual(["POST /v1/me/library/playlists"]);
    });

    test("the check can tell: the same answers are an error to a function that asks for a resource, which has nothing to hand over", async () => {
      const { music } = apple([{ body: { data: [] } }]);
      expect(isAppleMusicError(await rejection(getSong.bound(music)("1")), "ApiError")).toBe(true);
    });

    test("a write Apple turns away is still the error Apple answered with", async () => {
      const { music } = apple([{ status: 403 }], { userToken: "user" });
      expect(isAppleMusicError(await rejection(createPlaylist.bound(music)("Road")), "UserTokenInvalid")).toBe(true);
    });

    test("data on Object.prototype is not what the answer holds", async () => {
      Object.assign(Object.prototype, { data: [made] });
      try {
        const { music } = apple([{ status: 201, body: {} }], { userToken: "user" });
        expect(await createPlaylist.bound(music)("Road")).toBeUndefined();
      } finally {
        Reflect.deleteProperty(Object.prototype, "data");
      }
    });

    test("the types: bound, it gives the resource or undefined", () => {
      expectTypeOf(createPlaylist.bound(apple().music)).returns.resolves.toEqualTypeOf<tSong | undefined>();
      expectTypeOf(createPlaylist).returns.resolves.toEqualTypeOf<tSongsResponse>();
    });
  });

  describe("the resources", () => {
    test("are the list under data, as Apple sent it", async () => {
      const { music, sent } = apple([{ body: { data: [song("1"), song("2")], meta: { ignored: true } } }]);
      expect(await getSongs.bound(music)(["1", "2"])).toEqual([song("1"), song("2")]);
      expect(sent()).toEqual(["GET /v1/catalog/us/songs?ids=1,2"]);
    });

    test("the list is the one Apple sent, as it was sent: not a copy of it, and with nothing taken out", async () => {
      const data = [song("1"), null, song("2")];
      const client = { request: () => Promise.resolve({ data }), paginate: noop, storefront: noop } as unknown as tAppleMusicClient;
      expect(await getSongs.bound(client)(["1", "2"])).toBe(data);
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

    test("what the call is handed is checked as it is called: a mistake is thrown there, and is not kept for a loop that may never come", () => {
      const { music, calls } = apple(pages(), { userToken: "user" });
      const list = listLibrarySongs.bound(music);
      const related = getAlbumRelationship.bound(music);
      expect(() => list({ limit: 0 })).toThrow(new TypeError("listLibrarySongs: limit must be a whole number above 0; got 0"));
      expect(() => list("en-GB" as unknown as tReadOptions<tLibrarySongsResponse>)).toThrow(new TypeError("listLibrarySongs: expected an options object; got 5 characters"));
      expect(() => related("..", "tracks")).toThrow(new TypeError('getAlbumRelationship: id must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 2 characters'));
      expect(() => related("1", "" as "tracks")).toThrow(new TypeError('getAlbumRelationship: name must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 0 characters'));
      expect(calls).toHaveLength(0);
    });

    test("it is taken as it is called: changing the options before the loop starts changes nothing", async () => {
      const { music, sent } = apple([{ body: { data: [] } }], { userToken: "user" });
      const options = { limit: 5, include: ["albums"] };
      const walk = listLibrarySongs.bound(music)(options);
      options.limit = 50;
      options.include.push("artists");
      await all(walk);
      expect(sent()).toEqual(["GET /v1/me/library/songs?include=albums&limit=5"]);
    });

    test("Apple is asked for nothing until a loop starts", async () => {
      const { music, calls } = apple(pages(), { userToken: "user" });
      const walk = listLibrarySongs.bound(music)({ limit: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toHaveLength(0);
      expect(await all(walk)).toEqual([1, 2, 3]);
      expect(calls).toHaveLength(2);
    });

    test("what a call gives can be looped over again, and each loop asks afresh", async () => {
      const { music, sent } = apple([{ body: { data: [1] } }, { body: { data: [1, 2] } }], { userToken: "user" });
      const walk = listLibrarySongs.bound(music)({ limit: 9 });
      expect([await all(walk), await all(walk)]).toEqual([[1], [1, 2]]);
      expect(sent()).toEqual(["GET /v1/me/library/songs?limit=9", "GET /v1/me/library/songs?limit=9"]);
    });

    describe("where the collection leaves its path for when a request is about to be made", () => {
      /** A collection that has to ask for part of its path, as a catalog asks the client which storefront is the listener's. */
      const asking = (ask: () => string | Promise<string>) => {
        const later = vi.fn(ask);
        const collection = vi.fn<tCollection>(() => later);
        return { later, collection, walk: resourceLister<tLibrarySongsResponse>("listSongs", collection), one: resourceGetter<tSongsResponse>("getSong", collection) };
      };

      test("a function that walks pages asks for nothing as it is called: not Apple, and not the path either", async () => {
        const { later, collection, walk } = asking(() => Promise.resolve("v1/catalog/gb/songs"));
        const { music, calls } = apple();
        walk.bound(music)();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect([collection.mock.calls.length, later.mock.calls.length, calls.length]).toEqual([1, 0, 0]);
      });

      test("each loop asks for the path as it starts, and then for the pages", async () => {
        const { later, walk } = asking(() => Promise.resolve("v1/catalog/gb/songs"));
        const { music, sent } = apple();
        const songs = walk.bound(music)();
        await all(songs);
        await all(songs);
        expect(later).toHaveBeenCalledTimes(2);
        expect(sent()).toEqual(["GET /v1/catalog/gb/songs", "GET /v1/catalog/gb/songs"]);
      });

      test("a path that could not be had fails that loop and no other: the next loop asks again", async () => {
        const down = new Error("the storefront could not be had");
        let asked = 0;
        const { walk } = asking(() => (++asked === 1 ? Promise.reject(down) : "v1/catalog/gb/songs"));
        const { music, sent } = apple([{ body: { data: [song("1")] } }]);
        const songs = walk.bound(music)();
        expect(await rejection(all(songs))).toBe(down);
        expect(await all(songs)).toEqual([song("1")]);
        expect(sent()).toEqual(["GET /v1/catalog/gb/songs"]);
      });

      test("what the call was handed is still checked as it is called, before the path is asked for", () => {
        const { later, walk } = asking(() => "v1/catalog/gb/songs");
        const { music } = apple();
        expect(() => walk.bound(music)({ limit: 0 })).toThrow(new TypeError("listSongs: limit must be a whole number above 0; got 0"));
        expect(later).not.toHaveBeenCalled();
      });

      test("the path is checked when it comes, as any collection's is", async () => {
        const { walk, one } = asking(() => "v1/catalog/../me/library/songs");
        const { music, calls } = apple();
        expect((await rejection(all(walk.bound(music)()))).message).toContain("listSongs: the path of the collection holds a segment that is");
        expect((await rejection(one(music, "1"))).message).toContain("getSong: the path of the collection holds a segment that is");
        expect(calls).toHaveLength(0);
      });

      test("a function that asks for one thing asks for the path at once, since its request is about to be made", async () => {
        const { later, one } = asking(() => Promise.resolve("v1/catalog/gb/songs"));
        const { music, sent } = apple([{ body: { data: [song("1")] } }, { body: { data: [song("1")] } }]);
        await one(music, "1");
        await one.bound(music)("1");
        expect(later).toHaveBeenCalledTimes(2);
        expect(sent()).toEqual(["GET /v1/catalog/gb/songs/1", "GET /v1/catalog/gb/songs/1"]);
      });

      test("a plan written by hand can leave its own rest for later in the same way", async () => {
        const later = vi.fn((): tRequestPlan<tLibrarySongsResponse> => ["v1/me/library/songs"]);
        const walk = endpoint("listSongs", "pages", (_client, options?: { limit?: number }) => {
          if (options?.limit === 0) throw new TypeError("listSongs: limit must be a whole number above 0; got 0");
          return later;
        });
        const { music, sent } = apple([], { userToken: "user" });
        expect(() => walk.bound(music)({ limit: 0 })).toThrow(TypeError);
        const songs = walk.bound(music)();
        expect(later).not.toHaveBeenCalled();
        await all(songs);
        await walk(music);
        expect(later).toHaveBeenCalledTimes(2);
        expect(sent()).toEqual(["GET /v1/me/library/songs", "GET /v1/me/library/songs"]);
      });
    });

    describe("where the collection gives a promise of its path, which is on its way from then on", () => {
      /** What rejected with nobody listening while `run` ran and for a turn after, with the test runner's own listeners set aside. */
      async function unheard(run: () => unknown): Promise<unknown[]> {
        const kept = process.listeners("unhandledRejection");
        const heard: unknown[] = [];
        process.removeAllListeners("unhandledRejection");
        process.on("unhandledRejection", (reason) => heard.push(reason));
        try {
          await run();
          await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          process.removeAllListeners("unhandledRejection");
          for (const listener of kept) process.on("unhandledRejection", listener);
        }
        return heard;
      }
      const down = new Error("the storefront could not be had");
      const failing = () => resourceLister<tLibrarySongsResponse>("listSongs", () => Promise.reject(down));

      test("it is asked as the function is called, so a storefront is being fetched before any loop", async () => {
        const collection = vi.fn<tCollection>(() => Promise.resolve("v1/catalog/gb/songs"));
        const { music, sent } = apple();
        const walk = resourceLister<tLibrarySongsResponse>("listSongs", collection).bound(music)();
        expect(collection).toHaveBeenCalledTimes(1);
        await all(walk);
        await all(walk);
        expect(collection).toHaveBeenCalledTimes(1);
        expect(sent()).toEqual(["GET /v1/catalog/gb/songs", "GET /v1/catalog/gb/songs"]);
      });

      test("a failure there while no loop is listening is nobody's unhandled rejection", async () => {
        const { music } = apple();
        expect(await unheard(() => failing().bound(music)())).toEqual([]);
      });

      test("and it is kept for the loop, which hears it however late it starts, every time it starts", async () => {
        const { music, calls } = apple();
        const walk = failing().bound(music)();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(await rejection(all(walk))).toBe(down);
        expect(await rejection(all(walk))).toBe(down);
        expect(calls).toHaveLength(0);
      });

      test("the check that says so can catch one: a promise that rejects with nobody listening is heard", async () => {
        expect(await unheard(() => void Promise.reject(down))).toEqual([down]);
      });
    });

    test("pages are fetched one at a time, and breaking out of the loop stops fetching", async () => {
      const { music, calls } = apple(pages(), { userToken: "user" });
      for await (const item of listLibrarySongs.bound(music)()) if ((item as unknown) === 1) break;
      expect(calls).toHaveLength(1);
    });

    describe("maxPages: how many pages a walk may ask for", () => {
      /** Apple, answering every request with one item and a link to the next, without end. */
      const endless = () => Array.from({ length: 30 }, (_, index) => ({ body: { data: [index], next: `/v1/me/library/songs?offset=${String(index + 1)}` } }));

      test.each([1, 3])("with a limit of %i, a whole collection is walked that far and no further", async (maxPages) => {
        const { music, calls } = apple(endless(), { userToken: "user" });
        expect(await all(listLibrarySongs.bound(music)({ maxPages }))).toHaveLength(maxPages);
        expect(calls).toHaveLength(maxPages);
      });

      test("a relationship's walk is held to its limit in the same way", async () => {
        const { music, calls } = apple(endless(), { userToken: "user" });
        expect(await all(getAlbumRelationship.bound(music)("1", "tracks", { maxPages: 2 }))).toHaveLength(2);
        expect(calls).toHaveLength(2);
      });

      test("pages that hold nothing and each name a next are asked for only as far as the limit, where leaving the loop could not stop them", async () => {
        const empty = Array.from({ length: 30 }, (_, index) => ({ body: { data: [], next: `/v1/me/library/songs?offset=${String(index + 1)}` } }));
        const { music, calls } = apple(empty, { userToken: "user" });
        expect(await all(listLibrarySongs.bound(music)({ maxPages: 4 }))).toEqual([]);
        expect(calls).toHaveLength(4);
      });

      test("the check can tell: with no limit, the same walk goes on for as long as it is looped over", async () => {
        const { music, calls } = apple(endless(), { userToken: "user" });
        const seen: unknown[] = [];
        for await (const item of listLibrarySongs.bound(music)()) if (seen.push(item) === 12) break;
        expect(calls).toHaveLength(12);
      });

      test("the limit is not sent to Apple, and the other options still are", async () => {
        const { music, sent } = apple([{ body: { data: [] } }], { userToken: "user" });
        await all(listLibrarySongs.bound(music)({ limit: 5, maxPages: 2 }));
        expect(sent()).toEqual(["GET /v1/me/library/songs?limit=5"]);
      });

      test("a limit that is no limit is a TypeError naming the function, thrown as it is called", () => {
        const { music, calls } = apple();
        expect(() => listLibrarySongs.bound(music)({ maxPages: 0 })).toThrow(new TypeError("listLibrarySongs: maxPages must be a whole number above 0; got 0"));
        expect(() => getAlbumRelationship.bound(music)("1", "tracks", { maxPages: 1.5 })).toThrow(new TypeError("getAlbumRelationship: maxPages must be a whole number above 0; got 1.5"));
        expect(calls).toHaveLength(0);
      });

      test("called with a client, a function asks for its one page whatever the limit says, and still checks it", async () => {
        const { music, calls } = apple(endless(), { userToken: "user" });
        await listLibrarySongs(music, { maxPages: 3 });
        expect(calls).toHaveLength(1);
        expect(await rejection(listLibrarySongs(music, { maxPages: 0 }))).toEqual(new TypeError("listLibrarySongs: maxPages must be a whole number above 0; got 0"));
      });

      test("the types: a function that walks takes a limit, and one that asks for one thing does not", () => {
        expectTypeOf(listLibrarySongs).parameter(1).toExtend<{ readonly maxPages?: number | undefined } | undefined>();
        const wrong = [
          // @ts-expect-error -- one song is one request: there is no walk to hold
          () => getSong(apple().music, "1", { maxPages: 2 }),
        ];
        expect(wrong).toHaveLength(1);
      });
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
    const getArtist = resourceGetter<tSongsResponse, tNone, { readonly views?: readonly string[] | undefined }>("getArtist", () => "v1/catalog/us/artists", { views: "list" });
    const { music, sent } = apple();
    await getArtist(music, "1", { views: ["top-songs", "singles"] });
    await getSong(music, "1", { views: ["top-songs"] } as tReadOptions<tSongsResponse>);
    expect(sent()).toEqual(["GET /v1/catalog/us/artists/1?views=top-songs,singles", "GET /v1/catalog/us/songs/1"]);
  });

  test("an option a declaration adds is sent by each kind of function that can add one", async () => {
    interface tViews {
      readonly views?: readonly string[] | undefined;
    }
    const one = resourceGetter<tSongsResponse, tNone, tViews>("getArtist", () => "v1/catalog/us/artists", { views: "list" });
    const several = resourcesGetter<tSongsResponse, tNone, tViews>("getArtists", () => "v1/catalog/us/artists", { views: "list" });
    const whole = resourceLister<tSongsResponse, tNone, tViews>("listArtists", () => "v1/catalog/us/artists", { views: "list" });
    const { music, sent } = apple();
    await one(music, "1", { views: ["top-songs"] });
    await several(music, ["1"], { views: ["top-songs"] });
    await whole(music, { views: ["top-songs"] });
    await all(whole.bound(music)({ views: ["top-songs"] }));
    expect(sent()).toEqual([
      "GET /v1/catalog/us/artists/1?views=top-songs",
      "GET /v1/catalog/us/artists?views=top-songs&ids=1",
      "GET /v1/catalog/us/artists?views=top-songs",
      "GET /v1/catalog/us/artists?views=top-songs",
    ]);
  });

  test("a relationship's schema is what its answer is held to, called with a client or walked", async () => {
    const failing: tSchemaLike<never> = { "~standard": { validate: () => ({ issues: [{ message: "expected artists" }] }) } };
    const runs = [(music: tAppleMusicClient) => getAlbumRelationship(music, "1", "artists", { schema: failing }), (music: tAppleMusicClient) => all(getAlbumRelationship.bound(music)("1", "artists", { schema: failing }))];
    for (const run of runs) {
      const { music } = apple([{ body: { data: [song("1")] } }]);
      expect(isAppleMusicError(await rejection(run(music)), "ValidationError")).toBe(true);
    }
  });

  test("a relationship answers with a page, and bound it is walked", async () => {
    const { music, sent } = apple([{ body: { data: [song("1")], next: "/v1/catalog/us/albums/9/tracks?offset=1" } }, { body: { data: [song("2")] } }]);
    expect(await all(getAlbumRelationship.bound(music)("9", "tracks", { limit: 1 }))).toEqual([song("1"), song("2")]);
    expect(sent()).toEqual(["GET /v1/catalog/us/albums/9/tracks?limit=1", "GET /v1/catalog/us/albums/9/tracks?offset=1"]);
  });
});

describe("resourcesFinder: the resources a filter picks out of a collection", () => {
  interface tRestrict {
    readonly restrict?: readonly "explicit"[] | undefined;
  }
  const getSongsByIsrc = resourcesFinder<tSongsResponse>("getSongsByIsrc", "isrc", () => SONGS);

  test("it asks the collection for the values under the filter's name, with the options beside them", async () => {
    const { music, sent } = apple();
    await getSongsByIsrc(music, ["USUM71900001", "GBUM71900002"], { include: ["albums"], language: "en-GB" });
    expect(sent()).toEqual(["GET /v1/catalog/us/songs?l=en-GB&include=albums&filter[isrc]=USUM71900001,GBUM71900002"]);
  });

  test("called with a client it resolves to Apple's answer, and bound to the list the answer holds", async () => {
    const answer = { data: [song("1"), song("2")] };
    const { music } = apple([{ body: answer }, { body: answer }]);
    expect(await getSongsByIsrc(music, ["USUM71900001"])).toEqual(answer);
    expect(await getSongsByIsrc.bound(music)(["USUM71900001"])).toEqual(answer.data);
    expectTypeOf(getSongsByIsrc).parameters.toEqualTypeOf<[client: tAppleMusicClient, values: readonly string[], options?: tEndpointOptions<tSongsResponse>]>();
    expectTypeOf(getSongsByIsrc.bound(music)).returns.resolves.toEqualTypeOf<tSong[]>();
  });

  test("the values it is handed win over the same filter put among the caller's params", async () => {
    const { music, sent } = apple();
    await getSongsByIsrc(music, ["A"], { params: { "filter[isrc]": ["B"], "filter[upc]": ["C"] } });
    expect(sent()).toEqual(["GET /v1/catalog/us/songs?filter[isrc]=A&filter[upc]=C"]);
  });

  test("a filter with a hyphen in its name is sent under that name, and an option the declaration adds beside it", async () => {
    const equivalents = resourcesFinder<tSongsResponse, tNone, tRestrict>("getSongsByEquivalents", "equivalents", () => SONGS, { restrict: "list" });
    const chart = resourcesFinder<tSongsResponse>("getPlaylistsByStorefrontChart", "storefront-chart", () => "v1/catalog/us/playlists");
    const { music, sent } = apple();
    await equivalents(music, ["1"], { restrict: ["explicit"] });
    await chart(music, ["us"]);
    expect(sent()).toEqual(["GET /v1/catalog/us/songs?restrict=explicit&filter[equivalents]=1", "GET /v1/catalog/us/playlists?filter[storefront-chart]=us"]);
  });

  test.each<[string, unknown, string]>([
    ["one string, not a list", "USUM71900001", "12 characters"],
    ["an empty list", [], "a list of 0"],
    ["a list holding two in one", ["A,B"], "3 characters at index 0"],
    ["missing", undefined, "undefined"],
  ])("values that are %s are a TypeError naming the function and the argument as its signature names it, before the collection or Apple is asked", async (_name, values, what) => {
    const { music, calls } = apple();
    const collection = vi.fn<tCollection>(() => SONGS);
    const error = await rejection(resourcesFinder<tSongsResponse>("getSongsByIsrc", "isrc", collection)(music, values as string[]));
    expect(error).toEqual(new TypeError(`getSongsByIsrc: values must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ${what}`));
    expect([collection.mock.calls.length, calls.length]).toEqual([0, 0]);
  });

  test("the argument has one name: the signature's, which is the one a mistake in it is told by", () => {
    expectTypeOf(getSongsByIsrc).parameters.toEqualTypeOf<[client: tAppleMusicClient, values: readonly string[], options?: tEndpointOptions<tSongsResponse>]>();
  });

  test.each<[string, unknown, string]>([
    ["missing", undefined, "undefined"],
    ["empty", "", "0 characters"],
    ["written with its brackets", "filter[isrc]", "12 characters"],
    ["one that would close the brackets and add a parameter", "isrc]&ids[", "10 characters"],
    ["in capitals", "ISRC", "4 characters"],
    ["a list", ["isrc"], "object"],
    ["one that begins with a hyphen", "-isrc", "5 characters"],
    ["one that ends with a hyphen", "isrc-", "5 characters"],
    ["one with two hyphens together", "storefront--chart", "17 characters"],
    ["one with a digit in it", "isrc2", "5 characters"],
    ["one character longer than a name may be", "a".repeat(65), "65 characters"],
  ])("a filter's name that is %s is a TypeError naming resourcesFinder, as the declaration is made", (_name, filter, what) => {
    expect(() => resourcesFinder<tSongsResponse>("getSongsByIsrc", filter as string, () => SONGS)).toThrow(
      new TypeError(`resourcesFinder: filter must be the name of a filter, lowercase words with hyphens between and at most 64 characters, such as "isrc"; got ${what}`),
    );
  });

  test("a filter's name of 64 characters is taken, as a type's name of that length is", async () => {
    const { music, sent } = apple();
    await resourcesFinder<tSongsResponse>("find", "a".repeat(64), () => SONGS)(music, ["1"]);
    expect(sent()).toEqual([`GET /v1/catalog/us/songs?filter[${"a".repeat(64)}]=1`]);
  });

  test("the types: it has to say what its answer is, and to name every option it adds", () => {
    const declarations = [
      // @ts-expect-error -- the answer's type is not said, so there is nothing a collection can be
      () => resourcesFinder("getSongsByIsrc", "isrc", () => SONGS),
      // @ts-expect-error -- an option is added and not named
      () => resourcesFinder<tSongsResponse, tNone, tRestrict>("getSongsByEquivalents", "equivalents", () => SONGS),
    ];
    expect(declarations).toHaveLength(2);
  });
});

describe("the resource patterns: where the collection is", () => {
  test("it is asked with the function's name, the client and the options the call was given", async () => {
    const { music } = apple();
    const collection = vi.fn<tCollection>(() => SONGS);
    const options = { language: "en-GB" };
    await resourceGetter<tSongsResponse>("getSong", collection)(music, "1", options);
    expect(collection).toHaveBeenCalledWith("getSong", music, options);
  });

  test("a call with no options hands it an empty bag, never undefined", async () => {
    const { music } = apple();
    const collection = vi.fn<tCollection>(() => SONGS);
    await resourcesGetter<tSongsResponse>("getSongs", collection)(music, ["1"]);
    expect(collection).toHaveBeenCalledWith("getSongs", music, {});
  });

  test("a relationship asks for its collection as the others do: with the options the call was given, or an empty bag", async () => {
    const { music } = apple();
    const collection = vi.fn<tCollection>(() => "v1/catalog/us/albums");
    const related = relationshipGetter<tAlbumRelationships>("getAlbumRelationship", collection);
    await related(music, "1", "tracks");
    await related(music, "1", "tracks", { limit: 5 });
    expect(collection.mock.calls).toEqual([
      ["getAlbumRelationship", music, {}],
      ["getAlbumRelationship", music, { limit: 5 }],
    ]);
  });

  test("it may ask the client, as a catalog asks for a storefront no option named", async () => {
    const collection: tCollection<tStore> = async (_fn, client, options) => `v1/catalog/${options.storefront ?? (await client.storefront())}/songs`;
    const inStorefront = resourceGetter<tSongsResponse, tStore>("getSong", collection);
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

describe("inStorefront: the storefront a call is for, as one segment of a path", () => {
  const SEGMENT = 'must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';
  const path = (storefront: string) => `v1/catalog/${storefront}/songs`;

  test("named by the call, it is there at once, and the client is not asked", () => {
    const { music } = apple([], { storefront: "us" });
    const storefront = vi.spyOn(music, "storefront");
    expect(inStorefront("getSong", music, "gb", path)).toBe("v1/catalog/gb/songs");
    expect(storefront).not.toHaveBeenCalled();
  });

  test("not named, it is left for later: the client is asked when what it gives is called, and not before", async () => {
    const { music } = apple([], { storefront: "us" });
    const storefront = vi.spyOn(music, "storefront");
    const later = inStorefront("getSong", music, undefined, path);
    expect(later).toBeTypeOf("function");
    expect(storefront).not.toHaveBeenCalled();
    expect(await (later as () => Promise<string>)()).toBe("v1/catalog/us/songs");
    expect(storefront).toHaveBeenCalledTimes(1);
  });

  test("it is encoded as a segment is, so one that is only odd stays where it was put", () => {
    expect(inStorefront("getSong", apple().music, "u s?x", path)).toBe("v1/catalog/u%20s%3Fx/songs");
  });

  test.each<[string, unknown, string]>([
    ["empty", "", "0 characters"],
    ["two dots", "..", "2 characters"],
    ["one that would leave the catalog", "../me/library", "13 characters"],
    ["a number", 5, "5"],
    ["null", null, "null"],
  ])("a storefront the call names that is %s is a TypeError naming the function and the option, thrown there and then", (_name, storefront, what) => {
    expect(() => inStorefront("getSong", apple().music, storefront, path)).toThrow(new TypeError(`getSong: storefront ${SEGMENT}${what}`));
  });

  test("the client's own storefront is held to the same, when it comes", async () => {
    const later = inStorefront("getSong", apple([], { storefront: "../me/library" }).music, undefined, path) as () => Promise<string>;
    expect(await rejection(later())).toEqual(new TypeError(`getSong: storefront ${SEGMENT}13 characters`));
  });

  test("a client that answers with its storefront itself, and not a promise of it, is asked the same", async () => {
    const wrapped = { storefront: () => "gb" } as unknown as tAppleMusicClient;
    expect(await (inStorefront("getSong", wrapped, undefined, path) as () => Promise<string>)()).toBe("v1/catalog/gb/songs");
  });
});

describe("the resource patterns: a collection says whether what is asked of it carries the Music User Token", () => {
  /** A collection at a path, with its say on the listener's token, or with none. */
  const at = (path: string, user?: unknown): tCollection => Object.assign(() => path, user === undefined ? {} : { user }) as tCollection;
  /** A call of every pattern over one collection, with a client and bound: seven requests when no page names a next. */
  const every = (collection: tCollection) => {
    const one = resourceGetter<tSongsResponse>("getSong", collection);
    const several = resourcesGetter<tSongsResponse>("getSongs", collection);
    const found = resourcesFinder<tSongsResponse>("getSongsByIsrc", "isrc", collection);
    const whole = resourceLister<tSongsResponse>("listSongs", collection);
    const related = relationshipGetter<tAlbumRelationships>("getAlbumRelationship", collection);
    return async (music: tAppleMusicClient) => {
      await one(music, "1");
      await several(music, ["1"]);
      await found(music, ["A"]);
      await whole(music);
      await related(music, "1", "tracks");
      await all(whole.bound(music)());
      await all(related.bound(music)("1", "tracks"));
    };
  };
  const seven = (token: string | null) => Array.from({ length: 7 }, () => token);

  test("false: nothing asked of it carries the token, though the client holds one and the path is the listener's", async () => {
    const { music, userTokens } = apple([], { userToken: "listener" });
    await every(at("v1/me/library/songs", false))(music);
    expect(userTokens()).toEqual(seven(null));
  });

  test("false holds for every page of a walk, wherever a next link points", async () => {
    const page = { body: { data: [song("1")], next: "/v1/me/library/songs?offset=1" } };
    const { music, sent, userTokens } = apple([page, { body: { data: [song("2")] } }, page, { body: { data: [song("2")] } }], { userToken: "listener" });
    const collection = at("v1/catalog/us/genres", false);
    expect(await all(resourceLister<tSongsResponse>("listGenres", collection).bound(music)())).toEqual([song("1"), song("2")]);
    expect(await all(relationshipGetter<tAlbumRelationships>("getAlbumRelationship", collection).bound(music)("1", "tracks"))).toEqual([song("1"), song("2")]);
    expect(sent()).toEqual(["GET /v1/catalog/us/genres", "GET /v1/me/library/songs?offset=1", "GET /v1/catalog/us/genres/1/tracks", "GET /v1/me/library/songs?offset=1"]);
    expect(userTokens()).toEqual([null, null, null, null]);
  });

  test("the check can tell: with no say from the collection, the same walk does carry the token to where that link points", async () => {
    const { music, userTokens } = apple([{ body: { data: [song("1")], next: "/v1/me/library/songs?offset=1" } }, { body: { data: [] } }], { userToken: "listener" });
    await all(resourceLister<tSongsResponse>("listGenres", at("v1/catalog/us/genres")).bound(music)());
    expect(userTokens()).toEqual([null, "listener"]);
  });

  test("true: everything asked of it carries the token, though the path is the catalog's", async () => {
    const { music, userTokens } = apple([], { userToken: "listener" });
    await every(at("v1/catalog/us/stations", true))(music);
    expect(userTokens()).toEqual(seven("listener"));
  });

  test("left out: the client goes by the path, and sends the token under /v1/me alone", async () => {
    const { music, userTokens } = apple([], { userToken: "listener" });
    await every(at("v1/catalog/us/songs"))(music);
    await every(at("v1/me/library/songs"))(music);
    expect(userTokens()).toEqual([...seven(null), ...seven("listener")]);
  });

  test.each<[string, unknown, string]>([
    ["a string", "no", "2 characters"],
    ["a number", 0, "0"],
    ["null", null, "null"],
  ])("a say that is %s is a TypeError naming the builder, as the declaration is made", (_name, user, what) => {
    const builders: [string, (collection: tCollection) => unknown][] = [
      ["resourceGetter", (collection) => resourceGetter<tSongsResponse>("getSong", collection)],
      ["resourcesGetter", (collection) => resourcesGetter<tSongsResponse>("getSongs", collection)],
      ["resourcesFinder", (collection) => resourcesFinder<tSongsResponse>("getSongsByIsrc", "isrc", collection)],
      ["resourceLister", (collection) => resourceLister<tSongsResponse>("listSongs", collection)],
      ["relationshipGetter", (collection) => relationshipGetter<tAlbumRelationships>("getAlbumRelationship", collection)],
    ];
    for (const [builder, declare] of builders) {
      expect(() => declare(at(SONGS, user))).toThrow(new TypeError(`${builder}: collection.user must be true or false where it is given; got ${what}`));
    }
  });

  test("the say is the collection's own: a user put on Object.prototype by other code is not it", async () => {
    Object.assign(Object.prototype, { user: true });
    try {
      const { music, userTokens } = apple([], { userToken: "listener" });
      await every(at("v1/catalog/us/songs"))(music);
      expect(userTokens()).toEqual(seven(null));
    } finally {
      Reflect.deleteProperty(Object.prototype, "user");
    }
  });
});

describe("the resource patterns: what a collection gives is checked, so that what goes into it cannot move the request", () => {
  /** A collection that puts a storefront into its path as it comes, which is what the check is there for. */
  const catalog: tCollection<tStore> = (_fn, _client, options) => `v1/catalog/${options.storefront ?? "us"}/songs`;
  const one = resourceGetter<tSongsResponse, tStore>("getSong", catalog);
  const several = resourcesGetter<tSongsResponse, tStore>("getSongs", catalog);
  const whole = resourceLister<tSongsResponse, tStore>("listSongs", catalog);
  const related = relationshipGetter<tAlbumRelationships, tStore>("getSongRelationship", catalog);

  const DOTS = 'holds a segment that is "." or "..", written out or percent-encoded, which a URL reads as "here" and "one up", so that the request would go to another path';
  const BACKSLASH = "holds a backslash, which a URL reads as a slash, so that it would begin another segment";
  const QUESTION = "holds a question mark, which begins the query, so that what follows it would not be part of the path";
  const HASH = "holds a hash, which begins a fragment, so that what follows it would not be sent at all";
  const CONTROL = "holds a space, a tab, a line break or another control character, which a URL drops or trims, joining what was on either side of it";
  const FOREIGN = "holds a character outside ASCII, which a URL rewrites, so that what is asked for would not be what was written";
  const EMPTY = "holds an empty segment, from two slashes together or a slash at its end, so that what was meant to fill it is missing";
  const SCHEME = "begins with a name and a colon, which a URL reads as a scheme, so that the rest would be read as another address";

  test.each<[string, string, string]>([
    ["one up", "..", DOTS],
    ["one up and into the listener's library", "../me/library", DOTS],
    ["here", ".", DOTS],
    ["a real one, then two up", "us/../../me/library", DOTS],
    ["one up, percent-encoded", "%2e%2e", DOTS],
    ["one up, percent-encoded in capitals", "%2E%2E", DOTS],
    ["one up, half encoded", ".%2e", DOTS],
    ["one up, the other half encoded", "%2E.", DOTS],
    ["here, percent-encoded", "%2e", DOTS],
    ["one up by backslashes", "..\\me\\library", BACKSLASH],
    ["a real one and a backslash", "us\\", BACKSLASH],
    ["a real one and a query", "us?x=", QUESTION],
    ["a real one and a fragment", "us#", HASH],
    ["one up with a tab inside it, which a URL would drop", ".\t.", CONTROL],
    ["one up with a line break inside it", ".\n.", CONTROL],
    ["one with a carriage return", "u\rs", CONTROL],
    ["one with a space", "u s", CONTROL],
    ["one with a null", "u\u0000s", CONTROL],
    ["one with a delete", "u\u007fs", CONTROL],
    ["a letter outside ASCII", "é", FOREIGN],
    ["dots that only look like dots", "．．", FOREIGN],
    ["nothing", "", EMPTY],
    ["a real one and a slash", "us/", EMPTY],
    ["a slash and a host", "/evil.example", EMPTY],
  ])("a storefront that is %s is refused, and the reason is given", async (_name, storefront, reason) => {
    const { music, calls } = apple([], { userToken: "user" });
    // Each is async, so that a function which refuses as it is called and one which rejects are met the same way.
    const attempts: [string, () => Promise<unknown>][] = [
      ["getSong", async () => one(music, "1", { storefront })],
      ["getSong", async () => one.bound(music)("1", { storefront })],
      ["getSongs", async () => several(music, ["1"], { storefront })],
      ["getSongs", async () => several.bound(music)(["1"], { storefront })],
      ["listSongs", async () => whole(music, { storefront })],
      ["listSongs", async () => all(whole.bound(music)({ storefront }))],
      ["getSongRelationship", async () => related(music, "1", "tracks", { storefront })],
      ["getSongRelationship", async () => all(related.bound(music)("1", "tracks", { storefront }))],
    ];
    for (const [fn, attempt] of attempts) expect(await rejection(attempt())).toEqual(new TypeError(`${fn}: the path of the collection ${reason}`));
    expect(calls).toHaveLength(0);
  });

  test.each<[string, unknown, string]>([
    ["a number", 5, "must be a string with something in it; got 5"],
    ["nothing", undefined, "must be a string with something in it; got undefined"],
    ["null", null, "must be a string with something in it; got null"],
    ["an empty string", "", "must be a string with something in it; got 0 characters"],
    ["an address of its own", "https://evil.example/v1/catalog/us/songs", SCHEME],
    ["a scheme with no slashes after it, which a URL reads as a path on Apple's own origin", "https:v1/me/library/songs", SCHEME],
    ["a blob of Apple's origin", "blob:https://api.music.apple.com/v1/me/library/songs", SCHEME],
    ["another host, by two slashes", "//evil.example/v1/catalog/us/songs", EMPTY],
    ["a path with a slash at its end", "v1/catalog/us/songs/", EMPTY],
    ["a path longer than any collection's", `v1/${"x".repeat(254)}`, "is longer than 256 characters, which no collection's path is"],
  ])("a collection that gives %s is refused", async (_name, path, reason) => {
    const { music, calls } = apple([], { userToken: "user" });
    const fn = resourceGetter<tSongsResponse>("getSong", () => path as string);
    expect(await rejection(fn(music, "1"))).toEqual(new TypeError(`getSong: the path of the collection ${reason}`));
    expect(calls).toHaveLength(0);
  });

  test.each(["v1/catalog/us/songs", "/v1/catalog/us/songs", "v1/me/library/songs", "v1/a.b/c..d/...", "v1/x:y/z", "v1/a%2Fb/c", "v1/A_b-c~1!*'()/d", `v1/${"x".repeat(253)}`])("%s is a path, and is asked for as it is written", async (path) => {
    const { music, calls } = apple([], { userToken: "user" });
    await resourceGetter<tSongsResponse>("getSong", () => path)(music, "1");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe(`/${path.replace(/^\//, "")}/1`);
  });

  test("a collection that takes its time is checked when it answers", async () => {
    const { music, calls } = apple();
    const late = resourceGetter<tSongsResponse>("getSong", () => Promise.resolve("v1/catalog/../me/library"));
    expect(await rejection(late(music, "1"))).toEqual(new TypeError(`getSong: the path of the collection ${DOTS}`));
    expect(calls).toHaveLength(0);
  });

  test("whatever a storefront holds, a request is refused or it stays in the catalog, without the listener's token", async () => {
    const storefronts = ["us", "gb", "a.b", "...", "a%2Fb", "x:y", "..", "../me/library", "%2e%2e/me", "..%2f..%2fme", "us/../..", "us/songs/1/../../../../me", "\\..\\me", "?", "#", "\t", " us", "us ", "é", "", "/", "//", "/v1/me", "https://evil.example", "me/../../me"];
    for (const storefront of storefronts) {
      const { music, calls, userTokens } = apple([], { userToken: "user" });
      const outcome: unknown = await one(music, "1", { storefront }).catch((e: unknown) => e);
      if (outcome instanceof Error) {
        expect(outcome, storefront).toBeInstanceOf(TypeError);
        expect(calls, storefront).toHaveLength(0);
      } else {
        const segments = new URL(calls[0]?.url ?? "").pathname.split("/");
        expect(segments.slice(0, 3), storefront).toEqual(["", "v1", "catalog"]);
        expect(segments.at(-1), storefront).toBe("1");
        expect(userTokens(), storefront).toEqual([null]);
      }
    }
  });

  test("the check that says so can catch it: the same storefront put into a path with no check does reach the listener's library, token and all", async () => {
    const { music, sent, userTokens } = apple([], { userToken: "user" });
    await music.request((await catalog("getSong", music, { storefront: "../me/library" })) as string);
    expect(sent()).toEqual(["GET /v1/me/library/songs"]);
    expect(userTokens()).toEqual(["user"]);
  });

  test("what was wrong with the path is said, and the path is not shown", async () => {
    const { music } = apple();
    for (const storefront of [`${SECRET}?`, `${SECRET}/..`, `${SECRET} `, `${SECRET}\\`]) {
      const error = await rejection(one(music, "1", { storefront }));
      expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
    }
  });
});

describe("the resource patterns: what a function is handed is checked before anything is asked, of Apple or of the collection", () => {
  const collection = vi.fn<tCollection>(() => SONGS);
  const one = resourceGetter<tSongsResponse>("getSong", collection);
  const several = resourcesGetter<tSongsResponse>("getSongs", collection);
  const whole = resourceLister<tLibrarySongsResponse>("listLibrarySongs", collection);
  const related = relationshipGetter<tAlbumRelationships>("getAlbumRelationship", collection);
  const SEGMENT = 'must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';
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

  test("of two mistakes, the one named is the one in the argument handed over first", async () => {
    const { music } = apple();
    const none = null as unknown as tReadOptions<tSongsResponse>;
    const firsts: [Promise<unknown>, string][] = [
      [one(music, "", { limit: 0 }), "getSong: id "],
      [one(music, "", none), "getSong: id "],
      [several(music, [], { limit: 0 }), "getSongs: ids "],
      [several(music, [], none), "getSongs: ids "],
      [related(music, "", "" as "tracks", { limit: 0 }), "getAlbumRelationship: id "],
      [related(music, "1", "" as "tracks", { limit: 0 }), "getAlbumRelationship: name "],
      [related(music, "1", "tracks", { limit: 0 }), "getAlbumRelationship: limit "],
    ];
    for (const [call, start] of firsts) expect((await rejection(call)).message.startsWith(start), start).toBe(true);
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
  /** What a URL, or a server that decodes a path before it reads it, would take for a way out of the segment. */
  const leaving = ["../../../me/library/songs", "..\\..\\..\\me\\library\\songs", "%2e%2e/%2e%2e/%2e%2e/me/library/songs", "..%2F..%2F..%2Fme", "/v1/me/library/songs", "1/../../../../me/storefront", "1\n2"];
  /** What means something elsewhere in a URL, and nothing in a path once it is encoded. */
  const hostile = ["1?include=library", "1#x", "1 2", "1&ids=2"];
  const SEGMENT = 'must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';

  test.each(leaving)("an id or a relationship name of %j is refused by every function, and Apple is not asked", async (value) => {
    const { music, calls } = apple([], { userToken: "user" });
    const what = `${String(value.length)} characters`;
    expect(await rejection(getSong(music, value))).toEqual(new TypeError(`getSong: id ${SEGMENT}${what}`));
    expect(await rejection(getAlbumRelationship(music, value, "tracks"))).toEqual(new TypeError(`getAlbumRelationship: id ${SEGMENT}${what}`));
    expect(await rejection(getAlbumRelationship(music, "1", value as "tracks"))).toEqual(new TypeError(`getAlbumRelationship: name ${SEGMENT}${what}`));
    expect(() => getAlbumRelationship.bound(music)("1", value as "tracks")).toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

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

describe("what a plan gives is read as what it holds itself, never as what is found on Object.prototype", () => {
  /** Runs `run` while `Object.prototype` carries `planted`, as it would after some other code had polluted it. */
  async function polluted<T>(planted: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    Object.assign(Object.prototype, planted);
    try {
      return await run();
    } finally {
      for (const key of Object.keys(planted)) Reflect.deleteProperty(Object.prototype, key);
    }
  }
  const addToLibrary = endpoint("addToLibrary", "answer", (): tRequestPlan<unknown> => ["v1/me/library", { method: "POST", params: { "ids[songs]": ["1"] } }]);

  test("an onResponse there that is no function does not turn a request that was answered into a failure", async () => {
    const { music, sent } = apple([{ status: 202 }, { body: { data: [song("1")] } }, { body: { data: [song("1")] } }], { userToken: "user" });
    const answers = await polluted({ onResponse: "planted" }, async () => [await addToLibrary(music), await getSong(music, "1"), await getSong.bound(music)("1")]);
    expect(answers).toEqual([undefined, { data: [song("1")] }, song("1")]);
    expect(sent()).toEqual(["POST /v1/me/library?ids[songs]=1", "GET /v1/catalog/us/songs/1", "GET /v1/catalog/us/songs/1"]);
  });

  test("an onResponse there that is a function is not the plan's hook, and is handed no request", async () => {
    const planted = vi.fn();
    const { music } = apple([{ status: 202 }, { body: { data: [song("1")] } }], { userToken: "user" });
    await polluted({ onResponse: planted }, async () => [await addToLibrary(music), await getSong.bound(music)("1")]);
    expect(planted).not.toHaveBeenCalled();
  });

  test("the check can tell: a hook the plan gives itself is called, once for each response", async () => {
    const own = vi.fn();
    const hooked = endpoint("getSong", "resource", (): tRequestPlan<tSongsResponse> => [`${SONGS}/1`, { onResponse: own }]);
    const { music } = apple([{ body: { data: [song("1")] } }]);
    await hooked.bound(music)();
    expect(own).toHaveBeenCalledTimes(1);
  });
});

describe("endpointNamespace: a name looked up in a namespace is one of its functions, or is not there", () => {
  const namespace = () => endpointNamespace("catalog", apple().music, declared) as unknown as Record<string, unknown>;

  test.each(["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf"])("%s, which every ordinary object has, is not in it", (name) => {
    expect(namespace()[name]).toBeUndefined();
    expect(name in namespace()).toBe(false);
  });

  test("it inherits from nothing, so nothing put on Object.prototype by other code is found there either", () => {
    Object.assign(Object.prototype, { getEverything: () => "planted" });
    try {
      expect(Object.getPrototypeOf(namespace())).toBeNull();
      expect(namespace().getEverything).toBeUndefined();
    } finally {
      Reflect.deleteProperty(Object.prototype, "getEverything");
    }
  });

  test("the check can tell: an ordinary object does answer to those names", () => {
    expect(typeof ({} as Record<string, unknown>).constructor).toBe("function");
  });

  test("what it does hold is all there, and is still frozen", () => {
    expect(Object.keys(namespace()).sort()).toEqual(Object.keys(declared).sort());
    expect(Object.isFrozen(namespace())).toBe(true);
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

  test("a function's bound is called as the function's own method, so one made elsewhere may be written as one", () => {
    const { music } = apple();
    const made = Object.assign(() => undefined, {
      bound(this: unknown, client: tAppleMusicClient) {
        return () => [this === made, client === music];
      },
    });
    expect(endpointNamespace("catalog", music, { made }).made()).toEqual([true, true]);
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
    // One more name the namespace holds itself: it has not become what the namespace inherits from, which is nothing.
    expect(Object.getPrototypeOf(catalog)).toBeNull();
    expect(typeof Object.getOwnPropertyDescriptor(catalog, "__proto__")?.value).toBe("function");
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

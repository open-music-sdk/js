// @vitest-environment node
import type { tGenre, tSong, tSongsResponse } from "@open-music-sdk/browser";
import { createClient, type tAppleMusicClient, type tPage, type tSchemaLike } from "@open-music-sdk/core";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import { musicQueries, type tInfiniteQuery } from "./query";

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

const genre = (id: string) => ({ id, type: "genres", href: `/v1/catalog/us/genres/${id}`, attributes: { name: `Genre ${id}` } });
const SONG = { id: "1", type: "songs", href: "/v1/catalog/us/songs/1", attributes: { name: "Hey Jude" } };

/** Apple, so far as this suite asks it: genres in three pages, the listener's playlists in two, one song, and a record of every request. */
function apple() {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push(req);
    const url = new URL(req.url);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const body =
      url.pathname.endsWith("/genres") ? { data: [genre(String(offset + 1))], ...(offset < 2 ? { next: `/v1/catalog/us/genres?offset=${String(offset + 1)}` } : {}) }
      : url.pathname.endsWith("/library/playlists") ? { data: [{ id: `p.${String(offset + 1)}`, type: "library-playlists", href: `/v1/me/library/playlists/p.${String(offset + 1)}` }], ...(offset < 1 ? { next: `/v1/me/library/playlists?offset=${String(offset + 1)}` } : {}) }
      : { data: [SONG] };
    const res = new Response(JSON.stringify(body));
    responses.push(res);
    return Promise.resolve(res);
  };
  const music = createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false });
  return { music, calls, paths: () => calls.map((c) => `${new URL(c.url).pathname}${new URL(c.url).search}`), userTokens: () => calls.map((c) => c.headers.get("music-user-token")) };
}

/** Walks a query's pages as useInfiniteQuery would, and gives them. */
async function walk<P extends tPage<unknown>>(query: tInfiniteQuery<P>, most = 10): Promise<P[]> {
  const pages: P[] = [];
  let pageParam = query.initialPageParam;
  for (let asked = 0; asked < most; asked++) {
    const page = await query.queryFn({ pageParam });
    pages.push(page);
    pageParam = query.getNextPageParam(page);
    if (pageParam === undefined) break;
  }
  return pages;
}

afterEach(() => {
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("musicQueries: one answer", () => {
  test("is what useQuery takes: keyed by the package, the scope, the namespace, the name and the arguments; retry false; the function's answer unwrapped", async () => {
    const { music, paths } = apple();
    const query = musicQueries(music).catalog.getSong("1", { include: ["albums"] });
    expect(query.queryKey).toEqual(["open-music-sdk", 0, "catalog", "getSong", "1", { include: ["albums"] }]);
    expect(query.retry).toBe(false);
    expect(Object.isFrozen(query)).toBe(true);
    expect(paths()).toEqual([]);
    expect(await query.queryFn()).toEqual(SONG);
    expect(paths()).toEqual(["/v1/catalog/us/songs/1?include=albums"]);
    expectTypeOf(query.queryFn).returns.resolves.toEqualTypeOf<tSong>();
    expectTypeOf(query.retry).toEqualTypeOf<false>();
  });

  test("a mistake in the arguments is the function's TypeError, when the query runs", async () => {
    const { music } = apple();
    await expect(musicQueries(music).catalog.getSong("").queryFn()).rejects.toThrow(/^getSong: id must be/);
  });

  test("an answer as it is, such as a search, is an answer query too", async () => {
    const { music } = apple();
    const query = musicQueries(music).catalog.searchCatalog("hey", { types: ["songs"] });
    expect(query.queryKey).toEqual(["open-music-sdk", 0, "catalog", "searchCatalog", "hey", { types: ["songs"] }]);
    expect(await query.queryFn()).toEqual({ data: [SONG] });
  });
});

describe("musicQueries: a walk", () => {
  test("is what useInfiniteQuery takes: the first page is the function's, each later page is asked for by its next, and each page carries the next Apple sent", async () => {
    const { music, paths } = apple();
    const query = musicQueries(music).catalog.listGenres();
    expect([query.initialPageParam, query.retry]).toEqual([undefined, false]);
    const pages = await walk(query);
    expect(pages.map((page) => page.data.map((each) => each.id))).toEqual([["1"], ["2"], ["3"]]);
    expect(pages.map((page) => page.next)).toEqual(["/v1/catalog/us/genres?offset=1", "/v1/catalog/us/genres?offset=2", undefined]);
    expect(paths()).toEqual(["/v1/catalog/us/genres", "/v1/catalog/us/genres?offset=1", "/v1/catalog/us/genres?offset=2"]);
    expectTypeOf(query.queryFn).returns.resolves.toExtend<tPage<unknown>>();
    expectTypeOf(pages[0]?.data).toExtend<tGenre[] | undefined>();
    expectTypeOf(query.initialPageParam).toEqualTypeOf<string | undefined>();
  });

  test("a schema that is a function, as some libraries' are, is a schema here too: every page is validated by it, and it is a marker in the key", async () => {
    const { music } = apple();
    const checked: unknown[] = [];
    const schema = Object.assign(() => undefined, { "~standard": { validate: (value: unknown) => (checked.push(value), { value: value as { data: tGenre[] } }) } }) as unknown as tSchemaLike<{ data: tGenre[] }>;
    const query = musicQueries(music).catalog.listGenres({ schema });
    expect(query.queryKey).toEqual(["open-music-sdk", 0, "catalog", "listGenres", { schema: "schema" }]);
    expect(await walk(query)).toHaveLength(3);
    expect(checked).toHaveLength(3);
  });

  test("next comes from Apple's body as it came, not from a schema's copy that kept only what it knows", async () => {
    const { music } = apple();
    const checked: unknown[] = [];
    const schema: tSchemaLike<{ data: tGenre[] }> = { "~standard": { validate: (value) => (checked.push(value), { value: { data: (value as { data: tGenre[] }).data } }) } };
    const pages = await walk(musicQueries(music).catalog.listGenres({ schema }));
    expect(pages).toHaveLength(3);
    expect(checked).toHaveLength(3);
    expect(pages[0]?.next).toBe("/v1/catalog/us/genres?offset=1");
  });

  test("a catalog's later page sends no Music User Token, as the walk would not, and a listener's does", async () => {
    const { music, userTokens } = apple();
    await walk(musicQueries(music).catalog.listGenres());
    expect(userTokens()).toEqual([null, null, null]);
    const listener = apple();
    const pages = await walk(musicQueries(listener.music).user.listLibraryPlaylists());
    expect(pages).toHaveLength(2);
    expect(listener.userTokens()).toEqual(["listener", "listener"]);
  });

  test("maxPages is refused: how many pages are kept is TanStack's to say", () => {
    const { music } = apple();
    expect(() => musicQueries(music).catalog.listGenres({ maxPages: 2 })).toThrow(new TypeError("musicQueries.catalog.listGenres: maxPages is not an option of a query; how many pages are kept is TanStack's maxPages, on useInfiniteQuery"));
  });

  test("a relationship is a walk whose name decides the page", async () => {
    const { music, paths } = apple();
    const query = musicQueries(music).catalog.getAlbumRelationship("5", "tracks");
    expect(query.queryKey).toEqual(["open-music-sdk", 0, "catalog", "getAlbumRelationship", "5", "tracks"]);
    await walk(query);
    expect(paths()).toEqual(["/v1/catalog/us/albums/5/tracks"]);
  });
});

describe("musicQueries: what is in it, and what is kept out of a key", () => {
  test("every read function of both clients, and no write: a write is useMutation over the namespace", () => {
    const { music } = apple();
    const queries = musicQueries(music);
    expect(Object.keys(queries)).toEqual(["catalog", "user"]);
    expect(Object.keys(queries.catalog)).toContain("getSong");
    expect(Object.keys(queries.catalog)).toContain("listGenres");
    expect(Object.keys(queries.user)).toContain("getLibrarySong");
    for (const write of ["addToLibrary", "addToFavorites", "addLibraryPlaylistTracks", "createLibraryPlaylist", "setSongRating", "deleteSongRating"]) expect(Object.keys(queries.user), write).not.toContain(write);
    expect(Object.keys(queries.catalog)).not.toContain("catalog");
    expect(Object.isFrozen(queries) && Object.isFrozen(queries.catalog) && Object.getPrototypeOf(queries.user) === null).toBe(true);
    expectTypeOf(queries.user).not.toHaveProperty("addToLibrary");
    expectTypeOf(queries.catalog.getAlbumRelationship).toBeFunction();
  });

  test("the types say what the runtime has: a rating set or taken away is no query, and a view is a walk, in both", () => {
    const { music } = apple();
    const queries = musicQueries(music);
    for (const write of ["setSongRating", "deleteSongRating", "setLibraryPlaylistRating", "deleteLibraryAlbumRating"]) expect(Object.keys(queries.user), write).not.toContain(write);
    expectTypeOf(queries.user).not.toHaveProperty("setSongRating");
    expectTypeOf(queries.user).not.toHaveProperty("deleteSongRating");
    for (const view of ["getAlbumView", "getArtistView", "getPlaylistView", "getMusicVideoView", "getRecordLabelView"]) expect(Object.keys(queries.catalog), view).toContain(view);
    expectTypeOf(queries.catalog).toHaveProperty("getAlbumView");
    expectTypeOf(queries.catalog.getAlbumView("1", "other-versions").initialPageParam).toEqualTypeOf<string | undefined>();
  });

  test("a schema in the arguments is a marker in the key, and a signal or a function is nothing: the key is plain data", () => {
    const { music } = apple();
    const schema: tSchemaLike<tSongsResponse> = { "~standard": { validate: (value) => ({ value: value as tSongsResponse }) } };
    const key = musicQueries(music).catalog.getSong("1", { schema, signal: AbortSignal.timeout(1000), language: "fr" }).queryKey;
    expect(key).toEqual(["open-music-sdk", 0, "catalog", "getSong", "1", { schema: "schema", language: "fr" }]);
    expect(JSON.parse(JSON.stringify(key))).toEqual(key);
  });

  test("the scope is in every key, and no key holds a token", () => {
    const { music } = apple();
    const queries = musicQueries(music.as("s3cret-listener-token"), 7);
    expect(queries.catalog.getSong("1").queryKey[1]).toBe(7);
    expect(queries.user.listLibraryPlaylists().queryKey[1]).toBe(7);
    expect(JSON.stringify(queries.user.getLibrarySong("l.1").queryKey)).not.toContain("s3cret");
    expect(musicQueries(music, "me").catalog.getSong("1").queryKey[1]).toBe("me");
  });

  test.each<[string, unknown, unknown, string]>([
    ["no client", undefined, undefined, "musicQueries: client must be a client from createClient; got undefined"],
    ["a token where the client belongs", "dev", undefined, "musicQueries: client must be a client from createClient; got 3 characters"],
    ["a scope that is an object", "client", { generation: 1 }, "musicQueries: scope must be a string or a number, such as the provider's generation; got object"],
  ])("%s is a TypeError naming musicQueries", (_name, music, scope, message) => {
    const client = music === "client" ? apple().music : (music as tAppleMusicClient);
    expect(() => musicQueries(client, scope as number)).toThrow(new TypeError(message));
  });
});

describe("musicQueries: fits TanStack Query", () => {
  test("fetchQuery takes a query and fetchInfiniteQuery a walk, as useQuery and useInfiniteQuery would", async () => {
    const { music } = apple();
    const queries = musicQueries(music);
    const client = new QueryClient();
    expect(await client.query(queries.catalog.getSong("1"))).toEqual(SONG);
    const { pages } = await client.infiniteQuery({ ...queries.catalog.listGenres(), pages: 3 });
    expect(pages.map((page) => page.data.map((each) => each.id))).toEqual([["1"], ["2"], ["3"]]);
    expect(client.getQueryData(queries.catalog.getSong("1").queryKey)).toEqual(SONG);
    client.clear();
  });
});

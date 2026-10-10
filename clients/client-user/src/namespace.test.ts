import { createClient, isAppleMusicError, type tClientOptions } from "@open-music-sdk/core";
import type { tLibraryAlbum, tLibraryArtist, tLibraryMusicVideo, tLibraryPlaylist, tLibrarySearchResponse, tLibrarySong, tRating, tResource } from "@open-music-sdk/types";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import * as api from "./index";
import { user, type tUser, type tUserFunctions } from "./namespace";

/** One answer from Apple. */
interface tReply {
  status?: number;
  body?: unknown;
}

const song = (id: string) => ({ id, type: "library-songs", href: `/v1/me/library/songs/${id}` });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A listener's client over a fetch that answers from a queue of replies, then with an empty list, and records every Request it saw. */
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
    music: createClient({ developerToken: "dev", userToken: "listener", fetch, retry: false, ...options }),
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

describe("the listener's side for one client", () => {
  const declared = Object.entries(api)
    .filter(([, value]) => typeof (value as { bound?: unknown }).bound === "function")
    .map(([name]) => name);

  test("it holds every function the package exports, under the same name, and nothing else", () => {
    expect(Object.keys(user(apple().music)).sort()).toEqual(declared.sort());
    expect(declared).toHaveLength(79);
  });

  test("each of them is a function that needs no client", () => {
    for (const bound of Object.values(user(apple().music))) expect(bound).toBeTypeOf("function");
  });

  test("it cannot be changed: a function cannot be put in another's place, nor one added", () => {
    const mine = user(apple().music);
    expect(Object.isFrozen(mine)).toBe(true);
    expect(() => {
      (mine as { getLibrarySong: unknown }).getLibrarySong = () => undefined;
    }).toThrow(TypeError);
  });

  test("it does not hold itself: the function that makes it is not one of the listener's", () => {
    expect(user(apple().music)).not.toHaveProperty("user");
  });

  test.each<[string, unknown, string]>([
    ["nothing", undefined, "undefined"],
    ["the Music User Token, put where the client belongs", "listener", "8 characters"],
    ["options for a client, not a client", { developerToken: "dev", userToken: "listener" }, "object"],
    ["an object with only some of a client's methods", { request: () => undefined }, "object"],
  ])("made with %s, it is a TypeError naming user, there and then", (_name, client, what) => {
    expect(() => user(client as never)).toThrow(new TypeError(`user: client must be a client from createClient; got ${what}`));
  });

  test("it is the listener's whose client it was made with: two listeners' sides send their own tokens", async () => {
    const { music, userTokens } = apple();
    await user(music).getLibrarySongs(["i.1"]);
    await user(music.as("another")).getLibrarySongs(["i.1"]);
    expect(userTokens()).toEqual(["listener", "another"]);
  });

  test("made with a client that holds no listener's token, it is made, and each call is refused by the client before Apple is asked", async () => {
    const { music, calls } = apple([], { userToken: undefined });
    const error = await rejection(user(music).getLibrarySongs(["i.1"]));
    expect(isAppleMusicError(error, "UserTokenInvalid")).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("what its functions hand over", () => {
  test("a get of one resource, a create and a set give the resource", async () => {
    const answer = { body: { data: [song("i.1")] } };
    const { music } = apple([answer, { status: 201, ...answer }, answer]);
    expect(await user(music).getLibrarySong("i.1")).toEqual(song("i.1"));
    expect(await user(music).createLibraryPlaylist({ attributes: { name: "Road" } })).toEqual(song("i.1"));
    expect(await user(music).setSongRating("1", 1)).toEqual(song("i.1"));
  });

  test.each<[string, tReply]>([
    ["an empty list", { body: { data: [] } }],
    ["no data", { body: {} }],
    ["no body at all", { status: 204 }],
  ])("a get of one resource that Apple answers with %s is an ApiError with the status it came with, not undefined", async (_name, reply) => {
    const { music } = apple([reply]);
    const error = await rejection(user(music).getLibrarySong("i.1"));
    expect(isAppleMusicError(error, "ApiError")).toBe(true);
    expect(error.message).toBe("getLibrarySong: Apple answered with no resource");
    expect((error as { status?: number }).status).toBe(reply.status ?? 200);
  });

  test("a get of several gives the list, which is empty when Apple sends none", async () => {
    const { music } = apple([{ body: { data: [song("i.1"), song("i.2")] } }]);
    expect(await user(music).getLibrarySongs(["i.1", "i.2"])).toEqual([song("i.1"), song("i.2")]);
    expect(await user(music).getSongRatings(["1"])).toEqual([]);
  });

  test("a list gives every item of every page, asking for each page as the one before runs out, with the listener's token each time", async () => {
    const { music, sent, userTokens } = apple([{ body: { data: [song("i.1")], next: "/v1/me/library/songs?offset=1" } }, { body: { data: [song("i.2")], next: "/v1/me/library/songs?offset=2" } }, { body: { data: [song("i.3")] } }]);
    expect(await all(user(music).listLibrarySongs({ limit: 1 }))).toEqual([song("i.1"), song("i.2"), song("i.3")]);
    expect(sent()).toEqual(["GET /v1/me/library/songs?limit=1", "GET /v1/me/library/songs?offset=1", "GET /v1/me/library/songs?offset=2"]);
    expect(userTokens()).toEqual(["listener", "listener", "listener"]);
  });

  test("a list stops asking when the loop is left", async () => {
    const { music, calls } = apple([{ body: { data: [song("i.1"), song("i.2")], next: "/v1/me/library/songs?offset=2" } }, { body: { data: [song("i.3")] } }]);
    for await (const each of user(music).listLibrarySongs()) if (each.id === "i.1") break;
    expect(calls).toHaveLength(1);
  });

  test("a list and a relationship each ask for no more pages than maxPages says, and do not send it", async () => {
    const endless = () => Array.from({ length: 10 }, (_, index) => ({ body: { data: [song(`i.${String(index)}`)], next: `/v1/me/library/songs?offset=${String(index + 1)}` } }));
    for (const walk of [(mine: tUser) => mine.listLibrarySongs({ maxPages: 2 }), (mine: tUser) => mine.getLibraryPlaylistRelationship("p.1", "tracks", { maxPages: 2 }), (mine: tUser) => mine.listRecentlyPlayed({ maxPages: 2 })]) {
      const { music, calls } = apple(endless());
      expect(await all<unknown>(walk(user(music)))).toHaveLength(2);
      expect(calls.map((call) => new URL(call.url).search)).toEqual(["", "?offset=1"]);
    }
  });

  test("a maxPages that is no limit is a TypeError naming the function, thrown as it is called", () => {
    const { music, calls } = apple();
    expect(() => user(music).listLibrarySongs({ maxPages: 0 })).toThrow(new TypeError("listLibrarySongs: maxPages must be a whole number above 0; got 0"));
    expect(calls).toHaveLength(0);
  });

  test("a list asks for nothing until it is looped over, and can be looped over again", async () => {
    const { music, calls } = apple([{ body: { data: [song("i.1")] } }, { body: { data: [song("i.2")] } }]);
    const songs = user(music).listLibrarySongs();
    expect(calls).toHaveLength(0);
    expect([await all(songs), await all(songs)]).toEqual([[song("i.1")], [song("i.2")]]);
  });

  test("a relationship is walked as a list is", async () => {
    const { music, sent } = apple([{ body: { data: [song("i.1")], next: "/v1/me/library/playlists/p.1/tracks?offset=1" } }, { body: { data: [song("i.2")] } }]);
    expect(await all(user(music).getLibraryPlaylistRelationship("p.1", "tracks"))).toEqual([song("i.1"), song("i.2")]);
    expect(sent()).toEqual(["GET /v1/me/library/playlists/p.1/tracks", "GET /v1/me/library/playlists/p.1/tracks?offset=1"]);
  });

  test("what adds or deletes gives nothing", async () => {
    const { music } = apple([{ status: 204 }, { status: 202 }]);
    await expect(user(music).deleteSongRating("1")).resolves.toBeUndefined();
    await expect(user(music).addToLibrary({ songs: ["1"] })).resolves.toBeUndefined();
  });

  test("a mistake in what a function is handed is a TypeError naming the function, as it is with a client", async () => {
    const { music, calls } = apple();
    expect(await rejection(user(music).getLibrarySong(".."))).toEqual(new TypeError('getLibrarySong: id must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 2 characters'));
    expect(() => user(music).listLibrarySongs({ limit: 0 })).toThrow(new TypeError("listLibrarySongs: limit must be a whole number above 0; got 0"));
    expect(calls).toHaveLength(0);
  });
});

describe("the types: a function of the namespace takes what the package's takes, without the client", () => {
  const mine = user(apple().music);

  test("a get gives the resource, a get of several the list, and a list every item", () => {
    expectTypeOf(mine.getLibrarySong).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(mine.getLibrarySong).returns.resolves.toEqualTypeOf<tLibrarySong>();
    expectTypeOf(mine.getLibraryAlbums).returns.resolves.toEqualTypeOf<tLibraryAlbum[]>();
    expectTypeOf(mine.listLibraryPlaylists).returns.toEqualTypeOf<AsyncIterable<tLibraryPlaylist>>();
    expectTypeOf(mine.getLibraryResources).returns.resolves.toEqualTypeOf<tResource[]>();
    expectTypeOf(mine.setSongRating).returns.resolves.toEqualTypeOf<tRating | undefined>();
    expectTypeOf(mine.deleteSongRating).returns.resolves.toBeVoid();
  });

  test("a relationship's name still decides what comes back", () => {
    expectTypeOf(mine.getLibraryAlbumRelationship("l.1", "artists")).toEqualTypeOf<AsyncIterable<tLibraryArtist>>();
    expectTypeOf(mine.getLibraryAlbumRelationship("l.1", "tracks")).toEqualTypeOf<AsyncIterable<tLibraryMusicVideo | tLibrarySong>>();
    const wrong = [
      // @ts-expect-error -- a relationship a library album does not have, here as with a client
      () => mine.getLibraryAlbumRelationship("l.1", "composers"),
    ];
    expect(wrong).toHaveLength(1);
  });

  test("a search gives Apple's answer as it is", () => {
    expectTypeOf(mine.searchLibrary).returns.resolves.toEqualTypeOf<tLibrarySearchResponse>();
  });

  test("the namespace's type is the one the function gives", () => {
    expectTypeOf(mine).toEqualTypeOf<tUser>();
    expectTypeOf<keyof tUser>().toEqualTypeOf<Exclude<keyof typeof api, "user">>();
  });

  test("the interface the namespace is typed from names every function the package exports, each with the type it is declared with", () => {
    expectTypeOf<tUserFunctions>().toEqualTypeOf<Readonly<Omit<typeof api, "user">>>();
  });
});

describe("a function of the namespace says what the package's function says: an editor shows the same documentation for both", () => {
  const names = Object.entries(api)
    .filter(([, value]) => typeof (value as { bound?: unknown }).bound === "function")
    .map(([name]) => name);
  /** A module as an app would write one, never saved: read by the compiler as if it were beside this file. */
  const source = [
    'import type { tAppleMusicClient } from "@open-music-sdk/core";',
    'import * as api from "./index";',
    "declare const music: tAppleMusicClient;",
    "const bound = api.user(music);",
    ...names.flatMap((name) => [`export const direct_${name} = api.${name};`, `export const bound_${name} = bound.${name};`]),
    // A function named again with nothing written above the name: what each one is in the declarations a package is published with, where a module is a list of names.
    "const renamed = { getLibrarySong: api.getLibrarySong };",
    "export const lost = renamed.getLibrarySong;",
  ].join("\n");

  /** What an editor shows as the documentation of each name asked about, by the text the name ends. */
  function documentation(ends: readonly string[]): string[] {
    const slashed = (url: URL) => fileURLToPath(url).replace(/\\/g, "/");
    const root = slashed(new URL("..", import.meta.url)).replace(/\/$/, "");
    const probe = `${root}/src/hover.probe.ts`;
    const config = ts.getParsedCommandLineOfConfigFile(`${root}/tsconfig.json`, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
    const service = ts.createLanguageService({
      getCompilationSettings: () => config?.options ?? {},
      getScriptFileNames: () => [probe],
      getScriptVersion: () => "1",
      getScriptSnapshot: (name) => {
        const text = name === probe ? source : ts.sys.readFile(name);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => root,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (name) => name === probe || ts.sys.fileExists(name),
      readFile: (name) => (name === probe ? source : ts.sys.readFile(name)),
      readDirectory: (...args) => ts.sys.readDirectory(...args),
      directoryExists: (name) => ts.sys.directoryExists(name),
      getDirectories: (name) => ts.sys.getDirectories(name),
    });
    expect(service.getSemanticDiagnostics(probe)).toEqual([]);
    return ends.map((end) => ts.displayPartsToString(service.getQuickInfoAtPosition(probe, source.indexOf(end) + end.length - 1)?.documentation));
  }

  test("every one of the 79 is documented, and its documentation is there on the function of the namespace", { timeout: 120_000 }, () => {
    const direct = documentation(names.map((name) => `direct_${name} = api.${name}`));
    const ofTheNamespace = documentation(names.map((name) => `bound_${name} = bound.${name}`));
    expect(names.filter((_, index) => direct[index] === "")).toEqual([]);
    expect(ofTheNamespace).toEqual(direct);
    expect(names).toHaveLength(79);
  });

  test("the check that says so can tell: a function named again with nothing written above the name shows no documentation", { timeout: 120_000 }, () => {
    expect(documentation(["lost = renamed.getLibrarySong"])).toEqual([""]);
  });
});

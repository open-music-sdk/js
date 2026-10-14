import { createClient, isAppleMusicError, type tClientOptions } from "@open-music-sdk/core";
import type { tAlbum, tArtist, tChartResponse, tGenre, tMusicVideo, tResource, tSearchResponse, tSong } from "@open-music-sdk/types";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import * as api from "./index";
import { catalog, type tCatalog, type tCatalogFunctions } from "./namespace";

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

  test("a list, a relationship and a view each ask for no more pages than maxPages says, and do not send it", async () => {
    const endless = () => Array.from({ length: 10 }, (_, index) => ({ body: { data: [song(String(index))], next: `/v1/catalog/us/genres?offset=${String(index + 1)}` } }));
    for (const walk of [
      (music: tCatalog) => music.listGenres({ maxPages: 2 }),
      (music: tCatalog) => music.getAlbumRelationship("9", "tracks", { maxPages: 2 }),
      (music: tCatalog) => music.getAlbumView("9", "other-versions", { maxPages: 2 }),
    ]) {
      const { music, calls } = apple(endless());
      expect(await all<unknown>(walk(catalog(music)))).toHaveLength(2);
      expect(calls.map((call) => new URL(call.url).search)).toEqual(["", "?offset=1"]);
    }
  });

  test("a maxPages that is no limit is a TypeError naming the function, thrown as it is called", () => {
    const { music, calls } = apple();
    expect(() => catalog(music).listGenres({ maxPages: 0 })).toThrow(new TypeError("listGenres: maxPages must be a whole number above 0; got 0"));
    expect(() => catalog(music).getAlbumView("9", "other-versions", { maxPages: -1 })).toThrow(new TypeError("getAlbumView: maxPages must be a whole number above 0; got -1"));
    expect(calls).toHaveLength(0);
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
    expect(await rejection(catalog(music).getSong(".."))).toEqual(new TypeError('getSong: id must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 2 characters'));
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

  test("the interface the namespace is typed from names every function the package exports, each with the type it is declared with", () => {
    expectTypeOf<tCatalogFunctions>().toEqualTypeOf<Readonly<Omit<typeof api, "catalog">>>();
  });
});

describe("a function of the namespace says what the package's function says: an editor shows the same documentation for both", () => {
  const functions = Object.entries(api).filter(([, value]) => typeof (value as { bound?: unknown }).bound === "function") as [string, { readonly unwrap: string }][];
  const names = functions.map(([name]) => name);
  /** A module as an app would write one, never saved: read by the compiler as if it were beside this file. */
  const source = [
    'import type { tAppleMusicClient } from "@open-music-sdk/core";',
    'import * as api from "./index";',
    "declare const music: tAppleMusicClient;",
    "const bound = api.catalog(music);",
    ...names.flatMap((name) => [`export const direct_${name} = api.${name};`, `export const bound_${name} = bound.${name};`]),
    // A function named again with nothing written above the name: what each one is in the declarations a package is published with, where a module is a list of names.
    "const renamed = { getSong: api.getSong };",
    "export const lost = renamed.getSong;",
  ].join("\n");

  /** What an editor shows of each name asked about, by the text the name ends: its documentation, and each of its tags as `@name text`, flowed into one line as an editor flows it. */
  function shown(ends: readonly string[]): { readonly documentation: string; readonly tags: readonly string[] }[] {
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
    return ends.map((end) => {
      const info = service.getQuickInfoAtPosition(probe, source.indexOf(end) + end.length - 1);
      return { documentation: ts.displayPartsToString(info?.documentation), tags: (info?.tags ?? []).map((tag) => `@${tag.name} ${ts.displayPartsToString(tag.text)}`.replace(/\s+/g, " ").trimEnd()) };
    });
  }

  /** The documentation alone of each name asked about. */
  const documentation = (ends: readonly string[]): string[] => shown(ends).map((each) => each.documentation);

  test("every one of the 58 is documented, and its documentation is there on the function of the namespace", { timeout: 120_000 }, () => {
    const direct = documentation(names.map((name) => `direct_${name} = api.${name}`));
    const ofTheNamespace = documentation(names.map((name) => `bound_${name} = bound.${name}`));
    expect(names.filter((_, index) => direct[index] === "")).toEqual([]);
    expect(ofTheNamespace).toEqual(direct);
    expect(names).toHaveLength(58);
  });

  test("the check that says so can tell: a function named again with nothing written above the name shows no documentation", { timeout: 120_000 }, () => {
    expect(documentation(["lost = renamed.getSong"])).toEqual([""]);
  });

  test(
    "a member's tags are the function's less @function and the client, except what the bound form owns: its TypeError, about the arguments alone, and by its unwrap what it hands over and the AppleMusicError of unwrapping, each present, different, and saying what binding and unwrapping change",
    { timeout: 120_000 },
    () => {
      const direct = shown(names.map((name) => `direct_${name} = api.${name}`)).map((each) => each.tags);
      const ofTheNamespace = shown(names.map((name) => `bound_${name} = bound.${name}`)).map((each) => each.tags);
      /** The start of a tag that says which it is: `@returns`, or `@throws` and the error class it names. */
      const head = (tag: string) => /^@(?:returns|throws \w+)/.exec(tag)?.[0] ?? tag;
      /**
       * By `unwrap`, the tags the bound form says in its own words, and what each has to say: the rest are the function's,
       * word for word. A bound form was given its client when the namespace was made, so its TypeError is about the
       * arguments alone, whatever it hands over.
       */
      const MISTAKE = "if an argument is not what it should be";
      const own: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
        resource: { "@returns": ["out of `data`"], "@throws TypeError": [MISTAKE], "@throws AppleMusicError": ["`ApiError`"] },
        resources: { "@returns": ["out of `data`", "empty list"], "@throws TypeError": [MISTAKE], "@throws AppleMusicError": ["`ApiError`"] },
        pages: { "@returns": ["every page"], "@throws TypeError": [MISTAKE, "from the call itself"], "@throws AppleMusicError": ["`ApiError`"] },
        answer: { "@throws TypeError": [MISTAKE] },
      };
      /** Whether the bound form's tag is what the function's tag asks of it: the same, or its own and saying what it has to. */
      const said = (fn: string, bound: string, unwrap: string): boolean => {
        const phrases = own[unwrap]?.[head(fn)];
        if (phrases === undefined) return bound === fn;
        return bound !== fn && head(bound) === head(fn) && bound.length > head(fn).length + 1 && phrases.every((phrase) => bound.includes(phrase));
      };
      /** The names whose tags fail `holds`. */
      const failing = (holds: (fn: readonly string[], bound: readonly string[], unwrap: string) => boolean) => names.filter((_, index) => !holds(direct[index] ?? [], ofTheNamespace[index] ?? [], functions[index]?.[1].unwrap ?? ""));

      // The function is shown as one, its first argument is the client, and it names the four kinds it throws, in order.
      expect(failing((fn) => fn[0] === "@function" && fn[1] === "@param client - The client to ask with.")).toEqual([]);
      expect(failing((fn) => JSON.stringify(fn.filter((tag) => tag.startsWith("@throws ")).map(head)) === JSON.stringify(["@throws TypeError", "@throws AppleMusicError", "@throws The", "@throws Whatever"]))).toEqual([]);
      // The member: the function's tags less those two, one for one, each the same or the bound form's own.
      expect(failing((fn, bound, unwrap) => own[unwrap] !== undefined && bound.length === fn.length - 2 && fn.slice(2).every((tag, index) => said(tag, bound[index] ?? "", unwrap)))).toEqual([]);
      expect(names).toHaveLength(58);
    },
  );
});

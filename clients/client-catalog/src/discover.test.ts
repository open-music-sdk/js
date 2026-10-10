import { createClient, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import type { tChartResponse, tLangageTagResponse, tResource, tSearchHintsResponse, tSearchResponse, tSearchSuggestionsResponse, tStation } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import * as api from "./discover";

/** One answer from Apple. */
interface tReply {
  status?: number;
  body?: unknown;
}

const SECRET = "s3cretT0ken";
const LIST = "must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";
const TERM = "term must be a string of 1 to 256 characters; got ";
const STOREFRONT = 'storefront must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got ';

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

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

/** A call as a caller without the types could make it. */
type tLoose = (music: tAppleMusicClient, ...args: unknown[]) => Promise<unknown>;
const loose = (fn: unknown) => fn as tLoose;

describe("what Apple answers is what a function resolves to, called with a client or bound", () => {
  test.each<[string, tLoose, unknown[], unknown]>([
    ["searchCatalog", loose(api.searchCatalog), ["x", { types: ["songs"] }], { results: { songs: { data: [{ id: "1" }], next: "/v1/catalog/us/search?offset=1", href: "/v1/catalog/us/search" } } }],
    ["getSearchHints", loose(api.getSearchHints), ["x"], { results: { terms: ["x-ray", "xylophone"] } }],
    ["getSearchSuggestions", loose(api.getSearchSuggestions), ["x", { kinds: ["terms"] }], { results: { suggestions: [{ kind: "terms", searchTerm: "x-ray", displayTerm: "x-ray" }] } }],
    ["getCharts", loose(api.getCharts), [{ types: ["songs"] }], { results: { songs: [{ chart: "most-played", name: "Top Songs", data: [{ id: "1" }] }] } }],
    ["getLanguageTag", loose(api.getLanguageTag), [["fr"]], { results: { tag: "fr-FR" } }],
  ])("%s gives the answer as it is, which holds no data to hand over in its place", async (name, fn, args, answer) => {
    const { music } = apple([{ body: answer }, { body: answer }]);
    expect(await fn(music, ...args)).toEqual(answer);
    const bound = (api as unknown as Record<string, { bound: (client: tAppleMusicClient) => (...args: unknown[]) => Promise<unknown> }>)[name]?.bound(music);
    expect(await bound?.(...args)).toEqual(answer);
  });

  test("getCatalogResources and getLiveRadioStations resolve to the answer, and bound to the list it holds", async () => {
    const answer = { data: [{ id: "1", type: "songs" }, { id: "ra.1", type: "stations" }] };
    const { music } = apple(Array.from({ length: 4 }, () => ({ body: answer })));
    expect(await api.getCatalogResources(music, { songs: ["1"] })).toEqual(answer);
    expect(await api.getCatalogResources.bound(music)({ songs: ["1"] })).toEqual(answer.data);
    expect(await api.getLiveRadioStations(music)).toEqual(answer);
    expect(await api.getLiveRadioStations.bound(music)()).toEqual(answer.data);
  });
});

describe("what a function is handed is checked before Apple is asked, and a mistake names the function and the argument", () => {
  test.each<[string, tLoose, unknown[], string]>([
    ["searchCatalog: a term that is empty", loose(api.searchCatalog), ["", { types: ["songs"] }], `searchCatalog: ${TERM}0 characters`],
    ["searchCatalog: a term that is missing", loose(api.searchCatalog), [undefined, { types: ["songs"] }], `searchCatalog: ${TERM}undefined`],
    ["searchCatalog: a term that is a list", loose(api.searchCatalog), [["james"], { types: ["songs"] }], `searchCatalog: ${TERM}object`],
    ["searchCatalog: a term one character too long", loose(api.searchCatalog), ["t".repeat(257), { types: ["songs"] }], `searchCatalog: ${TERM}257 characters`],
    ["searchCatalog: no options, and so no types", loose(api.searchCatalog), ["x"], `searchCatalog: types ${LIST}undefined`],
    ["searchCatalog: options with no types", loose(api.searchCatalog), ["x", { limit: 5 }], `searchCatalog: types ${LIST}undefined`],
    ["searchCatalog: types that are one string", loose(api.searchCatalog), ["x", { types: "songs" }], `searchCatalog: types ${LIST}5 characters`],
    ["searchCatalog: types that are an empty list", loose(api.searchCatalog), ["x", { types: [] }], `searchCatalog: types ${LIST}a list of 0`],
    ["searchCatalog: a with that is an object", loose(api.searchCatalog), ["x", { types: ["songs"], with: {} }], `searchCatalog: with ${LIST}object`],
    ["searchCatalog: a with that is one string, not a list", loose(api.searchCatalog), ["x", { types: ["songs"], with: "topResults" }], `searchCatalog: with ${LIST}10 characters`],
    ["searchCatalog: options that are a list", loose(api.searchCatalog), ["x", ["songs"]], "searchCatalog: expected an options object; got a list"],
    ["searchCatalog: a storefront that is two dots", loose(api.searchCatalog), ["x", { types: ["songs"], storefront: ".." }], 'searchCatalog: storefront must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 2 characters'],
    ["getSearchHints: a term that is empty", loose(api.getSearchHints), [""], `getSearchHints: ${TERM}0 characters`],
    ["getSearchHints: a limit of zero", loose(api.getSearchHints), ["x", { limit: 0 }], "getSearchHints: limit must be a whole number above 0; got 0"],
    ["getSearchSuggestions: a term that is a number", loose(api.getSearchSuggestions), [5, { kinds: ["terms"] }], `getSearchSuggestions: ${TERM}5`],
    ["getSearchSuggestions: no kinds", loose(api.getSearchSuggestions), ["x", {}], `getSearchSuggestions: kinds ${LIST}undefined`],
    ["getSearchSuggestions: types that hold two in one", loose(api.getSearchSuggestions), ["x", { kinds: ["terms"], types: ["songs,albums"] }], `getSearchSuggestions: types ${LIST}12 characters at index 0`],
    ["getCharts: no options, and so no types", loose(api.getCharts), [], `getCharts: types ${LIST}undefined`],
    ["getCharts: a chart one character too long for a name", loose(api.getCharts), [{ types: ["songs"], chart: "c".repeat(65) }], "getCharts: chart must be a string of 1 to 64 characters; got 65 characters"],
    ["getCharts: a chart that is a number", loose(api.getCharts), [{ types: ["songs"], chart: 5 }], "getCharts: chart must be a string of 1 to 64 characters; got 5"],
    ["getCharts: a chart that is a list", loose(api.getCharts), [{ types: ["songs"], chart: ["most-played"] }], "getCharts: chart must be a string of 1 to 64 characters; got object"],
    ["getCharts: a genre that is true", loose(api.getCharts), [{ types: ["songs"], genre: true }], "getCharts: genre must be a string of 1 to 64 characters; got boolean"],
    ["getCharts: a with that is one string, not a list", loose(api.getCharts), [{ types: ["songs"], with: "cityCharts" }], `getCharts: with ${LIST}10 characters`],
    ["getSearchSuggestions: types that are one string, not a list", loose(api.getSearchSuggestions), ["x", { kinds: ["terms"], types: "songs" }], `getSearchSuggestions: types ${LIST}5 characters`],
    ["getCharts: a genre that is an object", loose(api.getCharts), [{ types: ["songs"], genre: {} }], "getCharts: genre must be a string of 1 to 64 characters; got object"],
    ["getCatalogResources: ids that are a list", loose(api.getCatalogResources), [["1"]], 'getCatalogResources: ids must be a plain object of ids by type, such as { songs: ["1"] }; got a list'],
    ["getCatalogResources: ids of no type", loose(api.getCatalogResources), [{}], "getCatalogResources: ids must hold the ids of 1 to 32 types; got 0"],
    ["getCatalogResources: a type's ids that are one string", loose(api.getCatalogResources), [{ songs: "1" }], `getCatalogResources: ids.songs ${LIST}1 characters`],
    ["getCatalogResources: a limit of zero", loose(api.getCatalogResources), [{ songs: ["1"] }, { limit: 0 }], "getCatalogResources: limit must be a whole number above 0; got 0"],
    ["getLiveRadioStations: options that are a string", loose(api.getLiveRadioStations), ["gb"], "getLiveRadioStations: expected an options object; got 2 characters"],
    ["getLanguageTag: languages that are one string", loose(api.getLanguageTag), ["fr"], `getLanguageTag: acceptLanguage ${LIST}2 characters`],
    ["getLanguageTag: no languages", loose(api.getLanguageTag), [[]], `getLanguageTag: acceptLanguage ${LIST}a list of 0`],
    ["getLanguageTag: a storefront that is empty", loose(api.getLanguageTag), [["fr"], { storefront: "" }], 'getLanguageTag: storefront must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 0 characters'],
    ["getSearchHints: a storefront that is two dots", loose(api.getSearchHints), ["x", { storefront: ".." }], `getSearchHints: ${STOREFRONT}2 characters`],
    ["getSearchSuggestions: a storefront that is a path", loose(api.getSearchSuggestions), ["x", { kinds: ["terms"], storefront: "us/x" }], `getSearchSuggestions: ${STOREFRONT}4 characters`],
    ["getCharts: a storefront that is a number", loose(api.getCharts), [{ types: ["songs"], storefront: 1 }], `getCharts: ${STOREFRONT}1`],
    ["getCharts: options that are a list", loose(api.getCharts), [["songs"]], "getCharts: expected an options object; got a list"],
    ["getCatalogResources: a storefront that is empty", loose(api.getCatalogResources), [{ songs: ["1"] }, { storefront: "" }], `getCatalogResources: ${STOREFRONT}0 characters`],
    ["getLiveRadioStations: a storefront that is two dots", loose(api.getLiveRadioStations), [{ storefront: ".." }], `getLiveRadioStations: ${STOREFRONT}2 characters`],
  ])("%s", async (_name, fn, args, message) => {
    const { music, calls } = apple();
    expect(await rejection(fn(music, ...args))).toEqual(new TypeError(message));
    expect(calls).toHaveLength(0);
  });

  test("a mistake is named in the order of the arguments: the term before the options", async () => {
    const { music } = apple();
    expect((await rejection(loose(api.searchCatalog)(music, "", { limit: 0 }))).message).toContain("searchCatalog: term ");
    expect((await rejection(loose(api.getCatalogResources)(music, {}, { limit: 0 }))).message).toContain("getCatalogResources: ids ");
    expect((await rejection(loose(api.getLanguageTag)(music, [], { storefront: "" }))).message).toContain("getLanguageTag: acceptLanguage ");
  });

  test("an argument is checked before the options are looked at at all: options that are no object do not hide an earlier mistake", async () => {
    const { music } = apple();
    expect((await rejection(loose(api.searchCatalog)(music, "", "songs"))).message).toContain("searchCatalog: term ");
    expect((await rejection(loose(api.getCatalogResources)(music, {}, "gb"))).message).toContain("getCatalogResources: ids ");
    expect((await rejection(loose(api.getLanguageTag)(music, [], "gb"))).message).toContain("getLanguageTag: acceptLanguage ");
    expect((await rejection(loose(api.searchCatalog)(music, "x", "songs"))).message).toBe("searchCatalog: expected an options object; got 5 characters");
  });

  test("a term of 256 characters, which is the most there may be, is sent: the check can tell", async () => {
    const { music, calls } = apple();
    await api.searchCatalog(music, "t".repeat(256), { types: ["songs"] });
    await api.getSearchHints(music, "t".repeat(256));
    expect(calls.map((call) => new URL(call.url).searchParams.get("term")?.length)).toEqual([256, 256]);
  });

  test("a mistake does not show a value: a token put where the term, a type or the ids belong", async () => {
    const token = `${SECRET}.${"p".repeat(260)}`;
    const { music, calls } = apple();
    const mistakes = [
      loose(api.searchCatalog)(music, token, { types: ["songs"] }),
      loose(api.searchCatalog)(music, "x", { types: [token] }),
      loose(api.getSearchHints)(music, token),
      loose(api.getCharts)(music, { types: token }),
      loose(api.getCatalogResources)(music, { [token]: ["1"] }),
      loose(api.getCatalogResources)(music, { songs: [token] }),
      loose(api.getLanguageTag)(music, [token]),
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
    const term = "a&types=albums #1 ?x=y/../é";
    await api.searchCatalog(music, term, { types: ["songs"] });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/catalog/us/search");
    expect([...url.searchParams]).toEqual([
      ["term", term],
      ["types", "songs"],
    ]);
    expect(url.hash).toBe("");
  });

  test("the term and the types a function is handed win over the same names among the caller's params", async () => {
    const { music, sent } = apple();
    await api.searchCatalog(music, "mine", { types: ["songs"], params: { term: "theirs", types: ["albums"], "fields[songs]": "name" } });
    expect(sent()).toEqual(["GET /v1/catalog/us/search?term=mine&types=songs&fields[songs]=name"]);
  });

  test("the ids are copied when the call is made: changing the caller's object afterwards changes nothing", async () => {
    const { music, sent } = apple();
    const songs = ["1"];
    const pending = api.getCatalogResources(music, { songs });
    songs.push("2");
    await pending;
    expect(sent()).toEqual(["GET /v1/catalog/us?ids[songs]=1"]);
  });

  test("a type whose ids are undefined is left out", async () => {
    const { music, sent } = apple();
    await api.getCatalogResources(music, { songs: ["1"], albums: undefined });
    expect(sent()).toEqual(["GET /v1/catalog/us?ids[songs]=1"]);
  });

  test("the live radio stations are always asked for by the one filter there is, whatever the caller's params say", async () => {
    const { music, sent } = apple();
    await api.getLiveRadioStations(music, { params: { "filter[featured]": "something-else" } });
    expect(sent()).toEqual(["GET /v1/catalog/us/stations?filter[featured]=apple-music-live-radio"]);
  });
});

describe("the types", () => {
  const { music } = apple();

  test("each function resolves to the answer Apple documents for it", () => {
    expectTypeOf(api.searchCatalog).returns.resolves.toEqualTypeOf<tSearchResponse>();
    expectTypeOf(api.getSearchHints).returns.resolves.toEqualTypeOf<tSearchHintsResponse>();
    expectTypeOf(api.getSearchSuggestions).returns.resolves.toEqualTypeOf<tSearchSuggestionsResponse>();
    expectTypeOf(api.getCharts).returns.resolves.toEqualTypeOf<tChartResponse>();
    expectTypeOf(api.getLanguageTag).returns.resolves.toEqualTypeOf<tLangageTagResponse>();
    expectTypeOf(api.getCatalogResources.bound(music)).returns.resolves.toEqualTypeOf<tResource[]>();
    expectTypeOf(api.getLiveRadioStations.bound(music)).returns.resolves.toEqualTypeOf<tStation[]>();
  });

  test("what does not fit does not compile", () => {
    const calls = [
      // @ts-expect-error -- a search has to say what types to look for
      () => api.searchCatalog(music, "x"),
      // @ts-expect-error -- and so the options cannot be without them
      () => api.searchCatalog(music, "x", { limit: 5 }),
      // @ts-expect-error -- top results are asked for with `with`, and are not a type
      () => api.searchCatalog(music, "x", { types: ["top"] }),
      // @ts-expect-error -- suggestions have to say what kinds to make
      () => api.getSearchSuggestions(music, "x", {}),
      // @ts-expect-error -- there are no charts of artists
      () => api.getCharts(music, { types: ["artists"] }),
      // @ts-expect-error -- a type the catalog does not have
      () => api.getCatalogResources(music, { "library-songs": ["i.1"] }),
      // @ts-expect-error -- ids are by type, not a list
      () => api.getCatalogResources(music, ["1"]),
      // @ts-expect-error -- the languages are a list, best first
      () => api.getLanguageTag(music, "fr"),
    ];
    expect(calls).toHaveLength(8);
  });
});

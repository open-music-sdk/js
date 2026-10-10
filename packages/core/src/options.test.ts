import { afterEach, describe, expect, test, vi } from "vitest";
import { createClient, type tSchemaLike } from "./client";
import { isAppleMusicError } from "./errors";
import { initOf, walkOf, type tReadOptions } from "./options";

const SECRET = "s3cretT0ken";
const noop = () => undefined;
const schema: tSchemaLike<unknown> = { "~standard": { validate: (value) => ({ value }) } };

/** What `fn` throws. A call that returns fails the test. */
const thrown = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error("expected a throw");
};

/** Options as a caller without the types could pass them. */
const loose = (options: unknown) => options as tReadOptions;

describe("initOf: with nothing given, nothing is sent", () => {
  test.each<[string, tReadOptions | undefined]>([
    ["no options", undefined],
    ["an empty bag", {}],
    ["every option undefined", { language: undefined, include: undefined, extend: undefined, limit: undefined, offset: undefined, params: undefined, schema: undefined, signal: undefined }],
    ["lists of nothing", { include: [], extend: [], params: {} }],
  ])("%s", (_name, options) => {
    expect(initOf("fn", options)).toEqual({ params: {}, schema: undefined, signal: undefined });
  });
});

describe("initOf: an option that is given reaches the query under Apple's name for it", () => {
  test.each<[tReadOptions, Record<string, unknown>]>([
    [{ language: "en-GB" }, { l: "en-GB" }],
    [{ include: ["albums", "artists"] }, { include: ["albums", "artists"] }],
    [{ extend: ["artistUrl"] }, { extend: ["artistUrl"] }],
    [{ limit: 1 }, { limit: 1 }],
    [{ limit: 25 }, { limit: 25 }],
    [{ offset: 0 }, { offset: 0 }],
    [{ offset: 50 }, { offset: 50 }],
    [{ offset: "MTAw" }, { offset: "MTAw" }],
    [
      { language: "fr", include: ["a"], extend: ["b"], limit: 2, offset: 4 },
      { l: "fr", include: ["a"], extend: ["b"], limit: 2, offset: 4 },
    ],
  ])("%j", (options, params) => {
    expect(initOf("fn", options).params).toEqual(params);
  });

  test("schema and signal are handed on as they are", () => {
    const { signal } = new AbortController();
    const init = initOf("fn", { schema, signal });
    expect(init.schema).toBe(schema);
    expect(init.signal).toBe(signal);
  });

  test.each<[string, AbortSignal]>([
    ["a controller's", new AbortController().signal],
    ["one already aborted", AbortSignal.abort()],
    ["one made of others", AbortSignal.any([new AbortController().signal])],
  ])("a signal, %s, is taken", (_name, signal) => {
    expect(initOf("fn", { signal }).signal).toBe(signal);
  });

  test("a schema that is a function is a schema all the same: it is known by what is under ~standard, as request knows it", () => {
    const callable: tSchemaLike<unknown> = Object.assign(() => "called as a function", { "~standard": { validate: (value: unknown) => ({ value }) } });
    expect(initOf("fn", { schema: callable }).schema).toBe(callable);
  });
});

describe("initOf: three things fill the query, and the later wins", () => {
  test("the caller's params are sent as given", () => {
    const params = { "fields[songs]": "name", platform: "web", explicit: false, year: 2020, ids: [1, "2"], empty: "" };
    expect(initOf("fn", { params }).params).toEqual(params);
  });

  test("null, undefined and a list of nothing in params mean absent", () => {
    expect(initOf("fn", { params: { a: null, b: undefined, c: [], d: "kept" } }).params).toEqual({ d: "kept" });
  });

  test("an option that is given wins over the same key in params", () => {
    const options: tReadOptions = { language: "en", limit: 5, include: ["a"], extend: ["b"], offset: 7, params: { l: "fr", limit: 9, include: ["z"], extend: ["y"], offset: 1, other: "kept" } };
    expect(initOf("fn", options).params).toEqual({ l: "en", limit: 5, include: ["a"], extend: ["b"], offset: 7, other: "kept" });
  });

  test("an option that is not given leaves the same key in params alone", () => {
    expect(initOf("fn", { language: undefined, include: [], params: { l: "fr", include: ["z"] } }).params).toEqual({ l: "fr", include: ["z"] });
  });

  test("what the function sets wins over both", () => {
    const init = initOf("fn", { limit: 5, include: ["a"], params: { ids: ["9"], limit: 1 } }, { ids: ["1", "2"], limit: 3, include: ["tracks"] });
    expect(init.params).toEqual({ ids: ["1", "2"], limit: 3, include: ["tracks"] });
  });

  test("what the function leaves undefined or null wins over nothing", () => {
    expect(initOf("fn", { language: "en", params: { views: ["kept"] } }, { l: undefined, views: null }).params).toEqual({ l: "en", views: ["kept"] });
  });
});

describe("initOf: a further option is sent only by a function that names it, and is held to what the function says it is", () => {
  const options = loose({ views: ["top-songs", "singles"], chart: "most-played", genre: "20" });
  const kinds = { views: "list", chart: "name", genre: "name" } as const;
  const LIST = "must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";

  test("named, it is sent under its own name: a list as a list, and a name as it is", () => {
    expect(initOf("fn", options, {}, kinds).params).toEqual({ views: ["top-songs", "singles"], chart: "most-played", genre: "20" });
  });

  test("not named, it is not sent: an option a function does not take cannot reach Apple by being passed", () => {
    expect(initOf("fn", options).params).toEqual({});
    expect(initOf("fn", options, {}, { views: "list" }).params).toEqual({ views: ["top-songs", "singles"] });
  });

  test("it wins over params, and loses to what the function sets", () => {
    expect(initOf("fn", loose({ views: ["a"], params: { views: ["z"] } }), {}, { views: "list" }).params).toEqual({ views: ["a"] });
    expect(initOf("fn", loose({ views: ["a"] }), { views: ["set"] }, { views: "list" }).params).toEqual({ views: ["set"] });
    expect(initOf("fn", loose({ chart: "mine", params: { chart: "theirs" } }), {}, { chart: "name" }).params).toEqual({ chart: "mine" });
  });

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["a list of nothing", []],
  ])("a list that is %s is not given, and leaves params alone", (_name, views) => {
    expect(initOf("fn", loose({ views, params: { views: ["z"] } }), {}, { views: "list" }).params).toEqual({ views: ["z"] });
  });

  test("a name that is undefined is not given, and leaves params alone", () => {
    expect(initOf("fn", loose({ chart: undefined, params: { chart: "z" } }), {}, { chart: "name" }).params).toEqual({ chart: "z" });
  });

  test.each<[string, unknown, string]>([
    ["null", null, "null"],
    ["one string, which is not a list of one", "top-songs", "9 characters"],
    ["one string that holds two, which would be sent as two", "top-songs,singles", "17 characters"],
    ["a number", 5, "5"],
    ["true", true, "boolean"],
    ["an object", { name: "top-songs" }, "object"],
    ["a function", noop, "function"],
    ["a list holding a number", ["a", 2], "2 at index 1"],
    ["a list holding two in one", ["a,b"], "3 characters at index 0"],
  ])("where a list was declared, %s is a TypeError naming the function and the option", (_name, views, what) => {
    expect(thrown(() => initOf("getArtist", loose({ views }), {}, { views: "list" }))).toEqual(new TypeError(`getArtist: views ${LIST}${what}`));
  });

  test.each<[string, unknown, string]>([
    ["null", null, "null"],
    ["an empty string", "", "0 characters"],
    ["a string one character too long", "s".repeat(65), "65 characters"],
    ["a number", 5, "5"],
    ["true", true, "boolean"],
    ["a list, though it holds one name", ["most-played"], "object"],
    ["an object", { name: "most-played" }, "object"],
  ])("where a name was declared, %s is a TypeError naming the function and the option", (_name, chart, what) => {
    expect(thrown(() => initOf("getCharts", loose({ chart }), {}, { chart: "name" }))).toEqual(new TypeError(`getCharts: chart must be a string of 1 to 64 characters; got ${what}`));
  });

  test("a name is sent as it is, so one that holds a comma arrives as one value and not as two", () => {
    expect(initOf("fn", loose({ chart: "a,b" }), {}, { chart: "name" }).params).toEqual({ chart: "a,b" });
  });

  test.each<[string, unknown, string]>([
    ["true, as a declaration once said it", true, "boolean"],
    ["a kind there is not", "number", "6 characters"],
    ["undefined", undefined, "undefined"],
  ])("an option declared as %s is the declaration's mistake, and is said to be", (_name, kind, what) => {
    expect(thrown(() => initOf("getArtist", loose({ views: ["a"] }), {}, { views: kind } as never))).toEqual(new TypeError(`getArtist: its option views has to be declared a "list" or a "name"; got ${what}`));
  });
});

describe("initOf: what it gives is this call's own", () => {
  test("a list is copied, so changing the caller's afterwards changes nothing", () => {
    const include = ["albums"];
    const ids = ["1"];
    const params = { ids };
    const init = initOf("fn", { include, params });
    include.push("artists");
    ids.push("2");
    Object.assign(params, { added: "later" });
    expect(init.params).toEqual({ include: ["albums"], ids: ["1"] });
  });

  test("each option is read once, so what was checked is what is sent", () => {
    const values: Record<string, unknown> = { language: "en", include: ["a"], extend: ["b"], limit: 1, offset: 2, params: { x: 1 }, schema, signal: new AbortController().signal, views: ["v"] };
    const reads: string[] = [];
    const options = new Proxy(values, {
      get: (target, key) => {
        reads.push(String(key));
        return target[String(key)];
      },
    });
    initOf("fn", loose(options), {}, { views: "list" });
    expect(reads.sort()).toEqual(Object.keys(values).sort());
  });

  test("so is each of the caller's params", () => {
    const read = vi.fn(() => "web");
    initOf("fn", { params: Object.defineProperty({}, "platform", { get: read, enumerable: true }) });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("a list given an iterator of its own is read by its length, as an option and among the params", () => {
    const odd = () =>
      Object.defineProperty(["albums"], Symbol.iterator, {
        value: function* () {
          for (let i = 0; i < 5000; i++) yield String(i);
        },
      });
    expect(initOf("fn", { include: odd(), params: { ids: odd() } }).params).toEqual({ include: ["albums"], ids: ["albums"] });
  });

  test("a list is asked how long it is once, as an option and among the params", () => {
    const counted = () => {
      const asked = { times: 0 };
      const list = new Proxy(["a"], {
        get: (target, key, receiver) => {
          if (key === "length") asked.times++;
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      return { list, asked };
    };
    const [include, ids, none] = [counted(), counted(), counted()];
    none.list.pop();
    none.asked.times = 0;
    initOf("fn", { include: include.list, extend: none.list, params: { ids: ids.list } });
    expect([include.asked.times, ids.asked.times, none.asked.times]).toEqual([1, 1, 1]);
  });

  test("a parameter named __proto__, as JSON can name one, is no parameter's name: it is refused, and nothing comes to inherit from it", () => {
    const params = JSON.parse('{"__proto__": ["polluted"], "x": 1}') as Record<string, string[] | number>;
    expect(thrown(() => initOf("fn", { params })).message).toContain("params holds a name that is not a parameter's");
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(initOf("fn", { params: { x: 1 } }).params)).toBe(Object.prototype);
  });
});

describe("initOf: an option is one the caller passed, never one found on Object.prototype", () => {
  /** Runs `run` while `Object.prototype` carries `planted`, as it would after some other code had polluted it. */
  function polluted<T>(planted: Record<string, unknown>, run: () => T): T {
    Object.assign(Object.prototype, planted);
    try {
      return run();
    } finally {
      for (const key of Object.keys(planted)) Reflect.deleteProperty(Object.prototype, key);
    }
  }
  const planted = { language: "fr", include: ["planted"], extend: ["planted"], limit: 9, offset: 9, params: { planted: 1 }, schema, views: ["planted"] };

  test.each<[string, tReadOptions | undefined]>([
    ["no options", undefined],
    ["an empty bag", {}],
  ])("with every option planted there, a call with %s still sends nothing", (_name, options) => {
    expect(polluted(planted, () => initOf("fn", options, {}, { views: "list" }))).toEqual({ params: {}, schema: undefined, signal: undefined });
  });

  test("an option the caller did pass is the one sent, beside planted ones that are not", () => {
    expect(polluted(planted, () => initOf("fn", { limit: 2 }, {}, { views: "list" })).params).toEqual({ limit: 2 });
  });

  test("the check that says so can tell: an ordinary object does appear to hold what was planted", () => {
    expect(polluted(planted, () => ({} as tReadOptions).limit)).toBe(9);
  });

  test("an object that inherits its options from another is no plain object, so nothing it inherits is taken for passed: it is refused", () => {
    const options = Object.assign(Object.create({ limit: 9, params: { inherited: 1 } }) as tReadOptions, { language: "en-GB" });
    expect(thrown(() => initOf("fn", options)).message).toBe("fn: expected an options object; got an object that is not a plain one");
  });
});

describe("initOf: what it is handed is checked, and a mistake names the function and the option", () => {
  const LIST = "must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";
  const PARAM =
    "getSong: params.a must be a string of at most 256 characters, a number, true or false, or a list of at most 300 numbers and strings, each string of 1 to 64 characters with no comma in it; got ";
  const PLAIN = "getSong: params must be a plain object of query parameters; got ";
  const KEY =
    'getSong: params holds a name that is not a parameter\'s, which is letters, digits, "-", "_", "." and ":", with any part in brackets after, as in ids[albums], and at most 64 characters; got ';
  class Options {
    limit = 5;
  }

  test.each<[string, unknown, string]>([
    ["options that are null", null, "getSong: expected an options object; got null"],
    ["options that are a string", "en-GB", "getSong: expected an options object; got 5 characters"],
    ["options that are a number", 25, "getSong: expected an options object; got 25"],
    ["options that are a list", [{ limit: 5 }], "getSong: expected an options object; got a list"],
    ["options that are a Map", new Map([["limit", 5]]), "getSong: expected an options object; got an object that is not a plain one"],
    ["options that are a class's instance", new Options(), "getSong: expected an options object; got an object that is not a plain one"],
    ["an empty language", { language: "" }, "getSong: language must be a string of 1 to 64 characters; got 0 characters"],
    ["a language one character too long", { language: "l".repeat(65) }, "getSong: language must be a string of 1 to 64 characters; got 65 characters"],
    ["a language that is null", { language: null }, "getSong: language must be a string of 1 to 64 characters; got null"],
    ["a language that is a list", { language: ["en"] }, "getSong: language must be a string of 1 to 64 characters; got object"],
    ["include as one string", { include: "albums" }, `getSong: include ${LIST}6 characters`],
    ["include holding a number", { include: [1] }, `getSong: include ${LIST}1 at index 0`],
    ["include holding two in one", { include: ["albums,artists"] }, `getSong: include ${LIST}14 characters at index 0`],
    ["include that is null", { include: null }, `getSong: include ${LIST}null`],
    ["extend as one string", { extend: "artistUrl" }, `getSong: extend ${LIST}9 characters`],
    ["a limit of zero", { limit: 0 }, "getSong: limit must be a whole number above 0; got 0"],
    ["a limit below zero", { limit: -1 }, "getSong: limit must be a whole number above 0; got -1"],
    ["a limit that is not whole", { limit: 1.5 }, "getSong: limit must be a whole number above 0; got 1.5"],
    ["a limit that is not a number", { limit: Number.NaN }, "getSong: limit must be a whole number above 0; got NaN"],
    ["a limit past what a number can count", { limit: 2 ** 53 }, `getSong: limit must be a whole number above 0; got ${String(2 ** 53)}`],
    ["a limit as a string", { limit: "25" }, "getSong: limit must be a whole number above 0; got 2 characters"],
    ["a limit that is null", { limit: null }, "getSong: limit must be a whole number above 0; got null"],
    ["an offset below zero", { offset: -1 }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got -1"],
    ["an offset that is not whole", { offset: 0.5 }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got 0.5"],
    ["an offset past what a number can count", { offset: 2 ** 53 }, `getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got ${String(2 ** 53)}`],
    ["an offset that is not a number", { offset: Number.NaN }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got NaN"],
    ["an empty cursor", { offset: "" }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got 0 characters"],
    ["a cursor one character too long", { offset: "c".repeat(257) }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got 257 characters"],
    ["an offset that is null", { offset: null }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got null"],
    ["params that are null", { params: null }, `${PLAIN}null`],
    ["params as a query string", { params: "a=b" }, `${PLAIN}3 characters`],
    ["params as a list", { params: ["a"] }, `${PLAIN}a list`],
    ["params as a function", { params: noop }, `${PLAIN}function`],
    ["params as a URLSearchParams, which would be read as none", { params: new URLSearchParams("a=1") }, `${PLAIN}an object that is not a plain one`],
    ["params as a Map, which would be read as none", { params: new Map([["a", 1]]) }, `${PLAIN}an object that is not a plain one`],
    ["params as bytes, which would be read as one for each", { params: new Uint8Array(4) }, `${PLAIN}an object that is not a plain one`],
    ["params as a class's instance", { params: new Options() }, `${PLAIN}an object that is not a plain one`],
    ["a param with no name", { params: { "": 1 } }, `${KEY}0 characters`],
    ["a param whose name is one character too long", { params: { ["a".repeat(65)]: 1 } }, `${KEY}65 characters`],
    ["a param whose name has a line break in it", { params: { "a\nERROR forged": 1 } }, `${KEY}14 characters`],
    ["a param whose name has a space in it", { params: { "a b": 1 } }, `${KEY}3 characters`],
    ["a param whose name is two parameters", { params: { "a=1&b": 1 } }, `${KEY}5 characters`],
    ["a param whose name starts with a bracket", { params: { "[albums]": 1 } }, `${KEY}8 characters`],
    ["a param whose name starts with a digit", { params: { "1a": 1 } }, `${KEY}2 characters`],
    ["a param whose name has a bracket left open", { params: { "ids[albums": 1 } }, `${KEY}10 characters`],
    ["a param whose name has nothing in its brackets", { params: { "ids[]": 1 } }, `${KEY}5 characters`],
    ["a param whose name goes on after its brackets", { params: { "ids[albums]x": 1 } }, `${KEY}12 characters`],
    ["a param whose name is not ASCII", { params: { "idé": 1 } }, `${KEY}3 characters`],
    ["a param whose name is bad, though its value is absent", { params: { "a b": undefined } }, `${KEY}3 characters`],
    ["a param that is text one character too long", { params: { a: "t".repeat(257) } }, `${PARAM}257 characters`],
    ["a param list holding an empty string", { params: { a: ["1", ""] } }, `${PARAM}object`],
    ["a param list holding two in one", { params: { a: ["1,2"] } }, `${PARAM}object`],
    ["a param list holding a string one character too long", { params: { a: ["i".repeat(65)] } }, `${PARAM}object`],
    ["a param that is an object", { params: { a: {} } }, `${PARAM}object`],
    ["a param that is not a number", { params: { a: Number.NaN } }, `${PARAM}NaN`],
    ["a param that is a function", { params: { a: noop } }, `${PARAM}function`],
    ["a param that is a symbol", { params: { a: Symbol("a") } }, `${PARAM}symbol`],
    ["a param list holding an object", { params: { a: [1, {}] } }, `${PARAM}object`],
    ["a param list holding a list", { params: { a: [["1"]] } }, `${PARAM}object`],
    ["a param list holding true", { params: { a: [true] } }, `${PARAM}object`],
    ["a param list holding what is not a number", { params: { a: [1, Number.NaN] } }, `${PARAM}object`],
    ["a param list holding infinity", { params: { a: [Number.POSITIVE_INFINITY] } }, `${PARAM}object`],
    ["a param that is infinity", { params: { a: Number.NEGATIVE_INFINITY } }, `${PARAM}-Infinity`],
    ["a param list one item too long", { params: { a: Array.from({ length: 301 }, () => "1") } }, `${PARAM}object`],
    ["a schema with nothing in it", { schema: {} }, 'getSong: schema must be a Standard Schema, with a validate function under "~standard"; got object'],
    ["a schema whose validate is no function", { schema: { "~standard": { validate: "yes" } } }, 'getSong: schema must be a Standard Schema, with a validate function under "~standard"; got object'],
    ["a schema that is a function with nothing under ~standard", { schema: noop }, 'getSong: schema must be a Standard Schema, with a validate function under "~standard"; got function'],
    ["a schema whose ~standard is itself a function", { schema: { "~standard": Object.assign(noop, { validate: noop }) } }, 'getSong: schema must be a Standard Schema, with a validate function under "~standard"; got object'],
    ["a schema whose ~standard is null", { schema: { "~standard": null } }, 'getSong: schema must be a Standard Schema, with a validate function under "~standard"; got object'],
    ["a schema that is null", { schema: null }, 'getSong: schema must be a Standard Schema, with a validate function under "~standard"; got null'],
    ["a signal that is null", { signal: null }, "getSong: signal must be an AbortSignal; got null"],
    ["a signal that is an empty object, as one parsed from JSON is", { signal: {} }, "getSong: signal must be an AbortSignal; got object"],
    ["a signal that only looks like one", { signal: { aborted: false, reason: undefined, throwIfAborted: noop, addEventListener: noop, removeEventListener: noop } }, "getSong: signal must be an AbortSignal; got object"],
    ["a controller where its signal belongs", { signal: new AbortController() }, "getSong: signal must be an AbortSignal; got object"],
    ["a signal that is true", { signal: true }, "getSong: signal must be an AbortSignal; got boolean"],
  ])("%s", (_name, options, message) => {
    const error = thrown(() => initOf("getSong", loose(options)));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(message);
  });

  test("a hundred params are taken, and one more is not", () => {
    const params = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${String(i)}`, i]));
    expect(Object.keys(initOf("fn", { params: params(100) }).params ?? {})).toHaveLength(100);
    expect(thrown(() => initOf("getSong", { params: params(101) })).message).toBe("getSong: params must hold at most 100 parameters; got 101");
  });

  test("a param list of three hundred is taken, and one of three hundred and one is not", () => {
    const list = (length: number) => Array.from({ length }, (_, i) => i);
    expect(initOf("fn", { params: { ids: list(300) } }).params).toEqual({ ids: list(300) });
    expect(() => initOf("fn", { params: { ids: list(301) } })).toThrow(TypeError);
  });

  test.each(["l", "include", "ids[library-playlist-folders]", "filter[storefront-chart]", "acceptLanguage", "limit[songs:tracks]", "fields[albums]", "art[url]", "a.b_c-d:e9", "a[b][c]", "n".repeat(64)])(
    "a param named as Apple names them, %s, is sent under that name",
    (name) => {
      expect(initOf("fn", { params: { [name]: 1 } }).params).toEqual({ [name]: 1 });
    },
  );

  test("text of 256 characters is taken, and a list's strings of 64", () => {
    const params = { term: "t".repeat(256), ids: ["i".repeat(64), 5] };
    expect(initOf("fn", { params }).params).toEqual(params);
  });

  test("an empty string is text, and is sent as it is", () => {
    expect(initOf("fn", { params: { term: "" } }).params).toEqual({ term: "" });
  });

  test("a name that fits is named in the error about its value, and one that does not is only described", () => {
    expect(thrown(() => initOf("getSong", loose({ params: { "ids[albums]": {} } }))).message).toContain("getSong: params.ids[albums] must be");
    const token = `${"h".repeat(60)}.${"p".repeat(80)}.${"s".repeat(86)}`;
    const error = thrown(() => initOf("getSong", { params: { [token]: 1 } }));
    expect(error.message).toBe(`${KEY}228 characters`);
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(token);
  });

  test("params that are no plain object are refused before anything of them is read", () => {
    const ownKeys = vi.fn((target: Uint8Array) => Reflect.ownKeys(target));
    const get = vi.fn((target: Uint8Array, key: string | symbol): unknown => Reflect.get(target, key));
    const bytes: unknown = new Proxy(new Uint8Array(8), { ownKeys, get });
    expect(() => initOf("fn", loose({ params: bytes }))).toThrow(TypeError);
    expect([ownKeys.mock.calls.length, get.mock.calls.length]).toEqual([0, 0]);
  });

  test("a param list too long is not read: its length is all that is asked for", () => {
    const read = vi.fn();
    const long = new Proxy(Array.from({ length: 301 }, () => "1"), {
      get: (target, key, receiver) => {
        if (typeof key === "string" && /^\d+$/.test(key)) read(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(() => initOf("fn", { params: { ids: long } })).toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();
  });

  test.each<[string, unknown]>([
    ["options", SECRET],
    ["language", { language: `${SECRET}${"x".repeat(300)}` }],
    ["include", { include: SECRET }],
    ["an item of include", { include: [`${SECRET},${SECRET}`] }],
    ["limit", { limit: SECRET }],
    ["offset", { offset: `${SECRET}${"x".repeat(300)}` }],
    ["params", { params: SECRET }],
    ["a param", { params: { a: { token: SECRET } } }],
    ["schema", { schema: SECRET }],
    ["signal", { signal: SECRET }],
    ["a signal that only looks like one", { signal: { token: SECRET, aborted: false, throwIfAborted: noop } }],
  ])("a mistake in %s does not show the value", (_name, options) => {
    const error = thrown(() => initOf("getSong", loose(options)));
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
  });

  test("nothing is called on a value that is wrong: it is not asked to become a string", () => {
    const asked = vi.fn(() => SECRET);
    const odd = { toString: asked, valueOf: asked, toJSON: asked, [Symbol.toPrimitive]: asked };
    for (const options of [{ language: odd }, { limit: odd }, { offset: odd }, { include: [odd] }, { params: { a: odd } }]) thrown(() => initOf("fn", loose(options)));
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("walkOf: the options of a function that walks pages", () => {
  test("it gives what initOf gives, and the most pages the walk may ask for when the caller named one", () => {
    const options = { language: "en-GB", limit: 5, params: { "fields[songs]": "name" } };
    expect(walkOf("fn", { ...options, maxPages: 3 }, { ids: ["1"] }, {})).toEqual({ ...initOf("fn", options, { ids: ["1"] }), maxPages: 3 });
  });

  test.each<[string, object | undefined]>([
    ["no options", undefined],
    ["no limit among the options", { limit: 5 }],
    ["a limit that is undefined", { maxPages: undefined }],
  ])("with %s, it gives no limit at all, so a walk goes on to the last page", (_name, options) => {
    expect(walkOf("fn", options)).not.toHaveProperty("maxPages");
    expect(walkOf("fn", options)).toEqual(initOf("fn", options));
  });

  test("a further option the function names is sent, as with initOf", () => {
    expect(walkOf("fn", loose({ views: ["top-songs"], maxPages: 2 }), {}, { views: "list" })).toMatchObject({ params: { views: ["top-songs"] }, maxPages: 2 });
  });

  test("the limit is not a parameter: it is never among what is sent", () => {
    expect(walkOf("fn", { maxPages: 2 }).params).toEqual({});
  });

  test.each<[string, unknown, string]>([
    ["zero", 0, "0"],
    ["below zero", -1, "-1"],
    ["not whole", 1.5, "1.5"],
    ["not a number", Number.NaN, "NaN"],
    ["without end", Number.POSITIVE_INFINITY, "Infinity"],
    ["a string", "2", "1 characters"],
    ["null", null, "null"],
  ])("a limit that is %s is a TypeError naming the function and the option", (_name, maxPages, what) => {
    expect(thrown(() => walkOf("listGenres", loose({ maxPages })))).toEqual(new TypeError(`listGenres: maxPages must be a whole number above 0; got ${what}`));
  });

  test("the other options are checked as initOf checks them, under the function's name", () => {
    expect(thrown(() => walkOf("listGenres", { limit: 0, maxPages: 2 })).message).toBe("listGenres: limit must be a whole number above 0; got 0");
    expect(thrown(() => walkOf("listGenres", loose([]))).message).toBe("listGenres: expected an options object; got a list");
  });

  test("initOf itself takes no notice of a limit: a function that asks for one thing has no walk to hold", () => {
    expect(initOf("fn", loose({ maxPages: 0 }))).toEqual({ params: {}, schema: undefined, signal: undefined });
  });
});

describe("initOf: what it gives is what request takes", () => {
  /** Every Response the fake Apple handed out, so the suite can insist each body was read. */
  const responses: Response[] = [];

  /** A client over a fetch that answers every request with `body` and records the Request it saw. */
  function client(body: unknown = { data: [] }) {
    const calls: Request[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      calls.push(input instanceof Request ? input : new Request(input));
      const res = new Response(JSON.stringify(body));
      responses.push(res);
      return Promise.resolve(res);
    };
    return { music: createClient({ developerToken: "dev", fetch, retry: false }), calls };
  }

  afterEach(() => {
    // An unread body holds its connection until garbage collection, so no code path may drop one.
    expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
    responses.length = 0;
  });

  test("the query Apple sees is the one built here", async () => {
    const { music, calls } = client();
    const options: tReadOptions = { language: "en-GB", include: ["albums", "artists"], limit: 2, params: { "fields[songs]": "name", l: "fr" } };
    await music.request("v1/catalog/us/songs", initOf("getSongs", options, { ids: ["1", "2"] }));
    expect([...new URL(calls[0]?.url ?? "").searchParams]).toEqual([
      ["fields[songs]", "name"],
      ["l", "en-GB"],
      ["include", "albums,artists"],
      ["limit", "2"],
      ["ids", "1,2"],
    ]);
  });

  test("the schema is the one the answer is held to", async () => {
    const { music } = client({ data: "not a list" });
    const failing: tSchemaLike<never> = { "~standard": { validate: () => ({ issues: [{ message: "expected a list", path: ["data"] }] }) } };
    const error: unknown = await music.request("v1/catalog/us/songs", initOf("getSongs", { schema: failing })).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ValidationError")).toBe(true);
  });

  test("a schema that is a function is the one the answer is held to, here as it is when handed to request itself", async () => {
    const issues = [{ message: "expected a list", path: ["data"] }];
    const callable: tSchemaLike<never> = Object.assign(() => undefined, { "~standard": { validate: () => ({ issues }) } });
    for (const init of [{ schema: callable }, initOf<never>("getSongs", { schema: callable })]) {
      const { music } = client({ data: "not a list" });
      const error: unknown = await music.request("v1/catalog/us/songs", init).catch((e: unknown) => e);
      expect(isAppleMusicError(error, "ValidationError")).toBe(true);
    }
  });

  test("the signal is the one that aborts the request", async () => {
    const { music, calls } = client();
    const reason = new Error("stopped");
    await expect(music.request("v1/catalog/us/songs", initOf("getSongs", { signal: AbortSignal.abort(reason) }))).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
  });
});

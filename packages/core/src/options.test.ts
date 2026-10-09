import { afterEach, describe, expect, test, vi } from "vitest";
import { createClient, type tSchemaLike } from "./client";
import { isAppleMusicError } from "./errors";
import { initOf, type tReadOptions } from "./options";

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

describe("initOf: a further option is sent only by a function that names it", () => {
  const options = loose({ views: ["top-songs", "singles"], with: "attributes", restrict: true, count: 3 });

  test("named, it is sent under its own name: one value or a list of them", () => {
    expect(initOf("fn", options, {}, ["views", "with", "restrict", "count"]).params).toEqual({ views: ["top-songs", "singles"], with: "attributes", restrict: true, count: 3 });
  });

  test("not named, it is not sent: an option a function does not take cannot reach Apple by being passed", () => {
    expect(initOf("fn", options).params).toEqual({});
    expect(initOf("fn", options, {}, ["views"]).params).toEqual({ views: ["top-songs", "singles"] });
  });

  test("it wins over params, and loses to what the function sets", () => {
    expect(initOf("fn", loose({ views: ["a"], params: { views: ["z"] } }), {}, ["views"]).params).toEqual({ views: ["a"] });
    expect(initOf("fn", loose({ views: ["a"] }), { views: ["set"] }, ["views"]).params).toEqual({ views: ["set"] });
  });

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["a list of nothing", []],
  ])("%s is not given, and leaves params alone", (_name, views) => {
    expect(initOf("fn", loose({ views, params: { views: ["z"] } }), {}, ["views"]).params).toEqual({ views: ["z"] });
  });

  test.each<[string, unknown, string]>([
    ["null", null, "null"],
    ["an empty string", "", "0 characters"],
    ["a string one character too long", "s".repeat(65), "65 characters"],
    ["not a number", Number.NaN, "NaN"],
    ["infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["an object", { name: "top-songs" }, "object"],
    ["a function", noop, "function"],
  ])("%s is a TypeError naming the option", (_name, views, what) => {
    const error = thrown(() => initOf("getArtist", loose({ views }), {}, ["views"]));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(`getArtist: views must be a string of 1 to 64 characters, a number, true or false, or a list of strings; got ${what}`);
  });

  test("a list is held to what a list of ids is", () => {
    expect(thrown(() => initOf("getArtist", loose({ views: ["a", 2] }), {}, ["views"])).message).toBe(
      "getArtist: views must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got 2 at index 1",
    );
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
    initOf("fn", loose(options), {}, ["views"]);
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

  test("a parameter named __proto__ is one more parameter and nothing else", () => {
    const init = initOf("fn", { params: JSON.parse('{"__proto__": ["polluted"], "x": 1}') as Record<string, string[] | number> });
    expect(Object.entries(init.params ?? {})).toEqual([
      ["__proto__", ["polluted"]],
      ["x", 1],
    ]);
    expect(Object.getPrototypeOf(init.params)).toBe(Object.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

describe("initOf: what it is handed is checked, and a mistake names the function and the option", () => {
  const LIST = "must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";
  const PARAM = "getSong: params.a must be a string, a number, true or false, or a list of at most 300 strings and numbers; got ";

  test.each<[string, unknown, string]>([
    ["options that are null", null, "getSong: expected an options object; got null"],
    ["options that are a string", "en-GB", "getSong: expected an options object; got 5 characters"],
    ["options that are a number", 25, "getSong: expected an options object; got 25"],
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
    ["an empty cursor", { offset: "" }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got 0 characters"],
    ["a cursor one character too long", { offset: "c".repeat(257) }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got 257 characters"],
    ["an offset that is null", { offset: null }, "getSong: offset must be a whole number from 0, or a cursor of 1 to 256 characters; got null"],
    ["params that are null", { params: null }, "getSong: params must be an object of query parameters; got null"],
    ["params as a query string", { params: "a=b" }, "getSong: params must be an object of query parameters; got 3 characters"],
    ["params as a list", { params: ["a"] }, "getSong: params must be an object of query parameters; got object"],
    ["params as a function", { params: noop }, "getSong: params must be an object of query parameters; got function"],
    ["a param that is an object", { params: { a: {} } }, `${PARAM}object`],
    ["a param that is not a number", { params: { a: Number.NaN } }, `${PARAM}NaN`],
    ["a param that is a function", { params: { a: noop } }, `${PARAM}function`],
    ["a param that is a symbol", { params: { a: Symbol("a") } }, `${PARAM}symbol`],
    ["a param list holding an object", { params: { a: [1, {}] } }, `${PARAM}object`],
    ["a param list holding a list", { params: { a: [["1"]] } }, `${PARAM}object`],
    ["a param list holding true", { params: { a: [true] } }, `${PARAM}object`],
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

import { describe, expect, test, vi } from "vitest";
import { clientOf, has, listOf, optionsOf, segmentOf } from "./check";
import { createClient } from "./client";

const SECRET = "s3cretT0ken";
const noop = () => undefined;

/** What `fn` throws. A call that returns fails the test. */
const thrown = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error("expected a throw");
};

describe("has", () => {
  class Kept {
    get() {
      return undefined;
    }
    set() {
      return undefined;
    }
  }

  test.each<[string, unknown, string[]]>([
    ["an object with the method", { get: noop }, ["get"]],
    ["an object with every method named", { get: noop, set: noop, delete: noop }, ["get", "set", "delete"]],
    ["an object with more besides", { get: noop, extra: 1 }, ["get"]],
    ["an instance whose methods are on its class", new Kept(), ["get", "set"]],
    ["any object, when no method is named", {}, []],
  ])("%s has them", (_name, value, methods) => {
    expect(has(value, methods)).toBe(true);
  });

  test.each<[string, unknown, string[]]>([
    ["an object missing one of two", { get: noop }, ["get", "set"]],
    ["an object whose method is a string", { get: "get" }, ["get"]],
    ["an object whose method is null", { get: null }, ["get"]],
    ["an instance asked for a method its class lacks", new Kept(), ["get", "delete"]],
    ["null", null, []],
    ["undefined", undefined, []],
    ["a string", "get", ["length"]],
    ["a number", 42, []],
    ["a function carrying the method", Object.assign(noop, { get: noop }), ["get"]],
  ])("%s does not", (_name, value, methods) => {
    expect(has(value, methods)).toBe(false);
  });

  test("the methods are looked at, never called", () => {
    const get = vi.fn();
    expect(has({ get }, ["get"])).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("optionsOf", () => {
  test("no options at all is an empty bag", () => {
    expect(optionsOf("fn", undefined, "an options object")).toEqual({});
  });

  test.each([{}, { signal: undefined }, { prefix: "p:" }])("an object, %j, comes back as this call's own copy of what it holds", (options) => {
    const bag = optionsOf("fn", options, "an options object");
    expect(bag).not.toBe(options);
    expect(Object.entries(bag)).toEqual(Object.entries(options));
  });

  describe("a bag holds what the caller's object holds itself, and nothing that is inherited", () => {
    /** Runs `run` while `Object.prototype` carries `planted`, as it would after some other code had polluted it. */
    function polluted<T>(planted: Record<string, unknown>, run: () => T): T {
      Object.assign(Object.prototype, planted);
      try {
        return run();
      } finally {
        for (const key of Object.keys(planted)) Reflect.deleteProperty(Object.prototype, key);
      }
    }

    test.each<[string, object | undefined]>([
      ["no options", undefined],
      ["an empty object", {}],
      ["an object with options", { limit: 5 }],
    ])("for %s, it inherits from nothing at all", (_name, options) => {
      expect(Object.getPrototypeOf(optionsOf("fn", options, "an options object"))).toBeNull();
    });

    test("what the caller's object inherits is not in it", () => {
      const options = Object.assign(Object.create({ limit: 5, storefront: "zz" }) as { limit?: number; storefront?: string; language?: string }, { language: "en-GB" });
      const bag = optionsOf("fn", options, "an options object");
      expect(Object.entries(bag)).toEqual([["language", "en-GB"]]);
      expect([bag.limit, bag.storefront]).toEqual([undefined, undefined]);
    });

    test("what other code has put on Object.prototype is not in it, passed an object or passed none", () => {
      const seen = polluted({ storefront: "zz", user: true }, () =>
        [undefined, {}].map((options: { storefront?: string; user?: boolean } | undefined) => {
          const bag = optionsOf("fn", options, "an options object");
          return [bag.storefront, bag.user, "storefront" in bag];
        }),
      );
      expect(seen).toEqual([
        [undefined, undefined, false],
        [undefined, undefined, false],
      ]);
    });

    test("the check that says so can tell: an ordinary object does appear to hold what was planted, for as long as it is", () => {
      expect(polluted({ storefront: "zz" }, () => ({} as { storefront?: string }).storefront)).toBe("zz");
      expect(({} as { storefront?: string }).storefront).toBeUndefined();
    });

    test("each of the caller's properties is read once, and changing the object afterwards changes nothing", () => {
      const read = vi.fn(() => "en-GB");
      const options: { limit: number; language?: string } = { limit: 5 };
      Object.defineProperty(options, "language", { get: read, enumerable: true });
      const bag = optionsOf("fn", options, "an options object");
      options.limit = 50;
      expect([bag.language, bag.language, bag.limit]).toEqual(["en-GB", "en-GB", 5]);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["a string that is a token", SECRET],
    ["a number", 42],
    ["true", true],
    ["a function", noop],
  ])("%s is a TypeError that says what was expected and does not show the value", (_name, options) => {
    const error = thrown(() => optionsOf("validateUserToken", options as object, "an options object"));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^validateUserToken: expected an options object; got /);
    expect(error.message).not.toContain(SECRET);
  });

  test("what was expected is said in the caller's words", () => {
    expect(thrown(() => optionsOf("fn", null as unknown as object, "a bag of settings")).message).toBe("fn: expected a bag of settings; got null");
  });
});

describe("clientOf", () => {
  test("a client from createClient is one, whichever of its methods are named", () => {
    const client = createClient({ developerToken: "dev" });
    expect(clientOf("fn", client, ["request"])).toBe(client);
    expect(clientOf("fn", client, ["request", "paginate", "storefront", "as", "forUser"])).toBe(client);
  });

  test("so is anything with the methods named: a wrapped client, or a test's own", () => {
    const client = { as: noop, request: noop };
    expect(clientOf("fn", client, ["as", "request"])).toBe(client);
  });

  test("only the methods named are asked for, so a caller is held to what it calls and no more", () => {
    const client = { request: noop };
    expect(clientOf("fn", client, ["request"])).toBe(client);
    expect(() => clientOf("fn", client, ["request", "paginate"])).toThrow(TypeError);
  });

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string that is a token", SECRET],
    ["a number", 42],
    ["true", true],
    ["an empty object", {}],
    ["an array", [SECRET]],
    ["a function with the methods on it", Object.assign(noop, { as: noop, request: noop })],
    ["an object with as alone", { as: noop }],
    ["an object with request alone", { request: noop }],
    ["an object whose as is not a function", { as: "as", request: noop }],
  ])("%s is a TypeError naming client, and is not shown", (_name, client) => {
    const error = thrown(() => clientOf("userTokenIntake", client, ["as", "request"]));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^userTokenIntake: client must be a client from createClient; got /);
    expect(error.message).not.toContain(SECRET);
  });

  test("nothing is called on what it is handed", () => {
    const request = vi.fn();
    clientOf("fn", { request }, ["request"]);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("segmentOf", () => {
  test.each(["1613600188", "pl.u-8aAVZAbCdEf", "i.eoDlqXxsaz8Nb", "ra.985484166", "us", "music-videos", "a.b", "...", ".a", "a..", "A_b-c~1!*'()", "s".repeat(64)])(
    "%s is a segment, and comes back as it is",
    (value) => {
      expect(segmentOf("fn", "id", value)).toBe(value);
    },
  );

  test.each([
    ["a/b", "a%2Fb"],
    ["../../me/library/songs", "..%2F..%2Fme%2Flibrary%2Fsongs"],
    ["a\\b", "a%5Cb"],
    ["a?b=1&c", "a%3Fb%3D1%26c"],
    ["a#b", "a%23b"],
    ["a b", "a%20b"],
    ["a\tb\n", "a%09b%0A"],
    ["%2e%2e", "%252e%252e"],
    ["%2F", "%252F"],
    ["a;b", "a%3Bb"],
    ["a:b@c", "a%3Ab%40c"],
    ["é", "%C3%A9"],
    ["😀", "%F0%9F%98%80"],
  ])("what would mean something in a path is encoded: %j becomes %s", (value, encoded) => {
    expect(segmentOf("fn", "id", value)).toBe(encoded);
  });

  describe("whatever a segment holds, the request still goes where it was going", () => {
    const BASE = "https://api.music.apple.com/";
    const hostile = [
      "../../../me/library/songs",
      "..\\..\\..\\me\\library\\songs",
      "%2e%2e/%2e%2e/%2e%2e/me",
      ".%2e",
      "%2E%2E",
      "/v1/me/storefront",
      "//evil.example/x",
      "https://evil.example/x",
      "1?include=library",
      "1#fragment",
      "1/../../../me",
      " ",
      "\t",
      "a\r\nb",
    ];

    test.each(hostile)("%j stays the one segment after /v1/catalog/us/songs", (value) => {
      const url = new URL(`v1/catalog/us/songs/${segmentOf("getSong", "id", value)}`, BASE);
      const segments = url.pathname.split("/");
      expect(url.origin).toBe("https://api.music.apple.com");
      expect(segments.slice(0, 5)).toEqual(["", "v1", "catalog", "us", "songs"]);
      expect(segments).toHaveLength(6);
      expect(decodeURIComponent(segments[5] ?? "")).toBe(value);
      expect([url.search, url.hash]).toEqual(["", ""]);
    });

    test("the check that says so can tell: put in as they are, the same values do leave", () => {
      expect(new URL("v1/catalog/us/songs/../../../me/library/songs", BASE).pathname).toBe("/v1/me/library/songs");
      expect(new URL("v1/catalog/us/songs/%2e%2e/%2e%2e/%2e%2e/me", BASE).pathname).toBe("/v1/me");
      expect(new URL("v1/catalog/us/songs/1?include=library", BASE).search).toBe("?include=library");
    });
  });

  test.each<[string, unknown, string]>([
    ["an empty string", "", "0 characters"],
    ["a single dot, which a URL reads as here", ".", "1 characters"],
    ["two dots, which a URL reads as one up", "..", "2 characters"],
    ["one character too many", "s".repeat(65), "65 characters"],
    ["half of a surrogate pair", "a\uD800", "2 characters"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a number", 1613600188, "1613600188"],
    ["true", true, "boolean"],
    ["an object", { id: "1" }, "object"],
    ["an array", ["1"], "object"],
    ["a String object", new String("1"), "object"],
  ])("%s is a TypeError naming the function and the argument, and saying what it got", (_name, value, what) => {
    const error = thrown(() => segmentOf("getSong", "id", value));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(`getSong: id must be a string of 1 to 64 characters, and not "." or ".."; got ${what}`);
  });

  test("the argument is named as the caller names it", () => {
    expect(thrown(() => segmentOf("getAlbumRelationship", "name", "")).message).toMatch(/^getAlbumRelationship: name must be /);
  });

  test("a token is too long to be an id: one put where an id belongs is refused, so it is never sent, and it is not shown", () => {
    // The size and shape of a developer token: three runs of base64url with dots between, every character one a segment may hold.
    const token = `eyJhbGciOiJFUzI1NiIsImtpZCI6IkFCQzEyM0RFRkcifQ.${"p".repeat(75)}.${"s".repeat(86)}`;
    const error = thrown(() => segmentOf("getSong", "id", token));
    expect(error.message).toBe(`getSong: id must be a string of 1 to 64 characters, and not "." or ".."; got ${String(token.length)} characters`);
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(token);
  });

  test("the longest id Apple gives out is well inside the limit", () => {
    for (const id of ["pl.f4d106fed2bd41149aaacabb233eb5eb", "ra.u-f4d106fed2bd41149aaacabb233eb5eb", "library-playlist-folders"]) expect(segmentOf("fn", "id", id)).toBe(id);
  });

  test("nothing is called on a value that is not a string: it is not asked to become one", () => {
    const asked = vi.fn(() => SECRET);
    thrown(() => segmentOf("fn", "id", { toString: asked, valueOf: asked, toJSON: asked, [Symbol.toPrimitive]: asked }));
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("listOf", () => {
  const MESSAGE = "getSongs: ids must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got ";
  /** Three long with nothing at index 1: a hole is not an item. */
  const holed = new Array<string>(3);
  holed[0] = "1";
  holed[2] = "3";

  test.each<[string, string[]]>([
    ["one id", ["1613600188"]],
    ["several", ["1", "2", "3"]],
    ["the same one twice", ["1", "1"]],
    ["types", ["songs", "music-videos"]],
    ["what a path could not hold, which a query can", ["a/b", "..", ".", "a b", "a?b#c", "é"]],
    ["an item of the longest length", ["s".repeat(64)]],
    ["as many as Apple takes", Array.from({ length: 300 }, (_, i) => String(i))],
  ])("%s is a list, and comes back item for item", (_name, value) => {
    expect(listOf("fn", "ids", value)).toEqual(value);
  });

  test("what comes back is the call's own copy: changing the caller's list afterwards changes nothing", () => {
    const mine = ["1", "2"];
    const list = listOf("fn", "ids", mine);
    mine.push("3");
    mine[0] = "9";
    expect(list).not.toBe(mine);
    expect(list).toEqual(["1", "2"]);
  });

  test("each item is read once, so what was checked is what is sent", () => {
    let reads = 0;
    const shifting = new Proxy(["1"], {
      get: (target, key, receiver) => (key === "0" ? (++reads === 1 ? "1" : "1,2") : (Reflect.get(target, key, receiver) as unknown)),
    });
    expect(listOf("fn", "ids", shifting)).toEqual(["1"]);
    expect(reads).toBe(1);
  });

  test.each<[string, unknown, string]>([
    ["an empty list", [], "a list of 0"],
    ["one item too many", Array.from({ length: 301 }, (_, i) => String(i)), "a list of 301"],
    ["an empty string in it", ["1", ""], "0 characters at index 1"],
    ["an item with a comma, which would arrive as two", ["1", "2,3"], "3 characters at index 1"],
    ["an item one character too long", ["s".repeat(65)], "65 characters at index 0"],
    ["a number in it", ["1", 2], "2 at index 1"],
    ["null in it", [null], "null at index 0"],
    ["undefined in it", ["1", undefined, "3"], "undefined at index 1"],
    ["a list in it", [["1"]], "object at index 0"],
    ["a hole in it", holed, "undefined at index 1"],
    ["a string, which is one id and not a list of them", "1613600188", "10 characters"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a number", 42, "42"],
    ["an object shaped like a list", { 0: "1", length: 1 }, "object"],
    ["a Set", new Set(["1"]), "object"],
  ])("%s is a TypeError naming the function and the argument, and saying what it got", (_name, value, what) => {
    const error = thrown(() => listOf("getSongs", "ids", value));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(MESSAGE + what);
  });

  describe("a list is asked how long it is once, and read by index as far as it said", () => {
    /** A list whose answers to `key` come from `answers`, one per asking, and which counts the askings. */
    function shifting<T>(list: T[], key: string, answers: unknown[]) {
      const asked = { times: 0 };
      const proxy = new Proxy(list, { get: (target, name, receiver) => (name === key ? answers[Math.min(asked.times++, answers.length - 1)] : (Reflect.get(target, name, receiver) as unknown)) });
      return { proxy, asked };
    }

    test("a list given an iterator of its own is read by its length, not by what the iterator hands over", () => {
      const odd = Object.defineProperty(["1"], Symbol.iterator, {
        value: function* () {
          for (let i = 0; i < 5000; i++) yield String(i);
        },
      });
      expect(listOf("fn", "ids", odd)).toEqual(["1"]);
    });

    test("a list that grows after it has said how long it is, is read as far as it said", () => {
      const { proxy, asked } = shifting(["1", "2", "3"], "length", [2, 3]);
      expect(listOf("fn", "ids", proxy)).toEqual(["1", "2"]);
      expect(asked.times).toBe(1);
    });

    test("a list refused for its length is described by the length it gave, not one it gives later", () => {
      const { proxy, asked } = shifting<string>([], "length", [301, 7]);
      expect(thrown(() => listOf("getSongs", "ids", proxy)).message).toBe(`${MESSAGE}a list of 301`);
      expect(asked.times).toBe(1);
    });

    test("an item that is wrong is described as it was when it was read, and is read once", () => {
      const { proxy, asked } = shifting([""], "0", ["", SECRET]);
      expect(thrown(() => listOf("getSongs", "ids", proxy)).message).toBe(`${MESSAGE}0 characters at index 0`);
      expect(asked.times).toBe(1);
    });

    test.each<[string, unknown]>([
      ["not a number", "2"],
      ["below zero", -1],
      ["not whole", 1.5],
    ])("a list whose length is %s is no list of one or more", (_name, length) => {
      const { proxy } = shifting(["1", "2"], "length", [length]);
      expect(() => listOf("fn", "ids", proxy)).toThrow(TypeError);
    });
  });

  test("the first item that is wrong is the one named", () => {
    expect(thrown(() => listOf("getSongs", "ids", ["1", "", 3, ""])).message).toBe(`${MESSAGE}0 characters at index 1`);
  });

  test("a list too long is not read: its length is all that is asked for", () => {
    const read = vi.fn();
    const long = new Proxy(Array.from({ length: 301 }, () => "1"), {
      get: (target, key, receiver) => {
        if (typeof key === "string" && /^\d+$/.test(key)) read(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(() => listOf("fn", "ids", long)).toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();
  });

  test("an item that is refused is not shown", () => {
    const error = thrown(() => listOf("getSongs", "ids", [`${SECRET},${SECRET}`, { token: SECRET }]));
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
  });

  test("a token is too long to be an item: one put among the ids is refused, so it is never sent, and it is not shown", () => {
    const token = `eyJhbGciOiJFUzI1NiIsImtpZCI6IkFCQzEyM0RFRkcifQ.${"p".repeat(75)}.${"s".repeat(86)}`;
    const error = thrown(() => listOf("getSongs", "ids", ["1", token]));
    expect(error.message).toBe(`${MESSAGE}${String(token.length)} characters at index 1`);
    expect(error.message).not.toContain(token);
  });

  test("nothing is called on an item that is not a string", () => {
    const asked = vi.fn(() => SECRET);
    thrown(() => listOf("fn", "ids", [{ toString: asked, valueOf: asked, toJSON: asked, [Symbol.toPrimitive]: asked }]));
    expect(asked).not.toHaveBeenCalled();
  });
});

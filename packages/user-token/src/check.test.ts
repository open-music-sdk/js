import { createClient, optionsOf } from "@open-music-sdk/core";
import { describe, expect, test, vi } from "vitest";
import { clientOf, storeOf, tokenOf, userIdOf } from "./check";
import { MemoryUserTokenStore } from "./stores";

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

/** Values that are no object of the kind asked for, some of them carrying a secret. */
const strangers: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["a string that is a token", SECRET],
  ["a number", 42],
  ["true", true],
  ["an empty object", {}],
  ["an array", [SECRET]],
  ["a function with the methods on it", Object.assign(noop, { as: noop, request: noop, get: noop, set: noop, delete: noop })],
];

// `has` and `optionsOf` are core's, and are tested there.

describe("clientOf", () => {
  test("a client from createClient is one", () => {
    const client = createClient({ developerToken: "dev" });
    expect(clientOf("fn", client)).toBe(client);
  });

  test("so is anything with as and request: a wrapped client, or a test's own", () => {
    const client = { as: noop, request: noop };
    expect(clientOf("fn", client)).toBe(client);
  });

  test.each<[string, unknown]>([
    ...strangers,
    ["an object with as alone", { as: noop }],
    ["an object with request alone", { request: noop }],
    ["an object whose as is not a function", { as: "as", request: noop }],
    ["a store", new MemoryUserTokenStore()],
  ])("%s is a TypeError naming client, and is not shown", (_name, client) => {
    const error = thrown(() => clientOf("userTokenIntake", client));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^userTokenIntake: client must be a client from createClient; got /);
    expect(error.message).not.toContain(SECRET);
  });
});

describe("storeOf", () => {
  test("a store of this package's is one", () => {
    const store = new MemoryUserTokenStore();
    expect(storeOf("fn", store)).toBe(store);
  });

  test("so is anything with get, set and delete: a store of the app's own", () => {
    const store = { get: noop, set: noop, delete: noop };
    expect(storeOf("fn", store)).toBe(store);
  });

  test.each<[string, unknown]>([
    ...strangers,
    ["an object with get and set but no delete", { get: noop, set: noop }],
    ["a key-value namespace, which has put where a store has set", { get: noop, put: noop, delete: noop }],
    ["a Set, which has delete but neither get nor set", new Set()],
    ["a client", createClient({ developerToken: "dev" })],
  ])("%s is a TypeError naming store, and is not shown", (_name, store) => {
    const error = thrown(() => storeOf("acceptUserToken", store));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^acceptUserToken: store must have get, set and delete; got /);
    expect(error.message).not.toContain(SECRET);
  });
});

describe("userIdOf", () => {
  test.each(["u1", "0", " ", "user@example.com", "a/b", "__proto__", "ü", "u".repeat(1000)])("%j is a user id: it is the app's own, and comes back as it is", (userId) => {
    expect(userIdOf("fn", userId)).toBe(userId);
  });

  test.each<[string, unknown, string]>([
    ["an empty string", "", "0 characters"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["zero", 0, "0"],
    ["a number", 42, "42"],
    ["true", true, "boolean"],
    ["an object", { id: "u1" }, "object"],
    ["an array", ["u1"], "object"],
  ])("%s is a TypeError naming userId and saying what it got", (_name, userId, got) => {
    const error = thrown(() => userIdOf("acceptUserToken", userId));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(`acceptUserToken: userId must be a string with something in it; got ${got}`);
  });
});

describe("tokenOf", () => {
  test.each(["a", "Ab+/9w==", "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJBIn0.c2ln-_", "a".repeat(4000)])("%s is a token, and comes back as it is", (token) => {
    expect(tokenOf("fn", token)).toBe(token);
  });

  test.each([" token", "token\n", "\ttoken\r\n"])("whitespace around %j is dropped, as core drops it when it sends", (token) => {
    expect(tokenOf("fn", token)).toBe("token");
  });

  test.each<[string, unknown]>([
    ["an empty string", ""],
    ["only whitespace", " \n"],
    ["a space inside it", `${SECRET} ${SECRET}`],
    ["a line break inside it", `${SECRET}\n${SECRET}`],
    ["a header smuggled after it", `${SECRET}\r\nx-injected: 1`],
    ["a letter outside ASCII", `${SECRET}é`],
    ["undefined", undefined],
    ["null", null],
    ["a number", 12345],
    ["an object holding a token", { token: SECRET }],
    ["an array holding a token", [SECRET]],
  ])("%s is a TypeError naming token, and is not shown", (_name, token) => {
    const error = thrown(() => tokenOf("validateUserToken", token));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^validateUserToken: token must be printable characters with no spaces or line breaks inside; got /);
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(SECRET);
  });

  test("nothing is called on a value that is not a string: it is not asked to become one", () => {
    const asked = vi.fn(() => SECRET);
    thrown(() => tokenOf("fn", { toString: asked, valueOf: asked, toJSON: asked, [Symbol.toPrimitive]: asked }));
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("every mistake is named for the function it was made in", () => {
  test.each(["validateUserToken", "acceptUserToken", "userTokenIntake", "KvUserTokenStore"])("%s", (fn) => {
    const messages = [
      thrown(() => optionsOf(fn, null as unknown as object, "an options object")),
      thrown(() => clientOf(fn, undefined)),
      thrown(() => storeOf(fn, undefined)),
      thrown(() => userIdOf(fn, undefined)),
      thrown(() => tokenOf(fn, undefined)),
    ].map((error) => error.message);
    for (const message of messages) expect(message.startsWith(`${fn}: `)).toBe(true);
  });
});

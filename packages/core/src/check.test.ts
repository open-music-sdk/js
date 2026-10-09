import { describe, expect, test, vi } from "vitest";
import { clientOf, has, optionsOf } from "./check";
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

  test.each([{}, { signal: undefined }, { prefix: "p:" }])("an object, %j, comes back as it is", (options) => {
    expect(optionsOf("fn", options, "an options object")).toBe(options);
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

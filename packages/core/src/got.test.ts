import { describe, expect, test, vi } from "vitest";
import { got } from "./got.js";

const SECRET = "-----BEGIN PRIVATE KEY-----hunter2-----END PRIVATE KEY-----";

describe("got", () => {
  test.each([
    [0, "0"],
    [1, "1"],
    [-60, "-60"],
    [1.5, "1.5"],
    [15_777_001, "15777001"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "Infinity"],
    [Number.NEGATIVE_INFINITY, "-Infinity"],
  ])("a number, %s, is printed as it is: it cannot be a secret, and its value is what helps", (value, text) => {
    expect(got(value)).toBe(text);
  });

  test.each([
    ["an empty string", "", "0 characters"],
    ["a short string", "abc", "3 characters"],
    ["a number written as a string", "3600", "4 characters"],
    ["a secret", SECRET, `${String(SECRET.length)} characters`],
  ])("%s is described by its length", (_name, value, text) => {
    expect(got(value)).toBe(text);
  });

  test.each<[string, unknown, string]>([
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["a boolean", true, "boolean"],
    ["a bigint", 10n, "bigint"],
    ["a symbol described by a secret", Symbol(SECRET), "symbol"],
    ["a function", () => SECRET, "function"],
    ["an object holding a secret", { pem: SECRET }, "object"],
    ["an array holding a secret", [SECRET], "object"],
    ["a String object of a secret", new String(SECRET), "object"],
    ["a Number object", new Number(5), "object"],
    ["the bytes of a secret", new TextEncoder().encode(SECRET), "object"],
    ["an Error whose message is a secret", new Error(SECRET), "object"],
    ["a promise of a secret", Promise.resolve(SECRET), "object"],
  ])("%s is named by its kind", (_name, value, text) => {
    expect(got(value)).toBe(text);
  });

  test.each<[string, unknown]>([
    ["a secret", SECRET],
    ["an array holding it", [SECRET]],
    ["an object that turns into it as a string", { toString: () => SECRET }],
    ["a String object of it", new String(SECRET)],
    ["a symbol described by it", Symbol(SECRET)],
    ["an Error carrying it", new Error(SECRET)],
  ])("%s never comes back out", (_name, value) => {
    expect(got(value)).not.toContain("hunter2");
  });

  test("nothing is called on the value: it is not asked to become a string, a number or JSON", () => {
    const asked = vi.fn(() => SECRET);
    got({ toString: asked, valueOf: asked, toJSON: asked, [Symbol.toPrimitive]: asked });
    expect(asked).not.toHaveBeenCalled();
  });
});

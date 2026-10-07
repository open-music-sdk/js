import { describe, expect, test, vi } from "vitest";
import { AppleMusicError, isAppleMusicError, type tErrorTag } from "./errors.js";

const TAGS: tErrorTag[] = ["DeveloperTokenRejected", "DeveloperTokenUnavailable", "UserTokenInvalid", "RateLimited", "ApiError", "ValidationError", "NetworkError"];

/** A second copy of this module, with its own class and its own guard, as a duplicate install has. */
const otherCopy = async () => {
  vi.resetModules();
  return import("./errors.js");
};

/** An Error made to look like `shape`, by no copy of this package. */
const lookalike = (shape: object) => Object.assign(new Error("x"), shape);

describe("AppleMusicError", () => {
  test.each(TAGS)("is an Error tagged %s", (tag) => {
    const e = new AppleMusicError(tag, "boom");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AppleMusicError);
    expect(e._tag).toBe(tag);
    expect(e.name).toBe("AppleMusicError");
    expect(e.message).toBe("boom");
    expect(String(e)).toBe("AppleMusicError: boom");
    expect(e.stack).toContain("boom");
  });

  test("has no details unless given some", () => {
    const e = new AppleMusicError("ApiError", "x");
    expect(e.status).toBeUndefined();
    expect(e.errors).toBeUndefined();
    expect(e.issues).toBeUndefined();
    expect(e.retryAfterMs).toBeUndefined();
    expect("cause" in e).toBe(false);
  });

  test("carries every detail", () => {
    const cause = new TypeError("socket hang up");
    const errors = [{ id: "1", title: "Resource Not Found", status: "404", code: "40400" }];
    const issues = [{ message: "required", path: ["href"] }];
    const e = new AppleMusicError("ApiError", "x", { status: 404, errors, issues, retryAfterMs: 1000, cause });
    expect(e.status).toBe(404);
    expect(e.errors).toBe(errors);
    expect(e.issues).toBe(issues);
    expect(e.retryAfterMs).toBe(1000);
    expect(e.cause).toBe(cause);
  });

  test.each([
    [{ status: 500 }, "status", 500],
    [{ retryAfterMs: 0 }, "retryAfterMs", 0],
    [{ cause: "a string" }, "cause", "a string"],
  ])("keeps a lone detail %j", (details, key, value) => {
    expect(new AppleMusicError("NetworkError", "x", details)).toHaveProperty(key, value);
  });
});

describe("isAppleMusicError", () => {
  test.each(TAGS)("identifies a %s with and without the tag", (tag) => {
    const e = new AppleMusicError(tag, "x");
    expect(isAppleMusicError(e)).toBe(true);
    expect(isAppleMusicError(e, tag)).toBe(true);
    for (const other of TAGS) if (other !== tag) expect(isAppleMusicError(e, other)).toBe(false);
  });

  test.each([new Error("x"), new TypeError("x"), new DOMException("x", "AbortError"), { _tag: "ApiError", message: "x" }, "ApiError", null, undefined, 42])(
    "rejects %s",
    (value) => {
      expect(isAppleMusicError(value)).toBe(false);
      expect(isAppleMusicError(value, "ApiError")).toBe(false);
    },
  );

  test("narrows the tag", () => {
    const e: unknown = new AppleMusicError("RateLimited", "x", { retryAfterMs: 5 });
    if (!isAppleMusicError(e, "RateLimited")) expect.unreachable();
    const tag: "RateLimited" = e._tag;
    expect(tag).toBe("RateLimited");
    expect(e.retryAfterMs).toBe(5);
  });
});

describe("instanceof AppleMusicError", () => {
  test.each<[string, unknown]>([
    ["one made here", new AppleMusicError("ApiError", "x")],
    ["one with every detail", new AppleMusicError("RateLimited", "x", { status: 429, retryAfterMs: 5, cause: new Error("c") })],
    ["an Error with the name and a tag", lookalike({ name: "AppleMusicError", _tag: "ApiError" })],
    ["one tagged with something this copy has never heard of", lookalike({ name: "AppleMusicError", _tag: "QuotaExceeded" })],
    ["one with an empty tag", lookalike({ name: "AppleMusicError", _tag: "" })],
  ])("%s is an instance", (_, value) => {
    expect(value instanceof AppleMusicError).toBe(true);
    expect(isAppleMusicError(value)).toBe(true);
  });

  test.each<[string, unknown]>([
    ["a plain Error", new Error("x")],
    ["a TypeError", new TypeError("x")],
    ["an abort", new DOMException("x", "AbortError")],
    ["an Error with the name but no tag", lookalike({ name: "AppleMusicError" })],
    ["an Error with a tag but another name", lookalike({ name: "ApiError", _tag: "ApiError" })],
    ["an Error with the name in another case", lookalike({ name: "applemusicerror", _tag: "ApiError" })],
    ["an Error with a numeric tag", lookalike({ name: "AppleMusicError", _tag: 403 })],
    ["an Error with a null tag", lookalike({ name: "AppleMusicError", _tag: null })],
    ["an Error with an object for a tag", lookalike({ name: "AppleMusicError", _tag: { tag: "ApiError" } })],
    ["an object with the name and a tag that is not an Error", { name: "AppleMusicError", _tag: "ApiError", message: "x" }],
    ["what JSON makes of one", JSON.parse(JSON.stringify(new AppleMusicError("ApiError", "x"))) as unknown],
    ["the class itself", AppleMusicError],
    ["the name", "AppleMusicError"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("%s is not", (_, value) => {
    expect(value instanceof AppleMusicError).toBe(false);
    expect(isAppleMusicError(value)).toBe(false);
  });
});

describe("an error is recognised whichever copy of the package made it", () => {
  test("another copy has its own class, so the prototype chain cannot be what decides", async () => {
    const other = await otherCopy();
    expect(other.AppleMusicError).not.toBe(AppleMusicError);
    expect(Object.getPrototypeOf(new other.AppleMusicError("ApiError", "x"))).not.toBe(AppleMusicError.prototype);
  });

  test.each(TAGS)("a %s made by another copy is an instance here, and one made here is an instance there", async (tag) => {
    const other = await otherCopy();
    const theirs = new other.AppleMusicError(tag, "x");
    const ours = new AppleMusicError(tag, "x");
    expect(theirs instanceof AppleMusicError).toBe(true);
    expect(ours instanceof other.AppleMusicError).toBe(true);
    expect(isAppleMusicError(theirs)).toBe(true);
    expect(other.isAppleMusicError(ours)).toBe(true);
  });

  test.each(TAGS)("the guard still tells a %s from every other tag across copies", async (tag) => {
    const other = await otherCopy();
    const theirs = new other.AppleMusicError(tag, "x");
    expect(isAppleMusicError(theirs, tag)).toBe(true);
    for (const wrong of TAGS) if (wrong !== tag) expect(isAppleMusicError(theirs, wrong)).toBe(false);
  });

  test("the details come through with it", async () => {
    const other = await otherCopy();
    const theirs: unknown = new other.AppleMusicError("RateLimited", "slow down", { status: 429, retryAfterMs: 5000 });
    if (!isAppleMusicError(theirs, "RateLimited")) expect.unreachable();
    expect([theirs.message, theirs.status, theirs.retryAfterMs]).toEqual(["slow down", 429, 5000]);
  });

  test("what another copy would not call an AppleMusicError is not one here either", async () => {
    const other = await otherCopy();
    for (const value of [new Error("x"), lookalike({ name: "AppleMusicError" }), null]) {
      expect(other.isAppleMusicError(value)).toBe(false);
      expect(isAppleMusicError(value)).toBe(false);
    }
  });
});

describe("a subclass keeps the ordinary instanceof", () => {
  class Narrower extends AppleMusicError {}

  test("its own instances are instances of it and of AppleMusicError", () => {
    const e = new Narrower("ApiError", "x");
    expect(e instanceof Narrower).toBe(true);
    expect(e instanceof AppleMusicError).toBe(true);
    expect(isAppleMusicError(e, "ApiError")).toBe(true);
  });

  test.each<[string, unknown]>([
    ["a plain AppleMusicError", new AppleMusicError("ApiError", "x")],
    ["a lookalike", lookalike({ name: "AppleMusicError", _tag: "ApiError" })],
    ["a plain Error", new Error("x")],
    ["null", null],
  ])("%s is not an instance of the subclass", (_, value) => {
    expect(value instanceof Narrower).toBe(false);
  });

  test("another copy's AppleMusicError is not an instance of the subclass", async () => {
    const other = await otherCopy();
    expect(new other.AppleMusicError("ApiError", "x") instanceof Narrower).toBe(false);
  });
});

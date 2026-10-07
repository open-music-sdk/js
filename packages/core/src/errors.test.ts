import { describe, expect, test } from "vitest";
import { AppleMusicError, isAppleMusicError, type tErrorTag } from "./errors.js";

const TAGS: tErrorTag[] = ["DeveloperTokenRejected", "DeveloperTokenUnavailable", "UserTokenInvalid", "RateLimited", "ApiError", "ValidationError", "NetworkError"];

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

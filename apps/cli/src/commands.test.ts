import { AppleMusicError } from "@open-music-sdk/server";
import { expect, test } from "vitest";
import { describe as describeFailure } from "./commands";

// What main's tests cannot bring about without waiting on retries: the rest of what asking Apple can fail with.
test.each([
  ["a rate limit says to wait", new AppleMusicError("RateLimited", "GET /v1/test: 429", { status: 429 }), "Apple is limiting requests for this key. Wait a minute and try again."],
  ["any other answer is given with its status", new AppleMusicError("ApiError", "GET /v1/test: Service Unavailable", { status: 503 }), "Apple answered 503: GET /v1/test: Service Unavailable"],
  ["one with no status had no answer, and is not given as one", new AppleMusicError("DeveloperTokenUnavailable", "the minter failed"), "Apple could not be asked: the minter failed"],
  [
    "a network failure with no system code down its causes is given without one",
    new AppleMusicError("NetworkError", "GET /v1/test: fetch failed", { cause: new TypeError("fetch failed", { cause: { code: 42 } }) }),
    "Apple could not be reached: GET /v1/test: fetch failed",
  ],
])("%s", (_what, error, words) => {
  expect(describeFailure(error)).toBe(words);
});

test("anything that is not from asking Apple is left for the caller to word", () => {
  for (const e of [new Error("unforeseen"), new DOMException("stopped", "AbortError"), "unforeseen", undefined]) expect(describeFailure(e)).toBeUndefined();
});

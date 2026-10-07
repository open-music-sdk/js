import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppleMusicError, type tErrorDetails, type tErrorTag } from "./errors.js";
import { parseRetryAfter, resolveRetryPolicy, retry, retryable, sleep, type tRetryPolicy } from "./retry.js";

const fail = (tag: tErrorTag, details?: tErrorDetails) => new AppleMusicError(tag, tag, details);
/** Rejects with the nth value on the nth attempt, then keeps rejecting with the last. Non-Errors are deliberate. */
const failing =
  (...errors: unknown[]) =>
  (attempt: number): Promise<never> =>
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- retry must pass through whatever was thrown
    Promise.reject(errors[attempt - 1] ?? errors.at(-1));

/** Drives every pending timer and reports how the promise ended. */
async function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const out = p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("retryable", () => {
  test.each([fail("NetworkError"), fail("RateLimited"), fail("ApiError", { status: 500 }), fail("ApiError", { status: 502 }), fail("ApiError", { status: 503 })])(
    "retries %s",
    (e) => {
      expect(retryable(e)).toBe(true);
    },
  );
  test.each([
    fail("DeveloperTokenRejected"),
    fail("UserTokenInvalid"),
    fail("ValidationError"),
    fail("ApiError"),
    fail("ApiError", { status: 400 }),
    fail("ApiError", { status: 404 }),
    fail("ApiError", { status: 409 }),
    fail("ApiError", { status: 501 }),
  ])("does not retry %s", (e) => {
    expect(retryable(e)).toBe(false);
  });
});

describe("retry", () => {
  test("returns the first success without waiting", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await retry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("retries a retryable failure and returns the eventual success", async () => {
    const fn = vi.fn().mockRejectedValueOnce(fail("NetworkError")).mockRejectedValueOnce(fail("RateLimited")).mockResolvedValue("ok");
    expect(await settle(retry(fn, { maxAttempts: 3 }))).toEqual({ value: "ok" });
    expect(fn.mock.calls).toEqual([[1], [2], [3]]);
  });

  test("gives up after maxAttempts with the last error", async () => {
    const [e1, e2, e3] = [fail("NetworkError"), fail("NetworkError"), fail("NetworkError")];
    const fn = vi.fn(failing(e1, e2, e3));
    expect(await settle(retry(fn, { maxAttempts: 3 }))).toEqual({ error: e3 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("defaults to two attempts", async () => {
    const fn = vi.fn(failing(fail("NetworkError")));
    await settle(retry(fn));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("maxAttempts 1 never retries or waits", async () => {
    const e = fail("NetworkError");
    const fn = vi.fn(failing(e));
    expect(await settle(retry(fn, { maxAttempts: 1 }))).toEqual({ error: e });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([fail("DeveloperTokenRejected"), fail("UserTokenInvalid"), fail("ValidationError"), fail("ApiError", { status: 404 }), fail("ApiError", { status: 501 })])(
    "does not retry %s",
    async (e) => {
      const fn = vi.fn(failing(e));
      expect(await settle(retry(fn, { maxAttempts: 5 }))).toEqual({ error: e });
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  test.each([new Error("plain"), new TypeError("type"), "string", undefined])("does not retry a non-SDK error: %s", async (e) => {
    const fn = vi.fn(failing(e));
    expect(await settle(retry(fn, { maxAttempts: 5 }))).toEqual({ error: e });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retryOn replaces the default predicate", async () => {
    const onlyValidation = (e: AppleMusicError) => e._tag === "ValidationError";
    const a = vi.fn(failing(fail("ValidationError")));
    await settle(retry(a, { maxAttempts: 3, retryOn: onlyValidation }));
    expect(a).toHaveBeenCalledTimes(3);
    const b = vi.fn(failing(fail("NetworkError")));
    await settle(retry(b, { maxAttempts: 3, retryOn: onlyValidation }));
    expect(b).toHaveBeenCalledTimes(1);
    const c = vi.fn(failing(fail("NetworkError")));
    await settle(retry(c, { maxAttempts: 3, retryOn: () => false }));
    expect(c).toHaveBeenCalledTimes(1);
  });

  async function delays(policy: Parameters<typeof retry>[1], error = fail("NetworkError")): Promise<number[]> {
    const times: number[] = [];
    await settle(
      retry(() => {
        times.push(Date.now());
        return Promise.reject(error);
      }, policy),
    );
    return times.slice(1).map((t, i) => t - (times[i] ?? 0));
  }

  test("backs off exponentially under the cap with full jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(await delays({ maxAttempts: 6, baseDelayMs: 100, maxDelayMs: 1000 })).toEqual([100, 200, 400, 800, 1000]);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(await delays({ maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1000 })).toEqual([50, 100, 200]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(await delays({ maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1000 })).toEqual([0, 0, 0]);
  });

  test("default delays are 250 ms doubling to a 4 s cap", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(await delays({ maxAttempts: 7 })).toEqual([250, 500, 1000, 2000, 4000, 4000]);
  });

  test("Retry-After on the error wins over the backoff, even past the backoff cap", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(await delays({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 }, fail("RateLimited", { retryAfterMs: 5000 }))).toEqual([5000, 5000]);
    expect(await delays({ maxAttempts: 2, baseDelayMs: 100 }, fail("RateLimited", { retryAfterMs: 0 }))).toEqual([0]);
  });

  describe("a Retry-After beyond maxRetryAfterMs is not waited for", () => {
    test.each([
      ["just over the default ceiling", 60_001, {}],
      ["far over it", 24 * 60 * 60 * 1000, {}],
      ["past setTimeout's range, where a wait would fire at once", 2 ** 31, {}],
      ["absurd", Number.MAX_SAFE_INTEGER, {}],
      ["over a lower custom ceiling", 2000, { maxRetryAfterMs: 1000 }],
    ])("%s: the error is thrown immediately, delay attached", async (_, retryAfterMs, policy) => {
      const e = fail("RateLimited", { retryAfterMs });
      const fn = vi.fn(failing(e));
      const start = Date.now();
      const { error } = await settle(retry(fn, { maxAttempts: 5, ...policy }));
      expect(error).toBe(e);
      expect((error as AppleMusicError).retryAfterMs).toBe(retryAfterMs);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(Date.now() - start).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    test.each([
      ["at the default ceiling", 60_000, {}],
      ["under a raised ceiling", 90_000, { maxRetryAfterMs: 120_000 }],
      ["at setTimeout's limit when the ceiling allows it", 2 ** 31 - 1, { maxRetryAfterMs: 2 ** 31 - 1 }],
    ])("%s: the wait is honoured", async (_, retryAfterMs, policy) => {
      expect(await delays({ maxAttempts: 2, ...policy }, fail("RateLimited", { retryAfterMs }))).toEqual([retryAfterMs]);
    });

    test.each([2 ** 31, -1, Number.NaN, Number.POSITIVE_INFINITY])("maxRetryAfterMs %s is a TypeError", (maxRetryAfterMs) => {
      expect(() => resolveRetryPolicy({ maxRetryAfterMs })).toThrow(TypeError);
    });

    test("maxRetryAfterMs 0 disables waiting on Retry-After but keeps the backoff", async () => {
      vi.spyOn(Math, "random").mockReturnValue(1);
      const fn = vi.fn(failing(fail("RateLimited", { retryAfterMs: 1 })));
      await settle(retry(fn, { maxAttempts: 3, maxRetryAfterMs: 0 }));
      expect(fn).toHaveBeenCalledTimes(1);
      expect(await delays({ maxAttempts: 3, baseDelayMs: 100, maxRetryAfterMs: 0 }, fail("RateLimited"))).toEqual([100, 200]);
    });
  });

  test("an already aborted signal rejects before the first attempt", async () => {
    const fn = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const { error } = await settle(retry(fn, {}, controller.signal));
    expect(error).toBe(controller.signal.reason);
    expect(fn).not.toHaveBeenCalled();
  });

  test("aborting during the delay rejects with the reason and stops retrying", async () => {
    const fn = vi.fn(failing(fail("NetworkError")));
    const controller = new AbortController();
    const out = retry(fn, { maxAttempts: 5, baseDelayMs: 1000 }, controller.signal).then(
      () => "resolved",
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(fn).toHaveBeenCalledTimes(1);
    const reason = new Error("stop");
    controller.abort(reason);
    expect(await out).toBe(reason);
    await vi.runAllTimersAsync();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("retry policy: every field is optional, never silently infinite", () => {
  const defaults = { maxAttempts: 2, baseDelayMs: 250, maxDelayMs: 4000, maxRetryAfterMs: 60_000, retryOn: retryable };

  test.each([
    ["no policy", undefined],
    ["an empty policy", {}],
    ["every field explicitly undefined", { maxAttempts: undefined, baseDelayMs: undefined, maxDelayMs: undefined, retryOn: undefined }],
  ])("%s resolves to the defaults", (_, policy) => {
    expect(resolveRetryPolicy(policy)).toEqual(defaults);
  });

  test("fields fall back one by one, not as a block", () => {
    const retryOn = () => true;
    expect(resolveRetryPolicy({ maxAttempts: 5, baseDelayMs: undefined, retryOn })).toEqual({ ...defaults, maxAttempts: 5, retryOn });
    expect(resolveRetryPolicy({ maxDelayMs: 0 })).toEqual({ ...defaults, maxDelayMs: 0 });
  });

  test("an explicitly undefined maxAttempts still stops at the default", async () => {
    const fn = vi.fn(failing(fail("NetworkError")));
    await settle(retry(fn, { maxAttempts: undefined, baseDelayMs: undefined }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test.each<[string, tRetryPolicy]>([
    ["maxAttempts 0", { maxAttempts: 0 }],
    ["maxAttempts -1", { maxAttempts: -1 }],
    ["maxAttempts 1.5", { maxAttempts: 1.5 }],
    ["maxAttempts NaN", { maxAttempts: Number.NaN }],
    ["maxAttempts Infinity", { maxAttempts: Number.POSITIVE_INFINITY }],
    ["maxAttempts as a string", { maxAttempts: "3" as unknown as number }],
    ["baseDelayMs -1", { baseDelayMs: -1 }],
    ["baseDelayMs NaN", { baseDelayMs: Number.NaN }],
    ["maxDelayMs Infinity", { maxDelayMs: Number.POSITIVE_INFINITY }],
    ["retryOn not a function", { retryOn: true as unknown as () => boolean }],
  ])("%s is a TypeError before the first attempt", async (_, policy) => {
    expect(() => resolveRetryPolicy(policy)).toThrow(TypeError);
    const fn = vi.fn();
    await expect(retry(fn, policy)).rejects.toThrow(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("parseRetryAfter", () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  test.each([
    ["0", 0],
    ["5", 5000],
    [" 12 ", 12000],
    ["120", 120000],
    [new Date(now + 30000).toUTCString(), 30000],
    [new Date(now - 30000).toUTCString(), 0],
    [new Date(now).toUTCString(), 0],
  ])("parses %s", (header, ms) => {
    expect(parseRetryAfter(header, now)).toBe(ms);
  });
  test.each([null, "", "   ", "soon", "5s", "5.5", "-5", "+5", "1e3", "2026-10-07"])("ignores %s", (header) => {
    expect(parseRetryAfter(header, now)).toBeUndefined();
  });
  test("defaults now to the clock", () => {
    vi.setSystemTime(now);
    expect(parseRetryAfter(new Date(now + 1000).toUTCString())).toBe(1000);
  });
});

describe("sleep", () => {
  test("resolves after the delay", async () => {
    const p = sleep(100).then(() => "done");
    await vi.advanceTimersByTimeAsync(99);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("done");
  });
  test("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(100, controller.signal)).rejects.toBe(controller.signal.reason);
    expect(vi.getTimerCount()).toBe(0);
  });
  test("rejects on abort and clears the timer", async () => {
    const controller = new AbortController();
    const p = sleep(100, controller.signal);
    const assertion = expect(p).rejects.toThrow("stop");
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error("stop"));
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});

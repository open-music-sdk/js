import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

// Only the clock and timeouts are faked, so setImmediate still drains microtasks for us.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Watches a promise without awaiting it. */
function track(p: Promise<unknown>) {
  const s = { state: "pending" as "pending" | "resolved" | "rejected", reason: undefined as unknown };
  p.then(
    () => (s.state = "resolved"),
    (reason: unknown) => {
      s.state = "rejected";
      s.reason = reason;
    },
  );
  return s;
}

describe("createRateLimiter", () => {
  test("lets `capacity` requests through at once, then makes the next wait", async () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1 });
    const first = [track(limiter.acquire()), track(limiter.acquire()), track(limiter.acquire())];
    const fourth = track(limiter.acquire());
    await flush();
    expect(first.map((s) => s.state)).toEqual(["resolved", "resolved", "resolved"]);
    expect(fourth.state).toBe("pending");
  });

  test.each([
    [1, 2, 500],
    [1, 10, 100],
    [1, 0.5, 2000],
    [2, 4, 250],
  ])("capacity %s at %s/s: the first excess request waits %s ms", async (capacity, refillPerSecond, waitMs) => {
    const limiter = createRateLimiter({ capacity, refillPerSecond });
    for (let i = 0; i < capacity; i++) await limiter.acquire();
    const next = track(limiter.acquire());
    await vi.advanceTimersByTimeAsync(waitMs - 1);
    expect(next.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(next.state).toBe("resolved");
  });

  test("refills while idle, up to capacity and no further", async () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 10 });
    await limiter.acquire();
    await limiter.acquire();
    await vi.advanceTimersByTimeAsync(10_000);
    const burst = [track(limiter.acquire()), track(limiter.acquire())];
    const third = track(limiter.acquire());
    await flush();
    expect(burst.map((s) => s.state)).toEqual(["resolved", "resolved"]);
    expect(third.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(100);
    expect(third.state).toBe("resolved");
  });

  test("spaces a queue evenly at the refill rate, in order", async () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 4 });
    const order: string[] = [];
    const waiters = ["a", "b", "c", "d"].map((name) => limiter.acquire().then(() => order.push(name)));
    await flush();
    expect(order).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(250);
    expect(order).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(250);
    expect(order).toEqual(["a", "b", "c"]);
    await vi.advanceTimersByTimeAsync(250);
    expect(order).toEqual(["a", "b", "c", "d"]);
    await Promise.all(waiters);
  });

  test("a request that was being paced resolves on time after an earlier one", async () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    await limiter.acquire();
    await vi.advanceTimersByTimeAsync(400);
    const next = track(limiter.acquire());
    await vi.advanceTimersByTimeAsync(599);
    expect(next.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(next.state).toBe("resolved");
  });

  test("an aborted waiter rejects with the reason and gives its slot to the next", async () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    await limiter.acquire();
    const controller = new AbortController();
    const aborted = track(limiter.acquire(controller.signal));
    const next = track(limiter.acquire());
    await vi.advanceTimersByTimeAsync(100);
    const reason = new Error("stop");
    controller.abort(reason);
    await flush();
    expect(aborted.state).toBe("rejected");
    expect(aborted.reason).toBe(reason);
    expect(next.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(900);
    expect(next.state).toBe("resolved");
  });

  test("an already aborted signal rejects without spending a token", async () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.acquire(controller.signal)).rejects.toBe(controller.signal.reason);
    const next = track(limiter.acquire());
    await flush();
    expect(next.state).toBe("resolved");
  });

  test("resolves to undefined", async () => {
    await expect(createRateLimiter({ capacity: 1, refillPerSecond: 1 }).acquire()).resolves.toBeUndefined();
  });
});

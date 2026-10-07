import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

// Only the clocks and timeouts are faked, so setImmediate still drains microtasks for us.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
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

  describe("abort leaves the queue at once, from any position, without spending a token", () => {
    /** capacity 1 at 1/s, drained; waiters a (head, sleeping), b, c queued behind. */
    async function queued() {
      const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
      await limiter.acquire();
      const controllers = [new AbortController(), new AbortController(), new AbortController()];
      const waiters = controllers.map((c) => track(limiter.acquire(c.signal)));
      await vi.advanceTimersByTimeAsync(100);
      return { limiter, controllers, waiters };
    }

    test.each([
      ["the head", 0],
      ["the middle", 1],
      ["the tail", 2],
    ])("aborting %s rejects it immediately and the others keep their timing", async (_, index) => {
      const { controllers, waiters } = await queued();
      const reason = new Error("stop");
      controllers[index]?.abort(reason);
      await flush();
      expect(waiters[index]).toEqual({ state: "rejected", reason });
      const rest = waiters.filter((_, i) => i !== index);
      expect(rest.map((w) => w.state)).toEqual(["pending", "pending"]);
      await vi.advanceTimersByTimeAsync(900); // one token after the drain started
      expect(rest.map((w) => w.state)).toEqual(["resolved", "pending"]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(rest.map((w) => w.state)).toEqual(["resolved", "resolved"]);
    });

    test("aborting every waiter empties the queue and leaves no timer running", async () => {
      const { limiter, controllers, waiters } = await queued();
      for (const c of controllers) c.abort(new Error("stop"));
      await flush();
      expect(waiters.map((w) => w.state)).toEqual(["rejected", "rejected", "rejected"]);
      expect(vi.getTimerCount()).toBe(0);
      const later = track(limiter.acquire());
      await vi.advanceTimersByTimeAsync(899);
      expect(later.state).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(later.state).toBe("resolved");
    });

    test("an already aborted signal rejects before joining the queue", async () => {
      const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
      const controller = new AbortController();
      controller.abort();
      await expect(limiter.acquire(controller.signal)).rejects.toBe(controller.signal.reason);
      const next = track(limiter.acquire());
      await flush();
      expect(next.state).toBe("resolved");
    });

    test("a waiter aborted after being granted is unaffected", async () => {
      const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
      const controller = new AbortController();
      await limiter.acquire(controller.signal);
      controller.abort();
      const next = track(limiter.acquire());
      await flush();
      expect(next.state).toBe("resolved");
    });
  });

  test("a backwards clock step cannot stall the queue", async () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    await limiter.acquire();
    vi.setSystemTime(Date.now() - 60_000);
    const next = track(limiter.acquire());
    await vi.advanceTimersByTimeAsync(1000);
    expect(next.state).toBe("resolved");
  });

  test("resolves to undefined", async () => {
    await expect(createRateLimiter({ capacity: 1, refillPerSecond: 1 }).acquire()).resolves.toBeUndefined();
  });
});

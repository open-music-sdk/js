/**
 * What paces requests: the client asks it before each attempt is sent, and sends when it answers. `createRateLimiter`
 * makes one; an app may hand the client its own, with the same `acquire`.
 */
export interface tRateLimiter {
  /**
   * Resolves when a request may go. Rejects with the abort reason as soon as `signal` fires, wherever the caller is in
   * the queue. What it rejects with, the request that asked rejects with, as it is.
   *
   * @param signal - The request's own signal, when it has one.
   * @throws The reason `signal` aborted with, when it does.
   */
  acquire(signal?: AbortSignal): Promise<void>;
}

interface tWaiter {
  /** Set when a token is this waiter's: a mark it finds when its own timer fires. */
  granted: boolean;
}

/**
 * Token bucket: `capacity` requests may go at once, then one every 1/`refillPerSecond` seconds.
 * Apple counts its limit per developer token, so share one limiter across every client using that token.
 *
 * @param options - How fast requests may go: how many at once, and how many a second after that.
 * @returns A limiter that grants in the order asked, one request per token in the bucket.
 * @throws TypeError if `options` is no object, `capacity` is not a finite number of at least 1, or `refillPerSecond` is not a finite number above 0.
 */
export function createRateLimiter({
  capacity,
  refillPerSecond,
}: {
  /** How many requests may go at once, from a full bucket: a finite number of at least 1. */
  capacity: number;
  /** How many requests a second may go once the bucket is empty: a finite number above 0. */
  refillPerSecond: number;
}): tRateLimiter {
  // Anything else either never grants (NaN, capacity 0 with no refill) or waits for Infinity, which
  // setTimeout silently turns into 1 ms: a limiter that limits nothing.
  if (!Number.isFinite(capacity) || capacity < 1) throw new TypeError(`createRateLimiter: capacity must be a number of at least 1, got ${String(capacity)}`);
  if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0)
    throw new TypeError(`createRateLimiter: refillPerSecond must be a positive number, got ${String(refillPerSecond)}`);
  let tokens = capacity;
  let refilledAt = performance.now();
  const queue: tWaiter[] = [];

  const refill = () => {
    const now = performance.now();
    tokens = Math.min(capacity, tokens + ((now - refilledAt) / 1000) * refillPerSecond);
    refilledAt = now;
  };

  // Grants in the order asked, while tokens last. A grant only marks the waiter, which finds the mark when its own
  // timer fires: no caller waits on a timer another caller set. Cloudflare Workers tie a timer to the request that
  // set it and end it with that request, and a request left waiting on such a timer never answers.
  const grant = () => {
    refill();
    const turns = queue.splice(0, Math.min(queue.length, Math.floor(tokens)));
    tokens -= turns.length;
    for (const waiter of turns) waiter.granted = true;
  };

  return {
    async acquire(signal) {
      signal?.throwIfAborted();
      const waiter: tWaiter = { granted: false };
      queue.push(waiter);
      grant();
      // Each wait is this caller's own, until the next token: a waiter ahead that leaves only makes the turn come sooner.
      while (!waiter.granted) {
        await new Promise<void>((resolve, reject) => {
          const leave = () => {
            clearTimeout(timer);
            queue.splice(0, queue.length, ...queue.filter((each) => each !== waiter));
            reject(signal?.reason as Error);
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", leave);
            resolve();
          }, Math.max(0, ((1 - tokens) / refillPerSecond) * 1000));
          signal?.addEventListener("abort", leave, { once: true });
        });
        grant();
      }
    },
  };
}

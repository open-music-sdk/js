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
  readonly grant: () => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
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
  let draining = false;
  let wake: (() => void) | undefined;

  const refill = () => {
    const now = performance.now();
    tokens = Math.min(capacity, tokens + ((now - refilledAt) / 1000) * refillPerSecond);
    refilledAt = now;
  };

  // One loop serves the queue in order: grant while tokens last, otherwise wait for the next one.
  // The wait is for a token, not for a particular waiter, so a waiter leaving mid-wait changes nothing
  // unless the queue is now empty, in which case the loop is woken to stop.
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        refill();
        if (tokens >= 1) {
          tokens -= 1;
          const waiter = queue.shift();
          if (waiter) {
            waiter.signal?.removeEventListener("abort", waiter.onAbort);
            waiter.grant();
          }
          continue;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ((1 - tokens) / refillPerSecond) * 1000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = undefined;
      }
    } finally {
      draining = false;
    }
  }

  return {
    async acquire(signal) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve) => {
        const waiter: tWaiter = {
          grant: resolve,
          signal,
          onAbort: () => {
            queue.splice(queue.indexOf(waiter), 1);
            resolve();
            if (queue.length === 0) wake?.();
          },
        };
        queue.push(waiter);
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        void drain();
      });
      signal?.throwIfAborted();
    },
  };
}

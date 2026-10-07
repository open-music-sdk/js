import { sleep } from "./retry.js";

export interface tRateLimiter {
  /** Resolves when a request may go. Rejects with the abort reason if `signal` fires first. */
  acquire(signal?: AbortSignal): Promise<void>;
}

/**
 * Token bucket: `capacity` requests may go at once, then one every 1/`refillPerSecond` seconds.
 * Apple counts its limit per developer token, so share one limiter across every client using that token.
 */
export function createRateLimiter({ capacity, refillPerSecond }: { capacity: number; refillPerSecond: number }): tRateLimiter {
  let tokens = capacity;
  let refilledAt = Date.now();
  let queue: Promise<unknown> = Promise.resolve();
  const refill = () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - refilledAt) / 1000) * refillPerSecond);
    refilledAt = now;
  };
  return {
    acquire(signal) {
      // FIFO: each caller waits for the one before it, so a burst drains in order.
      const turn = queue.then(async () => {
        signal?.throwIfAborted();
        refill();
        if (tokens < 1) {
          await sleep(((1 - tokens) / refillPerSecond) * 1000, signal);
          refill();
        }
        tokens -= 1;
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

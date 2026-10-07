import { type AppleMusicError, isAppleMusicError } from "./errors.js";

export interface tRetryPolicy {
  /** Attempts in total, the first included. Default 2. */
  readonly maxAttempts?: number;
  /** Upper bound of the first backoff in milliseconds; doubles each attempt. Default 250. */
  readonly baseDelayMs?: number;
  /** Cap on the backoff. A Retry-After header is honoured beyond it. Default 4000. */
  readonly maxDelayMs?: number;
  /** Which errors deserve another attempt. Default: `retryable`. */
  readonly retryOn?: (error: AppleMusicError) => boolean;
}

/** Network failures, 429, and 5xx other than 501 (reserved, never implemented). */
export const retryable = (e: AppleMusicError): boolean =>
  e._tag === "NetworkError" || e._tag === "RateLimited" || (e._tag === "ApiError" && e.status !== undefined && e.status >= 500 && e.status !== 501);

const DEFAULTS = { maxAttempts: 2, baseDelayMs: 250, maxDelayMs: 4000, retryOn: retryable };

/** Runs `fn` until it resolves or the policy gives up. Waits with full jitter, or for Retry-After when the error carries one. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, policy: tRetryPolicy = {}, signal?: AbortSignal): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, retryOn } = { ...DEFAULTS, ...policy };
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= maxAttempts || !isAppleMusicError(e) || !retryOn(e)) throw e;
      await sleep(e.retryAfterMs ?? Math.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)), signal);
    }
  }
}

/** Retry-After as milliseconds: delay-seconds or an HTTP date. Undefined when absent or unreadable. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Resolves after `ms`, or rejects with the abort reason. */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  signal?.throwIfAborted();
}

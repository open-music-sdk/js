import { type AppleMusicError, isAppleMusicError } from "./errors.js";

/** Every field is optional and an explicit `undefined` means the default. Invalid values throw a TypeError. */
export interface tRetryPolicy {
  /** Attempts in total, the first included. A positive integer. Default 2. */
  readonly maxAttempts?: number | undefined;
  /** Upper bound of the first backoff in milliseconds; doubles each attempt. Default 250. */
  readonly baseDelayMs?: number | undefined;
  /** Cap on the backoff. A Retry-After header is honoured beyond it. Default 4000. */
  readonly maxDelayMs?: number | undefined;
  /** Which errors deserve another attempt. Default: `retryable`. */
  readonly retryOn?: ((error: AppleMusicError) => boolean) | undefined;
}

/** Network failures, 429, and 5xx other than 501 (reserved, never implemented). */
export const retryable = (e: AppleMusicError): boolean =>
  e._tag === "NetworkError" || e._tag === "RateLimited" || (e._tag === "ApiError" && e.status !== undefined && e.status >= 500 && e.status !== 501);

export interface tResolvedRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryOn: (error: AppleMusicError) => boolean;
}

const DEFAULTS: tResolvedRetryPolicy = { maxAttempts: 2, baseDelayMs: 250, maxDelayMs: 4000, retryOn: retryable };

/** Fills in defaults field by field and rejects anything that would retry forever or wait for NaN. */
export function resolveRetryPolicy(policy: tRetryPolicy = {}): tResolvedRetryPolicy {
  const maxAttempts = policy.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = policy.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = policy.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const retryOn = policy.retryOn ?? DEFAULTS.retryOn;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError(`retry: maxAttempts must be a positive integer, got ${String(maxAttempts)}`);
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new TypeError(`retry: baseDelayMs must be a non-negative number, got ${String(baseDelayMs)}`);
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) throw new TypeError(`retry: maxDelayMs must be a non-negative number, got ${String(maxDelayMs)}`);
  if (typeof retryOn !== "function") throw new TypeError(`retry: retryOn must be a function, got ${typeof retryOn}`);
  return { maxAttempts, baseDelayMs, maxDelayMs, retryOn };
}

/** Runs `fn` until it resolves or the policy gives up. Waits with full jitter, or for Retry-After when the error carries one. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, policy?: tRetryPolicy, signal?: AbortSignal): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, retryOn } = resolveRetryPolicy(policy);
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

import { type AppleMusicError, isAppleMusicError } from "./errors";
import { got } from "./got";

/** Every field is optional and an explicit `undefined` means the default. Invalid values throw a TypeError. */
export interface tRetryPolicy {
  /** Attempts in total, the first included. A positive integer. Default 2. */
  readonly maxAttempts?: number | undefined;
  /** Upper bound of the first backoff in milliseconds; doubles each attempt. Default 250. */
  readonly baseDelayMs?: number | undefined;
  /** Cap on the backoff. A Retry-After header is honoured beyond it, up to maxRetryAfterMs. Default 4000. */
  readonly maxDelayMs?: number | undefined;
  /**
   * The longest Retry-After to wait for. A longer one is not waited for: the error is thrown at once with
   * `retryAfterMs` attached so the caller can decide. Default 60 000; at most 2^31 - 1 (setTimeout's limit).
   */
  readonly maxRetryAfterMs?: number | undefined;
  /** Which errors deserve another attempt. Default: `retryable`. A client asks this of a POST only for an error that says the POST was not carried out. */
  readonly retryOn?: ((error: AppleMusicError) => boolean) | undefined;
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const transient = (status: number | undefined) => status !== undefined && status >= 500 && status !== 501;

/**
 * Network failures, 429, and 5xx other than 501 (reserved, never implemented). A developer token that could not
 * be obtained is judged the same way, by what its source answered: no status means the source was unreachable.
 *
 * @param e - The error an attempt failed with.
 * @returns Whether another attempt is worth making: a `NetworkError`, a `RateLimited`, an `ApiError` with a 5xx status
 * other than 501, or a `DeveloperTokenUnavailable` with no status, a 429 or such a 5xx.
 */
export const retryable = (e: AppleMusicError): boolean =>
  e._tag === "NetworkError" ||
  e._tag === "RateLimited" ||
  (e._tag === "ApiError" && transient(e.status)) ||
  (e._tag === "DeveloperTokenUnavailable" && (e.status === undefined || e.status === 429 || transient(e.status)));

export interface tResolvedRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxRetryAfterMs: number;
  readonly retryOn: (error: AppleMusicError) => boolean;
}

const DEFAULTS: tResolvedRetryPolicy = { maxAttempts: 2, baseDelayMs: 250, maxDelayMs: 4000, maxRetryAfterMs: 60_000, retryOn: retryable };

const delay = (name: string, value: number, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new TypeError(`retry: ${name} must be a number from 0 to ${String(max)}, got ${String(value)}`);
  return value;
};

/** Fills in defaults field by field and rejects anything that would retry forever or wait for NaN. */
export function resolveRetryPolicy(policy: tRetryPolicy = {}): tResolvedRetryPolicy {
  const maxAttempts = policy.maxAttempts ?? DEFAULTS.maxAttempts;
  const retryOn = policy.retryOn ?? DEFAULTS.retryOn;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError(`retry: maxAttempts must be a positive integer, got ${String(maxAttempts)}`);
  if (typeof retryOn !== "function") throw new TypeError(`retry: retryOn must be a function, got ${typeof retryOn}`);
  return {
    maxAttempts,
    baseDelayMs: delay("baseDelayMs", policy.baseDelayMs ?? DEFAULTS.baseDelayMs),
    maxDelayMs: delay("maxDelayMs", policy.maxDelayMs ?? DEFAULTS.maxDelayMs),
    maxRetryAfterMs: delay("maxRetryAfterMs", policy.maxRetryAfterMs ?? DEFAULTS.maxRetryAfterMs, MAX_TIMEOUT_MS),
    retryOn,
  };
}

/**
 * Runs `fn` until it resolves or the policy gives up. Waits with full jitter, or for Retry-After when the
 * error carries one and it is within maxRetryAfterMs; a longer Retry-After ends the retrying immediately.
 *
 * Only an `AppleMusicError` that `retryOn` accepts is tried again; anything else `fn` rejects with ends the retrying
 * there and then. The attempts are numbered from 1, and `fn` is told which it is on.
 *
 * @param fn - One attempt, given its number; what it resolves to is the answer.
 * @param policy - How many attempts and how long between them; each field left out is the default.
 * @param signal - Ends the retrying: no attempt is begun and no wait goes on once it has fired.
 * @returns What the first attempt to succeed resolved to.
 * @throws TypeError if a field of `policy` is not what `tRetryPolicy` says, or `signal` is no AbortSignal.
 * @throws Whatever the last attempt rejected with, as it is, when it is no `AppleMusicError`, `retryOn` turns it down,
 * its `retryAfterMs` is beyond `maxRetryAfterMs`, or the attempts are used up; and whatever `retryOn` itself throws.
 * @throws The reason `signal` aborted with, when it does.
 */
export async function retry<T>(fn: (attempt: number) => Promise<T>, policy?: tRetryPolicy, signal?: AbortSignal): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, maxRetryAfterMs, retryOn } = resolveRetryPolicy(policy);
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= maxAttempts || !isAppleMusicError(e) || !retryOn(e)) throw e;
      if (e.retryAfterMs !== undefined && e.retryAfterMs > maxRetryAfterMs) throw e;
      // The power is kept to one a number can hold: past it, a base of 0 would come to no number at all, which is no wait.
      await sleep(e.retryAfterMs ?? Math.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempt - 1, 1023)), signal);
    }
  }
}

/**
 * Retry-After as milliseconds: delay-seconds or an HTTP date. Undefined when absent or unreadable.
 *
 * @param header - The header's value, or `null` when the answer had none.
 * @param now - The moment a date is measured from, in milliseconds since the epoch. Default: now.
 * @returns How long the header asks to wait, in milliseconds and never below 0, or `undefined` when there is no header or it is neither a whole number of seconds nor a date.
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // Only a date is left. V8 reads bare numerals like "5.5" or "-5" as dates too, so insist on a month name.
  const date = /[A-Za-z]/.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Resolves after `ms`, or rejects with the abort reason. What it is handed is checked, since other packages call
 * it too: a wait that is no number of milliseconds from 0, or has no end, is a TypeError, and so is a signal that
 * is none. A wait longer than a timer keeps is kept as several, so that it is never over at once.
 *
 * @param ms - How long to wait, in milliseconds: a number from 0, and not infinity.
 * @param signal - Ends the wait early.
 * @throws TypeError if `ms` is not a number of milliseconds from 0, or is without end, or `signal` is given and is no AbortSignal.
 * @throws The reason `signal` aborted with, when it does.
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (typeof ms !== "number" || !(ms >= 0) || ms === Number.POSITIVE_INFINITY) throw new TypeError(`sleep: ms must be a number of milliseconds from 0, and not without end; got ${got(ms)}`);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError(`sleep: signal must be an AbortSignal; got ${got(signal)}`);
  let left = ms;
  for (; left > MAX_TIMEOUT_MS; left -= MAX_TIMEOUT_MS) await timer(MAX_TIMEOUT_MS, signal);
  await timer(left, signal);
}

/** One timer, for a wait it can keep. */
async function timer(ms: number, signal?: AbortSignal): Promise<void> {
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

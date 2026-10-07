import type { tTokenContext } from "@open-music-sdk/core";

/** A core `tTokenProvider` that always answers with a promise and needs no context, so it is easy to call directly. */
export type tDeveloperTokenProvider = (ctx?: tTokenContext) => Promise<string>;

/** A token and the moment it stops working, in epoch milliseconds. */
export interface tIssued {
  readonly token: string;
  readonly expiresAt: number;
}

const DAY_SECONDS = 86_400;
/**
 * While a usable token is held, its source is asked at most this often. A token issued moments ago would only be
 * issued the same again, so Apple rejecting it is no reason to ask; and a source that just failed is left alone.
 */
const MIN_ISSUE_INTERVAL_MS = 60_000;

/** `flight`, unless `signal` aborts first, in which case its reason is thrown. The flight itself is left running. */
export async function orAbort<T>(flight: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return flight;
  const settled = new AbortController();
  const aborted = new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => {
      resolve();
    }, { once: true, signal: settled.signal });
  });
  try {
    await Promise.race([flight, aborted]);
    signal.throwIfAborted();
    return await flight;
  } finally {
    settled.abort(); // drops the listener
  }
}

/**
 * A token provider over `issue` that issues once and reuses the token. From `refreshAheadSeconds` before it
 * expires the token is replaced in the background while it keeps being handed out; only when there is no
 * usable token does a caller wait for one, or see the failure to get one. Concurrent callers share one issue.
 *
 * The margin never exceeds half of the life a token had left when it arrived, so a short-lived token is
 * still reused rather than replaced on every call. While a usable token is held, the source is asked at
 * most once a minute, whatever Apple or the local clock say about the token.
 */
export function cached(issue: () => Promise<tIssued>, refreshAheadSeconds = DAY_SECONDS): tDeveloperTokenProvider {
  if (!Number.isFinite(refreshAheadSeconds) || refreshAheadSeconds < 0)
    throw new TypeError(`developer token: refreshAheadSeconds must be a number from 0, got ${String(refreshAheadSeconds)}`);
  let current: { token: string; refreshAt: number; expiresAt: number } | undefined;
  let flight: Promise<string> | undefined;
  // When the source was last asked, on the clock that cannot step: the interval must not depend on the wall clock.
  let askedAt = Number.NEGATIVE_INFINITY;

  const refresh = async (): Promise<string> => {
    askedAt = performance.now();
    try {
      const issued = await issue();
      const now = Date.now();
      // A token that looks expired on arrival may be sound and the local clock fast. It gets one interval of use:
      // if it works, the source is asked once a minute instead of once a request; if not, Apple says so.
      const expiresAt = issued.expiresAt > now ? issued.expiresAt : now + MIN_ISSUE_INTERVAL_MS;
      current = { token: issued.token, expiresAt, refreshAt: expiresAt - Math.min(refreshAheadSeconds * 1000, (expiresAt - now) / 2) };
      return issued.token;
    } finally {
      flight = undefined;
    }
  };

  return async ({ signal, rejected } = {}) => {
    signal?.throwIfAborted();
    if (current !== undefined && Date.now() < current.expiresAt) {
      const held = current.token;
      const replacementWanted = held === rejected || Date.now() >= current.refreshAt;
      // An issue already under way is joined. A new one is started only once the interval has passed.
      const mayAsk = flight !== undefined || performance.now() - askedAt >= MIN_ISSUE_INTERVAL_MS;
      if (!replacementWanted || !mayAsk) return held;
      if (held !== rejected) {
        // Refreshing ahead: the held token is good until its exp, so nobody waits for the replacement and
        // a failure to get one disturbs nobody. It is asked for again in a minute.
        if (flight === undefined) (flight = refresh()).catch(ignore);
        return held;
      }
      // Apple's 401 does not prove the token bad (under /v1/me it can be about the listener), so when no
      // replacement can be had the held token stays the best there is.
      try {
        return await orAbort((flight ??= refresh()), signal);
      } catch {
        signal?.throwIfAborted();
        return held;
      }
    }
    return orAbort((flight ??= refresh()), signal);
  };
}

const ignore = () => undefined;

import type { tTokenContext } from "@open-music-sdk/core";

/** A core `tTokenProvider` that always answers with a promise and needs no context, so it is easy to call directly. */
export type tDeveloperTokenProvider = (ctx?: tTokenContext) => Promise<string>;

/** A token and the moment it stops working, in epoch milliseconds. */
export interface tIssued {
  readonly token: string;
  readonly expiresAt: number;
}

const DAY_SECONDS = 86_400;

/** `flight`, unless the caller's own signal aborts first. The flight is shared, so it is never cancelled. */
async function orAbort<T>(flight: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
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
 * A token provider over `issue` that issues once and reuses the token until `refreshAheadSeconds` before
 * it expires, or until Apple rejects it. Concurrent callers share one issue. Failures are not cached.
 *
 * The margin never exceeds half of the life a token had left when it arrived, so a short-lived token is
 * still reused rather than replaced on every call.
 */
export function cached(issue: () => Promise<tIssued>, refreshAheadSeconds = DAY_SECONDS): tDeveloperTokenProvider {
  if (!Number.isFinite(refreshAheadSeconds) || refreshAheadSeconds < 0)
    throw new TypeError(`developer token: refreshAheadSeconds must be a number from 0, got ${String(refreshAheadSeconds)}`);
  let current: { token: string; refreshAt: number } | undefined;
  let flight: Promise<string> | undefined;

  const refresh = async (): Promise<string> => {
    try {
      const { token, expiresAt } = await issue();
      current = { token, refreshAt: expiresAt - Math.min(refreshAheadSeconds * 1000, (expiresAt - Date.now()) / 2) };
      return token;
    } finally {
      flight = undefined;
    }
  };

  // ponytail: a failed refresh inside the margin throws although the old token still works;
  // serve it stale and refresh in the background if token-endpoint outages start to bite.
  return async ({ signal, rejected } = {}) => {
    signal?.throwIfAborted();
    if (current !== undefined && current.token !== rejected && Date.now() < current.refreshAt) return current.token;
    return orAbort((flight ??= refresh()), signal);
  };
}

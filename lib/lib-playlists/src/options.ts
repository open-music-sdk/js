// The options the verbs share, each read and checked in one place, so that the same option means the same thing
// whichever verb it is handed to.
import { got, sleep } from "@open-music-sdk/core";

/** How far a verb has got, counted in tracks. */
export interface tProgress {
  /** How many tracks are done with. */
  readonly done: number;
  /** How many there are in all, or `undefined` where that is not known until the end, as when a playlist is read. */
  readonly total: number | undefined;
}

/** What every verb that asks Apple takes. An explicit `undefined` means the option was not given. */
export interface tAskOptions {
  /** Aborts the verb: the request in flight, and any wait between requests. An abort is rethrown as it is. */
  readonly signal?: AbortSignal | undefined;
  /** Called each time more tracks are done with. What it throws stops the verb, and is what the verb rejects with. */
  readonly onProgress?: ((progress: tProgress) => void) | undefined;
}

/** What a verb that makes several requests of its own takes beside: how long to leave between them. */
export interface tPaceOptions {
  /**
   * How long to wait after one request before the next, in milliseconds. Default 0: no wait. The client's own rate
   * limiter and its wait after a 429 apply underneath, whatever this says.
   */
  readonly delayMs?: number | undefined;
}

/** The longest a timer waits: past it, `setTimeout` fires at once. */
const MAX_WAIT_MS = 2 ** 31 - 1;

/** A signal as `fetch` will take it. Anything else would be found out late, by the runtime, whose own complaint prints what it was handed. */
export function signalOf(fn: string, value: unknown): AbortSignal | undefined {
  if (value === undefined || value instanceof AbortSignal) return value;
  throw new TypeError(`${fn}: signal must be an AbortSignal; got ${got(value)}`);
}

/** What a verb calls as it gets on: the caller's `onProgress`, handed a frozen progress of its own, or nothing when none was given. */
export function progressOf(fn: string, value: unknown): (done: number, total: number | undefined) => void {
  if (value === undefined) return () => undefined;
  if (typeof value !== "function") throw new TypeError(`${fn}: onProgress must be a function; got ${got(value)}`);
  const heard = value as (progress: tProgress) => void;
  return (done, total) => {
    heard(Object.freeze({ done, total }));
  };
}

/** A wait in milliseconds, under the name the caller gave it: `fallback` when it was not given. */
export function waitOf(fn: string, name: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && value >= 0 && value <= MAX_WAIT_MS) return value;
  throw new TypeError(`${fn}: ${name} must be a number of milliseconds from 0 to ${String(MAX_WAIT_MS)}; got ${got(value)}`);
}

/** A whole number from `least` to `most`, under the name the caller gave it: `fallback` when it was not given. */
export function countOf(fn: string, name: string, value: unknown, least: number, most: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (Number.isSafeInteger(value) && (value as number) >= least && (value as number) <= most) return value as number;
  throw new TypeError(`${fn}: ${name} must be a whole number from ${String(least)}${most === Number.MAX_SAFE_INTEGER ? "" : ` to ${String(most)}`}; got ${got(value)}`);
}

/** Waits `ms`, or not at all when it is 0, and stops waiting as soon as the signal aborts. */
export async function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms > 0) await sleep(ms, signal);
  else signal?.throwIfAborted();
}

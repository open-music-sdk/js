import { afterEach, describe, expect, test, vi } from "vitest";
import { countOf, maxPagesOf, pause, progressOf, waitOf } from "./options";

afterEach(() => {
  vi.useRealTimers();
});

describe("progressOf", () => {
  test("with none given, there is still something to call, and it does nothing", () => {
    expect(() => {
      progressOf("playlists.apply", undefined)(1, 2);
    }).not.toThrow();
  });

  test("the caller's function is handed how far things are, as a frozen object of its own each time", () => {
    const heard = vi.fn();
    const report = progressOf("playlists.apply", heard);
    report(100, 250);
    report(3, undefined);
    expect(heard.mock.calls).toEqual([[{ done: 100, total: 250 }], [{ done: 3, total: undefined }]]);
    expect(heard.mock.calls.every(([progress]) => Object.isFrozen(progress))).toBe(true);
  });

  test("what the caller's function throws is thrown to whoever reported", () => {
    const stop = new Error("enough");
    expect(() => {
      progressOf("playlists.apply", () => {
        throw stop;
      })(1, 1);
    }).toThrow(stop);
  });

  test.each<[string, unknown]>([
    ["a string", "progress"],
    ["an object", { onProgress: () => undefined }],
    ["null", null],
  ])("%s is refused, under the verb's name", (_name, value) => {
    expect(() => progressOf("playlists.apply", value)).toThrow(/^playlists\.apply: onProgress must be a function; got /);
  });
});

describe("waitOf", () => {
  test("not given, it is the fallback; given, it is what was given", () => {
    expect(waitOf("playlists.apply", "delayMs", undefined, 0)).toBe(0);
    expect(waitOf("playlists.apply", "settle.waitMs", undefined, 1000)).toBe(1000);
    expect([0, 0.5, 250, 2 ** 31 - 1].map((ms) => waitOf("playlists.apply", "delayMs", ms, 7))).toEqual([0, 0.5, 250, 2 ** 31 - 1]);
  });

  test.each<[string, unknown]>([
    ["below zero", -1],
    ["past what a timer waits", 2 ** 31],
    ["not a number", Number.NaN],
    ["without end", Number.POSITIVE_INFINITY],
    ["a string", "250"],
    ["null", null],
  ])("a wait that is %s is refused, under the verb's name and the option's", (_name, value) => {
    expect(() => waitOf("playlists.apply", "settle.waitMs", value, 0)).toThrow(/^playlists\.apply: settle\.waitMs must be a number of milliseconds from 0 to 2147483647; got /);
  });
});

describe("countOf", () => {
  test("not given, it is the fallback; given, it is what was given", () => {
    expect(countOf("playlists.apply", "chunk", undefined, 1, 300, 100)).toBe(100);
    expect([1, 100, 300].map((count) => countOf("playlists.apply", "chunk", count, 1, 300, 100))).toEqual([1, 100, 300]);
  });

  test.each<[string, unknown]>([
    ["below the least", 0],
    ["above the most", 301],
    ["a fraction", 1.5],
    ["not a number", Number.NaN],
    ["a string", "100"],
    ["null", null],
  ])("a count that is %s is refused, with the range it has to be in", (_name, value) => {
    expect(() => countOf("playlists.apply", "chunk", value, 1, 300, 100)).toThrow(/^playlists\.apply: chunk must be a whole number from 1 to 300; got /);
  });

  test("a count with no most says only where it starts", () => {
    expect(() => countOf("playlists.apply", "settle.tries", 0, 1, Number.MAX_SAFE_INTEGER, 5)).toThrow(new TypeError("playlists.apply: settle.tries must be a whole number from 1; got 0"));
    expect(countOf("playlists.apply", "settle.tries", 1_000_000, 1, Number.MAX_SAFE_INTEGER, 5)).toBe(1_000_000);
  });
});

describe("maxPagesOf", () => {
  test("not given, there is no limit; given, it is what was given", () => {
    expect(maxPagesOf("playlists.read", undefined)).toBeUndefined();
    expect([1, 2, 500].map((pages) => maxPagesOf("playlists.read", pages))).toEqual([1, 2, 500]);
  });

  test.each<[string, unknown]>([
    ["none", 0],
    ["below zero", -1],
    ["a fraction", 2.5],
    ["without end", Number.POSITIVE_INFINITY],
    ["a string", "2"],
    ["null", null],
  ])("a limit that is %s is refused, under the verb's name", (_name, value) => {
    expect(() => maxPagesOf("playlists.read", value)).toThrow(/^playlists\.read: maxPages must be a whole number from 1; got /);
  });
});

describe("pause", () => {
  test("waits as long as it is told", async () => {
    vi.useFakeTimers();
    const waited = vi.fn();
    void pause(250, undefined).then(waited);
    await vi.advanceTimersByTimeAsync(249);
    expect(waited).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(waited).toHaveBeenCalled();
  });

  test("a wait of nothing sets no timer", async () => {
    vi.useFakeTimers();
    await pause(0, undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("stops waiting as soon as the signal aborts, and rejects with its reason", async () => {
    const controller = new AbortController();
    const waiting = pause(60_000, controller.signal);
    controller.abort(new Error("stop"));
    await expect(waiting).rejects.toThrow("stop");
  });

  test("a signal already aborted is heard even where there is nothing to wait for", async () => {
    await expect(pause(0, AbortSignal.abort(new Error("stop")))).rejects.toThrow("stop");
  });
});

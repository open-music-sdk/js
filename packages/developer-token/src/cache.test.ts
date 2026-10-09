import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cached, orAbort, type tIssued } from "./cache.js";

const NOW = Date.UTC(2026, 9, 7);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An issuer that hands out t1, t2, … each living for `life` from the moment it is issued. */
function issuer(life = 150 * DAY) {
  let n = 0;
  return vi.fn((): Promise<tIssued> => Promise.resolve({ token: `t${String(++n)}`, expiresAt: Date.now() + life }));
}

/** An issuer whose every call stays pending until the test settles it. */
function manual() {
  const pending: { resolve: (issued: tIssued) => void; reject: (e: Error) => void }[] = [];
  const issue = vi.fn(() => new Promise<tIssued>((resolve, reject) => pending.push({ resolve, reject })));
  return { issue, pending };
}

const outcome = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

/** Lets a replacement that is under way in the background finish. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Moves time to `ms` after the start, on the wall clock and the monotonic clock together. */
const at = (ms: number) => {
  vi.advanceTimersByTime(NOW + ms - Date.now());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cached: validation", () => {
  test.each([0, 1, 60, 86_400, 1e9])("accepts refreshAheadSeconds %s", (seconds) => {
    expect(() => cached(issuer(), seconds)).not.toThrow();
  });
  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "60" as unknown as number, null as unknown as number])(
    "rejects refreshAheadSeconds %s",
    (seconds) => {
      expect(() => cached(issuer(), seconds)).toThrow(TypeError);
    },
  );
  test.each([
    ["an hour", HOUR],
    ["ten days", 10 * DAY],
    ["150 days", 150 * DAY],
  ])("with no margin given, a token that lives %s is replaced halfway through its life", async (_name, life) => {
    for (const provider of [cached(issuer(life)), cached(issuer(life), undefined)]) {
      vi.setSystemTime(NOW);
      const first = await provider({});
      at(life / 2 - 1);
      expect(await provider({})).toBe(first);
      await flush();
      expect(await provider({})).toBe(first); // nothing was replaced behind that call
      at(life / 2);
      await provider({});
      await flush();
      expect(await provider({})).not.toBe(first);
    }
  });
});

describe("cached: a token is issued once and reused", () => {
  test("nothing is issued until the first call", () => {
    const issue = issuer();
    cached(issue);
    expect(issue).not.toHaveBeenCalled();
  });

  test("sequential calls get the same token from one issue", async () => {
    const issue = issuer();
    const provider = cached(issue);
    expect([await provider({}), await provider({}), await provider({})]).toEqual(["t1", "t1", "t1"]);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  test("concurrent calls on a cold cache share one issue", async () => {
    const { issue, pending } = manual();
    const provider = cached(issue);
    const calls = [provider({}), provider({}), provider({ rejected: "old" })];
    pending[0]?.resolve({ token: "t1", expiresAt: NOW + DAY });
    expect(await Promise.all(calls)).toEqual(["t1", "t1", "t1"]);
    expect(issue).toHaveBeenCalledTimes(1);
  });
});

describe("cached: a token is replaced before it expires", () => {
  test.each([
    ["the margin, when the token lives longer than twice the margin", 10 * HOUR, 3600, 9 * HOUR],
    ["zero, so the token is used until exp", 10 * HOUR, 0, 10 * HOUR],
    ["half the life, when the margin is longer than that", 10 * HOUR, 86_400, 5 * HOUR],
    ["half the life, when the margin is longer than the whole life", HOUR, 1e9, HOUR / 2],
  ])("the refresh point is exp minus %s", async (_name, life, refreshAheadSeconds, refreshAfter) => {
    const issue = issuer(life);
    const provider = cached(issue, refreshAheadSeconds);
    expect(await provider({})).toBe("t1");
    at(refreshAfter - 1);
    expect(await provider({})).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
    at(refreshAfter);
    await provider({});
    expect(issue).toHaveBeenCalledTimes(2);
    await flush();
    expect(await provider({})).toBe("t2");
  });

  test("concurrent calls at the refresh point share one issue", async () => {
    const issue = issuer(10 * HOUR);
    const provider = cached(issue, 3600);
    await provider({});
    at(9 * HOUR);
    await Promise.all([provider({}), provider({}), provider({})]);
    await flush();
    expect(await provider({})).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });
});

describe("cached: past its refresh point a token keeps working while it is replaced", () => {
  /** A provider holding t1, which lives ten hours and is due for replacement an hour before that. */
  function held(issue: () => Promise<tIssued>) {
    const provider = cached(issue, 3600);
    const first = provider({});
    return { provider, first };
  }
  const t1 = { token: "t1", expiresAt: NOW + 10 * HOUR };
  const t2 = { token: "t2", expiresAt: NOW + 20 * HOUR };

  test("the call that finds it due gets the held token at once, and the replacement serves the calls after it", async () => {
    const { issue, pending } = manual();
    const { provider, first } = held(issue);
    pending[0]?.resolve(t1);
    await first;
    at(9 * HOUR);
    expect(await provider({})).toBe("t1"); // resolved although the replacement is still pending
    expect(issue).toHaveBeenCalledTimes(2);
    pending[1]?.resolve(t2);
    await flush();
    expect(await provider({})).toBe("t2");
  });

  test("calls made while the replacement is under way get the held token and start no second issue", async () => {
    const { issue, pending } = manual();
    const { provider, first } = held(issue);
    pending[0]?.resolve(t1);
    await first;
    at(9 * HOUR);
    expect([await provider({}), await provider({}), await provider({ signal: new AbortController().signal })]).toEqual(["t1", "t1", "t1"]);
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test("a replacement that fails disturbs nobody: no call rejects and nothing goes unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { issue, pending } = manual();
    const { provider, first } = held(issue);
    pending[0]?.resolve(t1);
    await first;
    at(9 * HOUR);
    const during = provider({});
    pending[1]?.reject(new Error("source down"));
    await flush();
    process.off("unhandledRejection", unhandled);
    expect([await during, await provider({})]).toEqual(["t1", "t1"]);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("after a failed replacement the source is left alone for a minute, then asked again", async () => {
    const issue = issuer(10 * HOUR);
    const provider = cached(issue, 3600);
    await provider({});
    issue.mockRejectedValue(new Error("source down"));
    at(9 * HOUR);
    for (const ms of [0, 1000, 30_000, MINUTE - 1]) {
      at(9 * HOUR + ms);
      expect(await provider({})).toBe("t1");
      await flush();
    }
    expect(issue).toHaveBeenCalledTimes(2);
    at(9 * HOUR + MINUTE);
    expect(await provider({})).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(3);
  });

  test("an outage of the source that ends before exp is never seen by a caller", async () => {
    const issue = issuer(10 * HOUR);
    const provider = cached(issue, 3600);
    await provider({});
    issue.mockRejectedValue(new Error("source down"));
    const seen: string[] = [];
    for (let minute = 0; minute < 45; minute++) {
      at(9 * HOUR + minute * MINUTE);
      if (minute === 40) issue.mockImplementation(() => Promise.resolve({ token: "t2", expiresAt: NOW + 30 * HOUR }));
      seen.push(await provider({}));
      await flush();
    }
    expect(new Set(seen.slice(0, 41))).toEqual(new Set(["t1"])); // the call that started the good replacement still got t1
    expect(new Set(seen.slice(41))).toEqual(new Set(["t2"]));
  });

  test("it stops at exp: from then the token is not handed out, callers wait, and a failure is theirs to see", async () => {
    const issue = issuer(10 * HOUR);
    const provider = cached(issue, 3600);
    await provider({});
    issue.mockRejectedValue(new Error("source down"));
    at(10 * HOUR - 1);
    expect(await provider({})).toBe("t1");
    await flush();
    at(10 * HOUR);
    await expect(provider({})).rejects.toThrow("source down");
  });

  test("a token due for replacement that Apple also rejects is replaced before that call returns", async () => {
    const issue = issuer(10 * HOUR);
    const provider = cached(issue, 3600);
    await provider({});
    at(9 * HOUR);
    expect(await provider({ rejected: "t1" })).toBe("t2");
  });

  test("a caller that joins a background replacement because Apple rejected the token waits for it", async () => {
    const { issue, pending } = manual();
    const { provider, first } = held(issue);
    pending[0]?.resolve(t1);
    await first;
    at(9 * HOUR);
    expect(await provider({})).toBe("t1");
    const rejectedCall = provider({ rejected: "t1" });
    pending[1]?.resolve(t2);
    expect(await rejectedCall).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });
});

describe("cached: a rejected token is replaced", () => {
  test("the current token, rejected a minute after it was issued, is issued again", async () => {
    const issue = issuer();
    const provider = cached(issue);
    expect(await provider({})).toBe("t1");
    at(MINUTE);
    expect(await provider({ rejected: "t1" })).toBe("t2");
    expect(await provider({})).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test("many requests rejected with the same token cause one replacement", async () => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    at(MINUTE);
    expect(await Promise.all([provider({ rejected: "t1" }), provider({ rejected: "t1" }), provider({ rejected: "t1" })])).toEqual(["t2", "t2", "t2"]);
    expect(await provider({ rejected: "t1" })).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test.each(["t0", "", "something else entirely"])("a rejection of %j, which is not the current token, changes nothing", async (rejected) => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    at(MINUTE);
    expect(await provider({ rejected })).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
  });
});

describe("cached: while a usable token is held, its source is asked at most once a minute", () => {
  test.each([0, 1, 30_000, MINUTE - 1])("a token rejected %i ms after it was issued is handed back, not replaced", async (age) => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    at(age);
    expect(await provider({ rejected: "t1" })).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
  });

  test("a storm of rejections costs one issue a minute, however many requests are in it", async () => {
    const issue = issuer();
    const provider = cached(issue);
    let token = await provider({});
    for (let second = 1; second <= 180; second++) {
      at(second * 1000);
      // Each of five requests is answered 401 by Apple and asks for a replacement of whatever it was given.
      for (let i = 0; i < 5; i++) token = await provider({ rejected: token });
    }
    expect(issue).toHaveBeenCalledTimes(4); // the first, then one each at 60, 120 and 180 seconds
    expect(token).toBe("t4");
  });

  test("a replacement that cannot be had leaves the held token in service, and the source alone for a minute", async () => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    at(MINUTE);
    issue.mockRejectedValueOnce(new Error("source down"));
    expect(await provider({ rejected: "t1" })).toBe("t1");
    expect(await provider({})).toBe("t1");
    at(2 * MINUTE - 1);
    expect(await provider({ rejected: "t1" })).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(2);
    at(2 * MINUTE);
    expect(await provider({ rejected: "t1" })).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(3);
  });

  test("an abort while a replacement is awaited is the caller's abort, whether or not the replacement then fails", async () => {
    const { issue, pending } = manual();
    const provider = cached(issue);
    const first = provider({});
    pending[0]?.resolve({ token: "t1", expiresAt: NOW + DAY });
    await first;
    at(MINUTE);
    const controller = new AbortController();
    const reason = new Error("gone");
    const waiting = outcome(provider({ rejected: "t1", signal: controller.signal }));
    controller.abort(reason);
    pending[1]?.reject(new Error("source down"));
    expect(await waiting).toEqual({ error: reason });
  });

  test("a token that looks expired on arrival is used for a minute rather than fetched for every call", async () => {
    // To this clock the token is an hour past its exp. If the clock is fast the token is fine; if not, Apple says so.
    const issue = issuer(-HOUR);
    const provider = cached(issue);
    for (const ms of [0, 1000, 30_000, MINUTE - 1]) {
      at(ms);
      expect(await provider({})).toBe("t1");
    }
    expect(issue).toHaveBeenCalledTimes(1);
    at(MINUTE);
    expect(await provider({})).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test("and when Apple rejects it within that minute, it is handed back rather than fetched again", async () => {
    const issue = issuer(-HOUR);
    const provider = cached(issue);
    await provider({});
    at(1000);
    expect(await provider({ rejected: "t1" })).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
  });

  test("the minute is not shortened by the wall clock stepping forward", async () => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    vi.setSystemTime(NOW + HOUR);
    expect(await provider({ rejected: "t1" })).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
  });

  test("the minute is not lengthened by the wall clock stepping back", async () => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    vi.setSystemTime(NOW - HOUR);
    vi.advanceTimersByTime(MINUTE);
    expect(await provider({ rejected: "t1" })).toBe("t2");
  });
});

describe("cached: an expired token is never handed out", () => {
  test("once past its exp, a token is replaced before anything is returned", async () => {
    const issue = issuer(HOUR);
    const provider = cached(issue, 0);
    expect(await provider({})).toBe("t1");
    at(HOUR);
    expect(await provider({})).toBe("t2");
  });

  test("with nothing usable to fall back on, every call asks the source and a failure is thrown, minute or no minute", async () => {
    const issue = issuer(HOUR);
    const provider = cached(issue, 0);
    await provider({});
    at(HOUR);
    issue.mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("still down"));
    await expect(provider({})).rejects.toThrow("down");
    await expect(provider({ rejected: "t1" })).rejects.toThrow("still down");
    expect(await provider({})).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(4);
  });
});

describe("cached: failures are not cached", () => {
  test("every waiter sees the failure and the next call issues again", async () => {
    const { issue, pending } = manual();
    const provider = cached(issue);
    const boom = new Error("boom");
    const calls = [outcome(provider({})), outcome(provider({}))];
    pending[0]?.reject(boom);
    expect(await Promise.all(calls)).toEqual([{ error: boom }, { error: boom }]);

    const next = provider({});
    pending[1]?.resolve({ token: "t1", expiresAt: NOW + DAY });
    expect(await next).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(2);
  });
});

describe("cached: an issuer that throws instead of rejecting is a failed issue like any other", () => {
  const thrower = (message: string) => () => {
    throw new Error(message);
  };

  test("one throw fails that call alone: the next asks the issuer again and gets its token", async () => {
    const issue = issuer();
    issue.mockImplementationOnce(thrower("threw"));
    const provider = cached(issue);
    await expect(provider({})).rejects.toThrow("threw");
    expect([await provider({}), await provider({})]).toEqual(["t1", "t1"]);
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test("an issuer that always throws is asked on every call, and nothing is remembered between them", async () => {
    const issue = vi.fn(thrower("always"));
    const provider = cached(issue);
    for (let i = 0; i < 4; i++) await expect(provider({})).rejects.toThrow("always");
    expect(issue).toHaveBeenCalledTimes(4);
  });

  test("callers that arrive together share the one failed issue, and the caller after them starts a new one", async () => {
    const issue = issuer();
    issue.mockImplementationOnce(thrower("threw"));
    const provider = cached(issue);
    const together = await Promise.all([outcome(provider({})), outcome(provider({})), outcome(provider({ signal: new AbortController().signal }))]);
    expect(together.map((o) => ("error" in o ? (o.error as Error).message : o.value))).toEqual(["threw", "threw", "threw"]);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(await provider({})).toBe("t1");
  });

  test("thrown while a token is refreshed ahead, it disturbs nobody and the next minute's attempt replaces the token", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const issue = issuer(10 * HOUR);
    const provider = cached(issue, 3600);
    await provider({});
    issue.mockImplementationOnce(thrower("threw"));
    at(9 * HOUR);
    expect(await provider({})).toBe("t1");
    await flush();
    at(9 * HOUR + MINUTE);
    expect(await provider({})).toBe("t1");
    await flush();
    process.off("unhandledRejection", unhandled);
    expect(await provider({})).toBe("t2");
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("thrown while a rejected token is replaced, the held token stays in service and is replaced a minute later", async () => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    issue.mockImplementationOnce(thrower("threw"));
    at(MINUTE);
    expect(await provider({ rejected: "t1" })).toBe("t1");
    at(2 * MINUTE);
    expect(await provider({ rejected: "t1" })).toBe("t2");
  });

  test("thrown when the held token has expired, the call fails and the provider is not left broken", async () => {
    const issue = issuer(HOUR);
    const provider = cached(issue, 0);
    await provider({});
    issue.mockImplementationOnce(thrower("threw"));
    at(HOUR);
    await expect(provider({})).rejects.toThrow("threw");
    expect(await provider({})).toBe("t2");
  });
});

describe("cached: a caller's abort is its own", () => {
  test("an already aborted signal rejects without issuing", async () => {
    const issue = issuer();
    const reason = new Error("gone");
    await expect(cached(issue)({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(issue).not.toHaveBeenCalled();
  });

  test("an already aborted signal rejects even when a token is cached", async () => {
    const provider = cached(issuer());
    await provider({});
    const reason = new Error("gone");
    await expect(provider({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });

  test("aborting one waiter rejects it at once and leaves the others and the cache alone", async () => {
    const { issue, pending } = manual();
    const provider = cached(issue);
    const controller = new AbortController();
    const reason = new Error("gone");
    const aborted = outcome(provider({ signal: controller.signal }));
    const other = provider({ signal: new AbortController().signal });
    const plain = provider({});

    controller.abort(reason);
    expect(await aborted).toEqual({ error: reason });

    pending[0]?.resolve({ token: "t1", expiresAt: NOW + DAY });
    expect(await Promise.all([other, plain])).toEqual(["t1", "t1"]);
    expect(await provider({})).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
  });

  test("a flight every waiter abandoned still fills the cache", async () => {
    const { issue, pending } = manual();
    const provider = cached(issue);
    const controller = new AbortController();
    const abandoned = outcome(provider({ signal: controller.signal }));
    controller.abort(new Error("gone"));
    await abandoned;

    pending[0]?.resolve({ token: "t1", expiresAt: NOW + DAY });
    expect(await provider({})).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
  });

  test("a flight that fails after every waiter abandoned it is not an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { issue, pending } = manual();
    const controller = new AbortController();
    const abandoned = outcome(cached(issue)({ signal: controller.signal }));
    controller.abort(new Error("gone"));
    await abandoned;
    pending[0]?.reject(new Error("boom"));
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test.each([
    ["resolves", (pending: ReturnType<typeof manual>["pending"]) => pending[0]?.resolve({ token: "t1", expiresAt: NOW + DAY })],
    ["rejects", (pending: ReturnType<typeof manual>["pending"]) => pending[0]?.reject(new Error("boom"))],
  ])("a signal that many calls waited on carries no listener once the issue %s", async (_name, settle) => {
    const { issue, pending } = manual();
    const provider = cached(issue);
    const controller = new AbortController();
    const calls = [1, 2, 3].map(() => outcome(provider({ signal: controller.signal })));
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(3);
    settle(pending);
    await Promise.all(calls);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  test("a call answered from the cache never touches the signal", async () => {
    const provider = cached(issuer());
    await provider({});
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    await provider({ signal: controller.signal });
    expect(add).not.toHaveBeenCalled();
  });
});

describe("cached: called directly", () => {
  test("it needs no context at all", async () => {
    const provider = cached(issuer());
    expect([await provider(), await provider(undefined), await provider({})]).toEqual(["t1", "t1", "t1"]);
  });
});

describe("orAbort", () => {
  const never = new Promise<string>(() => undefined);

  test.each([
    ["no signal", undefined],
    ["a signal that never aborts", new AbortController().signal],
  ])("with %s, it is the flight: its value", async (_name, signal) => {
    expect(await orAbort(Promise.resolve("value"), signal)).toBe("value");
  });

  test.each([
    ["no signal", undefined],
    ["a signal that never aborts", new AbortController().signal],
  ])("with %s, it is the flight: its failure", async (_name, signal) => {
    const boom = new Error("boom");
    await expect(orAbort(Promise.reject(boom), signal)).rejects.toBe(boom);
  });

  test.each([
    ["an Error", new Error("gone")],
    ["a DOMException", new DOMException("too slow", "TimeoutError")],
    ["a string", "gone"],
  ])("an abort with %s as its reason rejects with that reason while the flight is still pending", async (_name, reason) => {
    const controller = new AbortController();
    const waiting = outcome(orAbort(never, controller.signal));
    controller.abort(reason);
    expect(await waiting).toEqual({ error: reason });
  });

  test("a signal aborted before the call rejects at once, without waiting for a flight that may never settle", async () => {
    const reason = new Error("gone");
    await expect(orAbort(never, AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  test("an abort does not cancel the flight or swallow its result for anyone else", async () => {
    const { issue, pending } = manual();
    const flight = issue().then((issued) => issued.token);
    const controller = new AbortController();
    const aborted = outcome(orAbort(flight, controller.signal));
    const patient = orAbort(flight, new AbortController().signal);
    controller.abort(new Error("gone"));
    await aborted;
    pending[0]?.resolve({ token: "t1", expiresAt: NOW + DAY });
    expect(await patient).toBe("t1");
  });

  test("a flight that fails after the abort is not an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { issue, pending } = manual();
    const controller = new AbortController();
    const aborted = outcome(orAbort(issue(), controller.signal));
    controller.abort(new Error("gone"));
    await aborted;
    pending[0]?.reject(new Error("boom"));
    await flush();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

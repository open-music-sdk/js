import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cached, type tIssued } from "./cache.js";

const NOW = Date.UTC(2026, 9, 7);
const HOUR = 3_600_000;
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

const outcome = (p: Promise<string>) =>
  p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
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
  test("undefined means the default of one day", async () => {
    const issue = issuer(10 * DAY);
    const provider = cached(issue, undefined);
    await provider({});
    vi.setSystemTime(NOW + 9 * DAY - 1);
    await provider({});
    expect(issue).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 9 * DAY);
    await provider({});
    expect(issue).toHaveBeenCalledTimes(2);
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
    vi.setSystemTime(NOW + refreshAfter - 1);
    expect(await provider({})).toBe("t1");
    vi.setSystemTime(NOW + refreshAfter);
    expect(await provider({})).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test("a token that arrives already expired is never reused", async () => {
    const issue = issuer(-HOUR);
    const provider = cached(issue);
    expect([await provider({}), await provider({})]).toEqual(["t1", "t2"]);
  });

  test("concurrent calls at the refresh point share one issue", async () => {
    const issue = issuer(10 * HOUR);
    const provider = cached(issue, 3600);
    await provider({});
    vi.setSystemTime(NOW + 9 * HOUR);
    expect(await Promise.all([provider({}), provider({}), provider({})])).toEqual(["t2", "t2", "t2"]);
    expect(issue).toHaveBeenCalledTimes(2);
  });
});

describe("cached: a rejected token is replaced", () => {
  test("the current token, once rejected, is issued again", async () => {
    const issue = issuer();
    const provider = cached(issue);
    expect(await provider({})).toBe("t1");
    expect(await provider({ rejected: "t1" })).toBe("t2");
    expect(await provider({})).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test("many requests rejected with the same token cause one replacement", async () => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    expect(await Promise.all([provider({ rejected: "t1" }), provider({ rejected: "t1" }), provider({ rejected: "t1" })])).toEqual(["t2", "t2", "t2"]);
    expect(await provider({ rejected: "t1" })).toBe("t2");
    expect(issue).toHaveBeenCalledTimes(2);
  });

  test.each(["t0", "", "something else entirely"])("a rejection of %j, which is not the current token, changes nothing", async (rejected) => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    expect(await provider({ rejected })).toBe("t1");
    expect(issue).toHaveBeenCalledTimes(1);
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

  test("a failed replacement leaves the rejected token rejected", async () => {
    const issue = issuer();
    const provider = cached(issue);
    await provider({});
    issue.mockRejectedValueOnce(new Error("boom"));
    await expect(provider({ rejected: "t1" })).rejects.toThrow("boom");
    expect(await provider({ rejected: "t1" })).toBe("t2");
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

  test("no listener is left on the signal after the call settles", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const provider = cached(issuer());
    await provider({ signal: controller.signal });
    // The listener is registered with a signal of its own, which the call aborts when it settles.
    const options = add.mock.calls[0]?.[2] as AddEventListenerOptions;
    expect(options.signal?.aborted).toBe(true);
  });
});

import { createClient, isAppleMusicError, type AppleMusicError } from "@open-music-sdk/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { remoteDeveloperToken } from "./remote.js";

const NOW = Date.UTC(2026, 9, 7);
const NOW_SECONDS = NOW / 1000;
const HOUR_SECONDS = 3600;
const ENDPOINT = "https://app.example/api/token";

const b64url = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
/** Something shaped like a developer token. The provider reads `exp` and never checks the signature. */
const jwt = (claims: unknown = { iss: "DEF123GHIJ", iat: NOW_SECONDS, exp: NOW_SECONDS + 12 * HOUR_SECONDS }, signature = "c2ln") =>
  `${b64url({ alg: "ES256", kid: "ABC123DEFG" })}.${b64url(claims)}.${signature}`;
const expiring = (inSeconds: number, tag = "") => jwt({ exp: NOW_SECONDS + inSeconds }, `sig${tag}`);

type tReply = { status?: number; text?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> } | Error | "hang";

/** Every Response the fake endpoint handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A token endpoint that answers from a queue of replies and records how it was called. */
function endpoint(...replies: tReply[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    const reply = replies.shift() ?? { text: jwt() };
    if (reply instanceof Error) return Promise.reject(reply);
    if (reply === "hang")
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      });
    const res = new Response(reply.body ?? reply.text ?? JSON.stringify(reply.json), { status: reply.status ?? 200, headers: reply.headers ?? {} });
    responses.push(res);
    return Promise.resolve(res);
  };
  return { fetch, calls };
}

const failure = async (p: Promise<unknown>): Promise<AppleMusicError> => {
  try {
    await p;
  } catch (e) {
    if (isAppleMusicError(e)) return e;
    throw new Error(`expected an AppleMusicError, got ${String(e)}`, { cause: e });
  }
  throw new Error("expected a rejection");
};

/** A body stream that fails after the headers have arrived. */
const brokenBody = () =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("connection reset"));
    },
  });

/** Lets a fetch that is under way in the background finish. */
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
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("remoteDeveloperToken: configuration", () => {
  test.each(["https://app.example/api/token", "http://localhost:3000/token", new URL("https://app.example/token?tenant=1")])("accepts %s", (url) => {
    expect(() => remoteDeveloperToken(url, { fetch: endpoint().fetch })).not.toThrow();
  });

  const notHttp = ["file:///etc/token", "data:text/plain,abc", "javascript:alert(1)", "ftp://app.example/token", "blob:https://app.example/1", "mailto:token@app.example", "ws://app.example/token"];

  test.each(notHttp)("refuses %j when it is created, with or without a document", (url) => {
    expect(() => remoteDeveloperToken(url, { fetch: endpoint().fetch })).toThrow(TypeError);
    vi.stubGlobal("document", { baseURI: "https://app.example/music/index.html" });
    try {
      expect(() => remoteDeveloperToken(url, { fetch: endpoint().fetch })).toThrow(TypeError);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test.each([1, 250, 10_000, 2 ** 31 - 1])("accepts timeoutMs %s", (timeoutMs) => {
    expect(() => remoteDeveloperToken(ENDPOINT, { fetch: endpoint().fetch, timeoutMs })).not.toThrow();
  });
  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, "1000" as unknown as number])("refuses timeoutMs %s", (timeoutMs) => {
    expect(() => remoteDeveloperToken(ENDPOINT, { fetch: endpoint().fetch, timeoutMs })).toThrow(TypeError);
  });
  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("refuses refreshAheadSeconds %s", (refreshAheadSeconds) => {
    expect(() => remoteDeveloperToken(ENDPOINT, { fetch: endpoint().fetch, refreshAheadSeconds })).toThrow(TypeError);
  });
  test("refuses a fetch that is not a function", () => {
    expect(() => remoteDeveloperToken(ENDPOINT, { fetch: "fetch" as unknown as typeof fetch })).toThrow(TypeError);
  });
  test("undefined options mean the defaults", () => {
    expect(() => remoteDeveloperToken(ENDPOINT, { fetch: undefined, timeoutMs: undefined, refreshAheadSeconds: undefined })).not.toThrow();
  });
  test("nothing is fetched until the first call", () => {
    const { fetch, calls } = endpoint();
    remoteDeveloperToken(ENDPOINT, { fetch });
    expect(calls).toEqual([]);
  });
});

describe("remoteDeveloperToken: what the URL carries stays out of errors", () => {
  /** Everything an error shows when it is printed, serialised, or inspected, without its cause. */
  const said = (e: Error) => `${e.message} ${e.stack ?? ""} ${JSON.stringify(e, ["name", "message", "stack", "status"])}`;

  test.each(["https://user:hunter2@app.example/token", "https://user@app.example/token", "https://:hunter2@app.example/token", "http://user:hunter2@localhost:3000/token?session=s3cret"])(
    "a URL with a username or password is refused when the provider is created: %s",
    (url) => {
      expect(() => remoteDeveloperToken(url, { fetch: endpoint().fetch })).toThrow(TypeError);
    },
  );

  test.each([
    ["credentials", "https://user:hunter2@app.example/token?session=s3cret"],
    ["a mistyped scheme", "htps://user:hunter2@app.example/token?session=s3cret"],
    ["a scheme that is not http", "ftp://app.example/hunter2?session=s3cret"],
    ["a data URL", "data:text/plain,hunter2-s3cret"],
  ])("refusing a URL with %s does not quote it", (_name, url) => {
    let error: unknown;
    try {
      remoteDeveloperToken(url, { fetch: endpoint().fetch });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(said(error as Error)).not.toMatch(/hunter2|s3cret/);
  });

  test.each([
    ["a fetch whose error spells out the URL", new TypeError(`error sending request for url (${ENDPOINT}?session=s3cret)`), "TypeError"],
    ["a timeout", new DOMException(`${ENDPOINT}?session=s3cret timed out`, "TimeoutError"), "TimeoutError"],
    ["a thrown string", `${ENDPOINT}?session=s3cret` as unknown as Error, "string"],
  ])("after %s, the message names the endpoint and the kind of failure, never the query", async (_name, thrown, kind) => {
    const fetch = () => Promise.reject(thrown);
    const e = await failure(remoteDeveloperToken(`${ENDPOINT}?session=s3cret#frag`, { fetch })({}));
    expect(e.message).toContain(ENDPOINT);
    expect(e.message).toContain(kind);
    expect(said(e)).not.toContain("s3cret");
    expect(e.cause).toBe(thrown); // the runtime's own error is kept for whoever needs the detail
  });

  test.each([
    ["a refusal", { status: 403, text: "s3cret" }],
    ["an answer that is not a token", { text: "s3cret" }],
    ["a token without exp", { text: jwt({ iat: NOW_SECONDS }, "s3cret") }],
  ])("after %s, the message names the endpoint without its query and never quotes the body", async (_name, reply) => {
    const { fetch } = endpoint(reply);
    const e = await failure(remoteDeveloperToken(`${ENDPOINT}?session=hunter2#frag`, { fetch })({}));
    expect(e.message).toContain(ENDPOINT);
    expect(`${said(e)} ${JSON.stringify(e, Object.getOwnPropertyNames(e))}`).not.toMatch(/hunter2|s3cret|frag/);
  });
});

describe("remoteDeveloperToken: a relative URL resolves the way fetch would resolve it", () => {
  const relative = ["/api/token", "api/token", "../token", "?fresh=1", "", "app.example/api/token", "//app.example/api/token"];
  /** Runs `fn` as if in a page at `page`, whose base URL is `base` when a <base href> moved it. */
  async function inDocument<T>(page: string, base: string | undefined, fn: () => T | Promise<T>): Promise<T> {
    vi.stubGlobal("location", { href: page });
    if (base !== undefined) vi.stubGlobal("document", { baseURI: base });
    try {
      return await fn();
    } finally {
      vi.unstubAllGlobals();
    }
  }

  test.each([
    ["/api/token", "https://app.example/api/token"],
    ["api/token", "https://app.example/music/api/token"],
    ["../token", "https://app.example/token"],
    ["?fresh=1", "https://app.example/music/index.html?fresh=1"],
    ["//tokens.example/t", "https://tokens.example/t"],
    ["https://other.example/t", "https://other.example/t"],
  ])("in a page, %j is fetched from %s", async (url, expected) => {
    const page = "https://app.example/music/index.html";
    const { fetch, calls } = endpoint();
    await inDocument(page, page, () => remoteDeveloperToken(url, { fetch })({}));
    expect(calls[0]?.url).toBe(expected);
  });

  test.each([
    ["/api/token", "https://cdn.example/api/token"],
    ["api/token", "https://cdn.example/assets/api/token"],
  ])("under a <base href> on another host, %j is fetched from %s, not from the page's own host", async (url, expected) => {
    const { fetch, calls } = endpoint();
    await inDocument("https://app.example/music/index.html", "https://cdn.example/assets/", () => remoteDeveloperToken(url, { fetch })({}));
    expect(calls[0]?.url).toBe(expected);
  });

  test("in a worker, which has a location but no document, it resolves against the location", async () => {
    const { fetch, calls } = endpoint();
    await inDocument("https://app.example/workers/sync.js", undefined, () => remoteDeveloperToken("/api/token", { fetch })({}));
    expect(calls[0]?.url).toBe("https://app.example/api/token");
  });

  test.each(relative)("with no document, creating a provider for %j neither throws nor fetches, so a server can load the module", (url) => {
    const { fetch, calls } = endpoint();
    expect(() => remoteDeveloperToken(url, { fetch })).not.toThrow();
    expect(calls).toEqual([]);
  });

  test.each(relative)("with no document, using a provider for %j is a TypeError each time, and nothing is fetched", async (url) => {
    const { fetch, calls } = endpoint();
    const provider = remoteDeveloperToken(url, { fetch });
    for (const attempt of [provider({}), provider({})]) {
      const error: unknown = await attempt.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TypeError);
      expect(isAppleMusicError(error)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  test("a client does not retry it: a URL that cannot be resolved is a mistake, not an outage", async () => {
    const { fetch, calls } = endpoint();
    const music = createClient({ developerToken: remoteDeveloperToken("/api/token", { fetch }), fetch, retry: { maxAttempts: 3, baseDelayMs: 0 } });
    await expect(music.request("v1/test")).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });

  test("a provider created before there was a document works once there is one", async () => {
    const { fetch, calls } = endpoint();
    const provider = remoteDeveloperToken("/api/token", { fetch });
    await expect(provider({})).rejects.toThrow(TypeError);
    const page = "https://app.example/";
    expect(await inDocument(page, page, () => provider({}))).toBe(jwt());
    expect(calls[0]?.url).toBe("https://app.example/api/token");
  });

  test.each(["file:///C:/app/index.html", "about:blank", "data:text/html,<p>"])("in a page at %s, where it cannot become an http URL, it is refused", async (page) => {
    const { fetch, calls } = endpoint();
    const outcome = await inDocument(page, page, async () => {
      try {
        return await remoteDeveloperToken("api/token", { fetch })({});
      } catch (e) {
        return e;
      }
    });
    expect(outcome).toBeInstanceOf(TypeError);
    expect(calls).toEqual([]);
  });
});

describe("remoteDeveloperToken: runs on browsers older than its newest built-ins", () => {
  // Each of these arrived after 2022 and is missing from browsers still in wide use.
  const recent: [string, object, string][] = [
    ["URL.parse", URL, "parse"],
    ["URL.canParse", URL, "canParse"],
    ["Promise.withResolvers", Promise, "withResolvers"],
    ["Array.fromAsync", Array, "fromAsync"],
    ["AbortSignal.any", AbortSignal, "any"],
  ];

  test.each(recent)("works without %s", async (_name, owner, method) => {
    const original = Object.getOwnPropertyDescriptor(owner, method);
    Reflect.deleteProperty(owner, method);
    try {
      const { fetch } = endpoint({ text: jwt() }, { status: 503, text: "" });
      const provider = remoteDeveloperToken(ENDPOINT, { fetch });
      expect(await provider({})).toBe(jwt());
      expect(() => remoteDeveloperToken("javascript:alert(1)", { fetch })).toThrow(TypeError);
      await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}));
    } finally {
      if (original) Object.defineProperty(owner, method, original);
    }
  });
});

describe("remoteDeveloperToken: reading the answer", () => {
  const token = jwt();
  test.each([
    ["the JWT as text", { text: token }],
    ["the JWT with whitespace around it", { text: `\n  ${token}\r\n` }],
    ["JSON with a token field", { json: { token } }],
    ["JSON with a token field among others", { json: { expiresIn: 43_200, token, kind: "developer" } }],
    ["pretty-printed JSON", { text: `  {\n  "token": "${token}"\n}\n` }],
    ["a 201", { status: 201, text: token }],
  ])("takes the token from %s", async (_name, reply) => {
    const { fetch } = endpoint(reply);
    expect(await remoteDeveloperToken(ENDPOINT, { fetch })({})).toBe(token);
  });

  test.each([
    ["an empty body", { text: "" }],
    ["a page of markup", { text: "<!doctype html><html><body>App</body></html>" }],
    ["plain words", { text: "Unauthorized" }],
    ["JSON without a token", { json: { jwt: token } }],
    ["JSON whose token is not a string", { json: { token: { value: token } } }],
    ["JSON whose token is null", { json: { token: null } }],
    ["a JSON string", { json: token }],
    ["a JSON array", { json: [token] }],
    ["broken JSON", { text: `{"token": "${token}"` }],
    ["a token with two segments", { text: token.split(".").slice(0, 2).join(".") }],
    ["a token with four segments", { text: `${token}.extra` }],
    ["a token with an empty signature", { text: `${token.split(".").slice(0, 2).join(".")}.` }],
    ["a token with a space in it", { text: token.replace(".", ". ") }],
    ["two tokens on two lines", { text: `${token}\n${token}` }],
    ["a token with a header injection", { text: `${token}\r\nx-evil: 1` }],
    ["a token whose claims are not base64url", { text: "aGVhZGVy.@@@@.c2ln" }],
    ["a token whose claims are not JSON", { text: `aGVhZGVy.${b64url("not json")}.c2ln` }],
    ["a token whose claims are a JSON string", { text: jwt("claims") }],
    ["a token whose claims are null", { text: jwt(null) }],
    ["a token without exp", { text: jwt({ iss: "DEF123GHIJ", iat: NOW_SECONDS }) }],
    ["a token whose exp is a string", { text: jwt({ exp: String(NOW_SECONDS + 60) }) }],
    ["a token whose exp is null", { text: jwt({ exp: null }) }],
  ])("%s is DeveloperTokenUnavailable with the answer's status, not a token", async (_name, reply) => {
    const { fetch } = endpoint(reply);
    const e = await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}));
    expect(e._tag).toBe("DeveloperTokenUnavailable");
    expect(e.status).toBe(200);
  });

  test.each([301, 400, 401, 403, 404, 429, 500, 503])("a %i is DeveloperTokenUnavailable carrying the status, whatever the body", async (status) => {
    const { fetch } = endpoint({ status, text: jwt() });
    const e = await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}));
    expect(e._tag).toBe("DeveloperTokenUnavailable");
    expect(e.status).toBe(status);
  });
});

describe("remoteDeveloperToken: an unreachable endpoint is DeveloperTokenUnavailable with no status", () => {
  test("fetch throwing", async () => {
    const cause = new TypeError("fetch failed");
    const { fetch } = endpoint(cause);
    const e = await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}));
    expect([e._tag, e.status]).toEqual(["DeveloperTokenUnavailable", undefined]);
    expect(e.cause).toBe(cause);
  });

  test("the connection dropping while the body is read", async () => {
    const { fetch } = endpoint({ body: brokenBody() });
    const e = await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}));
    expect([e._tag, e.status]).toEqual(["DeveloperTokenUnavailable", undefined]);
    expect((e.cause as Error).message).toBe("connection reset");
  });

  test("an endpoint that never answers, once timeoutMs has passed", async () => {
    const { fetch } = endpoint("hang");
    const e = await failure(remoteDeveloperToken(ENDPOINT, { fetch, timeoutMs: 20 })({}));
    expect([e._tag, e.status]).toEqual(["DeveloperTokenUnavailable", undefined]);
    expect((e.cause as Error).name).toBe("TimeoutError");
  });

  test("a failure is not remembered: the next call fetches again", async () => {
    const { fetch, calls } = endpoint(new TypeError("fetch failed"), { status: 503, text: "" }, { text: "<html>" }, { text: jwt() });
    const provider = remoteDeveloperToken(ENDPOINT, { fetch });
    await failure(provider({}));
    await failure(provider({}));
    await failure(provider({}));
    expect(await provider({})).toBe(jwt());
    expect(calls).toHaveLength(4);
  });
});

describe("remoteDeveloperToken: timeoutMs holds whatever the fetch it was given does with the signal", () => {
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** A response whose body never ends and ignores every signal. */
  const stalled = () => {
    const res = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("eyJ"));
        },
      }),
    );
    responses.push(res);
    return res;
  };
  /** Fetches that take no notice of the signal, as a wrapper that does not pass `init` on makes them. */
  const deaf: [string, () => Promise<Response>][] = [
    ["never settles", () => new Promise<Response>(() => undefined)],
    ["answers, but only after the timeout", () => later(60).then(() => endpoint({ text: jwt() }).fetch(ENDPOINT))],
    ["fails, but only after the timeout", () => later(60).then(() => Promise.reject(new TypeError("fetch failed")))],
    ["answers with a body that never ends", () => Promise.resolve(stalled())],
  ];

  test.each(deaf)("a fetch that %s is given up on at timeoutMs, as DeveloperTokenUnavailable", async (_name, fetch) => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const e = await failure(remoteDeveloperToken(ENDPOINT, { fetch, timeoutMs: 20 })({}));
    expect([e._tag, e.status, (e.cause as Error).name]).toEqual(["DeveloperTokenUnavailable", undefined, "TimeoutError"]);
    await later(80); // whatever the abandoned fetch does next must be handled, and a late answer must still be read
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("giving up frees the provider: the next call starts a new fetch instead of waiting on the dead one", async () => {
    let n = 0;
    const fetch = (input: RequestInfo | URL) => (++n === 1 ? new Promise<Response>(() => undefined) : endpoint({ text: jwt() }).fetch(input));
    const provider = remoteDeveloperToken(ENDPOINT, { fetch, timeoutMs: 20 });
    await failure(provider({}));
    expect(await provider({})).toBe(jwt());
    expect(n).toBe(2);
  });

  test("every caller sharing the fetch is released at the timeout, not only the one that started it", async () => {
    const provider = remoteDeveloperToken(ENDPOINT, { fetch: () => new Promise<Response>(() => undefined), timeoutMs: 20 });
    const errors = await Promise.all([failure(provider({})), failure(provider({})), failure(provider({ rejected: "x" }))]);
    expect(errors.map((e) => (e.cause as Error).name)).toEqual(["TimeoutError", "TimeoutError", "TimeoutError"]);
  });
});

describe("remoteDeveloperToken: the request", () => {
  test("goes to the configured URL, uncached, with a timeout and nothing else", async () => {
    const { fetch, calls } = endpoint();
    await remoteDeveloperToken(`${ENDPOINT}?tenant=1`, { fetch })({});
    expect(calls[0]?.url).toBe(`${ENDPOINT}?tenant=1`);
    expect(Object.keys(calls[0]?.init ?? {}).sort()).toEqual(["cache", "signal"]);
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("is shared by concurrent callers", async () => {
    const { fetch, calls } = endpoint();
    const provider = remoteDeveloperToken(ENDPOINT, { fetch });
    expect(new Set(await Promise.all([provider({}), provider({}), provider({})])).size).toBe(1);
    expect(calls).toHaveLength(1);
  });

  test("is not cancelled by the caller that started it; the caller alone is rejected", async () => {
    const { fetch, calls } = endpoint("hang");
    const provider = remoteDeveloperToken(ENDPOINT, { fetch, timeoutMs: 50 });
    const controller = new AbortController();
    const reason = new Error("navigated away");
    const first = provider({ signal: controller.signal }).catch((e: unknown) => e);
    const second = failure(provider({}));
    controller.abort(reason);
    expect(await first).toBe(reason);
    expect(calls[0]?.init?.signal?.aborted).toBe(false);
    expect(((await second).cause as Error).name).toBe("TimeoutError"); // the timeout, not the first caller's abort
    expect(calls).toHaveLength(1);
  });
});

describe("remoteDeveloperToken: reuse", () => {
  test("a token is reused until the refresh point before its exp, then fetched again while it is still handed out", async () => {
    const [first, second] = [expiring(12 * HOUR_SECONDS, "1"), expiring(24 * HOUR_SECONDS, "2")];
    const { fetch, calls } = endpoint({ text: first }, { json: { token: second } });
    const provider = remoteDeveloperToken(ENDPOINT, { fetch, refreshAheadSeconds: HOUR_SECONDS });
    expect(await provider({})).toBe(first);
    at(11 * HOUR_SECONDS * 1000 - 1);
    expect(await provider({})).toBe(first);
    at(11 * HOUR_SECONDS * 1000);
    expect(await provider({})).toBe(first);
    expect(calls).toHaveLength(2);
    await flush();
    expect(await provider({})).toBe(second);
    expect(calls).toHaveLength(2);
  });

  test("with the default margin of a day, a shorter-lived token is reused for half its life", async () => {
    const { fetch, calls } = endpoint({ text: expiring(2 * HOUR_SECONDS, "1") }, { text: expiring(4 * HOUR_SECONDS, "2") });
    const provider = remoteDeveloperToken(ENDPOINT, { fetch });
    await provider({});
    at(HOUR_SECONDS * 1000 - 1);
    await provider({});
    expect(calls).toHaveLength(1);
    at(HOUR_SECONDS * 1000);
    await provider({});
    expect(calls).toHaveLength(2);
  });

  test("a token that this clock calls expired on arrival is fetched once a minute, not once a call", async () => {
    // A browser whose clock runs an hour fast sees every token this way, and the tokens are fine.
    const { fetch, calls } = endpoint({ text: expiring(-HOUR_SECONDS, "1") }, { text: expiring(-HOUR_SECONDS, "2") });
    const provider = remoteDeveloperToken(ENDPOINT, { fetch });
    const first = await provider({});
    for (const ms of [1, 20_000, 59_999]) {
      at(ms);
      expect(await provider({})).toBe(first);
    }
    expect(calls).toHaveLength(1);
    at(60_000);
    expect(await provider({})).not.toBe(first);
    expect(calls).toHaveLength(2);
  });

  test("a token Apple rejected is fetched again, once it is a minute old", async () => {
    const [first, second] = [expiring(12 * HOUR_SECONDS, "1"), expiring(12 * HOUR_SECONDS, "2")];
    const { fetch, calls } = endpoint({ text: first }, { text: second });
    const provider = remoteDeveloperToken(ENDPOINT, { fetch });
    expect(await provider({})).toBe(first);
    at(59_999);
    expect(await provider({ rejected: first })).toBe(first);
    expect(calls).toHaveLength(1);
    at(60_000);
    expect(await provider({ rejected: "some other token" })).toBe(first);
    expect(await provider({ rejected: first })).toBe(second);
    expect(await provider({ rejected: first })).toBe(second);
    expect(calls).toHaveLength(2);
  });
});

describe("remoteDeveloperToken as a client's developerToken", () => {
  /** One fetch for both hosts: the token endpoint answers from `tokens`, Apple from `statuses`. */
  function world(tokens: tReply[], statuses: number[]) {
    const tokenEndpoint = endpoint(...tokens);
    const sent: string[] = [];
    const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!(input instanceof Request)) return tokenEndpoint.fetch(input, init);
      sent.push(input.headers.get("authorization") ?? "");
      return Promise.resolve(new Response("{}", { status: statuses.shift() ?? 200 }));
    };
    return { fetch, sent, tokenCalls: tokenEndpoint.calls };
  }

  test("every request carries the one fetched token as a Bearer", async () => {
    const token = jwt();
    const { fetch, sent, tokenCalls } = world([{ text: token }], []);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: false });
    await Promise.all([music.request("v1/test"), music.request("v1/test")]);
    await music.request("v1/test");
    expect(sent).toEqual([`Bearer ${token}`, `Bearer ${token}`, `Bearer ${token}`]);
    expect(tokenCalls).toHaveLength(1);
  });

  test("a 401 from Apple for a token that has been in use fetches a fresh one and resends with it", async () => {
    const [first, second] = [expiring(12 * HOUR_SECONDS, "1"), expiring(12 * HOUR_SECONDS, "2")];
    const { fetch, sent } = world([{ text: first }, { text: second }], [200, 401, 200]);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: false });
    await music.request("v1/test");
    at(5 * 60_000);
    await music.request("v1/test");
    expect(sent).toEqual([`Bearer ${first}`, `Bearer ${first}`, `Bearer ${second}`]);
  });

  test("an endpoint that keeps serving the rejected token ends in DeveloperTokenRejected, without a resend", async () => {
    const token = jwt();
    const { fetch, sent, tokenCalls } = world([{ text: token }, { text: token }], [200, 401]);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: false });
    await music.request("v1/test");
    at(5 * 60_000);
    expect((await failure(music.request("v1/test")))._tag).toBe("DeveloperTokenRejected");
    expect(sent).toHaveLength(2);
    expect(tokenCalls).toHaveLength(2);
  });

  test("an endpoint that is down while a token is refreshed ahead costs requests nothing", async () => {
    const [first, second] = [expiring(12 * HOUR_SECONDS, "1"), expiring(24 * HOUR_SECONDS, "2")];
    const { fetch, sent, tokenCalls } = world([{ text: first }, new TypeError("fetch failed"), { status: 503, text: "" }, { text: second }], []);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch, refreshAheadSeconds: HOUR_SECONDS }), fetch, retry: false });
    await music.request("v1/test");
    for (const minute of [0, 1, 2]) {
      at((11 * HOUR_SECONDS + minute * 60) * 1000);
      await music.request("v1/test"); // each succeeds with the held token; the endpoint is tried once per minute behind it
      await flush();
    }
    await music.request("v1/test");
    expect(sent).toEqual([first, first, first, first, second].map((token) => `Bearer ${token}`));
    expect(tokenCalls).toHaveLength(4);
  });

  test("an endpoint that is still down when the token expires fails the request then, as DeveloperTokenUnavailable", async () => {
    const { fetch, sent } = world([{ text: expiring(12 * HOUR_SECONDS, "1") }, new TypeError("fetch failed"), new TypeError("fetch failed")], []);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch, refreshAheadSeconds: HOUR_SECONDS }), fetch, retry: false });
    await music.request("v1/test");
    at(11 * HOUR_SECONDS * 1000);
    await music.request("v1/test");
    await flush();
    at(12 * HOUR_SECONDS * 1000);
    expect((await failure(music.request("v1/test")))._tag).toBe("DeveloperTokenUnavailable");
    expect(sent).toHaveLength(2);
  });

  test("when Apple rejects everything, the endpoint is asked once a minute and each request reaches Apple once", async () => {
    const tokens = Array.from({ length: 10 }, (_unused, i) => ({ text: expiring(12 * HOUR_SECONDS, String(i)) }));
    const { fetch, sent, tokenCalls } = world(tokens, Array.from({ length: 400 }, () => 401));
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: false });
    for (let second = 0; second < 120; second++) {
      at(second * 1000);
      expect((await failure(music.request("v1/me/library/songs", { user: false })))._tag).toBe("DeveloperTokenRejected");
    }
    expect(tokenCalls).toHaveLength(2); // the first, and the replacement at one minute
    expect(sent).toHaveLength(121); // one per request, plus the single resend that carried the replacement
  });

  test("a token endpoint that is briefly down is retried by the client's policy", async () => {
    const { fetch, sent, tokenCalls } = world([new TypeError("fetch failed"), { status: 503, text: "" }, { text: jwt() }], []);
    const music = createClient({
      developerToken: remoteDeveloperToken(ENDPOINT, { fetch }),
      fetch,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
    });
    await music.request("v1/test");
    expect(tokenCalls).toHaveLength(3);
    expect(sent).toHaveLength(1);
  });

  test("a token endpoint that refuses is not retried: the request fails with its status", async () => {
    const { fetch, sent, tokenCalls } = world([{ status: 403, text: "" }], []);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: { maxAttempts: 3, baseDelayMs: 0 } });
    const e = await failure(music.request("v1/test"));
    expect([e._tag, e.status]).toEqual(["DeveloperTokenUnavailable", 403]);
    expect(tokenCalls).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  test.each([
    [401, "DeveloperTokenRejected"],
    [403, "UserTokenInvalid"],
    [404, "ApiError"],
    [429, "RateLimited"],
    [500, "ApiError"],
  ] as const)("the endpoint's own %i is never reported under %s, the tag the same status from Apple would get", async (status, applesTag) => {
    const { fetch } = world([{ status, text: "" }], []);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: false, userToken: "user" });
    const e = await failure(music.request("v1/me/library/songs"));
    expect(e._tag).toBe("DeveloperTokenUnavailable");
    expect(isAppleMusicError(e, applesTag)).toBe(false);
    expect(e.status).toBe(status);
  });

  test("a rate-limited endpoint is retried, as Apple's 429 would be", async () => {
    const { fetch, sent, tokenCalls } = world([{ status: 429, text: "", headers: { "retry-after": "0" } }, { text: jwt() }], []);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: { maxAttempts: 2, baseDelayMs: 0 } });
    await music.request("v1/test");
    expect(tokenCalls).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  test("the endpoint's Retry-After decides how long the client waits before asking it again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"], now: NOW });
    const { fetch, sent, tokenCalls } = world([{ status: 503, text: "", headers: { "retry-after": "3" } }, { text: jwt() }], []);
    const music = createClient({ developerToken: remoteDeveloperToken(ENDPOINT, { fetch }), fetch, retry: { maxAttempts: 2 } });
    const done = music.request("v1/test");
    await vi.advanceTimersByTimeAsync(2999);
    expect(tokenCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(tokenCalls).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });
});

describe("remoteDeveloperToken: Retry-After", () => {
  test.each([
    ["seconds", "120", 120_000],
    ["zero", "0", 0],
    ["an HTTP date", new Date(NOW + 90_000).toUTCString(), 90_000],
  ])("given as %s is carried on the error in milliseconds", async (_name, header, expected) => {
    const { fetch } = endpoint({ status: 503, text: "", headers: { "retry-after": header } });
    expect((await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}))).retryAfterMs).toBe(expected);
  });

  test.each([
    ["absent", {}],
    ["unreadable", { "retry-after": "soon" }],
    ["negative", { "retry-after": "-5" }],
  ])("%s leaves retryAfterMs undefined", async (_name, headers) => {
    const { fetch } = endpoint({ status: 503, text: "", headers });
    expect((await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}))).retryAfterMs).toBeUndefined();
  });

  test("on an answer that is not a failure, it is ignored", async () => {
    const { fetch } = endpoint({ text: "not a token", headers: { "retry-after": "120" } });
    expect((await failure(remoteDeveloperToken(ENDPOINT, { fetch })({}))).retryAfterMs).toBeUndefined();
  });
});

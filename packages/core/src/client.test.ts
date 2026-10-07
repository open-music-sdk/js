import { afterEach, describe, expect, test, vi } from "vitest";
import { createClient, type tClientOptions, type tSchemaLike, type tUserTokenStore } from "./client.js";
import { AppleMusicError, isAppleMusicError } from "./errors.js";
import { createRateLimiter } from "./rate-limit.js";

type tReply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error;

/** A fetch that answers from a queue of replies and records every Request it saw. */
function fakeFetch(...replies: tReply[]) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push(req);
    const reply = replies.shift() ?? { status: 200, body: {} };
    if (reply instanceof Error) return Promise.reject(reply);
    const body = reply.text ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
    return Promise.resolve(new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? {} }));
  };
  return { fetch, calls };
}

function client(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const { fetch, calls } = fakeFetch(...replies);
  const music = createClient({ developerToken: "dev", fetch, retry: false, ...options });
  return { music, calls, url: (i = 0) => calls[i]?.url, header: (name: string, i = 0) => calls[i]?.headers.get(name) };
}

const song = { id: "1", type: "songs", href: "/v1/catalog/us/songs/1" };
const apiError = (status: number, title: string, detail?: string) => ({
  status,
  body: { errors: [{ id: "e1", title, detail, status: String(status), code: `${String(status)}00` }] },
});

const failure = async (p: Promise<unknown>): Promise<AppleMusicError> => {
  try {
    await p;
  } catch (e) {
    if (isAppleMusicError(e)) return e;
    throw new Error(`expected an AppleMusicError, got ${String(e)}`, { cause: e });
  }
  throw new Error("expected a rejection");
};

afterEach(() => {
  vi.useRealTimers();
});

describe("request: paths", () => {
  test.each([
    ["v1/catalog/us/songs/1", "https://api.music.apple.com/v1/catalog/us/songs/1"],
    ["/v1/catalog/us/songs/1", "https://api.music.apple.com/v1/catalog/us/songs/1"],
    ["/v1/catalog/us/search?offset=25&term=beach", "https://api.music.apple.com/v1/catalog/us/search?offset=25&term=beach"],
    ["v1/test", "https://api.music.apple.com/v1/test"],
  ])("%s -> %s", async (path, expected) => {
    const { music, url } = client();
    await music.request(path);
    expect(url()).toBe(expected);
  });
});

describe("request: params", () => {
  test.each([
    [{ term: "beach bunny" }, "term", "beach bunny"],
    [{ limit: 25 }, "limit", "25"],
    [{ isPublic: false }, "isPublic", "false"],
    [{ include: ["albums", "artists"] }, "include", "albums,artists"],
    [{ ids: [1, 2, 3] }, "ids", "1,2,3"],
    [{ "include[albums]": "tracks" }, "include[albums]", "tracks"],
    [{ "filter[isrc]": "USUM71703861" }, "filter[isrc]", "USUM71703861"],
    [{ l: "" }, "l", ""],
  ])("encodes %j", async (params, key, value) => {
    const { music, url } = client();
    await music.request("v1/catalog/us/search", { params });
    expect(new URL(url() ?? "").searchParams.get(key)).toBe(value);
  });

  test("drops undefined values and sends nothing when there are none", async () => {
    const { music, url } = client();
    await music.request("v1/catalog/us/search", { params: { term: "x", l: undefined } });
    expect(new URL(url(0) ?? "").search).toBe("?term=x");
    await music.request("v1/catalog/us/search", { params: {} });
    expect(new URL(url(1) ?? "").search).toBe("");
  });

  test("adds to a query the path already carries", async () => {
    const { music, url } = client();
    await music.request("v1/catalog/us/search?term=x", { params: { limit: 5 } });
    const u = new URL(url() ?? "");
    expect(u.searchParams.get("term")).toBe("x");
    expect(u.searchParams.get("limit")).toBe("5");
  });
});

describe("request: headers and body", () => {
  test("a catalog request carries only the developer token", async () => {
    const { music, header } = client([], { userToken: "user" });
    await music.request("v1/catalog/us/songs/1");
    expect(header("authorization")).toBe("Bearer dev");
    expect(header("music-user-token")).toBeNull();
    expect(header("content-type")).toBeNull();
  });

  test.each(["v1/me/storefront", "/v1/me/library/songs", "v1/me"])("%s carries both tokens by default", async (path) => {
    const { music, header } = client([], { userToken: "user" });
    await music.request(path);
    expect(header("authorization")).toBe("Bearer dev");
    expect(header("music-user-token")).toBe("user");
  });

  test.each(["v1/media", "v1/catalog/me/songs", "v1/menu"])("%s is not a user path", async (path) => {
    const { music, header } = client([], { userToken: "user" });
    await music.request(path);
    expect(header("music-user-token")).toBeNull();
  });

  test("`user` overrides the path", async () => {
    const { music, header } = client([], { userToken: "user" });
    await music.request("v1/me/storefront", { user: false });
    expect(header("music-user-token", 0)).toBeNull();
    await music.request("v1/catalog/us/songs/1", { user: true });
    expect(header("music-user-token", 1)).toBe("user");
  });

  test("a user request without a user token fails before fetching", async () => {
    const { music, calls } = client();
    const e = await failure(music.request("v1/me/library/songs"));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.message).toContain("/v1/me/library/songs");
    expect(calls).toHaveLength(0);
  });

  test("a JSON body sets the method and content type", async () => {
    const { music, calls, header } = client([{ status: 201, body: { data: [song] } }]);
    const body = { attributes: { name: "Road trip" } };
    await music.request("v1/me/library/playlists", { method: "POST", body, user: false });
    expect(calls[0]?.method).toBe("POST");
    expect(header("content-type")).toBe("application/json");
    expect(await calls[0]?.text()).toBe(JSON.stringify(body));
  });

  test.each(["GET", "PUT", "DELETE"] as const)("passes method %s", async (method) => {
    const { music, calls } = client([{ status: 204 }]);
    await music.request("v1/me/ratings/songs/1", { method, user: false });
    expect(calls[0]?.method).toBe(method);
  });
});

describe("token providers", () => {
  test.each([
    ["a string", "dev"],
    ["a sync function", () => "dev"],
    ["an async function", () => Promise.resolve("dev")],
  ])("developerToken as %s", async (_, developerToken) => {
    const { music, header } = client([], { developerToken });
    await music.request("v1/test");
    expect(header("authorization")).toBe("Bearer dev");
  });

  test.each([
    ["a string", "user"],
    ["a sync function", () => "user"],
    ["an async function", () => Promise.resolve("user")],
  ])("userToken as %s", async (_, userToken) => {
    const { music, header } = client([], { userToken });
    await music.request("v1/me/storefront");
    expect(header("music-user-token")).toBe("user");
  });

  test("providers get the signal and are asked once per request", async () => {
    const developerToken = vi.fn(() => "dev");
    const userToken = vi.fn(() => "user");
    const controller = new AbortController();
    const { music } = client([], { developerToken, userToken });
    await music.request("v1/me/storefront", { signal: controller.signal });
    expect(developerToken).toHaveBeenCalledTimes(1);
    expect(developerToken).toHaveBeenCalledWith({ signal: controller.signal });
    expect(userToken).toHaveBeenCalledWith({ signal: controller.signal });
  });

  test("a provider that throws fails the request with its error", async () => {
    const boom = new Error("vault down");
    const { music, calls } = client([], { developerToken: () => Promise.reject(boom) });
    await expect(music.request("v1/test")).rejects.toBe(boom);
    expect(calls).toHaveLength(0);
  });
});

describe("responses", () => {
  test.each([
    [{ status: 200, body: { data: [song] } }, { data: [song] }],
    [{ status: 201, body: { data: [song] } }, { data: [song] }],
    [{ status: 200, body: [] }, []],
    [{ status: 200, body: null }, null],
    [{ status: 202 }, undefined],
    [{ status: 204 }, undefined],
    [{ status: 200, text: "" }, undefined],
  ])("resolves %j to the body", async (reply, expected) => {
    const { music } = client([reply]);
    expect(await music.request("v1/test")).toEqual(expected);
  });

  test("a 2xx body that is not JSON is an ApiError", async () => {
    const { music } = client([{ status: 200, text: "<html>" }]);
    const e = await failure(music.request("v1/test"));
    expect(e._tag).toBe("ApiError");
    expect(e.status).toBe(200);
    expect(e.cause).toBeInstanceOf(SyntaxError);
  });

  test.each([400, 404, 409, 422, 500, 501, 503])("%s with Apple's errors array is an ApiError carrying it", async (status) => {
    const { music } = client([apiError(status, "Bad Thing", "Something was off")]);
    const e = await failure(music.request("v1/catalog/us/songs/1"));
    expect(e._tag).toBe("ApiError");
    expect(e.status).toBe(status);
    expect(e.errors).toEqual([{ id: "e1", title: "Bad Thing", detail: "Something was off", status: String(status), code: `${String(status)}00` }]);
    expect(e.message).toBe(`${String(status)} /v1/catalog/us/songs/1: Bad Thing (Something was off)`);
  });

  test.each([
    [{ status: 404 }, "404 /v1/x"],
    [{ status: 502, text: "<html>Bad Gateway</html>" }, "502 /v1/x"],
    [{ status: 400, body: { errors: [{ id: "1", title: "No detail", status: "400", code: "40000" }] } }, "400 /v1/x: No detail"],
    [{ status: 400, body: { message: "not Apple's shape" } }, "400 /v1/x"],
  ])("%j produces the message %s", async (reply, message) => {
    const { music } = client([reply]);
    const e = await failure(music.request("v1/x"));
    expect(e._tag).toBe("ApiError");
    expect(e.message).toBe(message);
  });

  test("403 is UserTokenInvalid and is never retried", async () => {
    const { music, calls } = client([apiError(403, "Forbidden")], { userToken: "user", retry: { maxAttempts: 3, baseDelayMs: 0 } });
    const e = await failure(music.request("v1/me/library/songs"));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  test("429 is RateLimited with the Retry-After delay", async () => {
    const { music } = client([{ status: 429, headers: { "retry-after": "7" } }]);
    const e = await failure(music.request("v1/test"));
    expect(e._tag).toBe("RateLimited");
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(7000);
  });

  test("429 without Retry-After has no delay attached", async () => {
    const { music } = client([{ status: 429 }]);
    expect((await failure(music.request("v1/test"))).retryAfterMs).toBeUndefined();
  });
});

describe("401 and the developer token", () => {
  test("a fixed token gets no second chance", async () => {
    const { music, calls } = client([apiError(401, "Unauthorized")]);
    const e = await failure(music.request("v1/test"));
    expect(e._tag).toBe("DeveloperTokenRejected");
    expect(e.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  test("a provider is re-asked with the rejected token and the request is resent once", async () => {
    let n = 0;
    const developerToken = vi.fn(() => `dev${String(++n)}`);
    const { music, calls, header } = client([apiError(401, "Unauthorized"), { body: { ok: true } }], { developerToken });
    expect(await music.request("v1/test")).toEqual({ ok: true });
    expect(developerToken.mock.calls).toEqual([[{ signal: undefined }], [{ signal: undefined, rejected: "dev1" }]]);
    expect(header("authorization", 0)).toBe("Bearer dev1");
    expect(header("authorization", 1)).toBe("Bearer dev2");
    expect(calls).toHaveLength(2);
  });

  test("a provider that returns the same token is not resent", async () => {
    const developerToken = vi.fn(() => "same");
    const { music, calls } = client([apiError(401, "Unauthorized")], { developerToken });
    expect((await failure(music.request("v1/test")))._tag).toBe("DeveloperTokenRejected");
    expect(developerToken).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(1);
  });

  test("a second 401 with the fresh token fails, with no further asking", async () => {
    let n = 0;
    const developerToken = vi.fn(() => `dev${String(++n)}`);
    const { music, calls } = client([apiError(401, "Unauthorized"), apiError(401, "Unauthorized")], { developerToken, retry: { maxAttempts: 3, baseDelayMs: 0 } });
    expect((await failure(music.request("v1/test")))._tag).toBe("DeveloperTokenRejected");
    expect(developerToken).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
  });

  test("on a user path the message mentions the subscription", async () => {
    const { music } = client([apiError(401, "Unauthorized")], { userToken: "user" });
    expect((await failure(music.request("v1/me/library/songs"))).message).toMatch(/not subscribed/);
    const catalog = client([apiError(401, "Unauthorized")]);
    expect((await failure(catalog.music.request("v1/test"))).message).not.toMatch(/subscribed/);
  });
});

describe("retrying", () => {
  const quick = { maxAttempts: 3, baseDelayMs: 0 };

  test.each([500, 502, 503, 429])("%s is retried and the eventual success returned", async (status) => {
    const { music, calls } = client([{ status }, { body: { ok: true } }], { retry: quick });
    expect(await music.request("v1/test")).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  test("runs out of attempts and throws the last error", async () => {
    const { music, calls } = client([{ status: 500 }, { status: 503 }, apiError(502, "Bad Gateway")], { retry: quick });
    const e = await failure(music.request("v1/test"));
    expect(e.status).toBe(502);
    expect(calls).toHaveLength(3);
  });

  test.each([400, 404, 501])("%s is not retried", async (status) => {
    const { music, calls } = client([{ status }, { body: {} }], { retry: quick });
    expect((await failure(music.request("v1/test"))).status).toBe(status);
    expect(calls).toHaveLength(1);
  });

  test("a thrown fetch is a NetworkError with the cause, and is retried", async () => {
    const boom = new TypeError("fetch failed");
    const { music, calls } = client([boom, { body: { ok: true } }], { retry: quick });
    expect(await music.request("v1/test")).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const dead = client([boom, boom, boom], { retry: quick });
    const e = await failure(dead.music.request("v1/catalog/us/songs/1"));
    expect(e._tag).toBe("NetworkError");
    expect(e.cause).toBe(boom);
    expect(e.message).toBe("GET /v1/catalog/us/songs/1: fetch failed");
  });

  test("retry: false means one attempt", async () => {
    const { music, calls } = client([{ status: 500 }, { body: {} }], { retry: false });
    expect((await failure(music.request("v1/test"))).status).toBe(500);
    expect(calls).toHaveLength(1);
  });

  test("the default policy retries once", async () => {
    vi.useFakeTimers();
    const { music, calls } = client([{ status: 500 }, { status: 500 }, { body: {} }], { retry: undefined });
    const out = failure(music.request("v1/test"));
    await vi.runAllTimersAsync();
    expect((await out).status).toBe(500);
    expect(calls).toHaveLength(2);
  });

  test("waits for Retry-After before resending", async () => {
    vi.useFakeTimers();
    const { music, calls } = client([{ status: 429, headers: { "retry-after": "2" } }, { body: { ok: true } }], { retry: quick });
    const out = music.request("v1/test");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await out).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  test("the limiter is acquired before every attempt", async () => {
    const acquire = vi.fn(() => Promise.resolve());
    const { music } = client([{ status: 500 }, { body: {} }], { retry: quick, rateLimit: { acquire } });
    await music.request("v1/test");
    expect(acquire).toHaveBeenCalledTimes(2);
  });
});

describe("abort", () => {
  /** A fetch that never answers until the request's signal aborts. */
  const hanging = () => {
    const calls: Request[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      const req = input instanceof Request ? input : new Request(input);
      calls.push(req);
      return new Promise((_, reject) => {
        req.signal.addEventListener("abort", () => {
          reject(req.signal.reason as Error);
        });
      });
    };
    return { fetch, calls };
  };

  test("an already aborted signal rejects with the reason before fetching", async () => {
    const { fetch, calls } = hanging();
    const music = createClient({ developerToken: "dev", fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(music.request("v1/test", { signal: controller.signal })).rejects.toBe(controller.signal.reason);
    expect(calls).toHaveLength(0);
  });

  test("aborting in flight rejects with an untouched AbortError and does not retry", async () => {
    const { fetch, calls } = hanging();
    const music = createClient({ developerToken: "dev", fetch, retry: { maxAttempts: 3, baseDelayMs: 0 } });
    const controller = new AbortController();
    const out = music.request("v1/test", { signal: controller.signal });
    await new Promise((r) => setImmediate(r));
    controller.abort();
    const e: unknown = await out.catch((x: unknown) => x);
    expect(isAppleMusicError(e)).toBe(false);
    expect(e).toBeInstanceOf(DOMException);
    expect((e as DOMException).name).toBe("AbortError");
    expect(calls).toHaveLength(1);
  });

  test("a custom abort reason comes through as is", async () => {
    const { fetch } = hanging();
    const music = createClient({ developerToken: "dev", fetch });
    const controller = new AbortController();
    const out = music.request("v1/test", { signal: controller.signal });
    await new Promise((r) => setImmediate(r));
    const reason = new Error("navigated away");
    controller.abort(reason);
    await expect(out).rejects.toBe(reason);
  });
});

describe("schema", () => {
  const okSchema: tSchemaLike<{ ok: true }> = { "~standard": { validate: (v) => ({ value: v as { ok: true } }) } };
  const badSchema: tSchemaLike<never> = {
    "~standard": { validate: () => ({ issues: [{ message: "required", path: ["data", 0, "href"] }, { message: "expected object" }] }) },
  };
  const asyncSchema: tSchemaLike<string> = { "~standard": { validate: (v) => Promise.resolve(typeof v === "string" ? { value: v } : { issues: [{ message: "expected string" }] }) } };

  test("a passing schema returns its value", async () => {
    const { music } = client([{ body: { ok: true } }]);
    const value = await music.request("v1/test", { schema: okSchema });
    expect(value.ok).toBe(true);
  });

  test("a failing schema throws ValidationError with the issues and their paths", async () => {
    const { music } = client([{ body: { data: [{}] } }]);
    const e = await failure(music.request("v1/test", { schema: badSchema }));
    expect(e._tag).toBe("ValidationError");
    expect(e.status).toBe(200);
    expect(e.issues).toHaveLength(2);
    expect(e.message).toBe("/v1/test: data.0.href: required; <root>: expected object");
  });

  test("an async schema is awaited", async () => {
    expect(await client([{ body: "hi" }]).music.request("v1/test", { schema: asyncSchema })).toBe("hi");
    const e = await failure(client([{ body: 1 }]).music.request("v1/test", { schema: asyncSchema }));
    expect(e._tag).toBe("ValidationError");
  });

  test("a schema is not consulted for an error response", async () => {
    const validate = vi.fn();
    const { music } = client([{ status: 404 }]);
    expect((await failure(music.request("v1/test", { schema: { "~standard": { validate } } })))._tag).toBe("ApiError");
    expect(validate).not.toHaveBeenCalled();
  });

  test("ValidationError is not retried", async () => {
    const { music, calls } = client([{ body: {} }, { body: {} }], { retry: { maxAttempts: 3, baseDelayMs: 0 } });
    await failure(music.request("v1/test", { schema: badSchema }));
    expect(calls).toHaveLength(1);
  });
});

describe("paginate", () => {
  const items = async <T>(it: AsyncIterable<T>) => {
    const out: T[] = [];
    for await (const item of it) out.push(item);
    return out;
  };

  test("yields the items of a single page", async () => {
    const { music, calls } = client([{ body: { data: [song, song] } }]);
    expect(await items(music.paginate("v1/catalog/us/songs", { params: { ids: ["1", "2"] } }))).toEqual([song, song]);
    expect(calls).toHaveLength(1);
  });

  test("follows next links verbatim without re-adding the params", async () => {
    const { music, url } = client([
      { body: { data: [1], next: "/v1/me/library/songs?offset=1&limit=1" } },
      { body: { data: [2], next: "/v1/me/library/songs?offset=2&limit=1" } },
      { body: { data: [3] } },
    ], { userToken: "user" });
    expect(await items(music.paginate<number>("v1/me/library/songs", { params: { limit: 1 } }))).toEqual([1, 2, 3]);
    expect(url(0)).toBe("https://api.music.apple.com/v1/me/library/songs?limit=1");
    expect(url(1)).toBe("https://api.music.apple.com/v1/me/library/songs?offset=1&limit=1");
    expect(url(2)).toBe("https://api.music.apple.com/v1/me/library/songs?offset=2&limit=1");
  });

  test.each([{ data: [] }, {}, { next: undefined }])("yields nothing for %j", async (body) => {
    const { music } = client([{ body }]);
    expect(await items(music.paginate("v1/catalog/us/songs"))).toEqual([]);
  });

  test("breaking out stops fetching", async () => {
    const { music, calls } = client([{ body: { data: [1, 2], next: "/v1/x?offset=2" } }, { body: { data: [3] } }]);
    for await (const item of music.paginate<number>("v1/x")) if (item === 2) break;
    expect(calls).toHaveLength(1);
  });

  test("fetches lazily, one page at a time", async () => {
    const { music, calls } = client([{ body: { data: [1], next: "/v1/x?offset=1" } }, { body: { data: [2] } }]);
    const it = music.paginate<number>("v1/x")[Symbol.asyncIterator]();
    expect(calls).toHaveLength(0);
    expect((await it.next()).value).toBe(1);
    expect(calls).toHaveLength(1);
    expect((await it.next()).value).toBe(2);
    expect(calls).toHaveLength(2);
    expect((await it.next()).done).toBe(true);
  });

  test("an error on a later page surfaces from the loop", async () => {
    const { music } = client([{ body: { data: [1], next: "/v1/x?offset=1" } }, apiError(500, "Oops")]);
    const e = await failure(items(music.paginate("v1/x")));
    expect(e.status).toBe(500);
  });

  test("the user token travels with every page", async () => {
    const { music, header } = client([{ body: { data: [1], next: "/v1/me/x?offset=1" } }, { body: { data: [] } }], { userToken: "user" });
    await items(music.paginate("v1/me/x"));
    expect(header("music-user-token", 0)).toBe("user");
    expect(header("music-user-token", 1)).toBe("user");
  });
});

describe("storefront", () => {
  const storefronts = (id: string) => ({ body: { data: [{ id, type: "storefronts", href: `/v1/storefronts/${id}` }] } });

  test("a configured storefront needs no request", async () => {
    const { music, calls } = client([], { storefront: "gb", userToken: "user" });
    expect(await music.storefront()).toBe("gb");
    expect(calls).toHaveLength(0);
  });

  test("resolves the listener's storefront once", async () => {
    const { music, calls, url } = client([storefronts("us")], { userToken: "user" });
    expect(await Promise.all([music.storefront(), music.storefront()])).toEqual(["us", "us"]);
    expect(await music.storefront()).toBe("us");
    expect(calls).toHaveLength(1);
    expect(url()).toBe("https://api.music.apple.com/v1/me/storefront");
  });

  test("without a user token there is nothing to resolve from", async () => {
    const { music, calls } = client();
    const e = await failure(music.storefront());
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.message).toContain("pass storefront");
    expect(calls).toHaveLength(0);
  });

  test("an empty answer is an ApiError", async () => {
    const { music } = client([{ body: { data: [] } }], { userToken: "user" });
    expect((await failure(music.storefront()))._tag).toBe("ApiError");
  });

  test("a failed resolution is not cached", async () => {
    const { music, calls } = client([{ status: 500 }, storefronts("jp")], { userToken: "user" });
    expect((await failure(music.storefront())).status).toBe(500);
    expect(await music.storefront()).toBe("jp");
    expect(calls).toHaveLength(2);
  });

  test("derived clients resolve their own listener", async () => {
    const { music } = client([storefronts("us"), storefronts("fr")], { userToken: "a" });
    expect(await music.storefront()).toBe("us");
    expect(await music.as("b").storefront()).toBe("fr");
  });
});

describe("as and forUser", () => {
  test("as() binds a listener and leaves the original alone", async () => {
    const { music, header } = client([{}, {}]);
    await music.as("listener").request("v1/me/library/songs");
    expect(header("music-user-token", 0)).toBe("listener");
    expect((await failure(music.request("v1/me/library/songs")))._tag).toBe("UserTokenInvalid");
  });

  test("as() replaces an existing listener", async () => {
    const { music, header } = client([{}], { userToken: "a" });
    await music.as("b").request("v1/me/storefront");
    expect(header("music-user-token")).toBe("b");
  });

  test("derived clients share the developer token provider, hooks, and limiter", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const developerToken = vi.fn(() => "dev");
    const onRequest = vi.fn();
    const rateLimit = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    const { music, calls } = client([{}, {}], { developerToken, onRequest, rateLimit });
    await music.request("v1/test");
    const second = music.as("u").request("v1/me/storefront").then(() => "done");
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBe("done");
    expect(developerToken).toHaveBeenCalledTimes(2);
    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  test("forUser() needs a store", () => {
    const { music } = client();
    expect(() => music.forUser("u1")).toThrow(TypeError);
  });

  test("forUser() sends the stored token", async () => {
    const get = vi.fn(() => Promise.resolve("stored"));
    const store: tUserTokenStore = { get, set: vi.fn(), delete: vi.fn() };
    const { music, header } = client([{}], { userTokenStore: store });
    await music.forUser("u1").request("v1/me/storefront");
    expect(get).toHaveBeenCalledWith("u1");
    expect(header("music-user-token")).toBe("stored");
  });

  test("forUser() with nothing stored is UserTokenInvalid, before fetching", async () => {
    const store: tUserTokenStore = { get: () => Promise.resolve(undefined), set: vi.fn(), delete: vi.fn() };
    const { music, calls } = client([{}], { userTokenStore: store });
    const e = await failure(music.forUser("u2").request("v1/me/storefront"));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.message).toContain("u2");
    expect(calls).toHaveLength(0);
  });

  test("forUser() looks the token up per request, so a replaced token is used", async () => {
    let token = "old";
    const store: tUserTokenStore = { get: () => Promise.resolve(token), set: vi.fn(), delete: vi.fn() };
    const { music, header } = client([{}, {}], { userTokenStore: store });
    const listener = music.forUser("u1");
    await listener.request("v1/me/storefront");
    token = "new";
    await listener.request("v1/me/storefront");
    expect(header("music-user-token", 0)).toBe("old");
    expect(header("music-user-token", 1)).toBe("new");
  });
});

describe("hooks", () => {
  test("onRequest and onResponse see the same Request, in order, once per attempt", async () => {
    const seen: string[] = [];
    const requests: Request[] = [];
    const { music, calls } = client([{ status: 500 }, { body: {} }], {
      retry: { maxAttempts: 2, baseDelayMs: 0 },
      onRequest: (req) => {
        seen.push("request");
        requests.push(req);
      },
      onResponse: (res, req) => {
        seen.push(`response ${String(res.status)}`);
        expect(req).toBe(requests.at(-1));
      },
    });
    await music.request("v1/test");
    expect(seen).toEqual(["request", "response 500", "request", "response 200"]);
    expect(requests).toEqual(calls);
  });

  test("onResponse is skipped when fetch throws", async () => {
    const onResponse = vi.fn();
    const { music } = client([new TypeError("down")], { onResponse });
    await failure(music.request("v1/test"));
    expect(onResponse).not.toHaveBeenCalled();
  });

  test("the request handed to the hook carries the final URL and headers", async () => {
    const onRequest = vi.fn();
    const { music } = client([{}], { onRequest, userToken: "u" });
    await music.request("v1/me/library/songs", { params: { limit: 1 } });
    const req = onRequest.mock.calls[0]?.[0] as Request;
    expect(req.url).toBe("https://api.music.apple.com/v1/me/library/songs?limit=1");
    expect(req.headers.get("music-user-token")).toBe("u");
  });
});

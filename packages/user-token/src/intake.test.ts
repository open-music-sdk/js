import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AppleMusicError, createClient, type tAppleMusicClient, type tClientOptions, type tUserTokenStore } from "@open-music-sdk/core";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { isJson, userTokenIntake, type tIntakeOptions, type tUserTokenIntake } from "./intake.js";
import { MemoryUserTokenStore } from "./stores.js";

const ENDPOINT = "https://app.example/music/user-token";
const JSON_TYPE = { "content-type": "application/json" };

/** One answer from Apple: a response, a fetch that throws, or `"hang"` for one that never answers until the request aborts. */
type tReply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error | "hang";

const storefront = (id = "us") => ({ data: [{ id, type: "storefronts", href: `/v1/storefronts/${id}` }] });

/** Apple's error body for `status`, with a detail no response of ours should repeat. */
const appleError = (status: number, title: string) => ({
  status,
  body: { errors: [{ id: "e1", title, detail: "apple-internal-detail", status: String(status), code: `${String(status)}00` }] },
});

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/**
 * A client whose fetch answers from a queue of replies, then with a storefront, and records every Request it
 * saw. Like the real fetch it rejects with the abort reason when the request is aborted.
 */
function fakeClient(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push(req);
    if (req.signal.aborted) return Promise.reject(req.signal.reason as Error);
    const reply = replies.shift() ?? { body: storefront() };
    if (reply === "hang")
      return new Promise<Response>((_resolve, reject) => {
        req.signal.addEventListener("abort", () => {
          reject(req.signal.reason as Error);
        });
      });
    if (reply instanceof Error) return Promise.reject(reply);
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers ?? {} });
    responses.push(res);
    return Promise.resolve(res);
  };
  return { music: createClient({ developerToken: "dev", fetch, retry: false, ...options }), calls };
}

/** Tokens by core's rule, tokens once the whitespace around them is dropped, and strings that are no token at all. */
const shaped: [string, string][] = [
  ["one character", "a"],
  ["four thousand characters", "a".repeat(4000)],
  ["base64 with padding", "Ab+/9w=="],
  ["base64url", "Ab-_9w"],
  ["dotted segments", "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJBIn0.c2ln"],
  ["every visible ASCII character", Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).join("")],
];
const padded: [string, string][] = [
  ["a leading space", " token"],
  ["a trailing newline", "token\n"],
  ["a tab before and a Windows line ending after", "\ttoken\r\n"],
];
const misshapen: [string, string][] = [
  ["empty", ""],
  ["a space", " "],
  ["an inner space", "to ken"],
  ["an inner newline", "to\nken"],
  ["a header injection", "token\r\nx-injected: 1"],
  ["a tab", "to\tken"],
  ["a NUL", "to\0ken"],
  ["a DEL", "to\x7fken"],
  ["Latin-1", "tokén"],
  ["beyond Latin-1", "tokĀn"],
  ["an emoji", "tok\u{1f3b5}n"],
];

/** An intake over a scripted client, the store behind it, and a spy on every write to that store. */
function intake(replies: tReply[] = [], options: Partial<tIntakeOptions> = {}, clientOptions: Partial<tClientOptions> = {}) {
  const { music, calls } = fakeClient(replies, clientOptions);
  const store = new MemoryUserTokenStore();
  const set = vi.spyOn(store, "set");
  const userId = vi.fn<tIntakeOptions["userId"]>(() => "u1");
  const handler = userTokenIntake(music, { store, userId, ...options });
  return { handler, store, set, userId, calls };
}

const post = (body: unknown, headers: Record<string, string> = JSON_TYPE) =>
  new Request(ENDPOINT,{ method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

/** Everything a response shows whoever receives it: its body and its headers. */
const shown = async (res: Response) => (await res.text()) + JSON.stringify([...res.headers]);

afterEach(() => {
  vi.useRealTimers();
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("isJson", () => {
  test.each(["application/json", "application/json; charset=utf-8", "application/json;charset=UTF-8", "application/json ; charset=utf-8", "Application/JSON", "APPLICATION/JSON;"])(
    "%j is JSON",
    (type) => {
      expect(isJson(type)).toBe(true);
    },
  );

  // Everything a form or a no-cors fetch can send without a preflight is in this list, with the lookalikes.
  test.each([
    null,
    "",
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "text/json",
    "application/jsonp",
    "application/json-seq",
    "application/json+ld",
    "application/ld+json",
    "application/vnd.api+json",
    "application/jsonx; charset=utf-8",
    "text/plain; application/json",
    "application/json, text/plain",
    "text/plain, application/json",
    "json",
    "*/*",
  ])("%j is not", (type) => {
    expect(isJson(type)).toBe(false);
  });
});

describe("userTokenIntake: one status per outcome", () => {
  test("204 with no body once Apple accepts the token", async () => {
    const { handler, store, calls } = intake();
    const res = await handler(post({ token: "user-token" }));
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await store.get("u1")).toBe("user-token");
    expect(calls.map((c) => [c.method, c.url, c.headers.get("music-user-token")])).toEqual([["GET", "https://api.music.apple.com/v1/me/storefront", "user-token"]]);
  });

  test.each(shaped)("204 for a token that is %s", async (_, token) => {
    const { handler, store } = intake();
    expect((await handler(post({ token }))).status).toBe(204);
    expect(await store.get("u1")).toBe(token);
  });

  test.each(["application/json; charset=utf-8", "Application/JSON"])("204 for content type %j", async (type) => {
    const { handler } = intake();
    expect((await handler(post({ token: "user-token" }, { "content-type": type }))).status).toBe(204);
  });

  test("204 for a body of exactly 8 KiB", async () => {
    const { handler } = intake();
    const json = JSON.stringify({ token: "user-token" });
    expect((await handler(post(json + " ".repeat(8192 - json.length)))).status).toBe(204);
  });

  test.each(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"])("405 with Allow: POST for %s", async (method) => {
    const { handler } = intake();
    const res = await handler(new Request(ENDPOINT,{ method, headers: JSON_TYPE }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await errorOf(res)).toBe("MethodNotAllowed");
  });

  test.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/ld+json", ""])("415 for content type %j", async (type) => {
    const { handler } = intake();
    const res = await handler(post({ token: "user-token" }, { "content-type": type }));
    expect(res.status).toBe(415);
    expect(await errorOf(res)).toBe("UnsupportedMediaType");
  });

  test("415 for no content type at all", async () => {
    const { handler } = intake();
    const req = new Request(ENDPOINT,{ method: "POST", body: new Blob([JSON.stringify({ token: "user-token" })]) });
    expect(req.headers.get("content-type")).toBeNull();
    expect((await handler(req)).status).toBe(415);
  });

  test.each([undefined, null, ""])("401 when userId resolves to %j", async (id) => {
    const { handler } = intake([], { userId: () => id });
    const res = await handler(post({ token: "user-token" }));
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe("Unauthorized");
  });

  test.each([
    ["not JSON", "token=abc"],
    ["truncated JSON", '{"token":"abc'],
    ["empty", ""],
    ["null", "null"],
    ["a string", '"abc"'],
    ["a number", "42"],
    ["an array", '["abc"]'],
    ["no token", "{}"],
    ["a token under another name", '{"Token":"abc","userToken":"abc"}'],
    ["a numeric token", '{"token":123}'],
    ["a null token", '{"token":null}'],
    ["a boolean token", '{"token":true}'],
    ["a token in an array", '{"token":["abc"]}'],
    ["a nested token", '{"token":{"token":"abc"}}'],
    ["a token only on __proto__", '{"__proto__":{"token":"abc"}}'],
  ])("400 for a body that is %s", async (_, body) => {
    const { handler } = intake();
    const res = await handler(post(body));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("BadRequest");
  });

  test.each([
    ["one byte over 8 KiB", JSON.stringify({ token: "user-token" }) + " ".repeat(8193 - JSON.stringify({ token: "user-token" }).length)],
    ["a megabyte", JSON.stringify({ token: "a".repeat(1 << 20) })],
  ])("413 for a body of %s", async (_, body) => {
    const { handler } = intake();
    const res = await handler(post(body));
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toBe("PayloadTooLarge");
  });

  test("422 UserTokenInvalid when Apple answers 403", async () => {
    const { handler } = intake([appleError(403, "Forbidden")]);
    const res = await handler(post({ token: "revoked" }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("UserTokenInvalid");
  });

  test.each(padded)("204 for a token posted with %s, which is validated and stored without it", async (_, token) => {
    const { handler, store, calls } = intake();
    expect((await handler(post({ token }))).status).toBe(204);
    expect(calls[0]?.headers.get("music-user-token")).toBe("token");
    expect(await store.get("u1")).toBe("token");
  });

  test.each(misshapen)("422 UserTokenInvalid for a posted string that is %s, without asking Apple", async (_, token) => {
    const { handler, calls } = intake();
    const res = await handler(post({ token }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("UserTokenInvalid");
    expect(calls).toHaveLength(0);
  });

  test("422 UserTokenInvalid when Apple answers 401 for the listener but accepts the developer token on its own", async () => {
    const { handler, calls } = intake([appleError(401, "Unauthorized"), {}]);
    const res = await handler(post({ token: "user-token" }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("UserTokenInvalid");
    expect(calls.map((c) => [new URL(c.url).pathname, c.headers.get("music-user-token")])).toEqual([
      ["/v1/me/storefront", "user-token"],
      ["/v1/test", null],
    ]);
  });

  test.each<[string, tReply[], string]>([
    ["401, and 401 again without the user token", [{ status: 401 }, { status: 401 }], "DeveloperTokenInvalid"],
    ["401, then 500 without the user token", [{ status: 401 }, { status: 500 }], "ApiError"],
    ["401, then nothing without the user token", [{ status: 401 }, new TypeError("fetch failed")], "NetworkError"],
    ["404", [{ status: 404 }], "ApiError"],
    ["429", [{ status: 429 }], "RateLimited"],
    ["500", [{ status: 500 }], "ApiError"],
    ["a 200 naming no storefront", [{ body: { data: [] } }], "ApiError"],
    ["an empty 200", [{}], "ApiError"],
    ["a failed fetch", [new TypeError("fetch failed")], "NetworkError"],
  ])("502 when Apple answers %s, with the client's error tag", async (_, replies, tag) => {
    const { handler } = intake(replies);
    const res = await handler(post({ token: "user-token" }));
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe(tag);
  });

  test("502 DeveloperTokenUnavailable when the client's developer token could not be had, before Apple is asked", async () => {
    const unavailable = new AppleMusicError("DeveloperTokenUnavailable", "developer token endpoint https://app.example/api/token answered 503", { status: 503 });
    const { handler, set, calls } = intake([], {}, { developerToken: () => Promise.reject(unavailable) });
    const res = await handler(post({ token: "user-token" }));
    expect([res.status, await errorOf(res)]).toEqual([502, "DeveloperTokenUnavailable"]);
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("userTokenIntake: a token is stored only after Apple accepts it", () => {
  test.each<[string, Request, tReply[]]>([
    ["Apple answers 403", post({ token: "user-token" }), [{ status: 403 }]],
    ["Apple answers 401 for the listener", post({ token: "user-token" }), [{ status: 401 }, {}]],
    ["Apple refuses the developer token", post({ token: "user-token" }), [{ status: 401 }, { status: 401 }]],
    ["Apple answers 429", post({ token: "user-token" }), [{ status: 429 }]],
    ["Apple answers 500", post({ token: "user-token" }), [{ status: 500 }]],
    ["Apple names no storefront", post({ token: "user-token" }), [{ body: {} }]],
    ["Apple cannot be reached", post({ token: "user-token" }), [new TypeError("fetch failed")]],
    ["the token is malformed", post({ token: "user token" }), []],
    ["the body has no token", post({}), []],
    ["the body is too large", post({ token: "user-token", pad: "x".repeat(9000) }), []],
    ["the content type is a form's", post("token=user-token", { "content-type": "application/x-www-form-urlencoded" }), []],
    ["the method is PUT", new Request(ENDPOINT,{ method: "PUT", headers: JSON_TYPE, body: JSON.stringify({ token: "user-token" }) }), []],
  ])("nothing is written when %s, and the token already stored stays", async (_, req, replies) => {
    const { handler, store, set } = intake(replies);
    await store.set("u1", "old");
    set.mockClear();
    expect((await handler(req)).status).not.toBe(204);
    expect(set).not.toHaveBeenCalled();
    expect(await store.get("u1")).toBe("old");
  });

  test("the token written is the one Apple was asked about, written once", async () => {
    const { handler, set, calls } = intake();
    await handler(post({ token: "user-token" }));
    expect(set.mock.calls).toEqual([["u1", "user-token"]]);
    expect(calls.map((c) => c.headers.get("music-user-token"))).toEqual(["user-token"]);
  });

  test("a new token replaces the stored one", async () => {
    const { handler, store } = intake();
    await store.set("u1", "old");
    expect((await handler(post({ token: "new" }))).status).toBe(204);
    expect(await store.get("u1")).toBe("new");
  });

  test("a store that fails rejects the handler: accepted but not kept is not a 204", async () => {
    const { handler, set } = intake();
    set.mockRejectedValue(new Error("store down"));
    await expect(handler(post({ token: "user-token" }))).rejects.toThrow("store down");
  });
});

describe("userTokenIntake: the user comes from the session and nowhere else", () => {
  test("the token is stored under what userId resolves to, and userId sees the request", async () => {
    const userId = vi.fn((req: Request) => Promise.resolve(req.headers.get("x-session")));
    const { handler, set } = intake([], { userId });
    const req = post({ token: "user-token" }, { ...JSON_TYPE, "x-session": "u7" });
    expect((await handler(req)).status).toBe(204);
    expect(userId).toHaveBeenCalledExactlyOnceWith(req);
    expect(set.mock.calls).toEqual([["u7", "user-token"]]);
  });

  test.each(["userId", "user", "id", "sub", "__proto__"])("a user named in the body as %s is ignored", async (field) => {
    const { handler, set } = intake();
    await handler(post(`{"token":"user-token","${field}":"victim"}`));
    expect(set.mock.calls).toEqual([["u1", "user-token"]]);
  });

  test.each([undefined, null, ""])("with no session (%j) the body is not read, Apple is not asked, and nothing is stored", async (id) => {
    const { handler, set, calls } = intake([], { userId: () => id });
    const req = post({ token: "user-token" });
    await handler(req);
    expect(req.bodyUsed).toBe(false);
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });

  test("a userId that throws rejects the handler before Apple is asked", async () => {
    const { handler, set, calls } = intake([], { userId: () => Promise.reject(new Error("session store down")) });
    await expect(handler(post({ token: "user-token" }))).rejects.toThrow("session store down");
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("userTokenIntake: another site cannot bind its own token to a visitor", () => {
  // What a cross-site form or a no-cors fetch can send without the browser asking first.
  test.each(["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])(
    "a %s post is turned away before the session is consulted",
    async (type) => {
      const { handler, set, userId, calls } = intake();
      const res = await handler(post(JSON.stringify({ token: "attacker-token" }), { "content-type": type }));
      expect(res.status).toBe(415);
      expect(userId).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
      expect(set).not.toHaveBeenCalled();
    },
  );

  test("the preflight a JSON post triggers is answered 405 with no CORS grant", async () => {
    const { handler, userId } = intake();
    const res = await handler(
      new Request(ENDPOINT,{ method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }),
    );
    expect(res.status).toBe(405);
    expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
    expect(userId).not.toHaveBeenCalled();
  });
});

describe("userTokenIntake: Apple is asked under the client's retry policy, whatever it is", () => {
  test("with retries off, one failure is a 502 after one request", async () => {
    const { handler, calls } = intake([{ status: 500 }], {}, { retry: false });
    expect((await handler(post({ token: "user-token" }))).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  test("with the default policy, a 500 is retried and the token stored", async () => {
    vi.useFakeTimers();
    const { handler, store, calls } = intake([{ status: 500 }], {}, { retry: undefined });
    const out = handler(post({ token: "user-token" }));
    await vi.advanceTimersByTimeAsync(4000);
    expect((await out).status).toBe(204);
    expect(calls).toHaveLength(2);
    expect(await store.get("u1")).toBe("user-token");
  });

  test("with the default policy, a 429 is waited out for its Retry-After", async () => {
    vi.useFakeTimers();
    const { handler, calls } = intake([{ status: 429, headers: { "retry-after": "2" } }], {}, { retry: undefined });
    const out = handler(post({ token: "user-token" }));
    let settled = false;
    void out.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect([settled, calls.length]).toEqual([false, 1]);
    await vi.advanceTimersByTimeAsync(1);
    expect((await out).status).toBe(204);
    expect(calls).toHaveLength(2);
  });

  test("a 403 is never retried", async () => {
    vi.useFakeTimers();
    const { handler, calls } = intake([{ status: 403 }], {}, { retry: undefined });
    const out = handler(post({ token: "user-token" }));
    await vi.advanceTimersByTimeAsync(4000);
    expect((await out).status).toBe(422);
    expect(calls).toHaveLength(1);
  });
});

describe("userTokenIntake: a request that is aborted is not answered", () => {
  const aborting = (controller: AbortController) => new Request(ENDPOINT,{ method: "POST", headers: JSON_TYPE, body: JSON.stringify({ token: "user-token" }), signal: controller.signal });

  test("aborted before the handler runs: rejects with the reason, Apple is not asked", async () => {
    const { handler, set, calls } = intake();
    const controller = new AbortController();
    const req = aborting(controller);
    const reason = new Error("client went away");
    controller.abort(reason);
    await expect(handler(req)).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });

  test("aborted while Apple is asked: rejects with the reason, nothing is stored", async () => {
    const { handler, set, calls } = intake(["hang"]);
    const controller = new AbortController();
    const out = handler(aborting(controller));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const reason = new Error("client went away");
    controller.abort(reason);
    await expect(out).rejects.toBe(reason);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("userTokenIntake: no response carries the token or Apple's error text, and none may be cached", () => {
  test.each<[string, Response]>([
    ["in its body", Response.json({ error: "secret-token" })],
    ["in a header", new Response(null, { headers: { "x-echo": "secret-token" } })],
    ["as Apple's detail", Response.json(appleError(403, "Forbidden").body)],
  ])("the check itself sees what a response carries %s, so its silence means something", async (_name, res) => {
    expect(await shown(res)).toMatch(/secret|apple-internal-detail/);
  });

  test.each<[string, Request, tReply[]]>([
    ["accepted", post({ token: "secret-token" }), []],
    ["rejected by Apple", post({ token: "secret-token" }), [appleError(403, "Forbidden")]],
    ["rejected for its shape", post({ token: "secret token" }), []],
    ["Apple failing", post({ token: "secret-token" }), [appleError(500, "Internal Server Error")]],
    ["Apple answering 401 for the listener", post({ token: "secret-token" }), [appleError(401, "Unauthorized"), {}]],
    ["Apple refusing the developer token", post({ token: "secret-token" }), [appleError(401, "Unauthorized"), appleError(401, "Unauthorized")]],
    ["a bad body", post('{"token":"secret-token"'), []],
    ["too large", post({ token: "secret-token", pad: "x".repeat(9000) }), []],
    ["the wrong content type", post({ token: "secret-token" }, { "content-type": "text/plain" }), []],
    ["the wrong method", new Request(ENDPOINT,{ method: "PUT", headers: JSON_TYPE, body: JSON.stringify({ token: "secret-token" }) }), []],
  ])("%s", async (_, req, replies) => {
    const { handler } = intake(replies);
    const res = await handler(req);
    const seen = await shown(res);
    expect(seen).not.toContain("secret");
    expect(seen).not.toContain("apple-internal-detail");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("no session", async () => {
    const { handler } = intake([], { userId: () => undefined });
    const res = await handler(post({ token: "secret-token" }));
    expect(await res.text()).not.toContain("secret");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("userTokenIntake: what it is handed is checked when it is created, not on the first request", () => {
  const store = new MemoryUserTokenStore();
  const good = { store, userId: () => "u1" };
  const make = (client: unknown, options: unknown) => () => userTokenIntake(client as tAppleMusicClient, options as tIntakeOptions);

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a token in its place", "secret-token"],
    ["an object that is no client", {}],
    ["a store", store],
  ])("a client that is %s is a TypeError", (_name, client) => {
    expect(make(client, good)).toThrow(/^userTokenIntake: client must be a client from createClient; got /);
  });

  test.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["a token", "secret-token"],
    ["a function", () => good],
  ])("options that are %s are a TypeError", (_name, options) => {
    expect(make(fakeClient().music, options)).toThrow(/^userTokenIntake: expected an options object with store and userId; got /);
  });

  test.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["a key-value namespace, which has put where a store has set", { get: () => null, put: () => null, delete: () => null }],
    ["a token", "secret-token"],
  ])("a store that is %s is a TypeError", (_name, bad) => {
    expect(make(fakeClient().music, { ...good, store: bad })).toThrow(/^userTokenIntake: store must have get, set and delete; got /);
  });

  test.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["the id itself, where a function that finds it belongs", "u1"],
    ["a number", 42],
    ["an object", { id: "u1" }],
  ])("a userId that is %s is a TypeError", (_name, bad) => {
    expect(make(fakeClient().music, { ...good, userId: bad })).toThrow(/^userTokenIntake: userId must be a function that returns the signed-in user's id; got /);
  });

  test.each<[string, unknown, unknown]>([
    ["client", "secret-token", good],
    ["options", fakeClient().music, "secret-token"],
    ["store", fakeClient().music, { ...good, store: "secret-token" }],
    ["userId", fakeClient().music, { ...good, userId: "secret-token" }],
  ])("a token handed over as the %s is described and never shown", (_name, client, options) => {
    let error: unknown;
    try {
      make(client, options)();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/got 12 characters$/);
    expect((error as Error).message).not.toContain("secret");
  });

  test("a handler is made without asking Apple, the store, or the session for anything", () => {
    const { music, calls } = fakeClient();
    const set = vi.spyOn(store, "set");
    const userId = vi.fn(() => "u1");
    userTokenIntake(music, { store, userId });
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
    expect(userId).not.toHaveBeenCalled();
  });
});

describe("userTokenIntake: its options are taken once", () => {
  test("changing the options object afterwards changes neither where a token goes nor whose it is", async () => {
    const first = new MemoryUserTokenStore();
    const second = new MemoryUserTokenStore();
    const options: { store: tUserTokenStore; userId: () => string } = { store: first, userId: () => "u1" };
    const handler = userTokenIntake(fakeClient().music, options);
    options.store = second;
    options.userId = () => "someone-else";
    expect((await handler(post({ token: "user-token" }))).status).toBe(204);
    expect(await first.get("u1")).toBe("user-token");
    expect([await second.get("u1"), await second.get("someone-else"), await first.get("someone-else")]).toEqual([undefined, undefined, undefined]);
  });
});

describe("userTokenIntake: against a real server, with the real fetch", () => {
  let server: Server;
  let origin: string;
  let handler: tUserTokenIntake;

  beforeAll(async () => {
    // What a framework's adapter does: a node request in, a web Request to the handler, its Response back out.
    server = createServer((req, res) => {
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i] ?? "", req.rawHeaders[i + 1] ?? "");
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          req.on("data", (chunk: Buffer) => {
            if (!cancelled) controller.enqueue(new Uint8Array(chunk));
          });
          req.on("end", () => {
            if (!cancelled) controller.close();
          });
        },
        cancel() {
          // What is left of the upload is let go by, so the answer can still be written on this connection.
          cancelled = true;
          req.resume();
        },
      });
      const sends = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(origin + (req.url ?? "/"), { method: req.method ?? "GET", headers, body: sends ? body : null, duplex: "half" } as RequestInit);
      void handler(request).then(
        async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  /** Mounts an intake on the server and says where to post to it. */
  function mounted(replies: tReply[] = []) {
    const made = intake(replies);
    handler = made.handler;
    return { ...made, url: `${origin}/music/user-token` };
  }

  test("a JSON post is validated with Apple and stored: 204 with no body", async () => {
    const { url, store, calls } = mounted();
    const res = await fetch(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ token: "user-token" }) });
    expect([res.status, await res.text(), res.headers.get("cache-control")]).toEqual([204, "", "no-store"]);
    expect(await store.get("u1")).toBe("user-token");
    expect(calls.map((c) => c.headers.get("music-user-token"))).toEqual(["user-token"]);
  });

  test("a form post, the kind another site can send without asking, is 415 and reaches neither Apple nor the store", async () => {
    const { url, set, calls } = mounted();
    const res = await fetch(url, { method: "POST", body: new URLSearchParams({ token: "attacker-token" }) });
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect([res.status, await errorOf(res)]).toEqual([415, "UnsupportedMediaType"]);
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });

  test("a post that declares more than 8 KiB is 413, and the connection still carries the answer", async () => {
    const { url, calls } = mounted();
    const res = await fetch(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ token: "user-token", pad: "x".repeat(20_000) }) });
    expect([res.status, await errorOf(res)]).toEqual([413, "PayloadTooLarge"]);
    expect(calls).toHaveLength(0);
  });

  test("a post streamed with no declared length is cut off past 8 KiB: 413", async () => {
    const { url, calls } = mounted();
    let sent = 0;
    const upload = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 32) controller.enqueue(new Uint8Array(1024).fill(0x20));
        else controller.close();
      },
    });
    const res = await fetch(url, { method: "POST", headers: JSON_TYPE, body: upload, duplex: "half" } as RequestInit);
    expect([res.status, await errorOf(res)]).toEqual([413, "PayloadTooLarge"]);
    expect(calls).toHaveLength(0);
  });

  test("a GET is 405 and says what is allowed", async () => {
    const { url } = mounted();
    const res = await fetch(url);
    expect([res.status, res.headers.get("allow"), await errorOf(res)]).toEqual([405, "POST", "MethodNotAllowed"]);
  });

  test("a token Apple will not take is 422, with nothing of Apple's answer in it", async () => {
    const { url, store } = mounted([appleError(403, "Forbidden")]);
    const res = await fetch(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ token: "revoked" }) });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('{"error":"UserTokenInvalid"}');
    expect(await store.get("u1")).toBeUndefined();
  });
});

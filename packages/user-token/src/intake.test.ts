import type { tClientOptions } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isJson, userTokenIntake, type tUserTokenIntakeOptions } from "./intake.js";
import { MemoryUserTokenStore } from "./stores.js";
import { appleError, fakeClient, foreignClient, misshapen, padded, shaped, type tReply } from "./testing.js";

const ENDPOINT = "https://app.example/music/user-token";
const JSON_TYPE = { "content-type": "application/json" };

/** An intake over a scripted client, the store behind it, and a spy on every write to that store. */
function intake(replies: tReply[] = [], options: Partial<tUserTokenIntakeOptions> = {}, clientOptions: Partial<tClientOptions> = {}) {
  const { music, calls } = fakeClient(replies, clientOptions);
  const store = new MemoryUserTokenStore();
  const set = vi.spyOn(store, "set");
  const userId = vi.fn<tUserTokenIntakeOptions["userId"]>(() => "u1");
  const handler = userTokenIntake(music, { store, userId, ...options });
  return { handler, store, set, userId, calls };
}

const post = (body: unknown, headers: Record<string, string> = JSON_TYPE) =>
  new Request(ENDPOINT,{ method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

afterEach(() => {
  vi.useRealTimers();
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

  test.each(misshapen.filter((row): row is [string, string] => typeof row[1] === "string"))("422 UserTokenInvalid for a posted string that is %s, without asking Apple", async (_, token) => {
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
});

describe("a token is stored only after Apple accepts it", () => {
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

describe("the user comes from the session and nowhere else", () => {
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

describe("another site cannot bind its own token to a visitor", () => {
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

describe("Apple is asked under the client's retry policy, whatever it is", () => {
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

describe("a request that is aborted is not answered", () => {
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

describe("no response carries the token or Apple's error text, and none may be cached", () => {
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
    const seen = (await res.text()) + JSON.stringify([...res.headers]);
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

describe("a client from another copy of core is served the same", () => {
  const foreign = async (replies: tReply[] = []) => {
    const { music, calls } = await foreignClient(replies);
    const store = new MemoryUserTokenStore();
    return { store, calls, handler: userTokenIntake(music, { store, userId: () => "u1" }) };
  };

  test("a token Apple accepts is stored", async () => {
    const { handler, store } = await foreign();
    expect((await handler(post({ token: "user-token" }))).status).toBe(204);
    expect(await store.get("u1")).toBe("user-token");
  });

  test.each<[string, number, string, tReply[]]>([
    ["403", 422, "UserTokenInvalid", [{ status: 403 }]],
    ["401 for the listener", 422, "UserTokenInvalid", [{ status: 401 }, {}]],
    ["401 for the developer token", 502, "DeveloperTokenInvalid", [{ status: 401 }, { status: 401 }]],
    ["429", 502, "RateLimited", [{ status: 429 }]],
    ["500", 502, "ApiError", [{ status: 500 }]],
    ["200 naming no storefront", 502, "ApiError", [{ body: {} }]],
    ["failed fetch", 502, "NetworkError", [new TypeError("fetch failed")]],
  ])("its %s is answered %i %s, not thrown at the framework", async (_, status, tag, replies) => {
    const { handler, store } = await foreign(replies);
    const res = await handler(post({ token: "user-token" }));
    expect(res.status).toBe(status);
    expect(await errorOf(res)).toBe(tag);
    expect(await store.get("u1")).toBeUndefined();
  });
});

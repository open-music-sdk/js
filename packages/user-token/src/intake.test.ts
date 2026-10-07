import { createClient } from "@open-music-sdk/core";
import { describe, expect, test, vi } from "vitest";
import { userTokenIntake, type tUserTokenIntakeOptions } from "./intake.js";
import { MemoryUserTokenStore } from "./stores.js";

type tReply = { status?: number; body?: unknown } | Error;

/** An intake over a real client whose fetch answers from a queue of replies, and the store behind it. */
function intake(replies: tReply[] = [], options: Partial<tUserTokenIntakeOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { status: 200, body: { data: [{ id: "us", type: "storefronts" }] } };
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 }));
  };
  const store = new MemoryUserTokenStore();
  const handler = userTokenIntake(createClient({ developerToken: "dev", fetch, retry: false }), { store, userId: () => "u1", ...options });
  return { handler, store, calls };
}

const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("https://app.example/music/user-token", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("a token Apple accepts is stored for the session's user", () => {
  test("204, stored, and validated with that token", async () => {
    const { handler, store, calls } = intake();
    const res = await handler(post({ token: "user-token" }));
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await store.get("u1")).toBe("user-token");
    expect(calls.map((c) => [c.url, c.headers.get("music-user-token")])).toEqual([["https://api.music.apple.com/v1/me/storefront", "user-token"]]);
  });

  test("a new token replaces the stored one", async () => {
    const { handler, store } = intake();
    await store.set("u1", "old");
    await handler(post({ token: "new" }));
    expect(await store.get("u1")).toBe("new");
  });

  test("userId may be async and sees the request", async () => {
    const userId = vi.fn((req: Request) => Promise.resolve(req.headers.get("x-session")));
    const { handler, store } = intake([], { userId });
    const res = await handler(post({ token: "user-token" }, { "content-type": "application/json", "x-session": "u7" }));
    expect(res.status).toBe(204);
    expect(await store.get("u7")).toBe("user-token");
  });

  test.each(["application/json", "application/json; charset=utf-8", "application/json;charset=UTF-8", "Application/JSON"])("content type %s is JSON", async (type) => {
    const { handler } = intake();
    expect((await handler(post({ token: "user-token" }, { "content-type": type }))).status).toBe(204);
  });
});

describe("the user comes from the session and nowhere else", () => {
  test.each([undefined, null, ""])("userId resolving to %j is 401, before the body is read or Apple is asked", async (id) => {
    const { handler, store, calls } = intake([], { userId: () => id });
    const req = post({ token: "user-token" });
    const res = await handler(req);
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe("Unauthorized");
    expect(req.bodyUsed).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await store.get("")).toBeUndefined();
  });

  test("a user named in the body is ignored", async () => {
    const { handler, store } = intake();
    await handler(post({ token: "user-token", userId: "victim", user: "victim", id: "victim" }));
    expect(await store.get("victim")).toBeUndefined();
    expect(await store.get("u1")).toBe("user-token");
  });

  test("a userId that throws rejects the handler and stores nothing", async () => {
    const { handler, store, calls } = intake([], {
      userId: () => {
        throw new Error("session store down");
      },
    });
    await expect(handler(post({ token: "user-token" }))).rejects.toThrow("session store down");
    expect(calls).toHaveLength(0);
    expect(await store.get("u1")).toBeUndefined();
  });
});

describe("only a JSON POST is taken in", () => {
  test.each(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"])("%s is 405 with Allow: POST", async (method) => {
    const userId = vi.fn(() => "u1");
    const { handler, calls } = intake([], { userId });
    const res = await handler(new Request("https://app.example/music/user-token", { method, headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(userId).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  // The types a cross-site form or a no-cors fetch can send without a preflight, and their lookalikes.
  test.each([
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonp",
    "application/json-seq",
    "text/plain; application/json",
    "text/json",
    "",
  ])("content type %j is 415, so another site cannot bind its token to a visitor", async (type) => {
    const userId = vi.fn(() => "u1");
    const { handler, store, calls } = intake([], { userId });
    const res = await handler(post({ token: "attacker-token" }, { "content-type": type }));
    expect(res.status).toBe(415);
    expect(userId).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(await store.get("u1")).toBeUndefined();
  });

  test("no content type at all is 415", async () => {
    const { handler } = intake();
    const req = new Request("https://app.example/music/user-token", { method: "POST", body: new Blob([JSON.stringify({ token: "t" })]) });
    expect(req.headers.get("content-type")).toBeNull();
    expect((await handler(req)).status).toBe(415);
  });
});

describe("the body is { token: string } and nothing bigger", () => {
  test.each([
    ["not JSON", "token=abc"],
    ["truncated JSON", '{"token":"abc'],
    ["empty", ""],
    ["null", "null"],
    ["a string", '"abc"'],
    ["an array", '["abc"]'],
    ["no token", "{}"],
    ["a numeric token", '{"token":123}'],
    ["a null token", '{"token":null}'],
    ["a nested token", '{"token":{"token":"abc"}}'],
  ])("%s is 400 and Apple is never asked", async (_, body) => {
    const { handler, store, calls } = intake();
    const res = await handler(post(body));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("BadRequest");
    expect(calls).toHaveLength(0);
    expect(await store.get("u1")).toBeUndefined();
  });

  test("a body past 8 KiB is 413", async () => {
    const { handler, calls } = intake();
    const res = await handler(post({ token: "a".repeat(8192) }));
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  test("a streamed body that understates its length is cut off at the limit", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024).fill(0x20));
      },
    });
    const req = new Request("https://app.example/music/user-token", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "10" },
      body,
      duplex: "half",
    } as RequestInit);
    const { handler } = intake();
    expect((await handler(req)).status).toBe(413);
    expect(pulls).toBeLessThan(20);
  });

  test("a body of exactly 8 KiB is read", async () => {
    const { handler } = intake();
    const padding = " ".repeat(8192 - JSON.stringify({ token: "user-token" }).length);
    expect((await handler(post(JSON.stringify({ token: "user-token" }) + padding))).status).toBe(204);
  });

  test("a multi-byte character split across chunks is decoded whole", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ token: "user-token", note: "é" }));
    const cut = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const req = new Request("https://app.example/music/user-token", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    const { handler } = intake();
    expect((await handler(req)).status).toBe(204);
  });
});

describe("a token is stored only after Apple accepts it", () => {
  test("403 from Apple is 422 UserTokenInvalid, and the stored token stays", async () => {
    const { handler, store } = intake([{ status: 403 }]);
    await store.set("u1", "old");
    const res = await handler(post({ token: "revoked" }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("UserTokenInvalid");
    expect(await store.get("u1")).toBe("old");
  });

  test.each(["to ken", "token\r\nx-injected: 1", "tokén", "", "a".repeat(4097)])("a token that could not be a header (%j) is 422 without asking Apple", async (token) => {
    const { handler, store, calls } = intake();
    const res = await handler(post({ token }));
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe("UserTokenInvalid");
    expect(calls).toHaveLength(0);
    expect(await store.get("u1")).toBeUndefined();
  });

  test.each<[string, tReply, string]>([
    ["401", { status: 401 }, "DeveloperTokenRejected"],
    ["429", { status: 429 }, "RateLimited"],
    ["500", { status: 500 }, "ApiError"],
    ["a failed fetch", new TypeError("fetch failed"), "NetworkError"],
  ])("%s from Apple is 502, not a verdict on the token, and nothing is stored", async (_, reply, tag) => {
    const { handler, store } = intake([reply]);
    const res = await handler(post({ token: "user-token" }));
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe(tag);
    expect(await store.get("u1")).toBeUndefined();
  });

  test("the store failing rejects the handler", async () => {
    const store = new MemoryUserTokenStore();
    store.set = () => Promise.reject(new Error("store down"));
    const { handler } = intake([], { store });
    await expect(handler(post({ token: "user-token" }))).rejects.toThrow("store down");
  });

  test("an aborted request rejects with the abort and stores nothing", async () => {
    const { handler, store, calls } = intake();
    const controller = new AbortController();
    const req = new Request("https://app.example/music/user-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "user-token" }),
      signal: controller.signal,
    });
    controller.abort(new Error("client went away"));
    await expect(handler(req)).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(await store.get("u1")).toBeUndefined();
  });
});

describe("no response says anything about the token or Apple's answer", () => {
  test.each<[string, unknown, tReply[]]>([
    ["accepted", { token: "secret-token" }, []],
    ["rejected by Apple", { token: "secret-token" }, [{ status: 403, body: { errors: [{ id: "e", title: "Forbidden", detail: "apple-internal-detail", status: "403", code: "40300" }] } }]],
    ["rejected for its shape", { token: "secret token" }, []],
    ["Apple failing", { token: "secret-token" }, [{ status: 500, body: { errors: [{ id: "e", title: "Oops", detail: "apple-internal-detail", status: "500", code: "50000" }] } }]],
    ["a bad body", '{"token":"secret-token"', []],
    ["too large", { token: "secret-token", pad: "x".repeat(9000) }, []],
  ])("%s", async (_, body, replies) => {
    const { handler } = intake(replies);
    const res = await handler(post(body));
    const seen = (await res.text()) + JSON.stringify([...res.headers]);
    expect(seen).not.toContain("secret");
    expect(seen).not.toContain("apple-internal");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

import { createClient, isAppleMusicError, type AppleMusicError, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { validateUserToken } from "./token.js";

/** One answer from Apple: a response, a fetch that throws, or `"hang"` for one that never answers until the request aborts. */
type tReply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error | "hang";

const storefront = (id = "us") => ({ data: [{ id, type: "storefronts", href: `/v1/storefronts/${id}` }] });

/** Apple's error body for `status`, with a detail no message of ours should repeat. */
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

/** The AppleMusicError `p` rejects with; anything else fails the test. */
const failure = async (p: Promise<unknown>): Promise<AppleMusicError> => {
  try {
    await p;
  } catch (e) {
    if (isAppleMusicError(e)) return e;
    throw new Error(`expected an AppleMusicError, got ${String(e)}`, { cause: e });
  }
  throw new Error("expected a rejection");
};

/** Tokens by core's rule, tokens once the whitespace around them is dropped, and values that are no token at all. */
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
const misshapen: [string, unknown][] = [
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
  ["undefined", undefined],
  ["null", null],
  ["a number", 12345],
  ["true", true],
  ["an object", { token: "abc" }],
  ["an array holding a token", ["abc"]],
];

afterEach(() => {
  vi.useRealTimers();
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("validateUserToken", () => {
  test("asks Apple for the listener's storefront with both tokens", async () => {
    const { music, calls } = fakeClient();
    await validateUserToken(music, "user-token");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://api.music.apple.com/v1/me/storefront");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer dev");
    expect(calls[0]?.headers.get("music-user-token")).toBe("user-token");
  });

  test.each([
    ["the storefront", storefront("us"), "us"],
    ["another storefront", storefront("jp"), "jp"],
    ["the first of several", { data: [{ id: "gb" }, { id: "us" }] }, "gb"],
    ["one with nothing but an id", { data: [{ id: "de" }] }, "de"],
  ])("resolves to %s Apple names", async (_, body, id) => {
    const { music } = fakeClient([{ body }]);
    await expect(validateUserToken(music, "user-token")).resolves.toBe(id);
  });

  test.each<[string, { status?: number; body?: unknown }]>([
    ["an empty 200", {}],
    ["a 204", { status: 204 }],
    ["an empty object", { body: {} }],
    ["no data", { body: { next: "/v1/me/storefront?offset=1" } }],
    ["null data", { body: { data: null } }],
    ["empty data", { body: { data: [] } }],
    ["a null item", { body: { data: [null] } }],
    ["an item with no id", { body: { data: [{ type: "storefronts" }] } }],
    ["a numeric id", { body: { data: [{ id: 143441 }] } }],
    ["errors under a 200", { body: { errors: [{ title: "Forbidden", status: "403" }] } }],
    ["a bare string", { body: "us" }],
    ["an array", { body: [{ id: "us" }] }],
    ["null", { body: null }],
  ])("a 2xx with %s is ApiError: Apple named no storefront", async (_, reply) => {
    const { music } = fakeClient([reply]);
    const e = await failure(validateUserToken(music, "user-token"));
    expect(e._tag).toBe("ApiError");
    expect(e.status).toBe(200);
  });

  test("403 is UserTokenInvalid", async () => {
    const { music } = fakeClient([appleError(403, "Forbidden")]);
    const e = await failure(validateUserToken(music, "revoked"));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.status).toBe(403);
  });

  test.each([
    [404, "ApiError"],
    [429, "RateLimited"],
    [500, "ApiError"],
    [503, "ApiError"],
  ])("%i is the client's %s, not a verdict on the token", async (status, tag) => {
    const { music, calls } = fakeClient([{ status }]);
    const e = await failure(validateUserToken(music, "user-token"));
    expect(e._tag).toBe(tag);
    expect(e.status).toBe(status);
    expect(calls).toHaveLength(1);
  });

  test("401, with the developer token accepted on its own, is UserTokenInvalid", async () => {
    const { music } = fakeClient([appleError(401, "Unauthorized"), {}]);
    const e = await failure(validateUserToken(music, "user-token"));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.status).toBe(401);
  });

  test("401, with the developer token refused on its own too, is DeveloperTokenInvalid", async () => {
    const { music } = fakeClient([appleError(401, "Unauthorized"), appleError(401, "Unauthorized")]);
    const e = await failure(validateUserToken(music, "user-token"));
    expect(e._tag).toBe("DeveloperTokenInvalid");
    expect(e.status).toBe(401);
  });

  test("a failed fetch is a NetworkError", async () => {
    const { music } = fakeClient([new TypeError("fetch failed")]);
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe("NetworkError");
  });

  test.each(misshapen)("%s is the caller's mistake: a TypeError before Apple is asked, not a verdict on a token", async (_, token) => {
    const { music, calls } = fakeClient();
    const error: unknown = await validateUserToken(music, token as string).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(isAppleMusicError(error)).toBe(false);
    expect((error as Error).message).toMatch(/^validateUserToken: token must be printable characters with no spaces or line breaks inside; got /);
    expect(calls).toHaveLength(0);
  });

  test.each(padded)("%s around a token is dropped before it is sent, as core drops it", async (_, token) => {
    const { music, calls } = fakeClient();
    await validateUserToken(music, token);
    expect(calls[0]?.headers.get("music-user-token")).toBe("token");
  });

  test.each(shaped)("%s is sent as it is", async (_, token) => {
    const { music, calls } = fakeClient();
    await validateUserToken(music, token);
    expect(calls[0]?.headers.get("music-user-token")).toBe(token);
  });

  test("an already aborted signal rejects with the reason before fetching", async () => {
    const { music, calls } = fakeClient();
    const reason = new Error("stop");
    await expect(validateUserToken(music, "user-token", { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
  });

  test("aborting while Apple is asked rejects with the reason", async () => {
    const { music, calls } = fakeClient(["hang"]);
    const controller = new AbortController();
    const out = validateUserToken(music, "user-token", { signal: controller.signal });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(out).rejects.toBe(reason);
  });
});

describe("validateUserToken: a 401 on a personal endpoint is settled by asking once more without the user token", () => {
  const sent = (calls: Request[]) => calls.map((c) => [new URL(c.url).pathname, c.headers.get("authorization"), c.headers.get("music-user-token")]);

  test("the second request is GET /v1/test with the developer token and no user token", async () => {
    const { music, calls } = fakeClient([{ status: 401 }, {}]);
    await failure(validateUserToken(music, "user-token"));
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(sent(calls)).toEqual([
      ["/v1/me/storefront", "Bearer dev", "user-token"],
      ["/v1/test", "Bearer dev", null],
    ]);
  });

  test("a client bound to a listener does not lend its user token to the second request either", async () => {
    const { music, calls } = fakeClient([{ status: 401 }, {}], { userToken: "bound" });
    await failure(validateUserToken(music, "candidate"));
    expect(sent(calls).map((c) => c[2])).toEqual(["candidate", null]);
  });

  test.each<[string, tReply]>([
    ["an empty 200", {}],
    ["a 204", { status: 204 }],
    ["a 200 with a body", { body: { ok: true } }],
  ])("%s to the second request means the listener was the problem", async (_, probe) => {
    const { music, calls } = fakeClient([appleError(401, "Unauthorized"), probe]);
    const e = await failure(validateUserToken(music, "user-token"));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.message).toMatch(/not signed in, or no Apple Music subscription/);
    expect(e.errors?.[0]?.title).toBe("Unauthorized");
    expect(isAppleMusicError(e.cause, "DeveloperTokenInvalid")).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test.each<[string, tReply, string]>([
    ["401", { status: 401 }, "DeveloperTokenInvalid"],
    ["404", { status: 404 }, "ApiError"],
    ["429", { status: 429 }, "RateLimited"],
    ["500", { status: 500 }, "ApiError"],
    ["a failed fetch", new TypeError("fetch failed"), "NetworkError"],
  ])("%s to the second request is that request's own error: nothing was learned about the listener", async (_, probe, tag) => {
    const { music, calls } = fakeClient([{ status: 401 }, probe]);
    const e = await failure(validateUserToken(music, "user-token"));
    expect(e._tag).toBe(tag);
    expect(e.message).not.toMatch(/subscription/);
    expect(calls).toHaveLength(2);
  });

  test.each<[string, tReply]>([
    ["200", { body: storefront() }],
    ["403", { status: 403 }],
    ["404", { status: 404 }],
    ["429", { status: 429 }],
    ["500", { status: 500 }],
    ["a failed fetch", new TypeError("fetch failed")],
  ])("%s to the first request is not followed by a second", async (_, reply) => {
    const { music, calls } = fakeClient([reply]);
    await validateUserToken(music, "user-token").catch(() => undefined);
    expect(sent(calls).map((c) => c[0])).toEqual(["/v1/me/storefront"]);
  });

  test("a provider that replaces a rejected developer token is asked first, and the second request uses what it gave", async () => {
    let current = "dev-0";
    const developerToken = (ctx: { rejected?: string | undefined }) => {
      if (ctx.rejected !== undefined) current = "dev-1";
      return current;
    };
    const { music, calls } = fakeClient([{ status: 401 }, { status: 401 }, {}], { developerToken });
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe("UserTokenInvalid");
    expect(sent(calls)).toEqual([
      ["/v1/me/storefront", "Bearer dev-0", "user-token"],
      ["/v1/me/storefront", "Bearer dev-1", "user-token"],
      ["/v1/test", "Bearer dev-1", null],
    ]);
  });

  test("aborting during the second request rejects with the reason", async () => {
    const { music, calls } = fakeClient([{ status: 401 }, "hang"]);
    const controller = new AbortController();
    const out = validateUserToken(music, "user-token", { signal: controller.signal });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(out).rejects.toBe(reason);
  });
});

describe("validateUserToken: the client it was given is left as it was", () => {
  test("the token under test replaces the one the client is bound to, for this call only", async () => {
    const { music, calls } = fakeClient([], { userToken: "bound" });
    await validateUserToken(music, "candidate");
    await music.request("v1/me/library/songs");
    expect(calls.map((c) => c.headers.get("music-user-token"))).toEqual(["candidate", "bound"]);
  });

  test("a configured storefront does not answer for Apple", async () => {
    const { music, calls } = fakeClient([appleError(403, "Forbidden")], { storefront: "us" });
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe("UserTokenInvalid");
    expect(calls).toHaveLength(1);
  });

  test("the storefront Apple names wins over the configured one", async () => {
    const { music } = fakeClient([{ body: storefront("jp") }], { storefront: "us" });
    await expect(validateUserToken(music, "user-token")).resolves.toBe("jp");
  });
});

describe("validateUserToken: Apple is asked under the client's retry policy, whatever it is", () => {
  test("with retries off, one failure is the answer", async () => {
    const { music, calls } = fakeClient([{ status: 500 }], { retry: false });
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe("ApiError");
    expect(calls).toHaveLength(1);
  });

  test("with the default policy, a 500 is retried once", async () => {
    vi.useFakeTimers();
    const { music, calls } = fakeClient([{ status: 500 }], { retry: undefined });
    const out = validateUserToken(music, "user-token");
    await vi.advanceTimersByTimeAsync(4000);
    await expect(out).resolves.toBe("us");
    expect(calls).toHaveLength(2);
  });

  test("a 403 is never retried", async () => {
    vi.useFakeTimers();
    const { music, calls } = fakeClient([{ status: 403 }], { retry: undefined });
    const out = failure(validateUserToken(music, "user-token"));
    await vi.advanceTimersByTimeAsync(4000);
    expect((await out)._tag).toBe("UserTokenInvalid");
    expect(calls).toHaveLength(1);
  });
});

describe("validateUserToken: no error quotes a token", () => {
  /** Everything an error shows when it is printed or serialised. */
  const shown = (e: unknown) => (e instanceof Error ? `${e.message} ${e.stack ?? ""} ${JSON.stringify(e, Object.getOwnPropertyNames(e))} ${String(e.cause)}` : String(e));

  test.each<[string, Error]>([
    ["in its message", new Error("refused secret-token")],
    ["in a property of its own", Object.assign(new Error("refused"), { token: "secret-token" })],
    ["in its cause", new Error("refused", { cause: new Error("secret-token") })],
  ])("the check itself sees a token an error carries %s, so its silence means something", (_name, error) => {
    expect(shown(error)).toContain("secret");
  });

  test.each<[string, string, tReply[]]>([
    ["refused for what it is", "secret token", []],
    ["rejected by Apple", "secret-token", [appleError(403, "Forbidden")]],
    ["rejected for the listener's account", "secret-token", [appleError(401, "Unauthorized"), {}]],
    ["sent with a developer token Apple refuses", "secret-token", [appleError(401, "Unauthorized"), appleError(401, "Unauthorized")]],
    ["Apple could not vouch for", "secret-token", [appleError(500, "Internal Server Error")]],
    ["Apple named no storefront for", "secret-token", [{ body: {} }]],
  ])("one %s", async (_, token, replies) => {
    const { music } = fakeClient(replies);
    const error: unknown = await validateUserToken(music, token).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(shown(error)).not.toContain("secret");
  });
});

describe("validateUserToken: what it is handed is checked before Apple is asked", () => {
  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a token in its place", "secret-token"],
    ["an object that is no client", {}],
    ["an object with request but no as", { request: () => undefined }],
  ])("a client that is %s is a TypeError", async (_name, client) => {
    const error: unknown = await validateUserToken(client as tAppleMusicClient, "user-token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/^validateUserToken: client must be a client from createClient; got /);
    expect((error as Error).message).not.toContain("secret");
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["a signal, where an options object holding one belongs", "signal"],
    ["a number", 42],
  ])("options that are %s are a TypeError, and Apple is not asked", async (_name, options) => {
    const { music, calls } = fakeClient();
    const error: unknown = await validateUserToken(music, "user-token", options as undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/^validateUserToken: expected an options object; got /);
    expect(calls).toHaveLength(0);
  });

  test.each([undefined, {}, { signal: undefined }])("options of %j mean no signal", async (options) => {
    const { music } = fakeClient();
    await expect(validateUserToken(music, "user-token", options)).resolves.toBe("us");
  });

  test("the client is checked before the token: with both wrong, the error is about the client", async () => {
    const error: unknown = await validateUserToken(undefined as unknown as tAppleMusicClient, "not a token").catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/^validateUserToken: client /);
  });
});

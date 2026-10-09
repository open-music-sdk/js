import { AppleMusicError, isAppleMusicError, type tErrorTag } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { appleError, failure, fakeClient, foreignClient, misshapen, padded, shaped, storefront, type tReply } from "./testing.js";
import { validateUserToken } from "./token.js";

afterEach(() => {
  vi.useRealTimers();
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

describe("a 401 on a personal endpoint is settled by asking once more without the user token", () => {
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

describe("validating leaves the client it was given as it was", () => {
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

describe("Apple is asked under the client's retry policy, whatever it is", () => {
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

describe("no error quotes a token", () => {
  /** Everything an error shows when it is printed or serialised. */
  const shown = (e: unknown) => (e instanceof Error ? `${e.message} ${e.stack ?? ""} ${JSON.stringify(e, Object.getOwnPropertyNames(e))} ${String(e.cause)}` : String(e));

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

describe("a client from another copy of core is validated the same", () => {
  test("that copy really is another: its error class is not this one", async () => {
    const { core } = await foreignClient();
    expect(core.AppleMusicError).not.toBe(AppleMusicError);
    expect(Object.getPrototypeOf(new core.AppleMusicError("ApiError", "x"))).not.toBe(AppleMusicError.prototype);
  });

  test("a token Apple accepts resolves to the storefront", async () => {
    const { music } = await foreignClient([{ body: storefront("jp") }]);
    await expect(validateUserToken(music, "user-token")).resolves.toBe("jp");
  });

  test.each<[string, tErrorTag, tReply[]]>([
    ["403", "UserTokenInvalid", [{ status: 403 }]],
    ["429", "RateLimited", [{ status: 429 }]],
    ["500", "ApiError", [{ status: 500 }]],
    ["failed fetch", "NetworkError", [new TypeError("fetch failed")]],
    ["401 for the listener", "UserTokenInvalid", [{ status: 401 }, {}]],
    ["401 for the developer token", "DeveloperTokenInvalid", [{ status: 401 }, { status: 401 }]],
    ["200 naming no storefront", "ApiError", [{ body: {} }]],
  ])("its %s is a %s to this copy's guard and to its own", async (_, tag, replies) => {
    const { core, music } = await foreignClient(replies);
    const e = await validateUserToken(music, "user-token").catch((thrown: unknown) => thrown);
    expect(isAppleMusicError(e, tag)).toBe(true);
    expect(core.isAppleMusicError(e, tag)).toBe(true);
  });

  test("a 401 from that copy's client is still followed by the second request", async () => {
    const { music, calls } = await foreignClient([{ status: 401 }, {}]);
    await validateUserToken(music, "user-token").catch(() => undefined);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/me/storefront", "/v1/test"]);
  });

  test("the UserTokenInvalid this package makes, for a 401 that was the listener's, is an instance of that copy's class", async () => {
    const { core, music } = await foreignClient([{ status: 401 }, {}]);
    const e = await validateUserToken(music, "user-token").catch((thrown: unknown) => thrown);
    expect(Object.getPrototypeOf(e)).toBe(AppleMusicError.prototype);
    expect(e instanceof core.AppleMusicError).toBe(true);
  });
});

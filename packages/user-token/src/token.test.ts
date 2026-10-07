import { isAppleMusicError } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { appleError, failure, fakeClient, misshapen, shaped, storefront, type tReply } from "./testing.js";
import { isUserTokenShaped, userTokenFromEnv, validateUserToken } from "./token.js";

/** An environment holding one variable. */
const env = (value: unknown, name = "TOKEN") => ({ [name]: value });

const thrownBy = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isUserTokenShaped", () => {
  test.each(shaped)("%s could be a header value", (_, value) => {
    expect(isUserTokenShaped(value)).toBe(true);
  });

  test.each(misshapen)("%s could not", (_, value) => {
    expect(isUserTokenShaped(value)).toBe(false);
  });

  test.each(shaped)("%s goes through Headers unchanged", (_, value) => {
    expect(new Headers({ "music-user-token": value }).get("music-user-token")).toBe(value);
  });
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

  test("401, with the developer token refused on its own too, is DeveloperTokenRejected", async () => {
    const { music } = fakeClient([appleError(401, "Unauthorized"), appleError(401, "Unauthorized")]);
    const e = await failure(validateUserToken(music, "user-token"));
    expect(e._tag).toBe("DeveloperTokenRejected");
    expect(e.status).toBe(401);
  });

  test("a failed fetch is a NetworkError", async () => {
    const { music } = fakeClient([new TypeError("fetch failed")]);
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe("NetworkError");
  });

  test.each(misshapen)("%s is UserTokenInvalid without asking Apple", async (_, token) => {
    const { music, calls } = fakeClient();
    const e = await failure(validateUserToken(music, token));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.status).toBeUndefined();
    expect(calls).toHaveLength(0);
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

describe("userTokenFromEnv", () => {
  test("reads the named variable from the object it is given", () => {
    expect(userTokenFromEnv("TOKEN", env("abc"))).toBe("abc");
  });

  test("the name defaults to MUSIC_USER_TOKEN", () => {
    expect(userTokenFromEnv(undefined, env("abc", "MUSIC_USER_TOKEN"))).toBe("abc");
  });

  test("the source defaults to process.env", () => {
    vi.stubEnv("MUSIC_USER_TOKEN", "from-process");
    expect(userTokenFromEnv()).toBe("from-process");
  });

  test.each(shaped)("%s is returned as it is", (_, value) => {
    expect(userTokenFromEnv("TOKEN", env(value))).toBe(value);
  });

  test.each([" abc", "abc ", "abc\n", "\tabc\r\n", "\n\n abc \n"])("surrounding whitespace is dropped: %j", (value) => {
    expect(userTokenFromEnv("TOKEN", env(value))).toBe("abc");
  });

  describe("a token that is not there is not an error", () => {
    test.each([
      ["missing", {}],
      ["undefined", env(undefined)],
      ["null", env(null)],
      ["empty", env("")],
      ["blank", env(" \t\r\n")],
      ["set under another name", env("abc", "OTHER")],
    ])("a variable that is %s is undefined", (_, source) => {
      expect(userTokenFromEnv("TOKEN", source)).toBeUndefined();
    });

    test("a variable unset in process.env is undefined", () => {
      expect(userTokenFromEnv("OPEN_MUSIC_SDK_TEST_UNSET")).toBeUndefined();
    });

    test("so is any variable where there is no process", () => {
      vi.stubGlobal("process", undefined);
      const token = userTokenFromEnv();
      vi.unstubAllGlobals();
      expect(token).toBeUndefined();
    });
  });

  describe("a token that is there has to look like one", () => {
    test.each([
      ["an inner space", "to ken"],
      ["two lines", "first-line\nsecond-line"],
      ["quotes left by a .env file", '"abc def"'],
      ["non-ASCII", "tokén"],
      ["4097 characters", "a".repeat(4097)],
      ["a number", 12345],
      ["true", true],
      ["an object", { token: "abc" }],
      ["a function", () => "abc"],
    ])("%s is UserTokenInvalid", (_, value) => {
      expect(isAppleMusicError(thrownBy(() => userTokenFromEnv("TOKEN", env(value))), "UserTokenInvalid")).toBe(true);
    });

    test("an inherited member is not a token either", () => {
      expect(() => userTokenFromEnv("toString", {})).toThrow(/^toString is not a Music User Token/);
    });
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
    expect(isAppleMusicError(e.cause, "DeveloperTokenRejected")).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test.each<[string, tReply, string]>([
    ["401", { status: 401 }, "DeveloperTokenRejected"],
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
  const quoted = (e: unknown) => JSON.stringify(isAppleMusicError(e) ? [e.message, e.errors, String(e.cause)] : String(e));

  test.each<[string, string, tReply[]]>([
    ["rejected for its shape", "secret token", []],
    ["rejected by Apple", "secret-token", [appleError(403, "Forbidden")]],
    ["rejected for the listener's account", "secret-token", [appleError(401, "Unauthorized"), {}]],
    ["sent with a developer token Apple refuses", "secret-token", [appleError(401, "Unauthorized"), appleError(401, "Unauthorized")]],
    ["Apple could not vouch for", "secret-token", [appleError(500, "Internal Server Error")]],
    ["Apple named no storefront for", "secret-token", [{ body: {} }]],
  ])("one %s", async (_, token, replies) => {
    const { music } = fakeClient(replies);
    expect(quoted(await failure(validateUserToken(music, token)))).not.toContain("secret");
  });

  test("one found malformed in the environment: the variable is named, the value is not", () => {
    const thrown = thrownBy(() => userTokenFromEnv("MUSIC_USER_TOKEN", env("secret-one\nsecret-two", "MUSIC_USER_TOKEN")));
    expect(isAppleMusicError(thrown, "UserTokenInvalid")).toBe(true);
    expect(quoted(thrown)).toContain("MUSIC_USER_TOKEN is not a Music User Token");
    expect(quoted(thrown)).not.toContain("secret");
  });
});

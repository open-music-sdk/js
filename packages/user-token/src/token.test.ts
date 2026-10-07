import { createClient, isAppleMusicError, type AppleMusicError, type tClientOptions } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { userTokenFromEnv, validateUserToken } from "./token.js";

type tReply = { status?: number; body?: unknown } | Error;

/** A client over a fetch that answers from a queue of replies and records every Request it saw. */
function client(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { status: 200, body: { data: [{ id: "us", type: "storefronts" }] } };
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 }));
  };
  return { music: createClient({ developerToken: "dev", fetch, retry: false, ...options }), calls };
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateUserToken", () => {
  test("asks Apple for the listener's storefront with both tokens", async () => {
    const { music, calls } = client();
    await expect(validateUserToken(music, "user-token")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://api.music.apple.com/v1/me/storefront");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer dev");
    expect(calls[0]?.headers.get("music-user-token")).toBe("user-token");
  });

  test("a configured storefront does not answer for Apple", async () => {
    const { music, calls } = client([{ status: 403 }], { storefront: "us" });
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe("UserTokenInvalid");
    expect(calls).toHaveLength(1);
  });

  test("the token under test replaces the one the client is bound to, for this call only", async () => {
    const { music, calls } = client([], { userToken: "bound" });
    await validateUserToken(music, "candidate");
    await music.request("v1/me/library/songs");
    expect(calls.map((c) => c.headers.get("music-user-token"))).toEqual(["candidate", "bound"]);
  });

  test("403 is UserTokenInvalid", async () => {
    const { music } = client([{ status: 403, body: { errors: [{ id: "e", title: "Forbidden", status: "403", code: "40300" }] } }]);
    const e = await failure(validateUserToken(music, "revoked"));
    expect(e._tag).toBe("UserTokenInvalid");
    expect(e.status).toBe(403);
  });

  test.each([
    [401, "DeveloperTokenRejected"],
    [429, "RateLimited"],
    [500, "ApiError"],
  ])("%i is the client's %s, not a verdict on the token", async (status, tag) => {
    const { music } = client([{ status }]);
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe(tag);
  });

  test("a failed fetch is a NetworkError", async () => {
    const { music } = client([new TypeError("fetch failed")]);
    expect((await failure(validateUserToken(music, "user-token")))._tag).toBe("NetworkError");
  });

  test("an abort is rethrown untouched", async () => {
    const { music, calls } = client();
    const reason = new Error("stop");
    await expect(validateUserToken(music, "user-token", { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
  });

  describe("a token that could not be a header value never reaches Apple", () => {
    test.each([
      ["empty", ""],
      ["a space", " "],
      ["an inner space", "to ken"],
      ["a trailing newline", "token\n"],
      ["a header injection", "token\r\nx-injected: 1"],
      ["a tab", "to\tken"],
      ["a NUL", "to\0ken"],
      ["a DEL", "to\x7fken"],
      ["non-ASCII", "tokén"],
      ["4097 characters", "a".repeat(4097)],
      ["undefined", undefined],
      ["null", null],
      ["a number", 12345],
      ["an object", { token: "abc" }],
    ])("%s", async (_, token) => {
      const { music, calls } = client();
      const e = await failure(validateUserToken(music, token));
      expect(e._tag).toBe("UserTokenInvalid");
      expect(calls).toHaveLength(0);
    });

    test.each([
      ["one character", "a"],
      ["4096 characters", "a".repeat(4096)],
      ["base64 punctuation", "Ab+/9=="],
      ["every visible ASCII character", Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).join("")],
    ])("%s is sent as it is", async (_, token) => {
      const { music, calls } = client();
      await validateUserToken(music, token);
      expect(calls[0]?.headers.get("music-user-token")).toBe(token);
    });
  });

  test.each([
    ["rejected for its shape", "secret token", []],
    ["rejected by Apple", "secret-token", [{ status: 403, body: { errors: [{ id: "e", title: "Forbidden", detail: "Invalid authentication", status: "403", code: "40300" }] } }]],
  ])("no error quotes a token %s", async (_, token, replies) => {
    const { music } = client(replies);
    const e = await failure(validateUserToken(music, token));
    expect(JSON.stringify([e.message, e.errors, String(e.cause)])).not.toContain("secret");
  });
});

describe("userTokenFromEnv", () => {
  const env = (value: unknown, name = "TOKEN") => ({ [name]: value });

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

  test.each([" abc", "abc\n", "\tabc\r\n"])("surrounding whitespace is dropped: %j", (value) => {
    expect(userTokenFromEnv("TOKEN", env(value))).toBe("abc");
  });

  test.each([
    ["missing", {}],
    ["empty", env("")],
    ["blank", env(" \n")],
    ["not a string", env(42)],
  ])("a variable that is %s is UserTokenInvalid, naming the variable", (_, source) => {
    let thrown: unknown;
    try {
      userTokenFromEnv("TOKEN", source);
    } catch (e) {
      thrown = e;
    }
    expect(isAppleMusicError(thrown, "UserTokenInvalid") && thrown.message).toBe("No Music User Token: set TOKEN");
  });

  test("an unset variable in process.env is UserTokenInvalid", () => {
    expect(() => userTokenFromEnv("OPEN_MUSIC_SDK_TEST_UNSET")).toThrow(/set OPEN_MUSIC_SDK_TEST_UNSET/);
  });
});

import { AppleMusicError, createClient, isAppleMusicError, type tErrorTag } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index.js";

/** One answer from Apple: a response, or a fetch that throws. */
type tReply = { status?: number; body?: unknown } | Error;

const storefront = (id = "us") => ({ data: [{ id, type: "storefronts", href: `/v1/storefronts/${id}` }] });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A fetch that answers from a queue of replies, then with a storefront, and records every Request it saw. */
function apple(replies: tReply[] = []) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const reply = replies.shift() ?? { body: storefront() };
    if (reply instanceof Error) return Promise.reject(reply);
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return { fetch, calls, sent: () => calls.map((c) => [new URL(c.url).pathname, c.headers.get("music-user-token")]) };
}

const post = (token: string) =>
  new Request("https://app.example/music/user-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("the package entry", () => {
  test("exports the documented names and nothing else", () => {
    expect(Object.keys(api).sort()).toEqual(["KvUserTokenStore", "MemoryUserTokenStore", "acceptUserToken", "userTokenIntake", "validateUserToken"]);
  });

  test("is the only one: nothing here holds a secret that has to be kept out of a browser", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test("reads no environment: nothing it exports takes one, and none of them looks for one", async () => {
    const env = vi.fn();
    vi.stubGlobal("process", new Proxy({}, { get: env }));
    const { fetch } = apple();
    const store = new api.MemoryUserTokenStore();
    const music = createClient({ developerToken: "dev", fetch, retry: false, userTokenStore: store });
    try {
      await api.validateUserToken(music, "user-token");
      await api.acceptUserToken(music, store, "u1", "user-token");
      await api.userTokenIntake(music, { store, userId: () => "u1" })(post("user-token"));
      new api.KvUserTokenStore({ get: () => Promise.resolve(null), put: () => Promise.resolve(), delete: () => Promise.resolve() });
      expect(env).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("from a posted token to a request for that listener, using nothing but the entry and core", async () => {
    const { fetch, sent } = apple([{ body: storefront() }, { body: { data: [] } }]);
    const store = new api.MemoryUserTokenStore();
    const music = createClient({ developerToken: "dev", fetch, retry: false, userTokenStore: store });
    const intake = api.userTokenIntake(music, { store, userId: () => "u1" });
    expect((await intake(post("user-token"))).status).toBe(204);
    await music.forUser("u1").request("v1/me/library/playlists");
    expect(sent()).toEqual([
      ["/v1/me/storefront", "user-token"],
      ["/v1/me/library/playlists", "user-token"],
    ]);
  });

  test("from a token an app holds to a client for that listener, without a request in sight", async () => {
    const { fetch, sent } = apple([{ body: storefront("jp") }, { body: { data: [] } }]);
    const store = new api.MemoryUserTokenStore();
    const music = createClient({ developerToken: "dev", fetch, retry: false, userTokenStore: store });
    await expect(api.acceptUserToken(music, store, "u1", "user-token")).resolves.toBe("jp");
    await music.forUser("u1").request("v1/me/library/playlists");
    expect(sent().map((call) => call[1])).toEqual(["user-token", "user-token"]);
  });

  test("the errors it throws for Apple's verdicts are the ones core recognises", async () => {
    const { fetch } = apple([{ status: 403 }]);
    const error: unknown = await api.validateUserToken(createClient({ developerToken: "dev", fetch, retry: false }), "revoked").catch((e: unknown) => e);
    expect(isAppleMusicError(error, "UserTokenInvalid")).toBe(true);
  });

  test("the errors it throws for a caller's mistakes are TypeErrors, which core does not take for Apple's", async () => {
    const { fetch, calls } = apple();
    const error: unknown = await api.validateUserToken(createClient({ developerToken: "dev", fetch, retry: false }), "not a token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(isAppleMusicError(error)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("an app whose copy of core is not the one this package resolves", () => {
  /** A second copy of core, as an app on another version of it has: its own error class, its own client. */
  async function foreignCore() {
    vi.resetModules();
    return import("@open-music-sdk/core");
  }

  /** A client and a store as that app would build them, over the fake Apple. */
  async function foreign(replies: tReply[] = []) {
    const core = await foreignCore();
    const { fetch, calls, sent } = apple(replies);
    const store = new api.MemoryUserTokenStore();
    return { core, store, calls, sent, music: core.createClient({ developerToken: "dev", fetch, retry: false, userTokenStore: store }) };
  }

  test("that copy has a class of its own, so its prototype chain cannot be what recognises an error from here", async () => {
    const { core, music } = await foreign([{ status: 401 }, {}]);
    expect(core.AppleMusicError).not.toBe(AppleMusicError);
    const error: unknown = await api.validateUserToken(music, "user-token").catch((e: unknown) => e);
    expect(Object.getPrototypeOf(error)).toBe(AppleMusicError.prototype);
    expect(Object.getPrototypeOf(error)).not.toBe(core.AppleMusicError.prototype);
    expect(error instanceof core.AppleMusicError).toBe(true);
  });

  test("a token Apple accepts is validated, stored, and sent on that copy's next request", async () => {
    const { music, store, sent } = await foreign([{ body: storefront("jp") }, { body: { data: [] } }]);
    await expect(api.acceptUserToken(music, store, "u1", "user-token")).resolves.toBe("jp");
    await music.forUser("u1").request("v1/me/library/playlists");
    expect(sent()).toEqual([
      ["/v1/me/storefront", "user-token"],
      ["/v1/me/library/playlists", "user-token"],
    ]);
  });

  test.each<[string, tErrorTag, tReply[]]>([
    ["403", "UserTokenInvalid", [{ status: 403 }]],
    ["401 for the listener", "UserTokenInvalid", [{ status: 401 }, {}]],
    ["401 for the developer token", "DeveloperTokenInvalid", [{ status: 401 }, { status: 401 }]],
    ["429", "RateLimited", [{ status: 429 }]],
    ["500", "ApiError", [{ status: 500 }]],
    ["200 naming no storefront", "ApiError", [{ body: {} }]],
    ["failed fetch", "NetworkError", [new TypeError("fetch failed")]],
  ])("validating against its %s is a %s to this copy's guard and to its own", async (_name, tag, replies) => {
    const { core, music } = await foreign(replies);
    const error: unknown = await api.validateUserToken(music, "user-token").catch((e: unknown) => e);
    expect(isAppleMusicError(error, tag)).toBe(true);
    expect(core.isAppleMusicError(error, tag)).toBe(true);
  });

  test("a 401 from that copy's client is still followed by the request that settles whose it was", async () => {
    const { music, sent } = await foreign([{ status: 401 }, {}]);
    await api.validateUserToken(music, "user-token").catch(() => undefined);
    expect(sent()).toEqual([
      ["/v1/me/storefront", "user-token"],
      ["/v1/test", null],
    ]);
  });

  test.each<[string, number, string, tReply[]]>([
    ["403", 422, "UserTokenInvalid", [{ status: 403 }]],
    ["401 for the listener", 422, "UserTokenInvalid", [{ status: 401 }, {}]],
    ["401 for the developer token", 502, "DeveloperTokenInvalid", [{ status: 401 }, { status: 401 }]],
    ["429", 502, "RateLimited", [{ status: 429 }]],
    ["500", 502, "ApiError", [{ status: 500 }]],
    ["200 naming no storefront", 502, "ApiError", [{ body: {} }]],
    ["failed fetch", 502, "NetworkError", [new TypeError("fetch failed")]],
  ])("the intake answers its %s with %i %s, rather than throwing it at the framework", async (_name, status, tag, replies) => {
    const { music, store } = await foreign(replies);
    const res = await api.userTokenIntake(music, { store, userId: () => "u1" })(post("user-token"));
    expect([res.status, await res.json()]).toEqual([status, { error: tag }]);
    expect(await store.get("u1")).toBeUndefined();
  });

  test("the intake stores a token that copy's Apple accepts", async () => {
    const { music, store } = await foreign();
    expect((await api.userTokenIntake(music, { store, userId: () => "u1" })(post("user-token"))).status).toBe(204);
    expect(await store.get("u1")).toBe("user-token");
  });
});

describe("the package manifest", () => {
  const core = "@open-music-sdk/core";

  test("core is an ordinary dependency on a caret range, as it is for the rest of the family", () => {
    expect(manifest.dependencies[core]).toBe("workspace:^");
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("core is the only dependency", () => {
    expect(Object.keys(manifest.dependencies)).toEqual([core]);
  });
});

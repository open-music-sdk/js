import { createClient, isAppleMusicError, type tClientOptions, type tUserTokenStore } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { acceptUserToken } from "./accept.js";
import { KvUserTokenStore, MemoryUserTokenStore } from "./stores.js";

/** One answer from Apple: a response, a fetch that throws, or `"hang"` for one that never answers until the request aborts. */
type tReply = { status?: number; body?: unknown } | Error | "hang";

const storefront = (id = "us") => ({ data: [{ id, type: "storefronts", href: `/v1/storefronts/${id}` }] });

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A client whose fetch answers from a queue of replies, then with a storefront, and records every Request it saw. */
function apple(replies: tReply[] = [], options: Partial<tClientOptions> = {}) {
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
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return { music: createClient({ developerToken: "dev", fetch, retry: false, ...options }), calls };
}

/** A memory store and a spy on every write to it. */
function kept() {
  const store = new MemoryUserTokenStore();
  return { store, set: vi.spyOn(store, "set") };
}

/** What `p` rejects with. A promise that resolves fails the test. */
const failed = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("acceptUserToken: a token Apple accepts", () => {
  test.each(["us", "jp", "gb"])("resolves to the storefront Apple names, %s", async (id) => {
    const { music } = apple([{ body: storefront(id) }]);
    await expect(acceptUserToken(music, kept().store, "u1", "user-token")).resolves.toBe(id);
  });

  test("is stored under the user id it was given, once, as the token Apple was asked about", async () => {
    const { music, calls } = apple();
    const { store, set } = kept();
    await acceptUserToken(music, store, "u1", "user-token");
    expect(set.mock.calls).toEqual([["u1", "user-token"]]);
    expect(calls.map((c) => [new URL(c.url).pathname, c.headers.get("music-user-token")])).toEqual([["/v1/me/storefront", "user-token"]]);
  });

  test("replaces the token already there", async () => {
    const { music } = apple();
    const { store } = kept();
    await store.set("u1", "old");
    await acceptUserToken(music, store, "u1", "new");
    expect(await store.get("u1")).toBe("new");
  });

  test.each([
    ["a leading space", " token"],
    ["a trailing newline", "token\n"],
    ["a tab before and a Windows line ending after", "\ttoken\r\n"],
  ])("handed over with %s, is validated and stored without it", async (_name, token) => {
    const { music, calls } = apple();
    const { store, set } = kept();
    await acceptUserToken(music, store, "u1", token);
    expect(calls[0]?.headers.get("music-user-token")).toBe("token");
    expect(set.mock.calls).toEqual([["u1", "token"]]);
  });

  test.each(["u1", "user@example.com", "a/b", "__proto__", "ü"])("is stored under %j as it is: a user id is the app's own", async (userId) => {
    const { music } = apple();
    const { store, set } = kept();
    await acceptUserToken(music, store, userId, "user-token");
    expect(set.mock.calls).toEqual([[userId, "user-token"]]);
  });

  test.each<[string, () => tUserTokenStore]>([
    ["MemoryUserTokenStore", () => new MemoryUserTokenStore()],
    ["KvUserTokenStore", () => new KvUserTokenStore({ get: () => Promise.resolve(null), put: () => Promise.resolve(), delete: () => Promise.resolve() })],
    ["a store of the app's own", () => ({ get: () => Promise.resolve(undefined), set: () => Promise.resolve(), delete: () => Promise.resolve() })],
  ])("is handed to a %s", async (_name, make) => {
    const { music } = apple();
    const store = make();
    const set = vi.spyOn(store, "set");
    await acceptUserToken(music, store, "u1", "user-token");
    expect(set).toHaveBeenCalledExactlyOnceWith("u1", "user-token");
  });

  test("the signal it was given reaches the request to Apple", async () => {
    const { music, calls } = apple();
    const controller = new AbortController();
    await acceptUserToken(music, kept().store, "u1", "user-token", { signal: controller.signal });
    controller.abort();
    expect(calls[0]?.signal.aborted).toBe(true);
  });
});

describe("acceptUserToken: a token is stored only after Apple accepts it", () => {
  test.each<[string, tReply[], string]>([
    ["403", [{ status: 403 }], "UserTokenInvalid"],
    ["401 for the listener", [{ status: 401 }, {}], "UserTokenInvalid"],
    ["401 for the developer token", [{ status: 401 }, { status: 401 }], "DeveloperTokenInvalid"],
    ["429", [{ status: 429 }], "RateLimited"],
    ["500", [{ status: 500 }], "ApiError"],
    ["a 200 naming no storefront", [{ body: {} }], "ApiError"],
    ["a failed fetch", [new TypeError("fetch failed")], "NetworkError"],
  ])("Apple answering %s rejects as %s, writes nothing, and leaves the token already there", async (_name, replies, tag) => {
    const { music } = apple(replies);
    const { store, set } = kept();
    await store.set("u1", "old");
    set.mockClear();
    const error = await failed(acceptUserToken(music, store, "u1", "user-token"));
    expect(isAppleMusicError(error) && error._tag).toBe(tag);
    expect(set).not.toHaveBeenCalled();
    expect(await store.get("u1")).toBe("old");
  });

  test("the store is not written while Apple has yet to answer", async () => {
    const { music, calls } = apple(["hang"]);
    const { store, set } = kept();
    const controller = new AbortController();
    const out = failed(acceptUserToken(music, store, "u1", "user-token", { signal: controller.signal }));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(set).not.toHaveBeenCalled();
    const reason = new Error("stop");
    controller.abort(reason);
    expect(await out).toBe(reason);
    expect(set).not.toHaveBeenCalled();
  });

  test("an already aborted signal rejects with the reason before Apple is asked", async () => {
    const { music, calls } = apple();
    const { store, set } = kept();
    const reason = new Error("stop");
    await expect(acceptUserToken(music, store, "u1", "user-token", { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });

  test("a store that fails rejects with its error: accepted by Apple but not kept is not success", async () => {
    const { music } = apple();
    const { store, set } = kept();
    const down = new Error("store down");
    set.mockRejectedValue(down);
    await expect(acceptUserToken(music, store, "u1", "user-token")).rejects.toBe(down);
  });
});

describe("acceptUserToken: what is no token is the caller's mistake, and reaches neither Apple nor the store", () => {
  test.each<[string, unknown]>([
    ["an empty string", ""],
    ["only whitespace", " \n"],
    ["a space inside it", "to ken"],
    ["a line break inside it", "to\nken"],
    ["a header smuggled after it", "token\r\nx-injected: 1"],
    ["a letter outside ASCII", "tokén"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 12345],
    ["an object holding a token", { token: "abc" }],
  ])("%s is a TypeError that names acceptUserToken and does not show the value", async (_name, token) => {
    const { music, calls } = apple();
    const { store, set } = kept();
    const error = await failed(acceptUserToken(music, store, "u1", token as string));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/^acceptUserToken: token must be printable characters with no spaces or line breaks inside; got /);
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("acceptUserToken: what it is handed is checked before Apple is asked", () => {
  /** A call with one argument replaced, and what it rejected with, what it asked Apple, and what it stored. */
  async function handed(replace: { client?: unknown; store?: unknown; userId?: unknown; options?: unknown }) {
    const { music, calls } = apple();
    const { store, set } = kept();
    const args = { client: music, store, userId: "u1", options: undefined, ...replace };
    const error = await failed(acceptUserToken(args.client as typeof music, args.store as tUserTokenStore, args.userId as string, "user-token", args.options as undefined));
    return { error: error as Error, calls, set };
  }

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a token in its place", "secret-token"],
    ["an object that is no client", {}],
  ])("a client that is %s is a TypeError, and nothing is stored", async (_name, client) => {
    const { error, set } = await handed({ client });
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^acceptUserToken: client must be a client from createClient; got /);
    expect(set).not.toHaveBeenCalled();
  });

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a key-value namespace, which has put where a store has set", { get: () => null, put: () => null, delete: () => null }],
  ])("a store that is %s is a TypeError, and Apple is not asked", async (_name, store) => {
    const { error, calls } = await handed({ store });
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^acceptUserToken: store must have get, set and delete; got /);
    expect(calls).toHaveLength(0);
  });

  test.each<[string, unknown]>([
    ["an empty string", ""],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { id: "u1" }],
  ])("a userId that is %s is a TypeError: a token is never validated with nowhere to put it", async (_name, userId) => {
    const { error, calls, set } = await handed({ userId });
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^acceptUserToken: userId must be a string with something in it; got /);
    expect(calls).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["a signal, where an options object holding one belongs", "signal"],
    ["a number", 42],
  ])("options that are %s are a TypeError", async (_name, options) => {
    const { error, calls } = await handed({ options });
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^acceptUserToken: expected an options object; got /);
    expect(calls).toHaveLength(0);
  });

  test("a mistake is a rejection, not a throw: the function is async all the way", () => {
    const { music } = apple();
    expect(() => void acceptUserToken(music, kept().store, "", "user-token").catch(() => undefined)).not.toThrow();
  });
});

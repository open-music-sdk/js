import { createClient, isAppleMusicError, type tUserTokenStore } from "@open-music-sdk/core";
import { describe, expect, test } from "vitest";
import { KvUserTokenStore, MemoryUserTokenStore, type tKvNamespace } from "./stores.js";

/** A namespace over a Map that answers null for a missing key, as Workers KV does. */
function fakeKv() {
  const entries = new Map<string, string>();
  const kv: tKvNamespace = {
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    put: (key, value) => Promise.resolve(void entries.set(key, value)),
    delete: (key) => Promise.resolve(entries.delete(key)),
  };
  return { kv, entries };
}

describe.each<[string, () => tUserTokenStore]>([
  ["MemoryUserTokenStore", () => new MemoryUserTokenStore()],
  ["KvUserTokenStore", () => new KvUserTokenStore(fakeKv().kv)],
])("%s keeps one token per user", (_, create) => {
  test("a user with no token has undefined", async () => {
    expect(await create().get("u1")).toBeUndefined();
  });

  test("set then get", async () => {
    const store = create();
    await store.set("u1", "token-1");
    expect(await store.get("u1")).toBe("token-1");
  });

  test("set replaces", async () => {
    const store = create();
    await store.set("u1", "old");
    await store.set("u1", "new");
    expect(await store.get("u1")).toBe("new");
  });

  test("delete forgets, and deleting nothing is not an error", async () => {
    const store = create();
    await store.set("u1", "token-1");
    await store.delete("u1");
    await store.delete("u1");
    expect(await store.get("u1")).toBeUndefined();
  });

  test.each([
    ["u1", "u2"],
    ["u1", "u10"],
    ["a", "A"],
    ["__proto__", "constructor"],
  ])("users %s and %s do not share a token", async (a, b) => {
    const store = create();
    await store.set(a, "token-a");
    expect(await store.get(b)).toBeUndefined();
    await store.set(b, "token-b");
    await store.delete(b);
    expect(await store.get(a)).toBe("token-a");
  });

  test("forUser() sends the stored token, and UserTokenInvalid when there is none", async () => {
    const store = create();
    const calls: Request[] = [];
    const fetch = (input: RequestInfo | URL) => {
      calls.push(input instanceof Request ? input : new Request(input));
      return Promise.resolve(Response.json({ data: [] }));
    };
    const music = createClient({ developerToken: "dev", fetch, retry: false, userTokenStore: store });
    await store.set("u1", "token-1");
    await music.forUser("u1").request("v1/me/library/songs");
    expect(calls[0]?.headers.get("music-user-token")).toBe("token-1");
    await expect(music.forUser("u2").request("v1/me/library/songs")).rejects.toSatisfy((e) => isAppleMusicError(e, "UserTokenInvalid"));
    expect(calls).toHaveLength(1);
  });
});

describe("MemoryUserTokenStore", () => {
  test("dispose forgets every token", async () => {
    const store = new MemoryUserTokenStore();
    await store.set("u1", "token-1");
    await store.set("u2", "token-2");
    store.dispose();
    expect(await store.get("u1")).toBeUndefined();
    expect(await store.get("u2")).toBeUndefined();
  });

  test("Symbol.asyncDispose disposes, so `await using` works", async () => {
    const store = new MemoryUserTokenStore();
    await store.set("u1", "token-1");
    await store[Symbol.asyncDispose]();
    expect(await store.get("u1")).toBeUndefined();
  });

  test("a logged or serialized store shows no tokens", async () => {
    const store = new MemoryUserTokenStore();
    await store.set("u1", "secret-token");
    expect(JSON.stringify(store)).toBe("{}");
    expect(Reflect.ownKeys(store)).toEqual([]);
  });
});

describe("KvUserTokenStore", () => {
  test("keys are the prefix followed by the user id", async () => {
    const { kv, entries } = fakeKv();
    await new KvUserTokenStore(kv).set("u1", "token-1");
    expect([...entries]).toEqual([["music-user-token:u1", "token-1"]]);
  });

  test("a custom prefix", async () => {
    const { kv, entries } = fakeKv();
    const store = new KvUserTokenStore(kv, { prefix: "mut/" });
    await store.set("u1", "token-1");
    expect([...entries.keys()]).toEqual(["mut/u1"]);
    expect(await store.get("u1")).toBe("token-1");
    await store.delete("u1");
    expect(entries.size).toBe(0);
  });

  test("an undefined prefix is the default", async () => {
    const { kv, entries } = fakeKv();
    await new KvUserTokenStore(kv, { prefix: undefined }).set("u1", "token-1");
    expect([...entries.keys()]).toEqual(["music-user-token:u1"]);
  });

  test("only keys under the prefix are touched", async () => {
    const { kv, entries } = fakeKv();
    entries.set("u1", "something else");
    const store = new KvUserTokenStore(kv);
    expect(await store.get("u1")).toBeUndefined();
    await store.set("u1", "token-1");
    await store.delete("u1");
    expect([...entries]).toEqual([["u1", "something else"]]);
  });

  test("a failing namespace rejects rather than reading as no token", async () => {
    const down = () => Promise.reject(new Error("kv down"));
    const store = new KvUserTokenStore({ get: down, put: down, delete: down });
    await expect(store.get("u1")).rejects.toThrow("kv down");
    await expect(store.set("u1", "t")).rejects.toThrow("kv down");
    await expect(store.delete("u1")).rejects.toThrow("kv down");
  });

});

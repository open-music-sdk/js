import { isAppleMusicError } from "@open-music-sdk/core";
import { describe, expect, test, vi } from "vitest";
import { KvUserTokenStore, MemoryUserTokenStore, type tKvNamespace, type tKvStoreOptions } from "./stores.js";
import { fakeClient } from "./testing.js";

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

type tStore = MemoryUserTokenStore | KvUserTokenStore;
const stores: [string, () => tStore][] = [
  ["MemoryUserTokenStore", () => new MemoryUserTokenStore()],
  ["KvUserTokenStore", () => new KvUserTokenStore(fakeKv().kv)],
];

// User ids are the consumer's: nothing about one may make it collide with another or with the store itself.
const userIds = ["u1", "u10", "U1", "", " ", "a:b", "a/b", "__proto__", "constructor", "toString", "user@example.com", "ü\u{1f3b5}"];

describe.each(stores)("%s", (_, create) => {
  describe("get", () => {
    test.each(userIds)("user %j with no token has undefined", async (userId) => {
      expect(await create().get(userId)).toBeUndefined();
    });

    test.each(userIds)("user %j gets back the token set for it", async (userId) => {
      const store = create();
      await store.set(userId, "token-1");
      expect(await store.get(userId)).toBe("token-1");
    });

    test("asking twice gives the same answer", async () => {
      const store = create();
      await store.set("u1", "token-1");
      expect([await store.get("u1"), await store.get("u1")]).toEqual(["token-1", "token-1"]);
    });
  });

  describe("set", () => {
    test("replaces the token already there", async () => {
      const store = create();
      await store.set("u1", "old");
      await store.set("u1", "new");
      expect(await store.get("u1")).toBe("new");
    });

    test.each(["a", "Ab+/9w==", "a".repeat(4096), " padded ", "two\nlines"])("keeps %j exactly as given", async (token) => {
      const store = create();
      await store.set("u1", token);
      expect(await store.get("u1")).toBe(token);
    });

    test.each([
      ["u1", "u2"],
      ["u1", "u10"],
      ["a", "A"],
      ["", " "],
      ["__proto__", "constructor"],
    ])("users %j and %j do not share a token", async (a, b) => {
      const store = create();
      await store.set(a, "token-a");
      expect(await store.get(b)).toBeUndefined();
      await store.set(b, "token-b");
      expect([await store.get(a), await store.get(b)]).toEqual(["token-a", "token-b"]);
    });
  });

  describe("delete", () => {
    test("forgets the token", async () => {
      const store = create();
      await store.set("u1", "token-1");
      await store.delete("u1");
      expect(await store.get("u1")).toBeUndefined();
    });

    test("deleting nothing, or twice, is not an error", async () => {
      const store = create();
      await store.delete("u1");
      await store.set("u1", "token-1");
      await store.delete("u1");
      await expect(store.delete("u1")).resolves.toBeUndefined();
    });

    test("leaves every other user's token", async () => {
      const store = create();
      await store.set("u1", "token-1");
      await store.set("u10", "token-10");
      await store.delete("u1");
      expect(await store.get("u10")).toBe("token-10");
    });

    test("a token can be set again afterwards", async () => {
      const store = create();
      await store.set("u1", "old");
      await store.delete("u1");
      await store.set("u1", "new");
      expect(await store.get("u1")).toBe("new");
    });
  });

  describe("dispose", () => {
    test("is there under both names", () => {
      const store = create();
      expect(typeof store.dispose).toBe("function");
      expect(typeof store[Symbol.asyncDispose]).toBe("function");
    });

    test("Symbol.asyncDispose resolves to nothing", async () => {
      await expect(create()[Symbol.asyncDispose]()).resolves.toBeUndefined();
    });

    test("disposing twice is not an error", async () => {
      const store = create();
      store.dispose();
      store.dispose();
      await store[Symbol.asyncDispose]();
      await expect(store[Symbol.asyncDispose]()).resolves.toBeUndefined();
    });

    test("`await using` takes the store", async () => {
      let used: tStore | undefined;
      {
        await using store = create();
        await store.set("u1", "token-1");
        used = store;
      }
      expect(used).toBeDefined();
    });

    test("a disposed store still answers", async () => {
      const store = create();
      store.dispose();
      await store.set("u1", "token-1");
      expect(await store.get("u1")).toBe("token-1");
    });
  });
});

describe("MemoryUserTokenStore", () => {
  const filled = async () => {
    const store = new MemoryUserTokenStore();
    await store.set("u1", "token-1");
    await store.set("u2", "token-2");
    return store;
  };

  test("dispose forgets every token", async () => {
    const store = await filled();
    store.dispose();
    expect([await store.get("u1"), await store.get("u2")]).toEqual([undefined, undefined]);
  });

  test("Symbol.asyncDispose forgets every token", async () => {
    const store = await filled();
    await store[Symbol.asyncDispose]();
    expect([await store.get("u1"), await store.get("u2")]).toEqual([undefined, undefined]);
  });

  test("leaving an `await using` block forgets every token", async () => {
    let outside: MemoryUserTokenStore;
    {
      await using store = await filled();
      outside = store;
      expect(await store.get("u1")).toBe("token-1");
    }
    expect(await outside.get("u1")).toBeUndefined();
  });

  test("two stores share nothing", async () => {
    const a = await filled();
    const b = new MemoryUserTokenStore();
    expect(await b.get("u1")).toBeUndefined();
    b.dispose();
    expect(await a.get("u1")).toBe("token-1");
  });

  test("a serialized store shows no tokens", async () => {
    const store = await filled();
    expect(JSON.stringify(store)).toBe("{}");
    expect(Reflect.ownKeys(store)).toEqual([]);
  });
});

describe("KvUserTokenStore", () => {
  test.each(userIds)("user %j is kept under the prefix followed by the id", async (userId) => {
    const { kv, entries } = fakeKv();
    await new KvUserTokenStore(kv).set(userId, "token-1");
    expect([...entries]).toEqual([[`music-user-token:${userId}`, "token-1"]]);
  });

  test.each(["mut/", "a", "", "tenant-7:music-user-token:"])("prefix %j is used for get, set, and delete", async (prefix) => {
    const { kv, entries } = fakeKv();
    const store = new KvUserTokenStore(kv, { prefix });
    await store.set("u1", "token-1");
    expect([...entries.keys()]).toEqual([`${prefix}u1`]);
    expect(await store.get("u1")).toBe("token-1");
    await store.delete("u1");
    expect(entries.size).toBe(0);
  });

  test.each([undefined, {}, { prefix: undefined }])("options %j mean the default prefix", async (options) => {
    const { kv, entries } = fakeKv();
    await new KvUserTokenStore(kv, options).set("u1", "token-1");
    expect([...entries.keys()]).toEqual(["music-user-token:u1"]);
  });

  test("only keys under the prefix are read, written, or deleted", async () => {
    const { kv, entries } = fakeKv();
    entries.set("u1", "something else");
    const store = new KvUserTokenStore(kv);
    expect(await store.get("u1")).toBeUndefined();
    await store.set("u1", "token-1");
    await store.delete("u1");
    expect([...entries]).toEqual([["u1", "something else"]]);
  });

  test("stores with different prefixes on one namespace are separate", async () => {
    const { kv } = fakeKv();
    const a = new KvUserTokenStore(kv, { prefix: "a:" });
    const b = new KvUserTokenStore(kv, { prefix: "b:" });
    await a.set("u1", "token-a");
    expect(await b.get("u1")).toBeUndefined();
    await b.delete("u1");
    expect(await a.get("u1")).toBe("token-a");
  });

  test.each([null, undefined])("a namespace answering %s for a missing key is undefined", async (miss) => {
    const kv = { ...fakeKv().kv, get: () => Promise.resolve(miss as null) };
    expect(await new KvUserTokenStore(kv).get("u1")).toBeUndefined();
  });

  test.each<[string, (store: KvUserTokenStore) => Promise<unknown>]>([
    ["get", (store) => store.get("u1")],
    ["set", (store) => store.set("u1", "token-1")],
    ["delete", (store) => store.delete("u1")],
  ])("%s rejects when the namespace does, rather than reading as no token", async (_, call) => {
    const down = () => Promise.reject(new Error("kv down"));
    await expect(call(new KvUserTokenStore({ get: down, put: down, delete: down }))).rejects.toThrow("kv down");
  });

  test.each([
    [
      "dispose",
      (store: KvUserTokenStore) => {
        store.dispose();
        return Promise.resolve();
      },
    ],
    ["Symbol.asyncDispose", (store: KvUserTokenStore) => store[Symbol.asyncDispose]()],
  ])("%s leaves the tokens in the namespace: they are not the store's to drop", async (_, dispose) => {
    const { kv, entries } = fakeKv();
    const store = new KvUserTokenStore(kv);
    await store.set("u1", "token-1");
    await dispose(store);
    expect([...entries]).toEqual([["music-user-token:u1", "token-1"]]);
  });

  test("leaving an `await using` block leaves the tokens too", async () => {
    const { kv, entries } = fakeKv();
    {
      await using store = new KvUserTokenStore(kv);
      await store.set("u1", "token-1");
    }
    expect(await new KvUserTokenStore(kv).get("u1")).toBe("token-1");
    expect(entries.size).toBe(1);
  });

  test("a serialized store shows neither the namespace nor the prefix", () => {
    const store = new KvUserTokenStore(fakeKv().kv, { prefix: "tenant-7:" });
    expect(JSON.stringify(store)).toBe("{}");
    expect(Reflect.ownKeys(store)).toEqual([]);
  });
});

describe.each(stores)("forUser() sends what %s holds, looked up for each request", (_, create) => {
  const bound = (store: tStore) => {
    const { music, calls } = fakeClient([], { userTokenStore: store });
    return { listener: music.forUser("u1"), sent: () => calls.map((c) => c.headers.get("music-user-token")) };
  };
  const invalid = (e: unknown) => isAppleMusicError(e, "UserTokenInvalid");

  test("the stored token is sent", async () => {
    const store = create();
    await store.set("u1", "token-1");
    const { listener, sent } = bound(store);
    await listener.request("v1/me/library/songs");
    expect(sent()).toEqual(["token-1"]);
  });

  test("another user's token is never sent", async () => {
    const store = create();
    await store.set("u2", "token-2");
    const { listener, sent } = bound(store);
    await expect(listener.request("v1/me/library/songs")).rejects.toSatisfy(invalid);
    expect(sent()).toEqual([]);
  });

  test("no token is UserTokenInvalid before anything is sent", async () => {
    const { listener, sent } = bound(create());
    await expect(listener.request("v1/me/library/songs")).rejects.toSatisfy(invalid);
    expect(sent()).toEqual([]);
  });

  test("a replaced token is the one sent next", async () => {
    const store = create();
    await store.set("u1", "old");
    const { listener, sent } = bound(store);
    await listener.request("v1/me/library/songs");
    await store.set("u1", "new");
    await listener.request("v1/me/library/songs");
    expect(sent()).toEqual(["old", "new"]);
  });

  test("a deleted token is UserTokenInvalid from then on", async () => {
    const store = create();
    await store.set("u1", "token-1");
    const { listener, sent } = bound(store);
    await listener.request("v1/me/library/songs");
    await store.delete("u1");
    await expect(listener.request("v1/me/library/songs")).rejects.toSatisfy(invalid);
    expect(sent()).toEqual(["token-1"]);
  });
});

describe("a store that cannot answer is not a store with no token", () => {
  test("forUser() rejects with the namespace's error, not UserTokenInvalid", async () => {
    const down = () => Promise.reject(new Error("kv down"));
    const { music, calls } = fakeClient([], { userTokenStore: new KvUserTokenStore({ get: down, put: down, delete: down }) });
    await expect(music.forUser("u1").request("v1/me/library/songs")).rejects.toThrow("kv down");
    expect(calls).toHaveLength(0);
  });
});

describe("KvUserTokenStore: what it is handed is checked when it is created, not on first use", () => {
  const make = (kv: unknown, options?: unknown) => () => new KvUserTokenStore(kv as tKvNamespace, options as tKvStoreOptions);

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a token in its place", "secret-token"],
    ["an empty object", {}],
    ["a Map, which has set where a namespace has put", new Map()],
    ["a namespace with no delete", { get: () => null, put: () => null }],
    ["a store of this package's", new MemoryUserTokenStore()],
  ])("a namespace that is %s is a TypeError", (_name, kv) => {
    expect(make(kv)).toThrow(/^KvUserTokenStore: kv must have get, put and delete; got /);
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["the prefix itself, where an options object belongs", "tenant-7:"],
    ["a number", 42],
  ])("options that are %s are a TypeError", (_name, options) => {
    expect(make(fakeKv().kv, options)).toThrow(/^KvUserTokenStore: expected an options object; got /);
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["a number", 42],
    ["an object", { value: "tenant-7:" }],
    ["an array", ["tenant-7:"]],
  ])("a prefix that is %s is a TypeError", (_name, prefix) => {
    expect(make(fakeKv().kv, { prefix })).toThrow(/^KvUserTokenStore: prefix must be a string; got /);
  });

  test("a token handed over as the namespace is described and never shown", () => {
    expect(make("secret-token")).toThrow(/got 12 characters$/);
    expect(make("secret-token")).not.toThrow(/secret/);
  });

  test("a store is made without asking the namespace for anything", () => {
    const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    new KvUserTokenStore(kv);
    expect([kv.get, kv.put, kv.delete].some((method) => method.mock.calls.length > 0)).toBe(false);
  });

  test("the options object is not looked at again: changing its prefix afterwards moves no key", async () => {
    const { kv, entries } = fakeKv();
    const options = { prefix: "a:" };
    const store = new KvUserTokenStore(kv, options);
    options.prefix = "b:";
    await store.set("u1", "token-1");
    expect([...entries.keys()]).toEqual(["a:u1"]);
  });
});

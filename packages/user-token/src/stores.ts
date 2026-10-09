/// <reference lib="esnext.disposable" />
// Stores for core's tUserTokenStore: where forUser(userId) finds a listener's Music User Token.
// Every store here is disposable, so `await using` works whichever one is behind it.
import { got, type tUserTokenStore } from "@open-music-sdk/core";
import { has, optionsOf } from "./check.js";

/** Keeps tokens in a Map: for tests, scripts, and single-process servers. Everything is gone on restart. */
export class MemoryUserTokenStore implements tUserTokenStore, AsyncDisposable {
  // Private, so a logged or serialized store shows no tokens.
  readonly #tokens = new Map<string, string>();

  get(userId: string): Promise<string | undefined> {
    return Promise.resolve(this.#tokens.get(userId));
  }

  set(userId: string, token: string): Promise<void> {
    this.#tokens.set(userId, token);
    return Promise.resolve();
  }

  delete(userId: string): Promise<void> {
    this.#tokens.delete(userId);
    return Promise.resolve();
  }

  /** Forgets every token: the Map is all this store holds. */
  dispose(): void {
    this.#tokens.clear();
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.dispose();
    return Promise.resolve();
  }
}

/** The part of a Workers KV namespace the store uses. Anything with these three methods fits. */
export interface tKvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/** Invalid values throw a TypeError when the store is created. */
export interface tKvStoreOptions {
  /** What goes before a user id to make its key. Default `music-user-token:`. */
  readonly prefix?: string | undefined;
}

const DEFAULT_PREFIX = "music-user-token:";

/** Keeps each token under `prefix + userId` in a key-value namespace, as the namespace stores it: wrap `kv` to encrypt. */
export class KvUserTokenStore implements tUserTokenStore, AsyncDisposable {
  readonly #kv: tKvNamespace;
  readonly #prefix: string;

  /** The namespace and the prefix are checked and taken here, once; the options object is not looked at again. */
  constructor(kv: tKvNamespace, options: tKvStoreOptions = {}) {
    if (!has(kv, ["get", "put", "delete"])) throw new TypeError(`KvUserTokenStore: kv must have get, put and delete; got ${got(kv)}`);
    const { prefix = DEFAULT_PREFIX } = optionsOf("KvUserTokenStore", options, "an options object");
    if (typeof prefix !== "string") throw new TypeError(`KvUserTokenStore: prefix must be a string; got ${got(prefix)}`);
    this.#kv = kv;
    this.#prefix = prefix;
  }

  async get(userId: string): Promise<string | undefined> {
    return (await this.#kv.get(this.#prefix + userId)) ?? undefined;
  }

  async set(userId: string, token: string): Promise<void> {
    await this.#kv.put(this.#prefix + userId, token);
  }

  async delete(userId: string): Promise<void> {
    await this.#kv.delete(this.#prefix + userId);
  }

  dispose(): void {
    // Nothing to release: the namespace belongs to the platform, and the tokens in it outlive this store.
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve();
  }
}

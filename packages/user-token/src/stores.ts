/// <reference lib="esnext.disposable" />
// Stores for core's tUserTokenStore: where forUser(userId) finds a listener's Music User Token.
// Every store here is disposable, so `await using` works whichever one is behind it.
import { got, has, optionsOf, type tUserTokenStore } from "@open-music-sdk/core";

/** Keeps tokens in a Map: for tests, scripts, and single-process servers. Everything is gone on restart. */
export class MemoryUserTokenStore implements tUserTokenStore, AsyncDisposable {
  // Private, so a logged or serialized store shows no tokens.
  readonly #tokens = new Map<string, string>();

  /**
   * The token kept for a user.
   *
   * @param userId - The id the token was set under.
   * @returns The token, or undefined when none is kept.
   */
  get(userId: string): Promise<string | undefined> {
    return Promise.resolve(this.#tokens.get(userId));
  }

  /**
   * Keeps a token for a user, in place of any kept before.
   *
   * @param userId - The id to keep it under: the app's own, as `forUser()` is given it.
   * @param token - The Music User Token.
   */
  set(userId: string, token: string): Promise<void> {
    this.#tokens.set(userId, token);
    return Promise.resolve();
  }

  /**
   * Forgets a user's token, if one is kept.
   *
   * @param userId - The id it was set under.
   */
  delete(userId: string): Promise<void> {
    this.#tokens.delete(userId);
    return Promise.resolve();
  }

  /** Forgets every token: the Map is all this store holds. */
  dispose(): void {
    this.#tokens.clear();
  }

  /** `dispose()`, for `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    this.dispose();
    return Promise.resolve();
  }
}

/** The part of a Workers KV namespace the store uses. Anything with these three methods fits. */
export interface tKvNamespace {
  /**
   * The value under a key.
   *
   * @param key - The key, as the store made it: the prefix and the user id.
   * @returns The value, or null when there is none, as Workers KV answers.
   */
  get(key: string): Promise<string | null>;
  /**
   * Writes a value under a key, in place of what is there.
   *
   * @param key - The key, as the store made it.
   * @param value - The token.
   * @returns Whatever the namespace answers; the store reads nothing from it.
   */
  put(key: string, value: string): Promise<unknown>;
  /**
   * Removes a key and its value, if there is one.
   *
   * @param key - The key, as the store made it.
   * @returns Whatever the namespace answers; the store reads nothing from it.
   */
  delete(key: string): Promise<unknown>;
}

/** Invalid values throw a TypeError when the store is created. */
export interface tKvStoreOptions {
  /** What goes before a user id to make its key. Default `music-user-token:`. */
  readonly prefix?: string | undefined;
}

const DEFAULT_PREFIX = "music-user-token:";

/**
 * Keeps each token under `prefix + userId` in a key-value namespace, as the namespace stores it. Neither store here
 * encrypts, so whoever can read the namespace reads the tokens: wrap `kv` to encrypt. Workers KV can take up to a
 * minute for a token just stored or deleted to look that way elsewhere, and Apple's 403 stays the authority.
 */
export class KvUserTokenStore implements tUserTokenStore, AsyncDisposable {
  readonly #kv: tKvNamespace;
  readonly #prefix: string;

  /**
   * The namespace and the prefix are checked and taken here, once; the options object is not looked at again.
   *
   * @param kv - The namespace, or anything with its `get`, `put` and `delete`.
   * @param options - The prefix each key starts with.
   * @throws TypeError if `kv` lacks `get`, `put` or `delete`, `options` is not a plain object, or `prefix` is not a string.
   */
  constructor(kv: tKvNamespace, options: tKvStoreOptions = {}) {
    if (!has(kv, ["get", "put", "delete"])) throw new TypeError(`KvUserTokenStore: kv must have get, put and delete; got ${got(kv)}`);
    const { prefix = DEFAULT_PREFIX } = optionsOf("KvUserTokenStore", options, "an options object");
    if (typeof prefix !== "string") throw new TypeError(`KvUserTokenStore: prefix must be a string; got ${got(prefix)}`);
    this.#kv = kv;
    this.#prefix = prefix;
  }

  /**
   * The token kept for a user, read from the namespace under `prefix + userId`.
   *
   * @param userId - The id the token was set under.
   * @returns The token, or undefined when the namespace has nothing there.
   * @throws Whatever `kv.get` rejects with.
   */
  async get(userId: string): Promise<string | undefined> {
    return (await this.#kv.get(this.#prefix + userId)) ?? undefined;
  }

  /**
   * Keeps a token for a user, written to the namespace under `prefix + userId` in place of what is there.
   *
   * @param userId - The id to keep it under: the app's own, as `forUser()` is given it.
   * @param token - The Music User Token, stored as the namespace stores a string.
   * @throws Whatever `kv.put` rejects with.
   */
  async set(userId: string, token: string): Promise<void> {
    await this.#kv.put(this.#prefix + userId, token);
  }

  /**
   * Forgets a user's token: removes `prefix + userId` from the namespace.
   *
   * @param userId - The id it was set under.
   * @throws Whatever `kv.delete` rejects with.
   */
  async delete(userId: string): Promise<void> {
    await this.#kv.delete(this.#prefix + userId);
  }

  /** Does nothing: the namespace belongs to the platform, and the tokens in it outlive this store. */
  dispose(): void {
    // Nothing to release: the namespace belongs to the platform, and the tokens in it outlive this store.
  }

  /** `dispose()`, for `await using`: nothing to release. */
  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve();
  }
}

// createClient: one fetch wrapper that attaches the tokens, encodes params, follows `next` links,
// maps status codes to tagged errors, and retries what is worth retrying.
import type { tError, tStorefrontsResponse } from "@open-music-sdk/types";
import { AppleMusicError, type tValidationIssue } from "./errors.js";
import type { tRateLimiter } from "./rate-limit.js";
import { parseRetryAfter, retry, type tRetryPolicy } from "./retry.js";

const BASE_URL = "https://api.music.apple.com/";

export interface tTokenContext {
  readonly signal?: AbortSignal | undefined;
  /** The token Apple just rejected with a 401. A caching provider should mint or fetch a fresh one. */
  readonly rejected?: string | undefined;
}
export type tTokenProvider = (ctx: tTokenContext) => string | Promise<string>;

/** Where forUser(userId) finds a listener's Music User Token. */
export interface tUserTokenStore {
  get(userId: string): Promise<string | undefined>;
  set(userId: string, token: string): Promise<void>;
  delete(userId: string): Promise<void>;
}

/** Query parameters. Arrays join with commas (`include=albums,artists`); undefined values are dropped. */
export type tParams = Readonly<Record<string, string | number | boolean | readonly (string | number)[] | undefined>>;

/** Anything with a Standard Schema `validate`, such as the validators in @open-music-sdk/validate. */
export interface tSchemaLike<T> {
  readonly "~standard": {
    readonly validate: (value: unknown) => tSchemaResult<T> | Promise<tSchemaResult<T>>;
  };
}
export type tSchemaResult<T> = { readonly value: T; readonly issues?: undefined } | { readonly issues: readonly tValidationIssue[] };

export interface tClientOptions {
  developerToken: string | tTokenProvider;
  /** Binds the client to one listener. Alternatively set userTokenStore and use forUser(). */
  userToken?: string | tTokenProvider | undefined;
  userTokenStore?: tUserTokenStore | undefined;
  /** Catalog storefront. Without it, storefront() resolves the listener's from /v1/me/storefront. */
  storefront?: string | undefined;
  fetch?: typeof fetch | undefined;
  /** `false` disables retries. Default: 2 attempts, 250 ms base, 4 s cap, full jitter, Retry-After honoured. */
  retry?: tRetryPolicy | false | undefined;
  /** Opt-in token bucket. Share one instance across every client using the same developer token. */
  rateLimit?: tRateLimiter | undefined;
  onRequest?: ((req: Request) => void) | undefined;
  onResponse?: ((res: Response, req: Request) => void) | undefined;
}

export interface tRequestInit<T = unknown> {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
  readonly params?: tParams | undefined;
  /** JSON-encoded. */
  readonly body?: unknown;
  /** Send the Music User Token. Default: true under /v1/me. */
  readonly user?: boolean | undefined;
  /** Validates the parsed body; a failure throws ValidationError. */
  readonly schema?: tSchemaLike<T> | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** One page of a collection or relationship response. */
export interface tPage<T> {
  readonly data?: readonly T[] | undefined;
  readonly next?: string | undefined;
}

export interface tAppleMusicClient {
  /** `path` is "v1/...", "/v1/...", or a `next` subpath from a response. Resolves to the parsed body, or undefined when there is none. */
  request<T>(path: string, init?: tRequestInit<T>): Promise<T>;
  /** The items of `data` across every `next` page. Breaking out of the loop stops fetching. */
  paginate<T>(path: string, init?: tRequestInit<tPage<T>>): AsyncIterable<T>;
  /** The configured storefront, or the listener's, resolved once. */
  storefront(): Promise<string>;
  /** A client for one listener. Shares the developer token, limiter, retry policy, and hooks. */
  as(userToken: string | tTokenProvider): tAppleMusicClient;
  /** as(), with the token looked up in userTokenStore. */
  forUser(userId: string): tAppleMusicClient;
}

const toProvider = (token: string | tTokenProvider): tTokenProvider => (typeof token === "string" ? () => token : token);
const isUserPath = (pathname: string) => /^\/v1\/me(\/|$)/.test(pathname);
const formatIssues = (issues: readonly tValidationIssue[]) =>
  issues.map((i) => `${(i.path ?? []).map((s) => String(typeof s === "object" ? s.key : s)).join(".") || "<root>"}: ${i.message}`).join("; ");

export function createClient(options: tClientOptions): tAppleMusicClient {
  const developerToken = toProvider(options.developerToken);
  const userToken = options.userToken === undefined ? undefined : toProvider(options.userToken);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const policy = options.retry === false ? { maxAttempts: 1 } : options.retry;
  let storefrontPromise: Promise<string> | undefined;

  async function request<T>(path: string, init: tRequestInit<T> = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), BASE_URL);
    for (const [k, v] of Object.entries(init.params ?? {}))
      if (v !== undefined) url.searchParams.set(k, typeof v === "object" ? v.join(",") : String(v));
    const user = init.user ?? isUserPath(url.pathname);
    if (user && !userToken)
      throw new AppleMusicError("UserTokenInvalid", `${url.pathname} needs a Music User Token; pass userToken, or use as() or forUser()`);
    const body = init.body === undefined ? null : JSON.stringify(init.body);
    const { signal } = init;

    const send = async (token: string): Promise<Response> => {
      await options.rateLimit?.acquire(signal);
      const headers = new Headers({ authorization: `Bearer ${token}` });
      if (user && userToken) headers.set("music-user-token", await userToken({ signal }));
      if (body !== null) headers.set("content-type", "application/json");
      const req = new Request(url, { method: init.method ?? "GET", headers, body, signal: signal ?? null });
      options.onRequest?.(req);
      let res: Response;
      try {
        res = await fetchImpl(req);
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new AppleMusicError("NetworkError", `${req.method} ${url.pathname}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
      options.onResponse?.(res, req);
      return res;
    };

    return retry(
      async () => {
        const token = await developerToken({ signal });
        let res = await send(token);
        if (res.status === 401) {
          // One chance for a caching provider to replace a stale token; a plain string gets no retry.
          const fresh = await developerToken({ signal, rejected: token });
          if (fresh !== token) res = await send(fresh);
        }
        return settle(res, init, user, url);
      },
      policy,
      signal,
    );
  }

  async function settle<T>(res: Response, init: tRequestInit<T>, user: boolean, url: URL): Promise<T> {
    const text = await res.text();
    if (res.ok) {
      if (!text) return undefined as T;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (e) {
        throw new AppleMusicError("ApiError", `${String(res.status)} ${url.pathname}: body is not JSON`, { status: res.status, cause: e });
      }
      if (!init.schema) return value as T;
      const result = await init.schema["~standard"].validate(value);
      if (result.issues) throw new AppleMusicError("ValidationError", `${url.pathname}: ${formatIssues(result.issues)}`, { status: res.status, issues: result.issues });
      return result.value;
    }

    let errors: readonly tError[] | undefined;
    try {
      errors = (JSON.parse(text) as { errors?: tError[] }).errors;
    } catch {
      // not JSON; the status is all we have
    }
    const first = errors?.[0];
    const message = `${String(res.status)} ${url.pathname}${first ? `: ${first.title}${first.detail ? ` (${first.detail})` : ""}` : ""}`;
    const details = { status: res.status, errors, retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) };
    switch (res.status) {
      case 401:
        throw new AppleMusicError(
          "DeveloperTokenRejected",
          user ? `${message}. Under /v1/me a 401 can also mean the listener is not signed in or not subscribed` : message,
          details,
        );
      case 403:
        throw new AppleMusicError("UserTokenInvalid", message, details);
      case 429:
        throw new AppleMusicError("RateLimited", message, details);
      default:
        throw new AppleMusicError("ApiError", message, details);
    }
  }

  async function* paginate<T>(path: string, init: tRequestInit<tPage<T>> = {}): AsyncIterable<T> {
    let next: string | undefined = path;
    let params = init.params;
    while (next !== undefined) {
      const page: tPage<T> = await request(next, { ...init, params });
      yield* page.data ?? [];
      next = page.next;
      params = undefined; // a next link already carries the query
    }
  }

  async function storefront(): Promise<string> {
    if (options.storefront !== undefined) return options.storefront;
    if (!userToken) throw new AppleMusicError("UserTokenInvalid", "No storefront configured and no Music User Token to resolve one from; pass storefront");
    storefrontPromise ??= request<tStorefrontsResponse>("v1/me/storefront")
      .then((r) => {
        const id = r.data[0]?.id;
        if (id === undefined) throw new AppleMusicError("ApiError", "/v1/me/storefront returned no storefront", { status: 200 });
        return id;
      })
      .catch((e: unknown) => {
        storefrontPromise = undefined;
        throw e;
      });
    return storefrontPromise;
  }

  const as = (token: string | tTokenProvider): tAppleMusicClient => createClient({ ...options, userToken: token });

  const forUser = (userId: string): tAppleMusicClient => {
    const store = options.userTokenStore;
    if (!store) throw new TypeError("forUser() needs userTokenStore");
    return as(async () => {
      const token = await store.get(userId);
      if (token === undefined) throw new AppleMusicError("UserTokenInvalid", `No Music User Token stored for user ${userId}`);
      return token;
    });
  };

  return { request, paginate, storefront, as, forUser };
}

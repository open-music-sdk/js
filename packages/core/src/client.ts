// createClient: one fetch wrapper that attaches the tokens, encodes params, follows `next` links,
// maps status codes to tagged errors, and retries what is worth retrying.
import type { tError, tStorefrontsResponse } from "@open-music-sdk/types";
import { ownOf } from "./check";
import { AppleMusicError, type tValidationIssue } from "./errors";
import { got } from "./got";
import type { tRateLimiter } from "./rate-limit";
import { parseRetryAfter, resolveRetryPolicy, retry, type tRetryPolicy } from "./retry";

const BASE_URL = "https://api.music.apple.com/";
const BASE_ORIGIN = new URL(BASE_URL).origin;

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

/** Query parameters. Arrays join with commas (`include=albums,artists`); null and undefined values are dropped. */
export type tParams = Readonly<Record<string, string | number | boolean | readonly (string | number)[] | null | undefined>>;

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
  /** Called just before each attempt is sent, with the final Request. */
  onRequest?: ((req: Request) => void) | undefined;
  /**
   * Called once per response, after the client is done with it: the body has been read and the
   * outcome decided. `outcome.error` is what the request will throw unless a retry succeeds.
   */
  onResponse?: ((res: Response, req: Request, outcome: tResponseOutcome) => void) | undefined;
}

export interface tResponseOutcome {
  /** The parsed JSON body; undefined when there was none or it was not JSON. */
  readonly body: unknown;
  /** The error this response produced, if any. The request may still be retried after it. */
  readonly error: AppleMusicError | undefined;
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
  /**
   * Called as the client's own `onResponse` is, and after it, for this request alone: once per response, when the
   * body has been read and the outcome decided. It is how a caller learns what `request` does not resolve to, such
   * as the status of the answer or one of its headers.
   */
  readonly onResponse?: ((res: Response, req: Request, outcome: tResponseOutcome) => void) | undefined;
}

/** One page of a collection or relationship response. */
export interface tPage<T> {
  readonly data?: readonly T[] | undefined;
  readonly next?: string | undefined;
}

/** What `paginate` takes: what `request` takes, for each page it asks for, and how many pages that may be. */
export interface tPaginateInit<T> extends tRequestInit<tPage<T>> {
  /**
   * The most pages to ask Apple for: a whole number above zero. Default: no limit, so a walk goes on asking for as
   * long as each page names a next one. At the limit the walk ends, whether or not there are more. A page handed
   * over is not counted, since it was not asked for.
   */
  readonly maxPages?: number | undefined;
}

export interface tAppleMusicClient {
  /** `path` is "v1/...", "/v1/...", or a `next` subpath from a response. Resolves to the parsed body, or undefined when there is none. */
  request<T>(path: string, init?: tRequestInit<T>): Promise<T>;
  /**
   * The items of `data` across every `next` page. Breaking out of the loop stops fetching.
   *
   * `from` is a path, or a page already fetched: the page's own items come first and nothing is asked for until
   * they run out. With a page, `init.params` is not sent, since its `next` link already carries the query. A page
   * is an object with a `data` list, a `next` link or both, and anything else handed over is a TypeError. A
   * promise of a page is not a page: await it, so that what it rejects with reaches the code that asked.
   *
   * What a `next` link answers with has to be a page itself, with `data` at the top, as a collection's and a
   * relationship's are. A search or a chart answers with its pages nested under `results`, and is not walked.
   *
   * A walk has no end but the last page unless `init.maxPages` gives it one. A `next` link is followed wherever on
   * Apple's origin it points, so a page or a path from outside your app is as trusted as you make it.
   */
  paginate<T>(from: string | tPage<T>, init?: tPaginateInit<T>): AsyncIterable<T>;
  /** The configured storefront, or the listener's, resolved once. */
  storefront(): Promise<string>;
  /** A client for one listener. Shares the developer token, limiter, retry policy, and hooks. */
  as(userToken: string | tTokenProvider): tAppleMusicClient;
  /** as(), with the token looked up in userTokenStore. */
  forUser(userId: string): tAppleMusicClient;
}

type tSettled<T> = tResponseOutcome & ({ readonly value: T; readonly error: undefined } | { readonly error: AppleMusicError; readonly value?: undefined });

/**
 * What an object holds under `data` and `next` itself. A page is read as its own properties and nothing it
 * inherits, so a `next` that other code has put on Object.prototype is not a link every page has: it would
 * otherwise send a walk somewhere no answer named, and keep it going without end.
 */
const held = (page: object): { readonly data?: unknown; readonly next?: unknown } => ownOf(page);

/**
 * A page is an object whose `data`, if any, is an array and whose `next`, if any, is a string. An empty body is a
 * last, empty page. `status` is that of the answer the page came in, for the error that says it was no page.
 */
export function pageOf(page: unknown, path: string, status: number | undefined): { readonly data: readonly unknown[]; readonly next: string | undefined } {
  if (page === undefined) return { data: [], next: undefined };
  const shape = (what: string) => new AppleMusicError("ApiError", `${path}: ${what}`, { status });
  if (typeof page !== "object" || page === null || Array.isArray(page)) throw shape("expected a page object");
  const { data, next } = held(page);
  if (data != null && !Array.isArray(data)) throw shape("data is not an array");
  if (next != null && typeof next !== "string") throw shape("next is not a string");
  return { data: (data as readonly unknown[] | null | undefined) ?? [], next: next ?? undefined };
}

/** The next link of a body as Apple sent it: its `next`, when that is a string, and nothing otherwise. */
function linkOf(body: unknown): string | undefined {
  const next: unknown = typeof body === "object" && body !== null ? held(body).next : undefined;
  return typeof next === "string" ? next : undefined;
}

/**
 * Whether a value handed over as a page is one: an object that holds a `data` list or a `next` link, and nothing
 * else under either name. What only looks like an object to walk, such as a URL, a Response or a whole search
 * answer, holds neither, and would otherwise be a walk over nothing that says nothing.
 */
function isPage(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { data, next } = held(value);
  return (data == null || Array.isArray(data)) && (next == null || typeof next === "string") && (data != null || next != null);
}

/**
 * Whether an error says the request was not carried out: Apple turned it away for coming too fast, or there was no
 * developer token to send it with. A POST makes something each time it is carried out, a playlist or a track added
 * to one, and a failure of any other kind leaves open whether it was: the connection may have dropped after Apple
 * acted. So a POST is sent again only after one of these, and never on the chance that the first did nothing.
 */
const unsent = (error: AppleMusicError): boolean => error._tag === "RateLimited" || error._tag === "DeveloperTokenUnavailable";

const toProvider = (token: string | tTokenProvider): tTokenProvider => (typeof token === "string" ? () => token : token);
const isUserPath = (pathname: string) => /^\/v1\/me(\/|$)/.test(pathname);

/**
 * `value` as a token fit to be a header value, or undefined when it is not one: printable ASCII with no spaces or
 * line breaks inside. Whitespace around it, as a token read from a file has, is dropped. This is the one rule for
 * what a token is, for a developer token and a Music User Token alike.
 */
export function parseToken(value: unknown): string | undefined {
  const token = typeof value === "string" ? value.trim() : "";
  return /^[\x21-\x7e]+$/.test(token) ? token : undefined;
}

/**
 * A token, or a TypeError. A runtime's own complaint about a value it cannot send quotes the value, so a token
 * with a line break or a space inside it is refused here and described, never repeated.
 */
function credential(name: string, token: unknown): string {
  const value = parseToken(token);
  if (value !== undefined) return value;
  throw new TypeError(`${name} is not a token: expected printable characters with no spaces or line breaks inside, got ${got(token)}`);
}
const formatIssues = (issues: readonly tValidationIssue[]) =>
  issues.map((i) => `${(i.path ?? []).map((s) => String(typeof s === "object" ? s.key : s)).join(".") || "<root>"}: ${i.message}`).join("; ");

export function createClient(given: tClientOptions): tAppleMusicClient {
  // What the options hold themselves, and nothing they inherit: a `fetch` or a `userToken` that some other code has
  // put on Object.prototype is not one this client was given. The same goes for what `request` and `paginate` take.
  const options = ownOf(given);
  const developerToken = toProvider(options.developerToken);
  const userToken = options.userToken === undefined ? undefined : toProvider(options.userToken);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const policy = resolveRetryPolicy(options.retry === false ? { maxAttempts: 1 } : options.retry);
  let storefrontPromise: Promise<string> | undefined;

  async function request<T>(path: string, given: tRequestInit<T> = {}): Promise<T> {
    const init = ownOf(given);
    const url = new URL(path, BASE_URL);
    // Both tokens ride on every request, so nothing may send one anywhere else: not an absolute URL,
    // not a scheme-relative one (the URL parser also reads `\\host` as one), not a downgrade to http.
    if (url.origin !== BASE_ORIGIN) throw new TypeError(`Refusing to send Apple Music credentials to ${url.origin}: path ${JSON.stringify(path)} leaves ${BASE_ORIGIN}`);
    for (const [k, v] of Object.entries(init.params ?? {}))
      if (v != null) url.searchParams.set(k, typeof v === "object" ? v.join(",") : String(v));
    const user = init.user ?? isUserPath(url.pathname);
    if (user && !userToken)
      throw new AppleMusicError("UserTokenInvalid", `${url.pathname} needs a Music User Token; pass userToken, or use as() or forUser()`);
    const body = init.body === undefined ? null : JSON.stringify(init.body);
    const { signal } = init;

    // One attempt: send, read, classify, then tell the hook. Every response is settled, even one about
    // to be replaced: settling reads the body, and an unread body keeps its connection out of the pool.
    const exchange = async (token: string): Promise<tSettled<T>> => {
      const headers = new Headers({ authorization: `Bearer ${credential("developerToken", token)}` });
      await options.rateLimit?.acquire(signal);
      if (user && userToken) headers.set("music-user-token", credential("userToken", await userToken({ signal })));
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
      const outcome = await settle(res, init, user, url);
      options.onResponse?.(res, req, { body: outcome.body, error: outcome.error });
      init.onResponse?.(res, req, { body: outcome.body, error: outcome.error });
      return outcome;
    };

    return retry(
      async () => {
        const token = await developerToken({ signal });
        let outcome = await exchange(token);
        if (outcome.error?._tag === "DeveloperTokenInvalid") {
          // One chance for a caching provider to replace a stale token; a plain string gets no retry.
          const fresh = await developerToken({ signal, rejected: token });
          if (fresh !== token) outcome = await exchange(fresh);
        }
        if (outcome.error) throw outcome.error;
        return outcome.value;
      },
      init.method === "POST" ? { ...policy, retryOn: (error) => unsent(error) && policy.retryOn(error) } : policy,
      signal,
    );
  }

  async function settle<T>(res: Response, init: tRequestInit<T>, user: boolean, url: URL): Promise<tSettled<T>> {
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      // The connection can drop after the headers arrive; that is a network failure like any other.
      if (init.signal?.aborted) throw e;
      const message = `${init.method ?? "GET"} ${url.pathname}: ${e instanceof Error ? e.message : String(e)}`;
      return { body: undefined, error: new AppleMusicError("NetworkError", message, { cause: e }) };
    }
    let body: unknown;
    let notJson: unknown;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (e) {
        notJson = e; // on an error status that is fine: the status is all we have
      }
    }

    if (res.ok) {
      if (!text) return { body, value: undefined as T, error: undefined };
      if (notJson !== undefined)
        return { body, error: new AppleMusicError("ApiError", `${String(res.status)} ${url.pathname}: body is not JSON`, { status: res.status, cause: notJson }) };
      if (!init.schema) return { body, value: body as T, error: undefined };
      const result = await init.schema["~standard"].validate(body);
      if (result.issues) {
        const message = `${url.pathname}: ${formatIssues(result.issues)}`;
        return { body, error: new AppleMusicError("ValidationError", message, { status: res.status, issues: result.issues }) };
      }
      return { body, value: result.value, error: undefined };
    }

    const reported = (body as { errors?: unknown } | null | undefined)?.errors;
    const errors = Array.isArray(reported) ? (reported as readonly tError[]) : undefined;
    const first = errors?.[0];
    const message = `${String(res.status)} ${url.pathname}${first ? `: ${first.title}${first.detail ? ` (${first.detail})` : ""}` : ""}`;
    const details = { status: res.status, errors, retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) };
    const tag =
      res.status === 401 ? "DeveloperTokenInvalid"
      : res.status === 403 ? "UserTokenInvalid"
      : res.status === 429 ? "RateLimited"
      : "ApiError";
    const hint = tag === "DeveloperTokenInvalid" && user ? ". Under /v1/me a 401 can also mean the listener is not signed in or not subscribed" : "";
    return { body, error: new AppleMusicError(tag, message + hint, details) };
  }

  async function* paginate<T>(from: string | tPage<T>, init: tPaginateInit<T> = {}): AsyncIterable<T> {
    // The limit is the walk's own: what is left is what each page is asked for with.
    const { maxPages, ...each } = ownOf(init);
    if (maxPages !== undefined && !(Number.isSafeInteger(maxPages) && maxPages > 0)) throw new TypeError(`paginate: maxPages must be a whole number above 0; got ${got(maxPages)}`);
    let next: string | undefined;
    let params = each.params;
    if (typeof from === "string") next = from;
    else {
      // A promise handed over would have nothing listening to it until a loop started, so one that rejects first
      // would be nobody's to catch. It is the caller's to await.
      if (typeof (from as { then?: unknown } | null | undefined)?.then === "function") throw new TypeError("paginate: expected a path or a page; got a promise of one, which has to be awaited first");
      // Nothing at all is what an empty answer comes to, and is a last, empty page. Anything else has to be a page,
      // and one that is not is the caller's mistake: nothing was asked for, so it is no answer of Apple's.
      const given: unknown = from;
      if (given !== undefined && !isPage(given)) throw new TypeError(`paginate: expected a path or a page, which is an object with a data list, a next link or both; got ${got(given)}`);
      const first = (given === undefined ? {} : held(from)) as { readonly data?: readonly T[] | null; readonly next?: string | null };
      // The walk's own copy, so that it goes over the page as it was handed, whatever is done to the page meanwhile.
      yield* (first.data ?? []).slice();
      next = first.next ?? undefined;
      params = undefined;
    }
    for (let asked = 0; next !== undefined && asked < (maxPages ?? Infinity); asked++) {
      // What Apple sent is kept beside what a schema made of it. The items are the schema's to shape, and where the
      // next page is, is Apple's to say: a schema that hands back only the fields it knows would otherwise end the
      // walk at its first page, without a word.
      let sent: unknown;
      const answered = await request<unknown>(next, {
        ...each,
        params,
        onResponse: (res, req, outcome) => {
          sent = outcome.body;
          each.onResponse?.(res, req, outcome);
        },
      });
      const page = pageOf(answered, next, 200);
      yield* page.data as readonly T[];
      next = linkOf(sent);
      params = undefined; // a next link already carries the query
    }
  }

  async function storefront(): Promise<string> {
    if (options.storefront !== undefined) return options.storefront;
    if (!userToken) throw new AppleMusicError("UserTokenInvalid", "No storefront configured and no Music User Token to resolve one from; pass storefront");
    storefrontPromise ??= request<unknown>("v1/me/storefront")
      .then((r) => {
        const id = (r as Partial<tStorefrontsResponse> | null | undefined)?.data?.[0]?.id;
        if (typeof id !== "string") throw new AppleMusicError("ApiError", "/v1/me/storefront returned no storefront", { status: 200 });
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

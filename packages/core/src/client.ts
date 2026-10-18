// createClient: one fetch wrapper that attaches the tokens, encodes params, follows `next` links,
// maps status codes to tagged errors, and retries what is worth retrying.
import type { tError, tStorefrontsResponse } from "@open-music-sdk/types";
import { gotFor, has, isPlain, ownOf, segmentOf } from "./check";
import { AppleMusicError, type tValidationIssue } from "./errors";
import { got } from "./got";
import type { tRateLimiter } from "./rate-limit";
import { parseRetryAfter, resolveRetryPolicy, retry, type tRetryPolicy } from "./retry";

// Both written out, and the origin not worked out from the URL: a call at the top of a module is one a bundler
// keeps whether or not the client is used, so an app that took one check from this package would carry this too.
const BASE_ORIGIN = "https://api.music.apple.com";
const BASE_URL = "https://api.music.apple.com/";

/** What a token provider is told when it is asked for a token. */
export interface tTokenContext {
  /** The signal of the request the token is for, when it has one: a provider that fetches its token can pass it on. */
  readonly signal?: AbortSignal | undefined;
  /** The token Apple just rejected with a 401. A caching provider should mint or fetch a fresh one. */
  readonly rejected?: string | undefined;
}

/**
 * Gives a token when a request needs one: a developer token, or a listener's Music User Token. It is called at each
 * attempt, and a developer token provider once more, with `rejected`, when Apple answered 401 to what it gave; a
 * different token is then tried before the error stands. What it gives is held to being a token, printable ASCII
 * with no spaces or line breaks inside, and anything else is a `TypeError` from the request. What it throws ends
 * the request, which rejects with it as it is; an `AppleMusicError` it throws is tried again when the retry policy
 * says so, as a `DeveloperTokenUnavailable` from the developer-token package is.
 */
export type tTokenProvider = (ctx: tTokenContext) => string | Promise<string>;

/**
 * Where forUser(userId) finds a listener's Music User Token. The client reads it, through `get`, each time a request
 * of that listener's needs the token; `set` and `delete` are for whoever signs listeners in and out, such as an
 * integration, and the client needs them to be there without calling them.
 */
export interface tUserTokenStore {
  /**
   * The listener's token, or `undefined` when none is stored: the request then rejects with a `UserTokenInvalid`.
   * What it rejects with, the request that asked rejects with, as it is.
   *
   * @param userId - Whose token, under the name the app knows the listener by.
   * @returns The token, or `undefined` for a listener with none.
   */
  get(userId: string): Promise<string | undefined>;
  /**
   * Keeps a listener's token, in place of any stored before.
   *
   * @param userId - Whose token, under the name the app knows the listener by.
   * @param token - The Music User Token to keep.
   */
  set(userId: string, token: string): Promise<void>;
  /**
   * Forgets a listener's token, if one is stored.
   *
   * @param userId - Whose token, under the name the app knows the listener by.
   */
  delete(userId: string): Promise<void>;
}

/** Query parameters. Arrays join with commas (`include=albums,artists`); null and undefined values are dropped. */
export type tParams = Readonly<Record<string, string | number | boolean | readonly (string | number)[] | null | undefined>>;

/** Anything with a Standard Schema `validate`, such as the validators in @open-music-sdk/validate. */
export interface tSchemaLike<T> {
  /** The Standard Schema interface: the one part of a schema the client reads. */
  readonly "~standard": {
    /** Judges a value: gives it back, typed, or the issues found. The client awaits it, so it may be async. */
    readonly validate: (value: unknown) => tSchemaResult<T> | Promise<tSchemaResult<T>>;
  };
}

/** What a Standard Schema's `validate` gives: the value as the schema typed it, or the issues it found. */
export type tSchemaResult<T> =
  | {
      /** The value, accepted. */
      readonly value: T;
      /** Nothing: the value was accepted. */
      readonly issues?: undefined;
    }
  | {
      /** What was wrong, one issue at least. */
      readonly issues: readonly tValidationIssue[];
    };

/**
 * What `createClient` takes. Only `developerToken` is needed. Each option is checked at creation, so a mistake is a
 * TypeError there and not on the first request; what a provider gives, and what a store holds, are checked when used.
 *
 * Only `undefined` leaves an option out: `null` is a mistake like any other value. An option is one the object holds
 * itself. One it inherits, or that other code has put on `Object.prototype`, is not one.
 */
export interface tClientOptions {
  /**
   * The developer token, or a function that gives one when a request needs it, such as a minter or a fetcher from
   * @open-music-sdk/developer-token. A string is checked here to be a token; a function's answer where it is sent.
   */
  developerToken: string | tTokenProvider;
  /** Binds the client to one listener. Alternatively set userTokenStore and use forUser(). */
  userToken?: string | tTokenProvider | undefined;
  /** Where `forUser()` finds a listener's token. Needs `get`, `set` and `delete`; the client itself calls only `get`. */
  userTokenStore?: tUserTokenStore | undefined;
  /** Catalog storefront, by its id, such as `"us"`: one segment of a path. Without it, storefront() resolves the listener's from /v1/me/storefront. */
  storefront?: string | undefined;
  /** What sends each request. Default: the global `fetch`. */
  fetch?: typeof fetch | undefined;
  /** `false` disables retries; a plain object sets the policy field by field. Default: 2 attempts, 250 ms base, 4 s cap, full jitter, Retry-After honoured. */
  retry?: tRetryPolicy | false | undefined;
  /** Opt-in token bucket. Share one instance across every client using the same developer token. */
  rateLimit?: tRateLimiter | undefined;
  /**
   * Called just before each attempt is sent, with the final Request. Its headers hold the developer token and,
   * where it is sent, the Music User Token, so a hook that logs requests logs both tokens.
   */
  onRequest?: ((req: Request) => void) | undefined;
  /**
   * Called once per response, after the client is done with it: the body has been read and the
   * outcome decided. `outcome.error` is what the request will throw unless a retry succeeds. The body has been
   * read, so take it from `outcome.body`, not from `res.json()`. `req` is the Request `onRequest` is handed, token
   * headers and all, so a hook that logs it logs the tokens.
   */
  onResponse?: ((res: Response, req: Request, outcome: tResponseOutcome) => void) | undefined;
}

/** What a response came to, as an `onResponse` hook hears it: the body read and parsed, and the error it made, if any. */
export interface tResponseOutcome {
  /** The parsed JSON body; undefined when there was none or it was not JSON. */
  readonly body: unknown;
  /** The error this response produced, if any. The request may still be retried after it. */
  readonly error: AppleMusicError | undefined;
}

/**
 * What `request` sends beside the path, and what it makes of the answer. Every field is optional. It is read as its
 * own properties, once, when the request is made, and sent as it is: a caller's options are checked by `initOf`, and
 * a function for an endpoint hands over what it made of them. What cannot be encoded is a `TypeError` from the request.
 */
export interface tRequestInit<T = unknown> {
  /** The HTTP method. Default: GET. */
  readonly method?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
  /** The query, encoded as `tParams` says and set on the URL over whatever the path carries. */
  readonly params?: tParams | undefined;
  /** JSON-encoded, and sent with `Content-Type: application/json`. */
  readonly body?: unknown;
  /** Send the Music User Token. Default: true under /v1/me. */
  readonly user?: boolean | undefined;
  /** Validates the parsed body; a failure throws ValidationError. */
  readonly schema?: tSchemaLike<T> | undefined;
  /** Aborts the request at any point: before an attempt, in the rate limiter, in `fetch`, reading the body, or between attempts. Its reason is what the request then rejects with, as it is. */
  readonly signal?: AbortSignal | undefined;
  /**
   * Called as the client's own `onResponse` is, and after it, for this request alone: once per response, when the
   * body has been read and the outcome decided. It is how a caller learns what `request` does not resolve to, such
   * as the status of the answer or one of its headers. `req` is the Request as sent, token headers and all, so a
   * hook that logs it logs the tokens.
   */
  readonly onResponse?: ((res: Response, req: Request, outcome: tResponseOutcome) => void) | undefined;
}

/** One page of a collection or relationship response. */
export interface tPage<T> {
  /** The items of this page; left out when the page holds none. */
  readonly data?: readonly T[] | undefined;
  /** Where the next page is, as Apple gives it: a path on its origin with the query in it. Left out on the last page. */
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

/**
 * The client: what every function of the SDK asks Apple through. `createClient` makes one; anything with these five
 * methods passes for one wherever a client is taken, since a function checks only the methods it calls.
 */
export interface tAppleMusicClient {
  /**
   * One request to Apple: the tokens attached, the parameters encoded, the body read, and the status read as an error
   * where it is one. The developer token goes on every request, and the Music User Token under `/v1/me` or where
   * `init.user` says so, so a path has to stay on Apple's origin. A failing attempt is made again as the client's
   * retry policy says, a POST only after a failure that says it was not carried out, and what the last attempt failed
   * with is what the promise rejects with. A 401 gives a developer token provider one chance to replace its token.
   *
   * @param path - Where to ask: `"v1/..."`, `"/v1/..."`, or a `next` link from an answer.
   * @param init - What to send and what to make of the answer: the method, the query, a JSON body, whether the Music
   * User Token goes along, a schema, a signal and a hook for the response.
   * @returns The parsed body, as `init.schema` typed it where one was given; `undefined` when the answer had no body.
   * @throws TypeError if `path` leaves `https://api.music.apple.com` or is no URL, a value of `init.params` or
   * `init.body` cannot be encoded, a GET is given a body, `init.signal` is no AbortSignal, or a token provider gives
   * what is no token.
   * @throws AppleMusicError, once the retries are over, with `_tag` `DeveloperTokenInvalid` when Apple answers 401;
   * `UserTokenInvalid` when Apple answers 403, or the path needs a Music User Token and the client has none;
   * `RateLimited` when Apple answers 429; `ApiError` on any other failing status, or a 2xx body that is not JSON;
   * `ValidationError` when `init.schema` finds issues; `NetworkError` when `fetch` fails, Apple answers with a
   * redirect, which is not followed, or the body cannot be read while `init.signal` has not fired. A `DeveloperTokenUnavailable` is never made here: it is a token provider's,
   * passed on.
   * @throws The reason `init.signal` aborted with, when it does.
   * @throws Whatever a token provider, a user token store, a schema's `validate`, an `onRequest` or `onResponse` hook
   * or the rate limiter throws, as it is.
   */
  request<T>(path: string, init?: tRequestInit<T>): Promise<T>;
  /**
   * The items of `data` across every `next` page. Breaking out of the loop stops fetching.
   *
   * `from` is a path, or a page already fetched: the page's own items come first and nothing is asked for until
   * they run out. With a page, `init.params` is not sent, since its `next` link already carries the query. A page
   * is an object with a `data` list, a `next` link or both, and anything else handed over is a TypeError, but
   * `undefined`, which is a last, empty page. A
   * promise of a page is not a page: await it, so that what it rejects with reaches the code that asked.
   *
   * What a `next` link answers with has to be a page itself, with `data` at the top, as a collection's and a
   * relationship's are. A search or a chart answers with its pages nested under `results`, and is not walked.
   *
   * A walk has no end but the last page unless `init.maxPages` gives it one. A `next` link is followed wherever on
   * Apple's origin it points, so a page or a path from outside your app is as trusted as you make it: for one, pass
   * `user: false`, so that no Music User Token goes along, and a `maxPages`.
   *
   * Nothing runs until the loop first asks: what is thrown is thrown from the loop, not from the call.
   *
   * @param from - The path to ask first, or a page already fetched to begin with.
   * @param init - What each page is asked for with, as `request` takes it, and `maxPages`, the most pages to ask for.
   * @returns The items of `data`, page by page: those of the page given, then those of each `next` page asked for.
   * @throws TypeError if `init.maxPages` is given and is not a whole number above 0, `from` is a promise, or `from`
   * is neither a path nor a page nor `undefined`; and as `request` throws it for a page asked for.
   * @throws AppleMusicError as `request` rejects with for a page; and `ApiError` when a `next` link answers with
   * what is no page: not an object, a `data` that is no list, or a `next` that is no string.
   * @throws The reason `init.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `request` does.
   */
  paginate<T>(from: string | tPage<T>, init?: tPaginateInit<T>): AsyncIterable<T>;
  /**
   * The configured storefront, or the listener's, resolved once. A failure is not kept: the next call asks again.
   *
   * @returns The storefront's id, such as `"us"`: the one the client was created with, or else the one
   * `/v1/me/storefront` names for the listener, asked for once and kept.
   * @throws TypeError if a token provider gives what is no token, as `request` throws it.
   * @throws AppleMusicError with `_tag` `UserTokenInvalid` when no storefront was configured and there is no Music User
   * Token to look one up with; otherwise what `request` rejects with for `v1/me/storefront`, and `ApiError` when
   * its answer names no storefront.
   * @throws Whatever a token provider, store, hook or rate limiter throws, as `request` does.
   */
  storefront(): Promise<string>;
  /**
   * A client for one listener. Shares the developer token, storefront, store, fetch, limiter, retry policy and hooks.
   *
   * @param userToken - The listener's Music User Token, or a function that gives it when a request needs it.
   * @returns A client that sends `userToken` under `/v1/me`, made with this client's options otherwise.
   * @throws TypeError if `userToken` is neither a token nor a function.
   */
  as(userToken: string | tTokenProvider): tAppleMusicClient;
  /**
   * as(), with the token looked up in userTokenStore at each request. A listener the store has no token for is a
   * `UserTokenInvalid` from the first request that needs it, and that error names the listener as `userId` does.
   *
   * @param userId - Whose token to look up, under the name the store knows the listener by. It is not checked here.
   * @returns A client that asks the store for the listener's token when a request needs it.
   * @throws TypeError if the client was made without a `userTokenStore`.
   */
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
 *
 * @param value - What was given as a token.
 * @returns The token, trimmed, or `undefined` when `value` is not a string of printable ASCII with no spaces or line breaks inside.
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

/** Whether `value` is a token, or a function that gives one. A function's answer is checked where it is sent. */
const isTokenSource = (value: unknown): boolean => typeof value === "function" || parseToken(value) !== undefined;
const TOKEN = "a token or a function that gives one";

/**
 * The options checked, so a mistake fails here and not on the first request. A provider's answer, and whatever a
 * store holds, are not known yet and are checked when they are used.
 */
function checked(given: unknown): tClientOptions {
  if (typeof given !== "object" || given === null) throw new TypeError(`createClient: expected an options object with developerToken; got ${gotFor(given)}`);
  // What the options hold themselves, and nothing they inherit: a `fetch` or a `userToken` that some other code has
  // put on Object.prototype is not one this client was given. The same goes for what `request` and `paginate` take.
  const options = ownOf(given as tClientOptions);
  const refuse = (name: string, what: string, value: unknown): never => {
    throw new TypeError(`createClient: ${name} must be ${what}; got ${got(value)}`);
  };
  if (!isTokenSource(options.developerToken)) refuse("developerToken", TOKEN, options.developerToken);
  if (options.userToken !== undefined && !isTokenSource(options.userToken)) refuse("userToken", TOKEN, options.userToken);
  if (options.userTokenStore !== undefined && !has(options.userTokenStore, ["get", "set", "delete"])) refuse("userTokenStore", "a store with get, set and delete", options.userTokenStore);
  // Held to what a function for an endpoint holds a storefront to, one segment of a path, so that a storefront that
  // would be refused at every call is refused here instead. It is kept as given: the call encodes it.
  if (options.storefront !== undefined) segmentOf("createClient", "storefront", options.storefront);
  for (const name of ["fetch", "onRequest", "onResponse"] as const) if (options[name] !== undefined && typeof options[name] !== "function") refuse(name, "a function", options[name]);
  if (options.retry !== undefined && options.retry !== false && !isPlain(options.retry)) refuse("retry", "false or a plain object of retry policy fields", options.retry);
  if (options.rateLimit !== undefined && !has(options.rateLimit, ["acquire"])) refuse("rateLimit", "a rate limiter with acquire", options.rateLimit);
  return options;
}

/**
 * The client: one `fetch` wrapper that attaches the tokens, encodes the parameters, follows `next` links, reads
 * Apple's statuses as tagged errors and retries what is worth retrying. The options are checked here, so a mistake
 * fails at creation and not on the first request; what a provider gives, and what a store holds, are checked when
 * they are used. Every function of the SDK takes what this gives.
 *
 * @param given - The developer token, and whatever else: a listener's token or a store of them, a storefront, a
 * `fetch`, a retry policy, a rate limiter and the hooks.
 * @returns A client with `request`, `paginate`, `storefront`, `as` and `forUser`.
 * @throws TypeError if `given` is no object, `developerToken` or `userToken` is neither a token nor a function,
 * `userTokenStore` has no `get`, `set` and `delete`, `storefront` is not one segment of a path as `segmentOf` holds
 * it to be, `fetch`, `onRequest` or `onResponse` is no function, `retry` is neither `false` nor a plain object,
 * a field of `retry` is not what `tRetryPolicy` says, or `rateLimit` has no `acquire`.
 */
export function createClient(given: tClientOptions): tAppleMusicClient {
  const options = checked(given);
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
      // A redirect is refused, not followed: fetch drops `authorization` when one leaves the origin, but sends every
      // other header on, the Music User Token too, and to an `http:` address in the clear.
      const req = new Request(url, { method: init.method ?? "GET", headers, body, signal: signal ?? null, redirect: "error" });
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

  const as = (token: string | tTokenProvider): tAppleMusicClient => {
    // Checked here under its own name: a mistake in as() is as()'s, not one in the options the client was made with.
    if (!isTokenSource(token)) throw new TypeError(`as: userToken must be ${TOKEN}; got ${got(token)}`);
    return createClient({ ...options, userToken: token });
  };

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

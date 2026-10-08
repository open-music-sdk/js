import { AppleMusicError, parseRetryAfter } from "@open-music-sdk/core";
import { cached, orAbort, type tDeveloperTokenProvider, type tIssued } from "./cache.js";
import { got } from "./got.js";

// This module is also the package's "./fetcher" entry, for code that must carry no signing code: nothing it
// imports, directly or through another module, may reach jose or ./mint.js. A test walks the imports.
export type { tDeveloperTokenProvider } from "./cache.js";

/** Invalid values throw a TypeError. */
export interface tFetcherOptions {
  /** Default: the global fetch. Wrap it to add credentials or headers your endpoint needs. */
  readonly fetch?: typeof fetch | undefined;
  /** Fetch a replacement this long before `exp`. Default, and at most, half the life the token had left when it arrived. */
  readonly refreshAheadSeconds?: number | undefined;
  /** How long the endpoint may take to answer, in whole milliseconds. Default 10 000; at most 2^31 - 1. */
  readonly timeoutMs?: number | undefined;
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
// A developer token is a few hundred bytes. The limits are far above that and far below what could hurt:
// whatever answers at the endpoint decides how much is sent, and must not decide how much is kept.
const MAX_BODY_BYTES = 16_384;
const MAX_TOKEN_LENGTH = 8192;
const JWT = /^[\w-]+\.([\w-]+)\.[\w-]+$/;

/** `exp` of a JWT in epoch milliseconds, or undefined when `token` is not a JWT of a sane length that carries one. */
function expiry(token: unknown): number | undefined {
  const payload = typeof token === "string" && token.length <= MAX_TOKEN_LENGTH ? JWT.exec(token)?.[1] : undefined;
  if (payload === undefined) return undefined;
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    const exp = typeof claims === "object" && claims !== null && "exp" in claims ? claims.exp : undefined;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The body as text, or undefined once it has run past MAX_BODY_BYTES. It is counted as it arrives, after any
 * decompression, and what lies beyond the limit is cancelled rather than read.
 */
async function bounded(res: Response): Promise<string | undefined> {
  const stream = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (Number(res.headers.get("content-length")) > MAX_BODY_BYTES) {
    await stream?.cancel();
    return undefined;
  }
  if (typeof stream?.getReader !== "function") {
    // Nothing to count: an empty answer, or a runtime whose responses have no body stream. Read whole, then judge.
    const text = await res.text();
    return text.length > MAX_BODY_BYTES ? undefined : text;
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** `new URL` as a value. `URL.parse` would do, but it is newer than the browsers this has to run in. */
function parse(url: string | URL, base?: string): URL | undefined {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}

/**
 * A `developerToken` provider that fetches the token from an endpoint you host, for code that must not hold
 * the private key. The endpoint answers 2xx with the JWT as text, or as JSON `{ "token": "<jwt>" }`.
 *
 * The token is reused until shortly before its `exp`, concurrent requests share one fetch, and a token Apple
 * answers 401 to is fetched again. Whatever goes wrong at the endpoint is `DeveloperTokenUnavailable`, carrying
 * the endpoint's status when it answered, so it is never mistaken for an answer from Apple.
 */
export function developerTokenFetcher(url: string | URL, options: tFetcherOptions = {}): tDeveloperTokenProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (typeof fetchImpl !== "function") throw new TypeError(`developerTokenFetcher: fetch must be a function, got ${typeof fetchImpl}`);
  // An integer, because a timer takes nothing else: Node throws at a fraction and a browser rounds it down, to zero if it can.
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
    throw new TypeError(`developerTokenFetcher: timeoutMs must be an integer from 1 to ${String(MAX_TIMEOUT_MS)}, got ${got(timeoutMs)}`);
  /**
   * The endpoint as an absolute URL, or undefined while it is relative and there is nothing to resolve it against.
   * A relative URL resolves against the document's base URL, exactly as fetch would resolve it.
   */
  const resolve = (): URL | undefined => {
    const scope = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
    const endpoint = parse(url, scope.document?.baseURI ?? scope.location?.href);
    // Neither error quotes the URL: its query or its credentials may be secrets, and errors get logged.
    if (endpoint !== undefined && endpoint.protocol !== "https:" && endpoint.protocol !== "http:")
      throw new TypeError(`developerTokenFetcher: the URL must be http or https, not ${endpoint.protocol}`);
    if (endpoint !== undefined && (endpoint.username !== "" || endpoint.password !== ""))
      throw new TypeError("developerTokenFetcher: the URL must not carry a username or password; send credentials through the fetch option");
    return endpoint;
  };
  // What can never work is refused now. A relative URL with no document yet is left for the first call, so a
  // module that creates the provider can still be loaded on a server.
  resolve();

  const issue = async (): Promise<tIssued> => {
    const endpoint = resolve();
    if (endpoint === undefined) throw new TypeError("developerTokenFetcher: a relative URL needs a document to resolve against; outside a browser, pass an absolute URL");
    const where = endpoint.origin + endpoint.pathname; // no query, no fragment
    // The shared fetch answers to the timeout alone; no caller's signal may cancel it for the others.
    const timeout = AbortSignal.timeout(timeoutMs);
    const exchange = async () => {
      // A redirect is refused: the token comes from the URL that was configured or from nowhere.
      const answer = await fetchImpl(endpoint, { cache: "no-store", redirect: "error", signal: timeout });
      return { res: answer, body: await bounded(answer) };
    };
    let res: Response;
    let body: string | undefined;
    try {
      // The signal asks fetch to stop at the timeout. The race makes sure this stops waiting then, even for a
      // fetch that was wrapped without passing the signal on; whatever it answers later is still read to the end.
      ({ res, body } = await orAbort(exchange(), timeout));
    } catch (e) {
      // Only the kind of failure is repeated. A runtime's own message may spell out the whole URL, query included.
      throw new AppleMusicError("DeveloperTokenUnavailable", `developer token endpoint ${where} could not be reached (${e instanceof Error ? e.name : typeof e})`, { cause: e });
    }
    if (!res.ok)
      throw new AppleMusicError("DeveloperTokenUnavailable", `developer token endpoint ${where} answered ${String(res.status)}`, {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      });
    if (body === undefined)
      throw new AppleMusicError("DeveloperTokenUnavailable", `developer token endpoint ${where} answered with more than ${String(MAX_BODY_BYTES)} bytes, which is no developer token`, {
        status: res.status,
      });
    const text = body.trim();
    let token: unknown = text;
    if (text.startsWith("{")) {
      try {
        token = (JSON.parse(text) as { token?: unknown }).token;
      } catch {
        token = undefined;
      }
    }
    const expiresAt = expiry(token);
    // The body is never quoted: it may be a credential, or a page of markup.
    if (typeof token !== "string" || expiresAt === undefined)
      throw new AppleMusicError("DeveloperTokenUnavailable", `developer token endpoint ${where} did not answer with a JWT that has an exp claim`, { status: res.status });
    return { token, expiresAt };
  };

  return cached(issue, options.refreshAheadSeconds);
}

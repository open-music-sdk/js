import { AppleMusicError, parseRetryAfter } from "@open-music-sdk/core";
import { cached, orAbort, type tDeveloperTokenProvider, type tIssued } from "./cache.js";

/** Invalid values throw a TypeError. */
export interface tRemoteOptions {
  /** Default: the global fetch. Wrap it to add credentials or headers your endpoint needs. */
  readonly fetch?: typeof fetch | undefined;
  /** Fetch a replacement this long before `exp`, capped at half the token's remaining life. Default one day. */
  readonly refreshAheadSeconds?: number | undefined;
  /** How long the endpoint may take to answer. Default 10 000; at most 2^31 - 1. */
  readonly timeoutMs?: number | undefined;
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const JWT = /^[\w-]+\.([\w-]+)\.[\w-]+$/;

/** `exp` of a JWT in epoch milliseconds, or undefined when `token` is not a JWT that carries one. */
function expiry(token: unknown): number | undefined {
  const payload = typeof token === "string" ? JWT.exec(token)?.[1] : undefined;
  if (payload === undefined) return undefined;
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    const exp = typeof claims === "object" && claims !== null && "exp" in claims ? claims.exp : undefined;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
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
export function remoteDeveloperToken(url: string | URL, options: tRemoteOptions = {}): tDeveloperTokenProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (typeof fetchImpl !== "function") throw new TypeError(`remoteDeveloperToken: fetch must be a function, got ${typeof fetchImpl}`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS)
    throw new TypeError(`remoteDeveloperToken: timeoutMs must be a number above 0 and at most ${String(MAX_TIMEOUT_MS)}, got ${String(timeoutMs)}`);
  /**
   * The endpoint as an absolute URL, or undefined while it is relative and there is nothing to resolve it against.
   * A relative URL resolves against the document's base URL, exactly as fetch would resolve it.
   */
  const resolve = (): URL | undefined => {
    const scope = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
    const endpoint = parse(url, scope.document?.baseURI ?? scope.location?.href);
    // Neither error quotes the URL: its query or its credentials may be secrets, and errors get logged.
    if (endpoint !== undefined && endpoint.protocol !== "https:" && endpoint.protocol !== "http:")
      throw new TypeError(`remoteDeveloperToken: the URL must be http or https, not ${endpoint.protocol}`);
    if (endpoint !== undefined && (endpoint.username !== "" || endpoint.password !== ""))
      throw new TypeError("remoteDeveloperToken: the URL must not carry a username or password; send credentials through the fetch option");
    return endpoint;
  };
  // What can never work is refused now. A relative URL with no document yet is left for the first call, so a
  // module that creates the provider can still be loaded on a server.
  resolve();

  const issue = async (): Promise<tIssued> => {
    const endpoint = resolve();
    if (endpoint === undefined) throw new TypeError("remoteDeveloperToken: a relative URL needs a document to resolve against; outside a browser, pass an absolute URL");
    const where = endpoint.origin + endpoint.pathname; // no query, no fragment
    // The shared fetch answers to the timeout alone; no caller's signal may cancel it for the others.
    const timeout = AbortSignal.timeout(timeoutMs);
    const exchange = async () => {
      // A redirect is refused: the token comes from the URL that was configured or from nowhere.
      const answer = await fetchImpl(endpoint, { cache: "no-store", redirect: "error", signal: timeout });
      return { res: answer, body: (await answer.text()).trim() };
    };
    let res: Response;
    let body: string;
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
    let token: unknown = body;
    if (body.startsWith("{")) {
      try {
        token = (JSON.parse(body) as { token?: unknown }).token;
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

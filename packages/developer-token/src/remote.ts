import { AppleMusicError } from "@open-music-sdk/core";
import { cached, type tDeveloperTokenProvider, type tIssued } from "./cache.js";

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
 * answers 401 to is fetched again. An unreachable endpoint is a `NetworkError`; any other answer than a
 * developer token is an `ApiError`.
 */
export function remoteDeveloperToken(url: string | URL, options: tRemoteOptions = {}): tDeveloperTokenProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (typeof fetchImpl !== "function") throw new TypeError(`remoteDeveloperToken: fetch must be a function, got ${typeof fetchImpl}`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS)
    throw new TypeError(`remoteDeveloperToken: timeoutMs must be a number above 0 and at most ${String(MAX_TIMEOUT_MS)}, got ${String(timeoutMs)}`);
  // A relative URL only means something where there is a document to resolve it against.
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  const endpoint = parse(url, base);
  if (endpoint?.protocol !== "https:" && endpoint?.protocol !== "http:")
    throw new TypeError(`remoteDeveloperToken: "${String(url)}" is not an http(s) URL; outside a browser it must be absolute`);
  const where = endpoint.origin + endpoint.pathname;

  const issue = async (): Promise<tIssued> => {
    let res: Response;
    let body: string;
    try {
      // The shared fetch answers to the timeout alone; no caller's signal may cancel it for the others.
      res = await fetchImpl(endpoint, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      body = (await res.text()).trim();
    } catch (e) {
      throw new AppleMusicError("NetworkError", `developer token endpoint ${where}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    if (!res.ok) throw new AppleMusicError("ApiError", `developer token endpoint ${where} answered ${String(res.status)}`, { status: res.status });
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
      throw new AppleMusicError("ApiError", `developer token endpoint ${where} did not answer with a JWT that has an exp claim`, { status: res.status });
    return { token, expiresAt };
  };

  return cached(issue, options.refreshAheadSeconds);
}

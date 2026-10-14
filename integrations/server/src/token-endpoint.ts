// The token endpoint: a handler that hands a page a short-lived developer token bound to the page's origin, which
// is what `createBrowserClient({ tokenUrl })` fetches. Web-standard Request and Response, to mount as it is.
import { got, optionsOf } from "@open-music-sdk/core";
import { developerTokenMinter, type tMinterOptions } from "@open-music-sdk/developer-token";

/** Invalid values throw a TypeError when the endpoint is made. */
export interface tTokenEndpointOptions extends Omit<tMinterOptions, "origin" | "ttlSeconds"> {
  /**
   * The web origins the token is for, one at least, each exactly as a browser sends it: `https://app.example`, with
   * no path and no trailing slash. Apple honours the claim for requests from browsers, and a request from one of
   * these origins is answered with the CORS headers that let its page read the token.
   */
  readonly origin: readonly string[];
  /** The token's lifetime in whole seconds, from 60 to 86 400, one day. Default 900, fifteen minutes: a page can be read by anyone, and so can its token. */
  readonly ttlSeconds?: number | undefined;
}

/** A web-standard handler, to mount wherever your framework takes one: `export const GET = tokenEndpoint(…)`. */
export type tTokenEndpoint = (req: Request) => Promise<Response>;

const DEFAULT_TTL_SECONDS = 900;
/** The longest a token handed to a page may live: anyone can fetch one, and it cannot be taken back. The minter's own ceiling is for a server's token. */
const MAX_TTL_SECONDS = 86_400;
const WHAT = "an options object with pem, teamId, keyId and origin";

/**
 * A handler that answers `GET` with `{ "token": "<jwt>" }` and `cache-control: no-store`, the token minted for the
 * origins given and replaced in the background halfway through its life, so page loads within that life share one
 * signature. A request whose `Origin` header is one of the origins is answered with `access-control-allow-origin`
 * for it; no other request gets a CORS header, and no answer carries credentials. Every answer says `vary: origin`
 * and `cache-control: no-store`. `OPTIONS` is answered `204` the same way, and any other method `405`.
 *
 * It catches nothing. A `pem` that is a string but no key fails at the first mint, inside the request, with the
 * TypeError the minter throws; the framework logs it, and the developer finds it there. The options are checked
 * and taken here, once.
 */
export function tokenEndpoint(options: tTokenEndpointOptions): tTokenEndpoint {
  if ((options as unknown) === undefined) throw new TypeError(`tokenEndpoint: expected ${WHAT}; got undefined`);
  const { origin, ttlSeconds, ...key } = optionsOf("tokenEndpoint", options, WHAT);
  if (!Array.isArray(origin) || origin.length === 0) throw new TypeError(`tokenEndpoint: origin must be a list of one or more web origins the token is for, such as ["https://app.example"]; got ${got(origin)}`);
  if (ttlSeconds !== undefined && (!Number.isInteger(ttlSeconds) || ttlSeconds > MAX_TTL_SECONDS))
    throw new TypeError(`tokenEndpoint: ttlSeconds must be a whole number of seconds up to ${String(MAX_TTL_SECONDS)}, one day, for a token a page holds; got ${got(ttlSeconds)}`);
  // This call's own copy of the list, read by index as the family reads a list: what the minter checks is what the CORS check uses.
  const origins: readonly unknown[] = Array.from({ length: origin.length }, (_, index): unknown => origin[index]);
  // The minter checks each origin, the key and its ids, and names what is wrong under its own name.
  const developerToken = developerTokenMinter({ ...key, origin: origins as readonly string[], ttlSeconds: ttlSeconds ?? DEFAULT_TTL_SECONDS });
  const allowed = new Set<unknown>(origins);

  return async (req: Request): Promise<Response> => {
    const from = req.headers.get("origin");
    // On every answer, whatever the match: a cache keyed on the URL alone would hand one page's answer to another, and no answer is for keeping.
    const headers: Record<string, string> = { vary: "origin", "cache-control": "no-store", ...(from !== null && allowed.has(from) ? { "access-control-allow-origin": from } : {}) };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET", allow: "GET" } });
    if (req.method !== "GET") return Response.json({ error: "MethodNotAllowed" }, { status: 405, headers: { ...headers, allow: "GET" } });
    // The mint is one flight shared by every request: a request that is gone does not cancel it, and is not what makes it fail.
    const token = await developerToken();
    return Response.json({ token }, { headers });
  };
}

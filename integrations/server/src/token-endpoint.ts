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
  /** The token's lifetime in whole seconds, from 60 to 15 777 000. Default 900, fifteen minutes: a page can be read by anyone, and so can its token. */
  readonly ttlSeconds?: number | undefined;
}

/** A web-standard handler, to mount wherever your framework takes one: `export const GET = tokenEndpoint(…)`. */
export type tTokenEndpoint = (req: Request) => Promise<Response>;

const DEFAULT_TTL_SECONDS = 900;
const WHAT = "an options object with pem, teamId, keyId and origin";

/**
 * A handler that answers `GET` with `{ "token": "<jwt>" }` and `cache-control: no-store`, the token minted for the
 * origins given and replaced in the background halfway through its life, so page loads within that life share one
 * signature. A request whose `Origin` header is one of the origins is answered with `access-control-allow-origin`
 * for it, and `vary: origin`; no other request gets a CORS header, and no answer carries credentials. `OPTIONS` is
 * answered `204` the same way, and any other method `405`.
 *
 * It catches nothing. A `pem` that is a string but no key fails at the first mint, inside the request, with the
 * TypeError the minter throws; the framework logs it, and the developer finds it there. The options are checked
 * and taken here, once.
 */
export function tokenEndpoint(options: tTokenEndpointOptions): tTokenEndpoint {
  if ((options as unknown) === undefined) throw new TypeError(`tokenEndpoint: expected ${WHAT}; got undefined`);
  const { origin, ttlSeconds, ...key } = optionsOf("tokenEndpoint", options, WHAT);
  if (!Array.isArray(origin) || origin.length === 0) throw new TypeError(`tokenEndpoint: origin must be a list of one or more web origins the token is for, such as ["https://app.example"]; got ${got(origin)}`);
  // The minter checks each origin, the key and its ids, and names what is wrong under its own name.
  const developerToken = developerTokenMinter({ ...key, origin, ttlSeconds: ttlSeconds ?? DEFAULT_TTL_SECONDS });
  const origins = new Set<unknown>(origin);

  return async (req: Request): Promise<Response> => {
    const from = req.headers.get("origin");
    const cors: Record<string, string> = from !== null && origins.has(from) ? { "access-control-allow-origin": from, vary: "origin" } : {};
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET", allow: "GET" } });
    if (req.method !== "GET") return Response.json({ error: "MethodNotAllowed" }, { status: 405, headers: { ...cors, allow: "GET", "cache-control": "no-store" } });
    const token = await developerToken({ signal: req.signal });
    return Response.json({ token }, { headers: { ...cors, "cache-control": "no-store" } });
  };
}

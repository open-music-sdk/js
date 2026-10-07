import { importPKCS8, SignJWT } from "jose";
import { cached, type tDeveloperTokenProvider, type tIssued } from "./cache.js";
import type { tRedacted } from "./redacted.js";

/** Invalid values throw a TypeError. */
export interface tMintOptions {
  /** The contents of AuthKey_XXXXXXXXXX.p8: a PKCS8 PEM. Line breaks escaped as `\n`, the way an environment variable holds them, are accepted. */
  readonly pem: string | tRedacted<string>;
  /** Your Apple Developer Team ID; becomes `iss`. */
  readonly teamId: string;
  /** The ID of the MusicKit key; becomes `kid`. */
  readonly keyId: string;
  /** Lifetime in whole seconds, at most 15 777 000 (Apple's six months). Default 150 days. */
  readonly ttlSeconds?: number | undefined;
  /** Web origins the token is valid for. Set it on any token a browser will see. */
  readonly origin?: readonly string[] | undefined;
}

export interface tCachedMinterOptions extends tMintOptions {
  /** Mint a replacement this long before `exp`, capped at half the lifetime. Default one day. */
  readonly refreshAheadSeconds?: number | undefined;
}

const MAX_TTL_SECONDS = 15_777_000;
const DEFAULT_TTL_SECONDS = 150 * 86_400;

/** What a value is, for an error that must not show what it holds: a value in the wrong place may be the private key. */
const got = (value: unknown) => (typeof value === "string" ? `${String(value.length)} characters` : value === null ? "null" : typeof value);

/** The PEM out of `pem`: the string itself, or the string a redacted wrapper holds. Anything else is refused by name. */
function pemOf(pem: unknown): string {
  const value: unknown = typeof pem === "object" && pem !== null && "unwrap" in pem && typeof pem.unwrap === "function" ? (pem.unwrap as () => unknown)() : pem;
  if (typeof value === "string" && value !== "") return value;
  throw new TypeError(`developer token: pem must be the contents of the .p8 file as a string, or that string redacted; got ${got(value)}`);
}

/** Apple's Team IDs and key IDs are ten capital letters and digits. Anything else is refused before it is signed into a token. */
function id(name: string, value: unknown) {
  if (typeof value === "string" && /^[A-Z0-9]{10}$/.test(value)) return;
  throw new TypeError(`developer token: ${name} must be ten capital letters and digits, as Apple issues it; got ${got(value)}`);
}

/** What a browser sends as Origin: scheme, host and port, in their canonical spelling. */
function isOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}

/** Checks everything that can be checked without parsing the key, and returns the PEM and the lifetime. */
function check(options: tMintOptions): { pem: string; ttlSeconds: number } {
  if (typeof options !== "object" || (options as unknown) === null) throw new TypeError(`developer token: expected an options object with pem, teamId and keyId; got ${got(options)}`);
  const { teamId, keyId, ttlSeconds = DEFAULT_TTL_SECONDS, origin } = options;
  const key = pemOf(options.pem);
  id("teamId", teamId);
  id("keyId", keyId);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS)
    throw new TypeError(`developer token: ttlSeconds must be an integer from 1 to ${String(MAX_TTL_SECONDS)}, got ${String(ttlSeconds)}`);
  if (origin !== undefined) {
    // An empty list is refused rather than sent: whether Apple reads it as "no origin" or "any origin" is undocumented.
    if (!Array.isArray(origin) || origin.length === 0) throw new TypeError("developer token: origin must be a non-empty array; omit it for no restriction");
    // By index, so a hole in a sparse array is seen. An entry Apple can never match would lock every browser out.
    for (let i = 0; i < origin.length; i++)
      if (!isOrigin(origin[i]))
        throw new TypeError(`developer token: origin[${String(i)}] must be a web origin such as https://app.example: scheme, host and port, with no path or trailing slash`);
  }
  // An environment variable often carries the PEM with its line breaks escaped; a PEM has no backslashes of its own.
  // jose insists the armor is the very first thing, so a stray newline or a byte order mark is trimmed away.
  return { pem: key.replaceAll("\\r", "\r").replaceAll("\\n", "\n").trim(), ttlSeconds };
}

async function issue(options: tMintOptions): Promise<tIssued> {
  const { pem, ttlSeconds } = check(options);
  let key;
  try {
    key = await importPKCS8(pem, "ES256");
  } catch (e) {
    throw new TypeError("developer token: pem is not a PKCS8 P-256 private key (expected the contents of AuthKey_XXXXXXXXXX.p8)", { cause: e });
  }
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const token = await new SignJWT(options.origin ? { origin: options.origin } : {})
    .setProtectedHeader({ alg: "ES256", kid: options.keyId })
    .setIssuer(options.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return { token, expiresAt: exp * 1000 };
}

/** Signs a developer token: an ES256 JWT with `iss`, `iat`, `exp`, and optionally `origin`. */
export const mintDeveloperToken = async (options: tMintOptions): Promise<string> => (await issue(options)).token;

/**
 * A `developerToken` provider that mints on first use and reuses the token until shortly before it expires.
 * Concurrent requests share one mint, and a token Apple answers 401 to is replaced.
 */
export function cachedMinter(options: tCachedMinterOptions): tDeveloperTokenProvider {
  check(options);
  return cached(() => issue(options), options.refreshAheadSeconds);
}

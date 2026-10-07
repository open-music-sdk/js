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

function text(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value === "") throw new TypeError(`developer token: ${name} must be a non-empty string`);
}

/** Checks everything that can be checked without parsing the key, and returns the PEM and the lifetime. */
function check({ pem, teamId, keyId, ttlSeconds = DEFAULT_TTL_SECONDS, origin }: tMintOptions): { pem: string; ttlSeconds: number } {
  const key: unknown = typeof pem === "object" ? pem.unwrap() : pem;
  text("pem", key);
  text("teamId", teamId);
  text("keyId", keyId);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS)
    throw new TypeError(`developer token: ttlSeconds must be an integer from 1 to ${String(MAX_TTL_SECONDS)}, got ${String(ttlSeconds)}`);
  if (origin !== undefined) {
    // An empty list is refused rather than sent: whether Apple reads it as "no origin" or "any origin" is undocumented.
    if (!Array.isArray(origin) || origin.length === 0) throw new TypeError("developer token: origin must be a non-empty array; omit it for no restriction");
    origin.forEach((o, i) => {
      text(`origin[${String(i)}]`, o);
    });
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

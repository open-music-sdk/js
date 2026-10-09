import { got } from "@open-music-sdk/core";
import { importPKCS8, SignJWT } from "jose";
import { cached, type tDeveloperTokenProvider, type tIssued } from "./cache.js";
import { redacted, type tRedacted } from "./redacted.js";

/**
 * Where the key and its two IDs are kept, and how they are loaded, is the caller's business: nothing here reads an
 * environment or a file. Invalid values throw a TypeError. No error quotes a value.
 */
export interface tMintOptions {
  /** The contents of AuthKey_XXXXXXXXXX.p8: a PKCS8 PEM. Line breaks escaped as `\n` are accepted. */
  readonly pem: string;
  /** Your Apple Developer Team ID; becomes `iss`. */
  readonly teamId: string;
  /** The ID of the MusicKit key; becomes `kid`. */
  readonly keyId: string;
  /** Lifetime in whole seconds, from 60 to 15 777 000 (Apple's six months). Default one hour. */
  readonly ttlSeconds?: number | undefined;
  /** Web origins the token is valid for. Set it on any token a browser will see. */
  readonly origin?: readonly string[] | undefined;
}

export interface tMinterOptions extends tMintOptions {
  /** Mint a replacement this long before `exp`. Default, and at most, half the lifetime. */
  readonly refreshAheadSeconds?: number | undefined;
}

// A token cannot be taken back without revoking the key, so its lifetime is how long a leaked one stays useful.
// Minting is local and the minter replaces tokens in the background, so a short life costs nothing.
const DEFAULT_TTL_SECONDS = 3600;
// Below a minute, clock drift and the request itself use the lifetime up, and no replacement can be ready in time.
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 15_777_000; // Apple's limit

/** The PEM, which is a string and nothing else: no wrapper is opened and no object is asked for one. */
function pemOf(pem: unknown): string {
  if (typeof pem === "string" && pem !== "") return pem;
  throw new TypeError(`developer token: pem must be the contents of the .p8 file, as a string; got ${got(pem)}`);
}

/** Apple's Team IDs and key IDs are ten capital letters and digits. Anything else is refused before it is signed into a token. */
function id(name: string, value: unknown): string {
  if (typeof value === "string" && /^[A-Z0-9]{10}$/.test(value)) return value;
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

/** What goes into a token, apart from the key. */
interface tClaims {
  readonly teamId: string;
  readonly keyId: string;
  readonly ttlSeconds: number;
  readonly origin: readonly string[] | undefined;
}

/**
 * Checks everything that can be checked without parsing the key, and returns it as values of its own: nothing the
 * caller does to its object, or to the origin list inside it, reaches a later mint. The PEM comes back wrapped, so
 * from here on it prints as a mask wherever it ends up, until `importKey` opens it.
 */
function check(options: tMintOptions): tClaims & { readonly pem: tRedacted<string> } {
  if (typeof options !== "object" || (options as unknown) === null) throw new TypeError(`developer token: expected an options object with pem, teamId and keyId; got ${got(options)}`);
  const { ttlSeconds = DEFAULT_TTL_SECONDS, origin } = options;
  const key = pemOf(options.pem);
  const teamId = id("teamId", options.teamId);
  const keyId = id("keyId", options.keyId);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS)
    throw new TypeError(`developer token: ttlSeconds must be an integer from ${String(MIN_TTL_SECONDS)} to ${String(MAX_TTL_SECONDS)}, got ${got(ttlSeconds)}`);
  let origins: string[] | undefined;
  if (origin !== undefined) {
    // An empty list is refused rather than sent: whether Apple reads it as "no origin" or "any origin" is undocumented.
    if (!Array.isArray(origin) || origin.length === 0) throw new TypeError("developer token: origin must be a non-empty array; omit it for no restriction");
    // By index, so a hole in a sparse array is seen. An entry Apple can never match would lock every browser out.
    for (let i = 0; i < origin.length; i++)
      if (!isOrigin(origin[i]))
        throw new TypeError(`developer token: origin[${String(i)}] must be a web origin such as https://app.example: scheme, host and port, with no path or trailing slash`);
    origins = Array.from(origin as readonly string[]); // a list of the minter's own, which the caller's later changes do not reach
  }
  // An environment variable often carries the PEM with its line breaks escaped; a PEM has no backslashes of its own.
  // jose insists the armor is the very first thing, so a stray newline or a byte order mark is trimmed away.
  return { pem: redacted(key.replaceAll("\\r", "\r").replaceAll("\\n", "\n").trim()), teamId, keyId, ttlSeconds, origin: origins };
}

/** The PEM as a key that can sign and cannot be exported. The one place the wrapper is opened. */
async function importKey(pem: tRedacted<string>): Promise<CryptoKey> {
  try {
    return await importPKCS8(pem.unwrap(), "ES256");
  } catch (e) {
    throw new TypeError(`developer token: pem is not a PKCS8 P-256 private key (expected the contents of AuthKey_XXXXXXXXXX.p8)`, { cause: e });
  }
}

async function sign(key: CryptoKey, { teamId, keyId, ttlSeconds, origin }: tClaims): Promise<tIssued> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const token = await new SignJWT(origin ? { origin } : {})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return { token, expiresAt: exp * 1000 };
}

/** Signs a developer token: an ES256 JWT with `iss`, `iat`, `exp`, and optionally `origin`. */
export async function mintDeveloperToken(options: tMintOptions): Promise<string> {
  const { pem, ...claims } = check(options);
  return (await sign(await importKey(pem), claims)).token;
}

/**
 * A `developerToken` provider that mints on first use and reuses the token, replacing it in the background
 * halfway through its life. Concurrent requests share one mint, and a token Apple answers 401 to is replaced.
 *
 * The options are read once, here, and the PEM held wrapped so that nothing prints it. The key is imported on
 * first use and the PEM let go of: from then on the minter holds a key that can sign and cannot be exported, and
 * no copy of the text it came from.
 */
export function developerTokenMinter(options: tMinterOptions): tDeveloperTokenProvider {
  const { pem, ...claims } = check(options);
  let key: tRedacted<string> | CryptoKey = pem; // the wrapped PEM until it has been imported, then the key in its place
  return cached(async () => {
    if ("unwrap" in key) key = await importKey(key);
    return sign(key, claims);
  }, options.refreshAheadSeconds);
}

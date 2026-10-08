import { importPKCS8, SignJWT } from "jose";
import { cached, type tDeveloperTokenProvider, type tIssued } from "./cache.js";
import { readEnv, type tEnvVariables, type tSetting } from "./env.js";

/** The key and its two IDs, given outright. */
interface tKeyGiven {
  /** The contents of AuthKey_XXXXXXXXXX.p8: a PKCS8 PEM. Line breaks escaped as `\n` are accepted. */
  readonly pem: string;
  /** Your Apple Developer Team ID; becomes `iss`. */
  readonly teamId: string;
  /** The ID of the MusicKit key; becomes `kid`. */
  readonly keyId: string;
  readonly env?: undefined;
  readonly variables?: undefined;
}

/** The key and its two IDs, read from an environment. Any of them given outright as well is used instead of its variable. */
interface tKeyFromEnv {
  /**
   * The environment to read: `process.env` once your `.env` file is loaded, a Workers `env`, or any object of
   * strings. It is read once, when the options are, from `APPLE_MUSIC_PRIVATE_KEY`, `APPLE_MUSIC_TEAM_ID` and
   * `APPLE_MUSIC_KEY_ID` unless `variables` names others.
   */
  readonly env: object;
  /** Other names for the three variables. */
  readonly variables?: tEnvVariables | undefined;
  readonly pem?: string | undefined;
  readonly teamId?: string | undefined;
  readonly keyId?: string | undefined;
}

/** Invalid values throw a TypeError. No error quotes a value. */
export type tMintOptions = (tKeyGiven | tKeyFromEnv) & {
  /** Lifetime in whole seconds, from 60 to 15 777 000 (Apple's six months). Default one hour. */
  readonly ttlSeconds?: number | undefined;
  /** Web origins the token is valid for. Set it on any token a browser will see. */
  readonly origin?: readonly string[] | undefined;
};

export type tMinterOptions = tMintOptions & {
  /** Mint a replacement this long before `exp`. Default, and at most, half the lifetime. */
  readonly refreshAheadSeconds?: number | undefined;
};

// A token cannot be taken back without revoking the key, so its lifetime is how long a leaked one stays useful.
// Minting is local and the minter replaces tokens in the background, so a short life costs nothing.
const DEFAULT_TTL_SECONDS = 3600;
// Below a minute, clock drift and the request itself use the lifetime up, and no replacement can be ready in time.
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 15_777_000; // Apple's limit

/** What a value is, for an error that must not show what it holds: a value in the wrong place may be the private key. */
const got = (value: unknown) => (typeof value === "string" ? `${String(value.length)} characters` : value === null ? "null" : typeof value);

/** The PEM, which is a string and nothing else: no wrapper is opened and no object is asked for one. */
function pemOf(name: string, pem: unknown): string {
  if (typeof pem === "string" && pem !== "") return pem;
  throw new TypeError(`developer token: ${name} must be the contents of the .p8 file, as a string; got ${got(pem)}`);
}

/** Apple's Team IDs and key IDs are ten capital letters and digits. Anything else is refused before it is signed into a token. */
function id(name: string, value: unknown): string {
  if (typeof value === "string" && /^[A-Z0-9]{10}$/.test(value)) return value;
  throw new TypeError(`developer token: ${name} must be ten capital letters and digits, as Apple issues it; got ${got(value)}`);
}

const SETTINGS: readonly tSetting[] = ["pem", "teamId", "keyId"];

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
 * caller does to its object, or to the origin list inside it, reaches a later mint.
 */
function check(options: tMintOptions): tClaims & { readonly pem: string; readonly pemName: string } {
  if (typeof options !== "object" || (options as unknown) === null)
    throw new TypeError(`developer token: expected an options object with pem, teamId and keyId, or with env; got ${got(options)}`);
  const { env, variables, ttlSeconds = DEFAULT_TTL_SECONDS, origin } = options;
  // The types rule this out, and a caller without them can still do it.
  if (env === undefined && (variables as unknown) !== undefined) throw new TypeError("developer token: variables names what to read from env, and no env was given");
  // Each of the key and its IDs comes from its own option or, failing that, from env under its variable's name.
  const read = env === undefined ? {} : readEnv(env, variables, SETTINGS.filter((setting) => options[setting] === undefined));
  /** The option as an error should name it: with the variable it was read from, when it was. */
  const named = (setting: tSetting) => (read[setting] === undefined ? setting : `${setting} (read from ${read[setting].variable})`);
  const key = pemOf(named("pem"), options.pem ?? read.pem?.value);
  const teamId = id(named("teamId"), options.teamId ?? read.teamId?.value);
  const keyId = id(named("keyId"), options.keyId ?? read.keyId?.value);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS)
    throw new TypeError(`developer token: ttlSeconds must be an integer from ${String(MIN_TTL_SECONDS)} to ${String(MAX_TTL_SECONDS)}, got ${String(ttlSeconds)}`);
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
  return { pem: key.replaceAll("\\r", "\r").replaceAll("\\n", "\n").trim(), pemName: named("pem"), teamId, keyId, ttlSeconds, origin: origins };
}

/** The PEM as a key that can sign and cannot be exported. `name` is how an error should refer to where it came from. */
async function importKey(pem: string, name: string): Promise<CryptoKey> {
  try {
    return await importPKCS8(pem, "ES256");
  } catch (e) {
    throw new TypeError(`developer token: ${name} is not a PKCS8 P-256 private key (expected the contents of AuthKey_XXXXXXXXXX.p8)`, { cause: e });
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
  const { pem, pemName, ...claims } = check(options);
  return (await sign(await importKey(pem, pemName), claims)).token;
}

/**
 * A `developerToken` provider that mints on first use and reuses the token until shortly before it expires.
 * Concurrent requests share one mint, and a token Apple answers 401 to is replaced.
 *
 * The options are read once, here. The key is imported on first use and the PEM let go of: from then on the
 * minter holds a key that can sign and cannot be exported, and no copy of the text it came from.
 */
export function developerTokenMinter(options: tMinterOptions): tDeveloperTokenProvider {
  const { pem, pemName, ...claims } = check(options);
  let key: string | CryptoKey = pem; // the PEM until it has been imported, then the key in its place
  return cached(async () => {
    if (typeof key === "string") key = await importKey(key, pemName);
    return sign(key, claims);
  }, options.refreshAheadSeconds);
}

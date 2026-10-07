import { redacted, type tRedacted } from "./redacted.js";

/** The private key and the two IDs that go with it. Spread it into `cachedMinter` or `mintDeveloperToken`. */
export interface tSigningKey {
  readonly pem: tRedacted<string>;
  readonly teamId: string;
  readonly keyId: string;
}

/** Which variable holds what, for an environment that does not use the default names. */
export interface tEnvNames {
  /** Default `APPLE_MUSIC_PRIVATE_KEY`. */
  readonly pem?: string | undefined;
  /** Default `APPLE_MUSIC_TEAM_ID`. */
  readonly teamId?: string | undefined;
  /** Default `APPLE_MUSIC_KEY_ID`. */
  readonly keyId?: string | undefined;
}

const DEFAULT_NAMES = { pem: "APPLE_MUSIC_PRIVATE_KEY", teamId: "APPLE_MUSIC_TEAM_ID", keyId: "APPLE_MUSIC_KEY_ID" } as const;
const SETTINGS = ["pem", "teamId", "keyId"] as const;

/**
 * Reads the private key, the Team ID and the key ID from an environment: `process.env` once your `.env` file is
 * loaded, a Workers `env`, or any object of strings. The key comes back redacted.
 *
 * A variable that is missing or empty is a TypeError naming the variable. No error ever quotes a value, so
 * handing over the key where a name or the environment belongs cannot leak it.
 */
export function fromEnv(env: object, names: tEnvNames = {}): tSigningKey {
  if (typeof env !== "object" || (env as unknown) === null) throw new TypeError("fromEnv: expected an environment object such as process.env");
  const found: Record<string, string> = {};
  const missing: string[] = [];
  for (const setting of SETTINGS) {
    const name: unknown = names[setting] ?? DEFAULT_NAMES[setting];
    if (typeof name !== "string" || !/^\w{1,128}$/.test(name)) throw new TypeError(`fromEnv: names.${setting} must be the name of a variable, not its value`);
    const value = (env as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim() !== "") found[setting] = value.trim();
    else missing.push(name);
  }
  const { pem, teamId, keyId } = found;
  if (pem === undefined || teamId === undefined || keyId === undefined)
    throw new TypeError(`fromEnv: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing or empty in the environment`);
  return { pem: redacted(pem), teamId, keyId };
}

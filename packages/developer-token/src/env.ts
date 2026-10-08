/** The key and the two IDs that go with it: what a mint needs besides the token's own settings. */
export type tSetting = "pem" | "teamId" | "keyId";

/** Which environment variable holds what, for an environment that does not use the default names. */
export interface tEnvVariables {
  /** Default `APPLE_MUSIC_PRIVATE_KEY`. */
  readonly pem?: string | undefined;
  /** Default `APPLE_MUSIC_TEAM_ID`. */
  readonly teamId?: string | undefined;
  /** Default `APPLE_MUSIC_KEY_ID`. */
  readonly keyId?: string | undefined;
}

const DEFAULT_VARIABLES = { pem: "APPLE_MUSIC_PRIVATE_KEY", teamId: "APPLE_MUSIC_TEAM_ID", keyId: "APPLE_MUSIC_KEY_ID" } as const;
const SETTINGS = ["pem", "teamId", "keyId"] as const;

/** What a value is, without showing it. */
const got = (value: unknown) => (typeof value === "string" ? `${String(value.length)} characters` : value === null ? "null" : typeof value);

/**
 * Reads the `wanted` settings from an environment: `process.env` once your `.env` file is loaded, a Workers
 * `env`, or any object of strings. Each comes back trimmed, beside the name of the variable it was read from.
 *
 * A variable that is missing or empty is a TypeError naming every such variable at once. No error ever quotes
 * a value, so handing over the key where a name or the environment belongs cannot leak it.
 */
export function readEnv(env: unknown, variables: unknown, wanted: readonly tSetting[]): Partial<Record<tSetting, { readonly value: string; readonly variable: string }>> {
  if (typeof env !== "object" || env === null) throw new TypeError(`developer token: env must be an environment object such as process.env; got ${got(env)}`);
  if (variables !== undefined && (typeof variables !== "object" || variables === null))
    throw new TypeError(`developer token: variables must be an object naming environment variables; got ${got(variables)}`);
  const names = (variables ?? {}) as Record<string, unknown>;
  const read: Partial<Record<tSetting, { value: string; variable: string }>> = {};
  const missing: string[] = [];
  for (const setting of SETTINGS) {
    const variable = names[setting] ?? DEFAULT_VARIABLES[setting];
    if (typeof variable !== "string" || !/^\w{1,128}$/.test(variable)) throw new TypeError(`developer token: variables.${setting} must be the name of a variable, not its value`);
    if (!wanted.includes(setting)) continue;
    const value = (env as Record<string, unknown>)[variable];
    if (typeof value === "string" && value.trim() !== "") read[setting] = { value: value.trim(), variable };
    else missing.push(variable);
  }
  if (missing.length > 0) throw new TypeError(`developer token: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing or empty in env`);
  return read;
}

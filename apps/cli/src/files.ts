// What the CLI keeps between runs, and where it finds the key. The packages read no environment and no file; the
// CLI is the app in that rule, so this is where both are read.
import { createPrivateKey, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { tUserTokenStore } from "@open-music-sdk/server";

/** A failure the person running the CLI can fix, worded for them, with the exit status it ends in: 1, or 2 for a mistake in how it was run. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

/** A mistake in how the CLI was run: exit status 2. */
export const usage = (message: string): CliError => new CliError(message, 2);

/** The environment, as far as the CLI reads it. */
export type tEnv = Readonly<Record<string, string | undefined>>;

/**
 * Where the CLI keeps what it keeps: `%APPDATA%\open-music-sdk` on Windows, and `$XDG_CONFIG_HOME/open-music-sdk`,
 * or `~/.config/open-music-sdk`, elsewhere. A relative `XDG_CONFIG_HOME` is ignored, as the XDG spec says to.
 */
export function configDir(env: tEnv, platform: NodeJS.Platform = process.platform): string {
  const appData = env.APPDATA;
  if (platform === "win32" && appData !== undefined && isAbsolute(appData)) return join(appData, "open-music-sdk");
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".config"), "open-music-sdk");
}

/**
 * Writes `data` where only this user can read it, all at once: to a temporary file beside `path`, then renamed over
 * it, so a reader finds the old file or the new one and never half of either. On Windows the mode is not applied;
 * the profile's own folder is readable by its user alone.
 */
async function writePrivate(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (e) {
    await rm(temporary, { force: true });
    throw e;
  }
}

/** The JSON object in `path`, as an object that inherits nothing, or an empty one when there is no file. */
async function readObject(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null) as Record<string, unknown>;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  // The file's contents are not quoted: this one may hold a token.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new CliError(`${path} is not what the CLI writes; delete it and run the command again`);
  return Object.assign(Object.create(null) as Record<string, unknown>, parsed);
}

/**
 * Keeps each listener's Music User Token in one JSON file that only this user can read: core's `tUserTokenStore`,
 * which is three methods, over a file. Every write replaces the file whole.
 */
export class FileUserTokenStore implements tUserTokenStore {
  readonly #path: string;

  /** @param path - The file. It and its folder are made on the first `set`. */
  constructor(path: string) {
    this.#path = path;
  }

  /**
   * The token kept for a listener.
   *
   * @param userId - The id it was set under.
   * @returns The token, or undefined when none is kept.
   * @throws CliError if the file is not JSON the store wrote, and whatever reading it fails with.
   */
  async get(userId: string): Promise<string | undefined> {
    const token = (await readObject(this.#path))[userId];
    return typeof token === "string" ? token : undefined;
  }

  /**
   * Keeps a token for a listener, in place of any kept before.
   *
   * @param userId - The id to keep it under.
   * @param token - The Music User Token.
   * @throws CliError if the file is not JSON the store wrote, and whatever reading or writing it fails with.
   */
  async set(userId: string, token: string): Promise<void> {
    const tokens = await readObject(this.#path);
    tokens[userId] = token;
    await writePrivate(this.#path, JSON.stringify(tokens));
  }

  /**
   * Forgets a listener's token, if one is kept.
   *
   * @param userId - The id it was set under.
   * @throws CliError if the file is not JSON the store wrote, and whatever reading or writing it fails with.
   */
  async delete(userId: string): Promise<void> {
    const tokens = await readObject(this.#path);
    if (!(userId in tokens)) return;
    // Own properties only, on an object that inherits nothing: `in` and `delete` see nothing else.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete tokens[userId];
    await writePrivate(this.#path, JSON.stringify(tokens));
  }
}

/** What `login` keeps of the key: its path, never its contents, and its two ids. */
export interface tSavedKey {
  readonly keyPath?: string | undefined;
  readonly teamId?: string | undefined;
  readonly keyId?: string | undefined;
}

/** The key the last `login` kept, as far as the file holds strings. */
export async function readSavedKey(path: string): Promise<tSavedKey> {
  const saved = await readObject(path);
  const text = (name: string) => (typeof saved[name] === "string" ? saved[name] : undefined);
  return { keyPath: text("keyPath"), teamId: text("teamId"), keyId: text("keyId") };
}

/** Keeps the key's path and ids for the commands after this one. */
export async function saveKey(path: string, key: tKey): Promise<void> {
  await writePrivate(path, `${JSON.stringify({ keyPath: key.keyPath, teamId: key.teamId, keyId: key.keyId }, null, 2)}\n`);
}

/** The key as the server's client and the minter take it, and the absolute path it was read from. */
export interface tKey {
  readonly pem: string;
  readonly teamId: string;
  readonly keyId: string;
  readonly keyPath: string;
}

/** What was passed on the command line for the key. */
export interface tKeyFlags {
  readonly key?: string | undefined;
  readonly "team-id"?: string | undefined;
  readonly "key-id"?: string | undefined;
}

/** Apple's Team IDs and key IDs are ten capital letters and digits. */
const ID = /^[A-Z0-9]{10}$/;

/**
 * The key, from the flags, else the environment, else what the last `login` kept; the key ID defaults to the one in
 * the file's name, `AuthKey_<key id>.p8`. The file is read and checked to be a P-256 private key, so a wrong file
 * fails here, by its path, and not as a 401 from Apple. Nothing in any error quotes the file.
 *
 * @throws CliError with exit status 2 when something is missing, is not what Apple issues, or cannot be read.
 */
export async function loadKey(flags: tKeyFlags, env: tEnv, saved: tSavedKey): Promise<tKey> {
  // A variable set to nothing is taken as not set, as a shell's `VAR= command` means it.
  const fromEnv = (name: string) => (env[name] === "" ? undefined : env[name]);
  const envPath = fromEnv("APPLE_MUSIC_KEY_PATH");
  const [keyPath, from] = flags.key !== undefined ? [flags.key, "--key"] : envPath !== undefined ? [envPath, "APPLE_MUSIC_KEY_PATH"] : [saved.keyPath, "the last login"];
  if (keyPath === undefined || keyPath === "") throw usage("No key: pass --key with the path to your AuthKey_XXXXXXXXXX.p8, or set APPLE_MUSIC_KEY_PATH.");
  const teamId = flags["team-id"] ?? fromEnv("APPLE_MUSIC_TEAM_ID") ?? saved.teamId;
  if (teamId === undefined || teamId === "") throw usage("No team ID: pass --team-id, or set APPLE_MUSIC_TEAM_ID. It is on your membership page at developer.apple.com/account.");
  if (!ID.test(teamId)) throw usage(`The team ID must be ten capital letters and digits, as Apple issues it; got ${String(teamId.length)} characters.`);
  const named = /^AuthKey_([A-Z0-9]{10})\.p8$/.exec(basename(keyPath))?.[1];
  const keyId = flags["key-id"] ?? fromEnv("APPLE_MUSIC_KEY_ID") ?? named ?? saved.keyId;
  if (keyId === undefined || keyId === "") throw usage("No key ID: pass --key-id, set APPLE_MUSIC_KEY_ID, or keep the file's name as Apple gave it, AuthKey_<key id>.p8.");
  if (!ID.test(keyId)) throw usage(`The key ID must be ten capital letters and digits, as Apple issues it; got ${String(keyId.length)} characters.`);

  const path = resolve(keyPath);
  let pem: string;
  try {
    pem = await readFile(path, "utf8");
  } catch (e) {
    throw usage(`Cannot read the key at ${path}, from ${from}: ${(e as NodeJS.ErrnoException).code ?? "unreadable"}.`);
  }
  if (!isMusicKitKey(pem)) throw usage(`The file at ${path}, from ${from}, is not a MusicKit private key: expected the .p8 file Apple gave you, a P-256 key in PEM.`);
  return { pem, teamId, keyId, keyPath: path };
}

/** Whether `pem` is a P-256 private key, which is what a MusicKit key is. */
function isMusicKitKey(pem: string): boolean {
  try {
    return createPrivateKey(pem).asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

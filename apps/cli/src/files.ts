// What the CLI keeps between runs: the folder it keeps it in, and the store for the token. The packages read no
// environment and no file; the CLI is the app in that rule.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseToken } from "@open-music-sdk/core";
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

/** Text from outside, from Apple, the network or a path, without the control characters a terminal would act on rather than show. */
export const printable = (text: string): string =>
  Array.from(text)
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
    .join("");

/** The environment, as far as the CLI reads it. */
export type tEnv = Readonly<Record<string, string | undefined>>;

/**
 * Where the CLI keeps what it keeps: `%LOCALAPPDATA%\open-music-sdk` on Windows, and `$XDG_CONFIG_HOME/open-music-sdk`,
 * or `~/.config/open-music-sdk`, elsewhere. Not the roaming `%APPDATA%`, which a domain copies to its servers and to
 * the user's other machines: what is kept here includes a token. A relative location is ignored, as the XDG spec says.
 * Paths are read and joined by `platform`'s own rules.
 */
export function configDir(env: tEnv, platform: NodeJS.Platform = process.platform): string {
  const path = platform === "win32" ? win32 : posix;
  const local = env.LOCALAPPDATA;
  if (platform === "win32" && local !== undefined && path.isAbsolute(local)) return path.join(local, "open-music-sdk");
  const xdg = env.XDG_CONFIG_HOME;
  return path.join(xdg !== undefined && path.isAbsolute(xdg) ? xdg : path.join(homedir(), ".config"), "open-music-sdk");
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
    await renameOver(temporary, path);
  } catch (e) {
    await rm(temporary, { force: true });
    throw e;
  }
}

/**
 * `rename`, tried again for a couple of seconds on Windows, which refuses one while another handle has either file
 * open: a second write's, or a virus scanner's looking at the file just written.
 */
async function renameOver(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || attempt === 15 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw e;
      await sleep(attempt * 20);
    }
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
    // Without the byte order mark an editor such as Notepad may put at the start.
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
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
   * @returns The token, without whitespace around it, or undefined when none is kept: what a hand edit left that is
   * no token, as core's `parseToken` says, is none.
   * @throws CliError if the file is not JSON the store wrote, and whatever reading it fails with.
   */
  async get(userId: string): Promise<string | undefined> {
    return parseToken((await readObject(this.#path))[userId]);
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

// The four commands. What a command produces goes to stdout (the token, the doctor's report); everything said to
// the person running it goes to stderr, so a pipe gets the one and the terminal still shows the other.
import { join } from "node:path";
import { styleText } from "node:util";
import { createServerClient, isAppleMusicError, mintDeveloperToken, validateUserToken, type tMusic } from "@open-music-sdk/server";
import { CliError, FileUserTokenStore, configDir, printable, usage, type tEnv } from "./files";
import { VARIABLES, loadKey, type tKey, type tKeyFlags } from "./key";
import { openBrowser, startLoopback } from "./loopback";
import type { tTerminal } from "./terminal";

export const NAME = "open-music-sdk";
/** The CLI keeps one listener's token: the person running it. */
const USER_ID = "default";
const TOKEN_FILE = "user-token.json";
/** How long a question to Apple may take, retries and all. */
const TIMEOUT_MS = 30_000;
/** How long `login` waits for the sign-in. */
const WAIT_MS = 5 * 60_000;

/** What every command is run with: the environment it reads, whether it may print in color, and the terminal it may ask at. */
export interface tContext {
  readonly env: tEnv;
  readonly color: boolean;
  readonly terminal: tTerminal;
}

/** The flags each command takes, as `parseArgs` gives them. */
export interface tFlags extends tKeyFlags {
  readonly port?: string | undefined;
  readonly browser?: boolean | undefined;
  readonly developer?: boolean | undefined;
}

type tFormat = Parameters<typeof styleText>[0];
export const paint = (ctx: tContext, format: tFormat, text: string, stream: NodeJS.WriteStream): string => (ctx.color ? styleText(format, text, { stream }) : text);
const out = (line: string) => process.stdout.write(`${line}\n`);
const say = (line: string) => process.stderr.write(`${line}\n`);

/** The one file the CLI keeps: the token. */
const tokenFile = (env: tEnv) => join(configDir(env), TOKEN_FILE);

/** The system's own code for why a request failed, such as `ENOTFOUND` or a certificate's, from down the error's causes. */
function codeOf(e: unknown): string | undefined {
  for (let cause = (e as { cause?: unknown }).cause; typeof cause === "object" && cause !== null; cause = (cause as { cause?: unknown }).cause) {
    const { code } = cause as { code?: unknown };
    if (typeof code === "string") return printable(code);
  }
  return undefined;
}

/** What went wrong in asking Apple, worded for the person running the CLI; undefined for anything else. */
export function describe(e: unknown): string | undefined {
  if (e instanceof DOMException && e.name === "TimeoutError") return `Apple did not answer within ${String(TIMEOUT_MS / 1000)} seconds. Check your connection and try again.`;
  if (!isAppleMusicError(e)) return undefined;
  switch (e._tag) {
    case "DeveloperTokenInvalid":
      return "Apple refused the developer token (401). Check that the team ID and the key ID are this key's, and that the key has MusicKit enabled and has not been revoked.";
    case "UserTokenInvalid":
      return `Apple refused the Music User Token: it has expired or been revoked, or the account has no Apple Music subscription. Run '${NAME} login' for a new one.`;
    case "RateLimited":
      return "Apple is limiting requests for this key. Wait a minute and try again.";
    case "NetworkError": {
      const code = codeOf(e);
      return `Apple could not be reached: ${printable(e.message)}${code === undefined ? "" : ` (${code})`}`;
    }
    default:
      return `Apple answered${e.status === undefined ? "" : ` ${String(e.status)}`}: ${printable(e.message)}`;
  }
}

const serverClient = (key: tKey, onResponse?: Parameters<typeof createServerClient>[0]["onResponse"]): tMusic =>
  createServerClient({ pem: key.pem, teamId: key.teamId, keyId: key.keyId, onResponse });

/** Asks Apple whether the key works: `GET /v1/test`, which needs the developer token and nothing else. */
const askKey = (music: tMusic, stop?: AbortSignal) =>
  music.request("v1/test", { user: false, signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(stop === undefined ? [] : [stop])]) });

/** The port `--port` names, or 0 for one the system picks. */
function portOf(value: string | undefined): number {
  if (value === undefined) return 0;
  const port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  if (port >= 1 && port <= 65_535) return port;
  throw usage("--port must be a whole number from 1 to 65535.");
}

/** Settles with `stored`, or rejects after `WAIT_MS`, or with the reason `stop` aborted with, now or later. */
async function waitFor(stored: Promise<void>, stop: AbortSignal): Promise<void> {
  stop.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      stored.then(resolve, reject);
      timer = setTimeout(() => {
        reject(new CliError(`No sign-in within ${String(WAIT_MS / 60_000)} minutes. Nothing was kept; run login again when you are ready.`));
      }, WAIT_MS);
      stop.addEventListener(
        "abort",
        () => {
          reject(stop.reason as Error);
        },
        { once: true },
      );
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Signs in through Apple's own sign-in on a page served on localhost, and keeps the token once Apple has accepted
 * it. The key and its IDs are not kept: the next command finds them where this one did.
 */
export async function login(flags: tFlags, ctx: tContext): Promise<number> {
  const port = portOf(flags.port);
  const tokens = tokenFile(ctx.env);
  // Read once before anything is asked, so a token file the store cannot write over is found now, not after Apple's yes.
  const store = new FileUserTokenStore(tokens);
  await store.get(USER_ID);
  const key = await loadKey(flags, ctx.env, ctx.terminal);
  // The intake resolves to nothing; the storefront it was told is read off the answer it got.
  let storefront: string | undefined;
  const music = serverClient(key, (_res, req, { body, error }) => {
    if (error !== undefined || new URL(req.url).pathname !== "/v1/me/storefront") return;
    const id = (body as { data?: readonly ({ id?: unknown } | null)[] } | null | undefined)?.data?.[0]?.id;
    if (typeof id === "string") storefront = id;
  });

  // Ctrl+C, from here to the end, stops what is under way and exits 130 with nothing kept. A second one ends the
  // process as Node does, since the handler is gone after the first.
  const stop = new AbortController();
  const interrupt = () => {
    stop.abort(new CliError("Stopped. Nothing was kept.", 130));
  };
  process.once("SIGINT", interrupt);
  try {
    say(`Asking Apple about key ${key.keyId} of team ${key.teamId}, the key from ${key.from}…`);
    await askKey(music, stop.signal);
    const loopback = await startLoopback({ key, music, store, userId: USER_ID, port, script: new URL("./page.js", import.meta.url), logo: new URL("./open-music-app-logo.svg", import.meta.url), timeoutMs: TIMEOUT_MS });
    try {
      say(`Sign in at Apple on this page:\n\n  ${loopback.url}\n`);
      if (flags.browser !== false) {
        openBrowser(loopback.url);
        say("It should be open in your browser; if not, open the address yourself.");
      }
      say("Waiting for the sign-in. Ctrl+C stops.");
      await waitFor(loopback.stored, stop.signal);
    } finally {
      await loopback.close();
    }
  } finally {
    process.off("SIGINT", interrupt);
  }
  say(`${paint(ctx, "green", "Signed in", process.stderr)}${storefront === undefined ? "" : `, storefront ${printable(storefront)}`}. The token is kept in ${tokens}, readable by you alone.`);
  say(`Next: '${NAME} token' prints it, and '${NAME} doctor' asks Apple whether it still works.`);
  if (key.asked) say(`To be asked nothing next time, set ${VARIABLES.key}, ${VARIABLES.teamId} and ${VARIABLES.keyId}.`);
  return 0;
}

/** Asks Apple whether the key works, and then whether the kept token does, which tells the two causes of a 401 apart. */
export async function doctor(flags: tFlags, ctx: tContext): Promise<number> {
  const key = await loadKey(flags, ctx.env, ctx.terminal);
  const music = serverClient(key);
  const pass = (line: string) => out(`${paint(ctx, "green", "✓", process.stdout)} ${line}`);
  const fail = (line: string) => out(`${paint(ctx, "red", "✗", process.stdout)} ${line}`);

  say(`Asking Apple about key ${key.keyId} of team ${key.teamId}, the key from ${key.from}…`);
  try {
    await askKey(music);
    pass(`Key: Apple takes developer tokens signed with key ${key.keyId} of team ${key.teamId}.`);
  } catch (e) {
    const why = describe(e);
    if (why === undefined) throw e;
    fail(`Key: ${why}`);
    out(`- Music User Token: not asked about, since the key's own question failed.`);
    return 1;
  }

  const token = await new FileUserTokenStore(tokenFile(ctx.env)).get(USER_ID);
  if (token === undefined) {
    fail(`Music User Token: none is kept. Run '${NAME} login' to sign in.`);
    return 1;
  }
  try {
    const storefront = await validateUserToken(music, token, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    pass(`Music User Token: Apple takes it, for storefront ${printable(storefront)}.`);
    return 0;
  } catch (e) {
    const why = describe(e);
    if (why === undefined) throw e;
    fail(`Music User Token: ${why}`);
    return 1;
  }
}

/** Prints the kept token, or with `--developer` mints a developer token and prints that. */
export async function token(flags: tFlags, ctx: tContext): Promise<number> {
  if (flags.developer === true) {
    const key = await loadKey(flags, ctx.env, ctx.terminal);
    out(await mintDeveloperToken({ pem: key.pem, teamId: key.teamId, keyId: key.keyId }));
    return 0;
  }
  if (flags["key-file"] !== undefined || flags["team-id"] !== undefined || flags["key-id"] !== undefined)
    throw usage("--key-file, --team-id and --key-id go with --developer: the Music User Token is printed as login kept it.");
  const kept = await new FileUserTokenStore(tokenFile(ctx.env)).get(USER_ID);
  if (kept === undefined) throw new CliError(`No Music User Token is kept. Run '${NAME} login' to sign in.`);
  out(kept);
  return 0;
}

/** Forgets the kept token. */
export async function logout(_flags: tFlags, ctx: tContext): Promise<number> {
  const tokens = tokenFile(ctx.env);
  const store = new FileUserTokenStore(tokens);
  if ((await store.get(USER_ID)) === undefined) {
    say("No Music User Token is kept; there is nothing to forget.");
    return 0;
  }
  await store.delete(USER_ID);
  say(`Forgot the Music User Token kept in ${tokens}. Copies of it handed to other programs work until Apple ends it.`);
  return 0;
}

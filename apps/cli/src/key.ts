// The key and its two IDs: each from its flag, else its environment variable, else a question at the terminal. The
// packages read no environment and no file; the CLI is the app in that rule, so this is where both are read.
import { createPrivateKey } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { usage, type tEnv } from "./files";
import type { tTerminal } from "./terminal";

/** The variables each value is read from, under names that are fixed: the ones the family's READMEs use. */
export const VARIABLES = { key: "APPLE_MUSIC_PRIVATE_KEY", teamId: "APPLE_MUSIC_TEAM_ID", keyId: "APPLE_MUSIC_KEY_ID" } as const;

/** What was passed on the command line for the key. */
export interface tKeyFlags {
  /** A file to read the key from, or `-` for stdin. */
  readonly "key-file"?: string | undefined;
  readonly "team-id"?: string | undefined;
  readonly "key-id"?: string | undefined;
  /** False with `--no-input`: nothing is asked. */
  readonly input?: boolean | undefined;
}

/** The key as the server's client and the minter take it. */
export interface tKey {
  /** The key as PKCS8 PEM. */
  readonly pem: string;
  readonly teamId: string;
  readonly keyId: string;
  /** Where the key came from, to name in what is printed: never what it holds. */
  readonly from: string;
  /** Whether anything was asked for at the terminal. */
  readonly asked: boolean;
}

/** Apple's Team IDs and key IDs are ten capital letters and digits. */
const ID = /^[A-Z0-9]{10}$/;
/** A `.p8` is about 250 bytes; nothing near this is one. */
const MAX_KEY = 16 * 1024;
/** A line break escaped as `\n`, as a variable often holds a PEM on one line. */
const ESCAPED_BREAK = `${String.fromCharCode(92)}n`;

/** One value and the flag, variable or file name it came from, as a message names it. */
interface tGiven {
  readonly value: string;
  readonly from: string;
}

/**
 * The key and its two IDs. Each is taken from its flag, else its variable, else asked for, so a project that keeps
 * them in the environment, as the family's READMEs show, passes no flags at all:
 *
 * - the key from `--key-file <path>`, or `--key-file -` for stdin, else `APPLE_MUSIC_PRIVATE_KEY`, which holds the
 *   key itself, else pasted with nothing shown. A file is read only when the flag names it.
 * - the team ID from `--team-id`, else `APPLE_MUSIC_TEAM_ID`, else typed.
 * - the key ID from `--key-id`, else the ID in the name of a `--key-file` called `AuthKey_<key id>.p8`, else
 *   `APPLE_MUSIC_KEY_ID`, else typed.
 *
 * Questions are asked only at an interactive terminal, without `--no-input`, and when stdin is not carrying the key.
 * The key is checked to be a P-256 private key, so a wrong one fails here and not as a 401 from Apple. No message
 * repeats a value that came in, from any source.
 *
 * @throws CliError with exit status 2 when something is missing and cannot be asked for, or is not what Apple
 *   issues; with exit status 130 on Ctrl+C at a question.
 */
export async function loadKey(flags: tKeyFlags, env: tEnv, term: tTerminal): Promise<tKey> {
  // A variable set to nothing is taken as not set, as a shell's `VAR= command` means it.
  const variable = (name: string): tGiven | undefined => (env[name] === undefined || env[name] === "" ? undefined : { value: env[name], from: name });
  const file = flags["key-file"];
  const piped = file === "-";
  if (piped && term.stdinIsTerminal) throw usage("--key-file - reads the key from a pipe, and stdin is this terminal: pipe the key in, or leave --key-file out to be asked for it with nothing shown.");

  const key = piped ? await fromPipe(term) : file !== undefined ? await fromFile(file) : fromVariable(variable(VARIABLES.key));
  const named = file !== undefined && !piped ? /^AuthKey_([A-Z0-9]{10})\.p8$/.exec(basename(file))?.[1] : undefined;
  let teamId = idOf("team ID", flags["team-id"] === undefined ? variable(VARIABLES.teamId) : { value: flags["team-id"], from: "--team-id" });
  let keyId = idOf(
    "key ID",
    flags["key-id"] !== undefined ? { value: flags["key-id"], from: "--key-id" } : named !== undefined ? { value: named, from: "the key file's name" } : variable(VARIABLES.keyId),
  );
  let pem = key === undefined ? undefined : musicKitKey(key.value);
  if (key !== undefined && pem === undefined) throw usage(`${notAKey(key.from)}: expected the contents of the .p8 Apple gave you, a P-256 private key in PEM.`);

  if (key !== undefined && pem !== undefined && teamId !== undefined && keyId !== undefined) return { pem, teamId, keyId, from: key.from, asked: false };
  const missing = [teamId === undefined && "team ID", keyId === undefined && "key ID", pem === undefined && "key"].filter((what) => what !== false);

  if (flags.input === false || !term.interactive || piped) {
    const why = flags.input === false ? "--no-input was given" : piped ? "stdin carries the key" : "this is no interactive terminal";
    throw usage([...missing.map((what) => MISSING[what]), `Nothing is asked, since ${why}.`].join("\n"));
  }
  term.tell(`Asking for what the flags and the environment leave out: ${missing.join(", ")}. --no-input turns questions off.`);
  teamId ??= await askId(term, "Team ID, ten characters from developer.apple.com/account: ", "team ID");
  keyId ??= await askId(term, "Key ID, the ten characters in AuthKey_<key id>.p8: ", "key ID");
  pem ??= await askKey(term);
  return { pem, teamId, keyId, from: key?.from ?? "pasted", asked: true };
}

/** What to say for each value that is missing, naming its flag and its variable. */
const MISSING: Readonly<Record<string, string>> = {
  "team ID": `No team ID: pass --team-id or set ${VARIABLES.teamId}. It is on your membership page at developer.apple.com/account.`,
  "key ID": `No key ID: pass --key-id or set ${VARIABLES.keyId}. It is the ten characters in the name of the AuthKey_<key id>.p8 Apple gave you.`,
  key: `No key: set ${VARIABLES.key} to the contents of your AuthKey_XXXXXXXXXX.p8, or pass --key-file <path>.`,
};

/** The ID given, checked; undefined when none was. A wrong one that came from a flag, a variable or a name is a mistake to fix there, not asked for again. */
function idOf(what: string, given: tGiven | undefined): string | undefined {
  if (given === undefined) return undefined;
  if (ID.test(given.value)) return given.value;
  throw usage(`The ${what} from ${given.from} must be ten capital letters and digits, as Apple issues it; got ${String(given.value.length)} characters.`);
}

/** The key in `APPLE_MUSIC_PRIVATE_KEY`, or undefined when it is not set. A path put there is refused with what to do instead. */
function fromVariable(given: tGiven | undefined): tGiven | undefined {
  if (given === undefined) return undefined;
  const value = given.value.trim();
  if (!value.includes("-----") && (/\.(p8|pem)$/i.test(value) || existsSync(value)))
    throw usage(`${VARIABLES.key} holds what looks like a path to a file, not the key itself: set it to the key's contents, or pass the path with --key-file <path>.`);
  return given;
}

/** The key piped to `--key-file -`. */
async function fromPipe(term: tTerminal): Promise<tGiven> {
  const value = await term.pipe(MAX_KEY);
  if (value === undefined) throw usage(`What was piped to --key-file - is over ${String(MAX_KEY / 1024)} KB, which no MusicKit key is: pipe in the .p8 alone.`);
  return { value, from: "stdin, by --key-file -" };
}

/** The key in the file `--key-file` names. */
async function fromFile(file: string): Promise<tGiven> {
  const path = resolve(file);
  try {
    // Once read, the path is known to be one, and can be named.
    return { value: await readFile(path, "utf8"), from: `--key-file ${path}` };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unreadable";
    if (isShowable(file, path)) throw usage(`Cannot read the key at ${path}, from --key-file: ${code}.`);
    throw usage(`Cannot read a key file at what --key-file holds, ${String(file.length)} characters not repeated here in case they are the key itself or a token: pass the path to your AuthKey_XXXXXXXXXX.p8, not its contents.`);
  }
}

/** The start of the message for a key that is not one, by where it came from. */
function notAKey(from: string): string {
  if (from === VARIABLES.key) return `${VARIABLES.key} does not hold a MusicKit private key`;
  if (from.startsWith("stdin")) return "What was piped to --key-file - is not a MusicKit private key";
  return `The file at ${from.slice("--key-file ".length)} is not a MusicKit private key`;
}

/** Asks for an ID until one is given that is ten capital letters and digits. */
async function askId(term: tTerminal, question: string, what: string): Promise<string> {
  for (;;) {
    const answer = await term.line(question);
    if (answer === undefined) throw usage(`No ${what} was given.`);
    const id = answer.trim();
    if (ID.test(id)) return id;
    term.tell(`That is ${String(id.length)} characters; a ${what} is ten capital letters and digits. Try again, or press Ctrl+C to stop.`);
  }
}

/** Asks for the key until one is given that is a P-256 private key. */
async function askKey(term: tTerminal): Promise<string> {
  for (;;) {
    const answer = await term.secret("Private key, the whole .p8 from BEGIN to END (not shown): ", MAX_KEY);
    if (answer === undefined) {
      term.tell(`That was over ${String(MAX_KEY / 1024)} KB, which no MusicKit key is. Paste the .p8 alone.`);
      continue;
    }
    if (answer.trim() === "") throw usage("No key was given.");
    const pem = musicKitKey(answer);
    if (pem !== undefined) {
      term.tell("Got a P-256 private key.");
      return pem;
    }
    term.tell("That is not a MusicKit private key: paste the whole .p8 Apple gave you, from its BEGIN line to its END line. Try again, or press Ctrl+C to stop.");
  }
}

/**
 * Whether a path that could not be read may be repeated in an error. What was passed may be the key's contents or a
 * token put where the path goes, so it is shown only when it looks like a path: no line break and no PEM armour, a
 * file name of a usual length with an extension, which base64 has no character for, in a folder that exists. A key,
 * a line of one, or a token fails at least one.
 */
function isShowable(given: string, path: string): boolean {
  return !/[\r\n]/.test(given) && !given.includes("-----") && /^.{1,56}\.\w{1,8}$/.test(basename(path)) && existsSync(dirname(path));
}

/**
 * The key as PKCS8 PEM, the form Apple gives and the minter takes, when `text` is a P-256 private key, which is what
 * a MusicKit key is: in that form or another, such as the SEC1 `EC PRIVATE KEY` a conversion leaves, with its line
 * breaks escaped as `\n` as a variable often holds it, with Windows line endings, or after a byte order mark.
 * Otherwise undefined.
 */
function musicKitKey(text: string): string | undefined {
  const pem = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replaceAll(ESCAPED_BREAK, "\n").trim();
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyDetails?.namedCurve === "prime256v1" ? key.export({ type: "pkcs8", format: "pem" }).toString() : undefined;
  } catch {
    return undefined;
  }
}

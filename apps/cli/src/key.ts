// The key and its two IDs: each from its flag, else its environment variable, else a question at the terminal. The
// packages read no environment and no file; the CLI is the app in that rule, so this is where both are read.
import { createPrivateKey } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { printable, usage, type tEnv } from "./files";
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

/** One value, where it came from as a message names it, and, for a key, how a message says it is none. */
interface tGiven {
  readonly value: string;
  readonly from: string;
}
interface tGivenKey extends tGiven {
  readonly notAKey: string;
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
 * Everything that needs no reading is settled first, so a wrong ID, or a value that is missing and cannot be asked
 * for, is found before a file or a pipe is read. Questions are asked only at an interactive terminal, without
 * `--no-input`, and when stdin is not carrying the key; the key is asked for first, so a key on the clipboard is
 * pasted where nothing is shown. The key is checked to be a P-256 private key, so a wrong one fails here and not as
 * a 401 from Apple. No message repeats the key, a token, or anything that came in that might be one.
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

  // The IDs and where the key is to come from, none of which needs anything read.
  let teamId = idOf("team ID", flags["team-id"] === undefined ? variable(VARIABLES.teamId) : { value: flags["team-id"], from: "--team-id" });
  // The name's ID needs no check: the pattern it is read with is the check.
  const named = file !== undefined && !piped ? /^AuthKey_([A-Z0-9]{10})\.p8$/.exec(basename(file))?.[1] : undefined;
  let keyId = flags["key-id"] !== undefined ? idOf("key ID", { value: flags["key-id"], from: "--key-id" }) : (named ?? idOf("key ID", variable(VARIABLES.keyId)));
  const inVariable = file === undefined ? keyInVariable(variable(VARIABLES.key)) : undefined;
  const missing = [file === undefined && inVariable === undefined && "key", teamId === undefined && "team ID", keyId === undefined && "key ID"].filter((what) => what !== false);
  if (missing.length > 0 && (flags.input === false || !term.interactive || piped)) {
    const why = flags.input === false ? "--no-input was given" : piped ? "stdin carries the key" : "this is no interactive terminal";
    throw usage([...missing.map((what) => MISSING[what]), `Nothing is asked, since ${why}.`].join("\n"));
  }

  // Now the key, from wherever it is.
  const key = piped ? await fromPipe(term) : file !== undefined ? await fromFile(file) : inVariable;
  let pem = key === undefined ? undefined : musicKitKey(key.value);
  if (key !== undefined && pem === undefined) throw usage(`${key.notAKey}: expected the contents of the .p8 Apple gave you, a P-256 private key in PEM.`);
  if (key !== undefined && pem !== undefined && teamId !== undefined && keyId !== undefined) return { pem, teamId, keyId, from: key.from, asked: false };

  term.tell(`Asking for what the flags and the environment leave out: ${missing.join(", ")}. --no-input turns questions off.`);
  pem ??= await askKey(term);
  teamId ??= await askId(term, "Team ID, ten characters from developer.apple.com/account: ", "team ID");
  keyId ??= await askId(term, "Key ID, the ten characters in AuthKey_<key id>.p8: ", "key ID");
  return { pem, teamId, keyId, from: key?.from ?? "what was pasted", asked: true };
}

/** What to say for each value that is missing, naming its flag and its variable. */
const MISSING: Readonly<Record<string, string>> = {
  key: `No key: set ${VARIABLES.key} to the contents of your AuthKey_XXXXXXXXXX.p8, or pass --key-file <path>.`,
  "team ID": `No team ID: pass --team-id or set ${VARIABLES.teamId}. It is on your membership page at developer.apple.com/account.`,
  "key ID": `No key ID: pass --key-id or set ${VARIABLES.keyId}. It is the ten characters in the name of the AuthKey_<key id>.p8 Apple gave you.`,
};

/** What is wrong with an ID that is not one, said without repeating it. */
function whatIsWrong(value: string): string {
  if (value === "") return "nothing was given";
  if (/^[A-Za-z0-9]+$/.test(value) && /[a-z]/.test(value)) return "it has lower-case letters";
  if (/[^A-Z0-9]/.test(value)) return "it has characters other than A to Z and 0 to 9";
  return `it is ${String(value.length)} characters`;
}

/** The ID given, checked; undefined when none was. A wrong one is a mistake to fix where it came from, not asked for again. */
function idOf(what: string, given: tGiven | undefined): string | undefined {
  if (given === undefined) return undefined;
  if (ID.test(given.value)) return given.value;
  throw usage(`The ${what} from ${given.from} is not one: ${whatIsWrong(given.value)}. A ${what} is ten capital letters and digits, as Apple issues it.`);
}

/** The key in `APPLE_MUSIC_PRIVATE_KEY`, or undefined when it is not set. A path put there is refused with what to do instead. */
function keyInVariable(given: tGiven | undefined): tGivenKey | undefined {
  if (given === undefined) return undefined;
  const value = given.value.trim();
  if (!value.includes("-----") && (/\.(p8|pem)$/i.test(value) || existsSync(value)))
    throw usage(`${VARIABLES.key} holds what looks like a path to a file, not the key itself: set it to the key's contents, or pass the path with --key-file <path>.`);
  return { ...given, notAKey: `${VARIABLES.key} does not hold a MusicKit private key` };
}

/** The key piped to `--key-file -`. */
async function fromPipe(term: tTerminal): Promise<tGivenKey> {
  const value = await term.pipe(MAX_KEY);
  if (value === undefined) throw usage(`What was piped to --key-file - is over ${String(MAX_KEY / 1024)} KB, which no MusicKit key is: pipe in the .p8 alone.`);
  return { value, from: "stdin, by --key-file -", notAKey: "What was piped to --key-file - is not a MusicKit private key" };
}

/**
 * The key in the file `--key-file` names, which must be a file, and no larger than any key: not a folder, a device,
 * a pipe or the terminal, which would hang, read without end, or show what is typed.
 */
async function fromFile(file: string): Promise<tGivenKey> {
  const path = resolve(file);
  const failed = (e: unknown) => {
    const code = (e as NodeJS.ErrnoException).code ?? "unreadable";
    if (isShowable(file, path)) return usage(`Cannot read the key at ${printable(path)}, from --key-file: ${code}.`);
    return usage(`Cannot read a key file at what --key-file holds (${code}), ${String(file.length)} characters not repeated here in case they are the key itself or a token: pass the path to your AuthKey_XXXXXXXXXX.p8, not its contents.`);
  };
  const info = await stat(path).catch((e: unknown) => {
    throw failed(e);
  });
  // It is there, so it is a path, and can be named.
  const shown = printable(path);
  if (!info.isFile()) throw usage(`${shown}, from --key-file, is ${info.isDirectory() ? "a folder" : "no file"}: pass the path to your AuthKey_XXXXXXXXXX.p8.`);
  if (info.size > MAX_KEY) throw usage(`The file at ${shown}, from --key-file, is over ${String(MAX_KEY / 1024)} KB, which no MusicKit key is.`);
  const value = await readFile(path, "utf8").catch((e: unknown) => {
    throw failed(e);
  });
  return { value, from: `--key-file ${shown}`, notAKey: `The file at ${shown}, from --key-file, is not a MusicKit private key` };
}

/** Asks for the key until one is given that is a P-256 private key. */
async function askKey(term: tTerminal): Promise<string> {
  for (;;) {
    const answer = await term.secret("Private key, the whole .p8 from BEGIN to END, not shown (Ctrl+D ends it early): ", MAX_KEY);
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

/** Asks for an ID until one is given that is ten capital letters and digits. */
async function askId(term: tTerminal, question: string, what: string): Promise<string> {
  for (;;) {
    const answer = await term.id(question);
    if (answer === undefined) throw usage(`No ${what} was given.`);
    const id = answer.trim();
    if (ID.test(id)) return id;
    term.tell(`That is not a ${what}: ${whatIsWrong(id)}. A ${what} is ten capital letters and digits. Try again, or press Ctrl+C to stop.`);
  }
}

/**
 * Whether a path that could not be read may be repeated in an error. What was passed may be the key's contents or a
 * token put where the path goes, so it is shown only when it looks like a path: no line break and no PEM armour, no
 * longer than a path usually is, not shaped like a JWT, and ending in a file name with an extension, which base64
 * has no character for. A key, a line of one, or a token fails at least one.
 */
function isShowable(given: string, path: string): boolean {
  return !/[\r\n]/.test(given) && !given.includes("-----") && given.length <= 260 && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(given) && /^.{1,56}\.\w{1,8}$/.test(basename(path));
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

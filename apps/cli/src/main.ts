// The command line: which command, which flags, the help, and what an error becomes. `main` resolves to the exit
// status: 0 done, 1 failed, 2 not run as it should be, 130 stopped with Ctrl+C.
import { parseArgs } from "node:util";
import manifest from "../package.json" with { type: "json" };
import { CHECKS, check } from "./check";
import { NAME, describe, doctor, login, logout, paint, token, type tContext, type tFlags } from "./commands";
import { CliError, configDir, usage, type tEnv } from "./files";
import { VARIABLES } from "./key";
import { terminal } from "./terminal";

const DOCS = "https://github.com/open-music-sdk/js/tree/main/apps/cli#readme";
const ISSUES = "https://github.com/open-music-sdk/js/issues";

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  color: { type: "boolean" },
  "key-file": { type: "string" },
  "team-id": { type: "string" },
  "key-id": { type: "string" },
  input: { type: "boolean" },
  port: { type: "string", short: "p" },
  browser: { type: "boolean" },
  developer: { type: "boolean" },
  write: { type: "boolean" },
} as const;

/** The environment variables the CLI reads: the key's three, and where its folder goes. */
const READ = [VARIABLES.key, VARIABLES.teamId, VARIABLES.keyId, "LOCALAPPDATA", "XDG_CONFIG_HOME"];

/** Options every command takes. */
const GLOBAL = ["help", "version", "color", "input"];
/** The flags that are given as `--no-`, and only so. */
const NEGATABLE = ["color", "browser", "input"];
/** The options of every command that needs the key. */
const KEY_OPTIONS = ["key-file", "team-id", "key-id"];

const KEY_HELP = [
  "      --key-file <path>  Read the key from this file, or from stdin with -",
  "      --team-id <id>     Your Apple Developer Team ID",
  "      --key-id <id>      The key's ID",
  "      --no-input         Ask nothing: fail when something is missing",
];
/** Where the key and its IDs come from, for the help of every command that needs them. */
const KEY_SOURCES = [
  "  Each comes from its flag, else its environment variable, else a question when the terminal is interactive:",
  "  the key first, then the team ID, then the key ID.",
  `    Key       --key-file <path>   ${VARIABLES.key}   asked for, not shown`,
  `    Team ID   --team-id <id>      ${VARIABLES.teamId}       asked for`,
  `    Key ID    --key-id <id>       ${VARIABLES.keyId}        asked for`,
  `  The key ID in the name of a --key-file called AuthKey_<key id>.p8 comes before ${VARIABLES.keyId}.`,
  `  ${VARIABLES.key} holds the key itself, the contents of the .p8. A key file is read only when --key-file names`,
  "  it, and nothing given or typed is kept.",
];

interface tCommand {
  readonly summary: string;
  readonly usage: string;
  readonly about: readonly string[];
  readonly options: readonly string[];
  readonly optionHelp: readonly string[];
  readonly examples: readonly string[];
  /** Whether it takes arguments after its name, as `check` takes the names of checks. */
  readonly takesArguments?: boolean;
  readonly run: (flags: tFlags, ctx: tContext, args: readonly string[]) => Promise<number>;
}

const CHECK_WIDTH = Math.max(...CHECKS.map((each) => each.id.length)) + 2;

const COMMANDS: Readonly<Record<string, tCommand>> = {
  login: {
    summary: "Sign in at Apple in your browser, and keep the Music User Token",
    usage: "login [--key-file <path>] [--team-id <id>] [--key-id <id>] [--no-input] [--port <n>] [--no-browser]",
    about: [
      "Asks Apple whether the key works, then serves a page on http://localhost that runs Apple's own sign-in,",
      "and opens it in your browser. Once Apple accepts the token, it is kept in a file only you can read.",
      "Waits five minutes; Ctrl+C stops it.",
    ],
    options: [...KEY_OPTIONS, "port", "browser"],
    optionHelp: [...KEY_HELP, "  -p, --port <n>         The port to listen on; default: one the system picks", "      --no-browser       Print the page's address without opening a browser"],
    examples: [
      `${NAME} login                                    with the key and its IDs in the environment`,
      `${NAME} login --key-file ./AuthKey_ABC123DEFG.p8 --team-id DEF123GHIJ`,
      `op read "op://Dev/MusicKit/AuthKey.p8" | ${NAME} login --key-file - --team-id DEF123GHIJ --key-id ABC123DEFG`,
    ],
    run: login,
  },
  token: {
    summary: "Print the kept Music User Token, or mint a developer token",
    usage: "token [--developer [--key-file <path>] [--team-id <id>] [--key-id <id>] [--no-input]]",
    about: ["Prints the Music User Token login kept, and nothing else, for another program to read.", "With --developer, mints a developer token from the key instead, which lives an hour."],
    options: ["developer", ...KEY_OPTIONS],
    optionHelp: ["      --developer        Mint and print a developer token instead", ...KEY_HELP],
    // In a variable, not an argument: a program's arguments are there for every user of the machine to read.
    examples: [`APPLE_MUSIC_USER_TOKEN=$(${NAME} token) node job.js`, `APPLE_MUSIC_DEVELOPER_TOKEN=$(${NAME} token --developer) node job.js`],
    run: token,
  },
  doctor: {
    summary: "Ask Apple whether the key and the kept token work",
    usage: "doctor [--key-file <path>] [--team-id <id>] [--key-id <id>] [--no-input]",
    about: [
      "Asks Apple whether the key works, with GET /v1/test, and then whether the kept Music User Token does, with",
      "GET /v1/me/storefront: a 401 can be either, and this tells them apart. Prints nothing secret, and exits 1",
      "when either fails.",
    ],
    options: KEY_OPTIONS,
    optionHelp: KEY_HELP,
    examples: [`${NAME} doctor`],
    run: doctor,
  },
  check: {
    summary: "Ask the live API what the SDK takes on trust, and print what Apple did",
    usage: "check [<check>...] [--write] [--key-file <path>] [--team-id <id>] [--key-id <id>] [--no-input]",
    about: [
      "Asks Apple, as the kept Music User Token's listener, what the SDK's packages take on trust, through their own",
      "functions, after doctor's two questions. Named checks are asked alone; with none named, every one that reads.",
      "Each line is marked ✓ where Apple does what the SDK assumes, ≠ where it does not, · for what Apple did, - for a",
      "question not asked, as when this account cannot be asked it, and ✗ where Apple failed. Exits 1 for a ≠ or a ✗.",
      "What it prints on stdout is the report, for an issue as it is, in a code block; stderr is for you.",
      "",
      "The checks marked --write run only with it. What they add stays: Apple's API has no way to take a playlist or",
      "anything else out of the library, and check does not take its favorite back. They add up to four things to your",
      "library, an album's songs with it, make one song a favorite, and make a playlist of up to 300 songs, which may",
      "put those songs in your library too. Each is something you did not have, and the run ends with the steps that",
      "remove it in the Music app, on stderr.",
      "",
      ...CHECKS.map((each) => `  ${each.id.padEnd(CHECK_WIDTH)}${each.about}${each.writes ? " (--write)" : ""}`),
    ],
    options: [...KEY_OPTIONS, "write"],
    optionHelp: [...KEY_HELP, "      --write            Run the checks that write to your library too"],
    examples: [`${NAME} check`, `${NAME} check isrc-next rating-unset`, `${NAME} check --write`, `${NAME} check playlist --write`],
    takesArguments: true,
    run: check,
  },
  logout: {
    summary: "Forget the kept Music User Token",
    usage: "logout",
    about: ["Deletes the token login kept. Apple is not told: copies handed to other programs work until Apple ends the token."],
    options: [],
    optionHelp: [],
    examples: [`${NAME} logout`],
    run: logout,
  },
};

const heading = (ctx: tContext, text: string) => paint(ctx, "bold", text, process.stdout);

function topHelp(ctx: tContext): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length)) + 3;
  return [
    `${NAME} ${manifest.version}`,
    manifest.description,
    "",
    heading(ctx, "USAGE"),
    `  ${NAME} <command> [options]`,
    "",
    heading(ctx, "COMMANDS"),
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}${command.summary}`),
    `  ${"help".padEnd(width)}Show the help for a command`,
    "",
    heading(ctx, "EXAMPLES"),
    `  ${NAME} login                 with ${VARIABLES.key}, ${VARIABLES.teamId} and ${VARIABLES.keyId} set`,
    `  ${NAME} doctor`,
    `  APPLE_MUSIC_USER_TOKEN=$(${NAME} token) node job.js`,
    "",
    heading(ctx, "THE KEY AND ITS IDS"),
    ...KEY_SOURCES,
    "",
    heading(ctx, "OPTIONS"),
    "  -h, --help        Show this help, or after a command, that command's",
    "      --version     Print the version",
    "      --no-color    Print without color; so does NO_COLOR",
    "      --no-input    Ask nothing: fail when something is missing",
    "",
    heading(ctx, "FILES"),
    `  ${configDir(ctx.env)}`,
    "",
    heading(ctx, "EXIT STATUS"),
    "  0 done · 1 failed · 2 not run as it should be · 130 stopped with Ctrl+C",
    "",
    `Run '${NAME} help <command>' for a command's options.`,
    `Docs: ${DOCS}`,
    `Issues: ${ISSUES}`,
  ].join("\n");
}

function commandHelp(ctx: tContext, command: tCommand): string {
  return [
    `${command.summary}.`,
    "",
    heading(ctx, "USAGE"),
    `  ${NAME} ${command.usage}`,
    "",
    ...command.about,
    "",
    heading(ctx, "OPTIONS"),
    ...command.optionHelp,
    "  -h, --help             Show this help",
    "",
    ...(command.options.includes("key-file") ? [heading(ctx, "THE KEY AND ITS IDS"), ...KEY_SOURCES, ""] : []),
    heading(ctx, "EXAMPLES"),
    ...command.examples.map((example) => `  ${example}`),
    "",
    `Docs: ${DOCS}`,
  ].join("\n");
}

/** A word the person typed, repeated in an error only when it looks like a command or a flag: what was typed may be a token pasted in the wrong place. */
const quoted = (word: string) => (/^-{0,2}[a-z][\w-]{0,23}$/i.test(word) ? ` '${word}'` : "");

/** What an error becomes: a line for the person at the terminal, and the exit status. */
function report(e: unknown, ctx: tContext, command: string | undefined): number {
  const error = paint(ctx, "red", "Error:", process.stderr);
  if (e instanceof CliError) {
    process.stderr.write(`${error} ${e.message}\n`);
    if (e.exitCode === 2) process.stderr.write(`Run '${NAME}${command === undefined ? "" : ` ${command}`} --help' for how to run it.\n`);
    return e.exitCode;
  }
  const apple = describe(e);
  if (apple !== undefined) {
    process.stderr.write(`${error} ${apple}\n`);
    return 1;
  }
  // The system's own refusals, such as a file that cannot be written, name what they refused.
  if (e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string" && (e as NodeJS.ErrnoException).syscall !== undefined) {
    process.stderr.write(`${error} ${e.message}\n`);
    return 1;
  }
  process.stderr.write(`${error} something went wrong that the CLI did not expect.\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.stderr.write(`This is a bug. Please report it, with the output above, at ${ISSUES}\n`);
  return 1;
}

/** Prints the help for `topic`, a command, or the CLI's own for none or for `help`. */
function help(ctx: tContext, topic: string | undefined): number {
  if (topic === undefined || topic === "help") {
    process.stdout.write(`${topHelp(ctx)}\n`);
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, topic) ? COMMANDS[topic] : undefined;
  if (command === undefined) throw usage(`There is no command${quoted(topic)} to show help for. The commands are ${Object.keys(COMMANDS).join(", ")}.`);
  process.stdout.write(`${commandHelp(ctx, command)}\n`);
  return 0;
}

/** The arguments as `parseArgs` reads them; what it refuses is a mistake in how the CLI was run. */
function parse(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, allowNegative: true, strict: true });
  } catch (e) {
    const unknown = /^Unknown option '([^']*)'/.exec((e as Error).message)?.[1];
    throw usage(unknown === undefined ? (e as Error).message : `There is no option${quoted(unknown)}.`);
  }
}

/**
 * Runs the CLI on `argv`, the arguments after the program's name, and resolves to the exit status.
 *
 * @param argv - The arguments, such as `["login", "--no-browser"]`.
 */
export async function main(argv: readonly string[]): Promise<number> {
  // What the CLI reads of the environment, read through process.env, which on Windows finds a name however it is
  // cased. Then the key is taken out of the process's, so no program the CLI starts, the browser above all, is handed
  // it. What started the CLI, a shell or npx, had it already.
  const env: tEnv = Object.fromEntries(READ.map((name) => [name, process.env[name]]));
  Reflect.deleteProperty(process.env, VARIABLES.key);
  const term = terminal(process.stdin, process.stderr);
  let ctx: tContext = { env, color: !argv.includes("--no-color"), terminal: term };
  // Known before the flags are read, so that a flag it refuses still points at the command's own help.
  let name = argv[0] !== undefined && Object.hasOwn(COMMANDS, argv[0]) ? argv[0] : undefined;
  try {
    let parsed;
    try {
      parsed = parse(argv);
    } catch (e) {
      // -h and --help show the help whatever else was passed, a flag that is not there included.
      if (argv.includes("-h") || argv.includes("--help")) return help(ctx, name);
      throw e;
    }
    const { values, positionals } = parsed;
    ctx = { env, color: values.color !== false, terminal: term };
    const [first, ...rest] = positionals;
    name = first;

    // parseArgs takes a `--no-` of every flag and the plain form of every `--no-` one; only these are options.
    for (const [option, value] of Object.entries(values)) {
      if (typeof value === "boolean" && !value !== NEGATABLE.includes(option)) throw usage(`There is no option${quoted(value ? `--${option}` : `--no-${option}`)}.`);
    }
    if (values.version === true) {
      process.stdout.write(`${manifest.version}\n`);
      return 0;
    }
    if (first === undefined) return help(ctx, undefined);
    if (first === "help") return help(ctx, rest[0]);
    if (values.help === true) return help(ctx, first);

    const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
    if (command === undefined) {
      name = undefined;
      throw usage(`There is no command${quoted(first)}. The commands are ${Object.keys(COMMANDS).join(", ")}.`);
    }
    if (rest.length > 0 && command.takesArguments !== true) throw usage(`${first} takes no arguments, only options.`);
    for (const [option, value] of Object.entries(values)) {
      if (!GLOBAL.includes(option) && !command.options.includes(option)) throw usage(`${value === false ? `--no-${option}` : `--${option}`} is not an option of ${first}.`);
    }
    return await command.run(values, ctx, rest);
  } catch (e) {
    return report(e, ctx, name);
  }
}

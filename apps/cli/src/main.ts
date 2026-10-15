// The command line: which command, which flags, the help, and what an error becomes. `main` resolves to the exit
// status: 0 done, 1 failed, 2 not run as it should be, 130 stopped with Ctrl+C.
import { parseArgs } from "node:util";
import manifest from "../package.json" with { type: "json" };
import { NAME, describe, doctor, login, logout, paint, token, type tContext, type tFlags } from "./commands";
import { CliError, configDir, usage } from "./files";

const DOCS = "https://github.com/open-music-sdk/js/tree/main/apps/cli#readme";
const ISSUES = "https://github.com/open-music-sdk/js/issues";

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  color: { type: "boolean" },
  key: { type: "string" },
  "team-id": { type: "string" },
  "key-id": { type: "string" },
  port: { type: "string", short: "p" },
  browser: { type: "boolean" },
  developer: { type: "boolean" },
} as const;

/** Options every command takes. */
const GLOBAL = ["help", "version", "color"];

const KEY_HELP = [
  "      --key <path>    Your MusicKit private key, AuthKey_XXXXXXXXXX.p8",
  "      --team-id <id>  Your Apple Developer Team ID",
  "      --key-id <id>   The key's ID; default: the one in the key file's name",
];
const KEY_ABOUT = "The key and its IDs come from the flags, else from APPLE_MUSIC_KEY_PATH, APPLE_MUSIC_TEAM_ID and\nAPPLE_MUSIC_KEY_ID, else from what the last login kept.";

interface tCommand {
  readonly summary: string;
  readonly usage: string;
  readonly about: readonly string[];
  readonly options: readonly string[];
  readonly optionHelp: readonly string[];
  readonly examples: readonly string[];
  readonly run: (flags: tFlags, ctx: tContext) => Promise<number>;
}

const COMMANDS: Readonly<Record<string, tCommand>> = {
  login: {
    summary: "Sign in at Apple in your browser, and keep the Music User Token",
    usage: "login [--key <path>] [--team-id <id>] [--key-id <id>] [--port <n>] [--no-browser]",
    about: [
      "Asks Apple whether the key works, then serves a page on http://localhost that runs Apple's own sign-in,",
      "and opens it in your browser. Once Apple accepts the token, it is kept in a file only you can read,",
      "with the key's path and IDs, so the commands after it need no flags. Waits five minutes; Ctrl+C stops it.",
      KEY_ABOUT,
    ],
    options: ["key", "team-id", "key-id", "port", "browser"],
    optionHelp: [...KEY_HELP, "  -p, --port <n>      The port to listen on; default: one the system picks", "      --no-browser    Print the page's address without opening a browser"],
    examples: [`${NAME} login --key ./AuthKey_ABC123DEFG.p8 --team-id DEF123GHIJ`, `${NAME} login --no-browser`],
    run: login,
  },
  token: {
    summary: "Print the kept Music User Token, or mint a developer token",
    usage: "token [--developer [--key <path>] [--team-id <id>] [--key-id <id>]]",
    about: [
      "Prints the Music User Token login kept, and nothing else, for another program to read.",
      "With --developer, mints a developer token from the key instead, which lives an hour.",
      KEY_ABOUT,
    ],
    options: ["developer", "key", "team-id", "key-id"],
    optionHelp: ["      --developer     Mint and print a developer token instead", ...KEY_HELP],
    examples: [`APPLE_MUSIC_USER_TOKEN=$(${NAME} token) node job.js`, `curl -H "Authorization: Bearer $(${NAME} token --developer)" https://api.music.apple.com/v1/test`],
    run: token,
  },
  doctor: {
    summary: "Ask Apple whether the key and the kept token work",
    usage: "doctor [--key <path>] [--team-id <id>] [--key-id <id>]",
    about: [
      "Asks Apple whether the key works, with GET /v1/test, and then whether the kept Music User Token does, with",
      "GET /v1/me/storefront: a 401 can be either, and this tells them apart. Prints nothing secret, and exits 1",
      "when either fails.",
      KEY_ABOUT,
    ],
    options: ["key", "team-id", "key-id"],
    optionHelp: KEY_HELP,
    examples: [`${NAME} doctor`],
    run: doctor,
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
    `  ${NAME} login --key ./AuthKey_ABC123DEFG.p8 --team-id DEF123GHIJ`,
    `  ${NAME} doctor`,
    `  APPLE_MUSIC_USER_TOKEN=$(${NAME} token) node job.js`,
    "",
    heading(ctx, "OPTIONS"),
    "  -h, --help        Show this help, or after a command, that command's",
    "      --version     Print the version",
    "      --no-color    Print without color; so does NO_COLOR",
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
    "  -h, --help          Show this help",
    "",
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
  const env = process.env;
  let ctx: tContext = { env, color: true };
  // Known before the flags are read, so that a flag it refuses still points at the command's own help.
  let name = argv[0] !== undefined && Object.hasOwn(COMMANDS, argv[0]) ? argv[0] : undefined;
  try {
    const { values, positionals } = parse(argv);
    ctx = { env, color: values.color !== false };
    const [first, ...rest] = positionals;
    name = first;

    if (values.version === true) {
      process.stdout.write(`${manifest.version}\n`);
      return 0;
    }
    if (first === undefined) {
      process.stdout.write(`${topHelp(ctx)}\n`);
      return 0;
    }
    const topic = first === "help" ? rest[0] : values.help === true ? first : undefined;
    if (first === "help" || values.help === true) {
      if (topic === undefined) {
        process.stdout.write(`${topHelp(ctx)}\n`);
        return 0;
      }
      const command = Object.hasOwn(COMMANDS, topic) ? COMMANDS[topic] : undefined;
      if (command === undefined) throw usage(`There is no command${quoted(topic)} to show help for. The commands are ${Object.keys(COMMANDS).join(", ")}.`);
      process.stdout.write(`${commandHelp(ctx, command)}\n`);
      return 0;
    }

    const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
    if (command === undefined) {
      name = undefined;
      throw usage(`There is no command${quoted(first)}. The commands are ${Object.keys(COMMANDS).join(", ")}.`);
    }
    if (rest.length > 0) throw usage(`${first} takes no arguments, only options.`);
    for (const [option, value] of Object.entries(values)) {
      if (!GLOBAL.includes(option) && !command.options.includes(option)) throw usage(`${value === false ? `--no-${option}` : `--${option}`} is not an option of ${first}.`);
    }
    return await command.run(values, ctx);
  } catch (e) {
    return report(e, ctx, name);
  }
}

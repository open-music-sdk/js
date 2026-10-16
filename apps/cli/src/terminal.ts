// Questions at the terminal, and stdin read as a pipe. Each question is written to stderr, so a pipe on stdout gets
// only what the command produces.
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";
import { CliError } from "./files";

/** The terminal as the key's loading uses it. */
export interface tTerminal {
  /** Whether a question can be asked: stdin and stderr are both terminals. */
  readonly interactive: boolean;
  /** Whether stdin is a terminal, and so no pipe. */
  readonly stdinIsTerminal: boolean;
  /** Says a line to the person at the terminal, on stderr. */
  tell(line: string): void;
  /**
   * Asks for a line, shown as it is typed.
   *
   * @returns The line, or undefined when stdin ends first, as with Ctrl+D.
   * @throws CliError with exit status 130 on Ctrl+C.
   */
  line(question: string): Promise<string | undefined>;
  /**
   * Asks for a private key, with nothing shown, read until its `-----END … PRIVATE KEY-----` line, Ctrl+D, or `max`
   * characters.
   *
   * @returns What was given, or undefined past `max`.
   * @throws CliError with exit status 130 on Ctrl+C.
   */
  secret(question: string, max: number): Promise<string | undefined>;
  /**
   * Reads stdin to its end.
   *
   * @returns What was read, or undefined past `max` bytes.
   */
  pipe(max: number): Promise<string | undefined>;
}

/** stdin as a terminal has it, which may be put in raw mode. */
interface tTerminalInput extends Readable {
  readonly isTTY?: boolean | undefined;
  setRawMode?(mode: boolean): unknown;
}

const stopped = () => new CliError("Stopped. Nothing was kept.", 130);
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = [String.fromCharCode(8), String.fromCharCode(127)];
const END = /-----END [A-Z ]*PRIVATE KEY-----\s*$/;
/** A paste that is not over yet. */
const PENDING = Symbol("pending");

/**
 * The terminal over `input` and `output`: `process.stdin` and `process.stderr` when the CLI runs.
 *
 * @param input - Where answers and a pipe are read from.
 * @param output - Where questions are written.
 */
export function terminal(input: tTerminalInput, output: Writable & { readonly isTTY?: boolean | undefined }): tTerminal {
  return {
    interactive: input.isTTY === true && output.isTTY === true,
    stdinIsTerminal: input.isTTY === true,

    tell: (line) => {
      output.write(`${line}\n`);
    },

    line: (question) =>
      new Promise((resolve, reject) => {
        const rl = createInterface({ input, output, terminal: true });
        let answered = false;
        // A terminal in readline's hands sends Ctrl+C to it, not to the process.
        rl.on("SIGINT", () => {
          answered = true;
          rl.close();
          output.write("\n");
          reject(stopped());
        });
        rl.on("close", () => {
          if (!answered) resolve(undefined);
        });
        rl.question(question, (answer) => {
          answered = true;
          rl.close();
          resolve(answer);
        });
      }),

    secret: (question, max) =>
      new Promise((resolve, reject) => {
        output.write(question);
        let text = "";
        /** What the keys pressed so far come to: the text once it is whole, undefined past `max`, Ctrl+C's error, or PENDING. */
        const take = (chunk: string): string | undefined | CliError | typeof PENDING => {
          for (const c of chunk) {
            if (c === CTRL_C) return stopped();
            if (c === CTRL_D) return text;
            if (BACKSPACE.includes(c)) text = text.slice(0, -1);
            // A terminal in raw mode sends a line break as a carriage return.
            else text += c === "\r" ? "\n" : c;
            if (text.length > max) return undefined;
            if (END.test(text)) return text;
          }
          return PENDING;
        };
        const onData = (chunk: Buffer | string) => {
          const outcome = take(String(chunk));
          if (outcome === PENDING) return;
          input.off("data", onData);
          input.setRawMode?.(false);
          input.pause();
          output.write("\n");
          if (outcome instanceof CliError) reject(outcome);
          else resolve(outcome);
        };
        // Raw mode: nothing typed or pasted is shown, and each key arrives as it is pressed.
        input.setRawMode?.(true);
        input.setEncoding("utf8");
        input.on("data", onData);
        input.resume();
      }),

    pipe: async (max) => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of input) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += bytes.length;
        if (size > max) {
          input.destroy();
          return undefined;
        }
        chunks.push(bytes);
      }
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

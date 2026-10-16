// Questions at the terminal, and stdin read as a pipe. Each question is written to stderr, so a pipe on stdout gets
// only what the command produces. Every answer is read in raw mode, so the CLI decides what is shown: a key pasted
// at the wrong question shows no more than it would at the right one.
import type { Readable, Writable } from "node:stream";
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
   * Asks for an ID, read to Enter. Letters are taken as capitals. What is shown is ID characters, ten at most, and
   * nothing at all once anything else arrives, such as a key pasted here by mistake; what came after a wrong answer
   * is let go by, so a paste's other lines answer nothing.
   *
   * @returns All that was typed, or undefined when stdin ends first, as with Ctrl+D.
   * @throws CliError with exit status 130 on Ctrl+C.
   */
  id(question: string): Promise<string | undefined>;
  /**
   * Asks for a private key, with nothing shown, read until its `-----END … PRIVATE KEY-----` line, Ctrl+D, or `max`
   * characters. Whatever arrives after it is let go by, so a paste's other lines never reach the shell.
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
const ESC = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = [String.fromCharCode(8), String.fromCharCode(127)];
const END = /-----END [A-Z ]*PRIVATE KEY-----\s*$/;
/** What a terminal in bracketed-paste mode puts around a paste. */
const PASTE_MARKS = [`${ESC}[200~`, `${ESC}[201~`];
const ID_CHARACTER = /^[A-Za-z0-9]$/;
/** A paste that can be nothing but an ID: no more than ten ID characters, and the line break after them. */
const PASTED_ID = /^[A-Za-z0-9]{1,10}(\r\n?|\n)?$/;
const ID_LENGTH = 10;
/** How long input must stop for before what is left of a paste is taken to be over. */
const DRAIN_MS = 100;
/** An answer that is not over yet. */
const PENDING = Symbol("pending");

/**
 * The terminal over `input` and `output`: `process.stdin` and `process.stderr` when the CLI runs.
 *
 * @param input - Where answers and a pipe are read from.
 * @param output - Where questions are written.
 */
export function terminal(input: tTerminalInput, output: Writable & { readonly isTTY?: boolean | undefined }): tTerminal {
  /** Keys typed ahead of the question they answer, kept for it. */
  let ahead = "";

  /**
   * Reads one answer in raw mode, a character at a time through `take`, until it gives one; `take` is handed the
   * chunk the character came in, which is one key when typed and more when pasted. What is left of the chunk is
   * kept for the next question, unless `drain` says to let input go by until it stops for a moment.
   */
  const read = <T>(take: (c: string, chunk: string) => T | typeof PENDING, drain: (answer: T) => boolean): Promise<T> =>
    new Promise((resolve, reject) => {
      const setRawMode = input.setRawMode?.bind(input);
      // Without raw mode the terminal shows what is typed; there is no asking for a key that way.
      if (setRawMode === undefined) throw new Error("terminal: stdin cannot be put in raw mode, so what is typed could not be kept from showing");
      let answer: T | CliError | typeof PENDING = PENDING;
      let draining = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Raw mode is left from a timer, never from inside the read that brought the answer: on Windows, a console
      // taken out of raw mode there and put back for the next question echoes, and reads no more.
      const end = () => {
        input.off("data", onData);
        setRawMode(false);
        input.pause();
        output.write("\n");
        if (answer instanceof CliError) reject(answer);
        else resolve(answer as T);
      };
      const onData = (chunk: Buffer | string) => {
        const text = String(chunk);
        if (answer !== PENDING) {
          // Answered: what comes before the end is let go by, putting the end off, or kept for the next question.
          if (draining) {
            clearTimeout(timer);
            timer = setTimeout(end, DRAIN_MS);
          } else ahead += text;
          return;
        }
        let i = 0;
        while (i < text.length && answer === PENDING) {
          const c = text.charAt(i++);
          answer = c === CTRL_C ? stopped() : take(c, text);
        }
        if (answer === PENDING) return;
        draining = answer instanceof CliError || drain(answer);
        if (!draining) {
          // The line feed of a CR LF that ended this answer is this answer's, not an empty one for the next question.
          if (text.charAt(i - 1) === "\r" && text.charAt(i) === "\n") i++;
          ahead = text.slice(i);
        }
        timer = setTimeout(end, draining ? DRAIN_MS : 0);
      };
      setRawMode(true);
      input.setEncoding("utf8");
      input.on("data", onData);
      input.resume();
      if (ahead !== "") {
        const typed = ahead;
        ahead = "";
        onData(typed);
      }
    });

  return {
    interactive: input.isTTY === true && output.isTTY === true,
    stdinIsTerminal: input.isTTY === true,

    tell: (line) => {
      output.write(`${line}\n`);
    },

    id: (question) => {
      output.write(question);
      let typed = "";
      /** For each character kept, whether it was shown. */
      const shown: boolean[] = [];
      let other = false;
      let afterReturn = false;
      /** The answer, shown in full once it is known to be an ID, when some of it came in a paste and was held back. */
      const answered = (answer: string) => {
        if (!shown.every(Boolean) && !other && answer.length === ID_LENGTH) output.write(`\r${question}${answer}`);
        return answer;
      };
      return read<string | undefined>(
        (c, chunk) => {
          // A line break sent as CR LF is one break, not an empty answer to the next question.
          const lineFeedOfBreak = c === "\n" && afterReturn;
          afterReturn = c === "\r";
          if (lineFeedOfBreak) return PENDING;
          if (c === "\r" || c === "\n") return answered(typed);
          if (c === CTRL_D) return typed === "" ? undefined : answered(typed);
          if (BACKSPACE.includes(c)) {
            typed = typed.slice(0, -1);
            if (shown.pop() === true) output.write("\b \b");
            return PENDING;
          }
          const isId = ID_CHARACTER.test(c);
          other ||= !isId;
          // Enough is kept to tell an answer is wrong, and no more.
          if (typed.length > 64) return PENDING;
          // A key typed is shown as it comes, and so is a paste the size of an ID; any other paste waits until it is
          // known to be one. A key pasted here by mistake never is, however slowly its lines arrive.
          const show = (chunk.length === 1 || PASTED_ID.test(chunk)) && !other && shown.filter(Boolean).length < ID_LENGTH;
          typed += isId ? c.toUpperCase() : c;
          shown.push(show);
          if (show) output.write(c.toUpperCase());
          return PENDING;
        },
        // After a wrong answer, the rest of a paste is let go by rather than answering the next question.
        (answer) => answer !== undefined && (other || answer.length !== ID_LENGTH),
      );
    },

    secret: (question, max) => {
      output.write(question);
      let text = "";
      let afterReturn = false;
      const unmarked = () => PASTE_MARKS.reduce((t, mark) => t.replaceAll(mark, ""), text);
      return read<string | undefined>(
        (c) => {
          const lineFeedOfBreak = c === "\n" && afterReturn;
          afterReturn = c === "\r";
          if (lineFeedOfBreak) return PENDING;
          if (c === CTRL_D) return unmarked();
          if (BACKSPACE.includes(c)) text = text.slice(0, -1);
          // A terminal in raw mode sends a line break as a carriage return.
          else text += c === "\r" ? "\n" : c;
          if (text.length > max) return undefined;
          if (END.test(text)) return unmarked();
          return PENDING;
        },
        // What follows a key, the rest of a pasted file say, is for no one: it is let go by, not left for the shell.
        () => true,
      );
    },

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

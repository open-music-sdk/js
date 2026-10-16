import { generateKeyPairSync } from "node:crypto";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { CliError } from "./files";
import { terminal } from "./terminal";

const PEM = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
/** The lines of the key's body, none of which may ever be shown. */
const BODY = PEM.split("\n").filter((line) => line !== "" && !line.startsWith("-----"));
const ESC = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = String.fromCharCode(127);
/** A paste as a terminal in raw mode sends it: each line break a carriage return. */
const PASTED = PEM.replaceAll("\n", "\r");

/** stdin and stderr as a terminal has them, or as a pipe does, with everything written to stderr kept. */
function streams(tty = true) {
  const input = Object.assign(new PassThrough(), { isTTY: tty, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: tty });
  let shown = "";
  output.on("data", (chunk: Buffer) => (shown += chunk.toString()));
  return { input, output, shown: () => shown };
}

const neverShown = (shown: string) => {
  for (const line of BODY) expect(shown).not.toContain(line.slice(0, 16));
};

describe("terminal: whether it may ask", () => {
  test("it asks only when stdin and stderr are both terminals", () => {
    expect(terminal(streams(true).input, streams(true).output)).toMatchObject({ interactive: true, stdinIsTerminal: true });
    expect(terminal(streams(false).input, streams(true).output)).toMatchObject({ interactive: false, stdinIsTerminal: false });
    expect(terminal(streams(true).input, streams(false).output)).toMatchObject({ interactive: false, stdinIsTerminal: true });
  });

  test("without raw mode it asks for nothing, rather than show what is typed", async () => {
    const { input, output } = streams();
    const plain = Object.assign(input, { setRawMode: undefined });
    await expect(terminal(plain, output).secret("Private key: ", 16_384)).rejects.toThrow(/raw mode/);
  });
});

describe("terminal: an ID", () => {
  test("is what was typed to Enter, in capitals, shown as it is typed, and raw mode is left behind", async () => {
    const { input, output, shown } = streams();
    const answer = terminal(input, output).id("Team ID: ");
    input.write("def123ghij\r");
    expect(await answer).toBe("DEF123GHIJ");
    expect(shown()).toBe("Team ID: DEF123GHIJ\n");
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.isPaused()).toBe(true);
  });

  test("backspace takes back what it shows, and no more than ten characters are shown", async () => {
    const { input, output, shown } = streams();
    const answer = terminal(input, output).id("Key ID: ");
    input.write(`ABX${BACKSPACE}C123DEFGHIJ\r`);
    expect(await answer).toBe("ABC123DEFGHIJ");
    expect(shown()).toBe("Key ID: ABX\b \bC123DEFG\n");
  });

  test("a key pasted at it shows nothing of the key, however the paste arrives, and the rest of it answers nothing", async () => {
    for (const pieces of [[PASTED], PASTED.split("\r").map((line) => `${line}\r`)]) {
      const { input, output, shown } = streams();
      const term = terminal(input, output);
      const answer = term.id("Team ID: ");
      for (const piece of pieces) input.write(piece);
      expect((await answer)?.startsWith("-----BEGIN")).toBe(true);
      // The paste's other lines were let go by, so the next question waits for what is typed.
      const next = term.id("Team ID: ");
      input.write("DEF123GHIJ\r");
      expect(await next).toBe("DEF123GHIJ");
      neverShown(shown());
      expect(shown()).not.toContain("BEGIN");
    }
  });

  test("answers typed ahead are kept for the questions they answer, and a CR LF is one line break", async () => {
    const { input, output } = streams();
    const term = terminal(input, output);
    const first = term.id("Team ID: ");
    input.write("DEF123GHIJ\r\nABC123DEFG\r\n");
    expect(await first).toBe("DEF123GHIJ");
    expect(await term.id("Key ID: ")).toBe("ABC123DEFG");
  });

  test("stdin ending before an answer is no answer, and Ctrl+C is exit status 130", async () => {
    const ended = streams();
    const none = terminal(ended.input, ended.output).id("Team ID: ");
    ended.input.write(CTRL_D);
    expect(await none).toBeUndefined();
    const stopped = streams();
    const asked = terminal(stopped.input, stopped.output).id("Team ID: ");
    stopped.input.write(`DEF${CTRL_C}`);
    await expect(asked).rejects.toBeInstanceOf(CliError);
    await expect(asked).rejects.toMatchObject({ exitCode: 130 });
    expect(stopped.input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});

describe("terminal: the key", () => {
  test("a paste shows nothing, is read to its END line in whatever pieces it comes, and leaves raw mode behind", async () => {
    const { input, output, shown } = streams();
    const secret = terminal(input, output).secret("Private key: ", 16_384);
    input.write(PASTED.slice(0, 40));
    input.write(PASTED.slice(40));
    expect((await secret)?.trim()).toBe(PEM.trim());
    expect(shown()).toBe("Private key: \n");
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
  });

  test("a paste with CR LF line breaks, or inside bracketed-paste marks, is the key as it was", async () => {
    for (const paste of [PEM.replaceAll("\n", "\r\n"), `${ESC}[200~${PASTED}${ESC}[201~`]) {
      const { input, output } = streams();
      const secret = terminal(input, output).secret("Private key: ", 16_384);
      input.write(paste);
      expect((await secret)?.trim()).toBe(PEM.trim());
    }
  });

  test("what arrives after the key, the rest of a pasted file say, is let go by and left for no one", async () => {
    const { input, output } = streams();
    const secret = terminal(input, output).secret("Private key: ", 16_384);
    input.write(PASTED);
    input.write("OTHER_SECRET=hunter2\r");
    expect((await secret)?.trim()).toBe(PEM.trim());
    expect(input.read()).toBeNull();
  });

  test("backspace takes back a character, Ctrl+D ends the paste where it is, and Ctrl+C is exit status 130 and shows nothing", async () => {
    const edited = streams();
    const typed = terminal(edited.input, edited.output).secret("Private key: ", 16_384);
    edited.input.write(`abX${BACKSPACE}c${CTRL_D}`);
    expect(await typed).toBe("abc");
    const stopped = streams();
    const asked = terminal(stopped.input, stopped.output).secret("Private key: ", 16_384);
    stopped.input.write(`-----BEGIN${CTRL_C}`);
    await expect(asked).rejects.toMatchObject({ exitCode: 130 });
    expect(stopped.input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stopped.shown()).not.toContain("BEGIN");
  });

  test("a paste longer than any key ends with nothing", async () => {
    const { input, output } = streams();
    const secret = terminal(input, output).secret("Private key: ", 100);
    input.write("x".repeat(101));
    expect(await secret).toBeUndefined();
  });
});

describe("terminal: a pipe", () => {
  test("is read to its end, and refused past the limit", async () => {
    const piped = streams(false);
    const read = terminal(piped.input, piped.output).pipe(16_384);
    piped.input.end(PEM);
    expect(await read).toBe(PEM);
    const large = streams(false);
    const tooMuch = terminal(large.input, large.output).pipe(100);
    large.input.end("x".repeat(101));
    expect(await tooMuch).toBeUndefined();
  });
});

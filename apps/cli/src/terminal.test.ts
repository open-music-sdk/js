import { generateKeyPairSync } from "node:crypto";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { CliError } from "./files";
import { terminal } from "./terminal";

const PEM = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = String.fromCharCode(127);

/** stdin and stderr as a terminal has them, or as a pipe does, with everything written to stderr kept. */
function streams(tty = true) {
  const input = Object.assign(new PassThrough(), { isTTY: tty, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: tty });
  let shown = "";
  output.on("data", (chunk: Buffer) => (shown += chunk.toString()));
  return { input, output, shown: () => shown };
}

describe("terminal: questions at the terminal, and stdin as a pipe", () => {
  test("it asks only when stdin and stderr are both terminals", () => {
    expect(terminal(streams(true).input, streams(true).output)).toMatchObject({ interactive: true, stdinIsTerminal: true });
    expect(terminal(streams(false).input, streams(true).output)).toMatchObject({ interactive: false, stdinIsTerminal: false });
    expect(terminal(streams(true).input, streams(false).output)).toMatchObject({ interactive: false, stdinIsTerminal: true });
  });

  test("a line is the answer typed, shown as typed", async () => {
    const { input, output, shown } = streams();
    const answer = terminal(input, output).line("Team ID: ");
    input.write("DEF123GHIJ\r");
    expect(await answer).toBe("DEF123GHIJ");
    expect(shown()).toContain("Team ID: ");
  });

  test("stdin ending before an answer is no answer, and Ctrl+C is exit status 130", async () => {
    const ended = streams();
    const none = terminal(ended.input, ended.output).line("Team ID: ");
    ended.input.end();
    expect(await none).toBeUndefined();
    const stopped = streams();
    const asked = terminal(stopped.input, stopped.output).line("Team ID: ");
    stopped.input.write(CTRL_C);
    await expect(asked).rejects.toMatchObject({ exitCode: 130 });
    await expect(asked).rejects.toBeInstanceOf(CliError);
  });

  test("a pasted key shows nothing, is read to its END line whatever line breaks it came with, and leaves raw mode behind", async () => {
    const { input, output, shown } = streams();
    const secret = terminal(input, output).secret("Private key: ", 16_384);
    // A terminal in raw mode sends Enter as a carriage return; a paste arrives in pieces.
    const pasted = PEM.replaceAll("\n", "\r");
    input.write(pasted.slice(0, 40));
    input.write(pasted.slice(40));
    const text = await secret;
    expect(text?.trim()).toBe(PEM.trim());
    expect(shown()).toBe("Private key: \n");
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.isPaused()).toBe(true);
  });

  test("backspace takes back a character, Ctrl+D ends the paste where it is, and Ctrl+C is exit status 130", async () => {
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

  test("a pipe is read to its end, and refused past the limit", async () => {
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

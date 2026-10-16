import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CliError } from "./files";
import { loadKey, type tKeyFlags } from "./key";
import type { tTerminal } from "./terminal";

/* eslint-disable @typescript-eslint/naming-convention -- environment variables are named as the system names them */

const TEAM = "DEF123GHIJ";
const KEY_ID = "ABC123DEFG";
const pemOf = (curve: string) => generateKeyPairSync("ec", { namedCurve: curve }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PEM = pemOf("P-256");
/** A line of the key's body, which no message may hold. */
const BODY = PEM.split("\n")[1] ?? "";
/** Everything a project that follows the family's READMEs has in its environment. */
const ENV = { APPLE_MUSIC_PRIVATE_KEY: PEM, APPLE_MUSIC_TEAM_ID: TEAM, APPLE_MUSIC_KEY_ID: KEY_ID };

let dir: string;
let keyFile: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omsdk-key-"));
  keyFile = join(dir, `AuthKey_${KEY_ID}.p8`);
  await writeFile(keyFile, PEM);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A terminal that answers from a script, records the questions it was asked and what it was told, and holds a pipe's contents. */
function fake(options: { interactive?: boolean; stdinIsTerminal?: boolean; lines?: (string | undefined)[]; secrets?: (string | undefined)[]; piped?: string } = {}) {
  const asked: string[] = [];
  const told: string[] = [];
  const lines = [...(options.lines ?? [])];
  const secrets = [...(options.secrets ?? [])];
  const interactive = options.interactive ?? true;
  const term: tTerminal = {
    interactive,
    stdinIsTerminal: options.stdinIsTerminal ?? interactive,
    tell: (line) => {
      told.push(line);
    },
    line: (question) => {
      asked.push(question);
      return Promise.resolve(lines.shift());
    },
    secret: (question) => {
      asked.push(question);
      return Promise.resolve(secrets.shift());
    },
    pipe: (max) => Promise.resolve(options.piped === undefined || Buffer.byteLength(options.piped) > max ? undefined : options.piped),
  };
  return { term, asked, told };
}

/** Runs `fn` and gives back the CliError it threw. */
async function thrown(fn: () => Promise<unknown>): Promise<CliError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof CliError) return e;
    throw e;
  }
  throw new Error("expected a CliError");
}

describe("loadKey: each value from its flag, else its environment variable, else a question", () => {
  test("from the environment alone, as the family's READMEs keep them: no flags, and nothing asked", async () => {
    const { term, asked } = fake();
    expect(await loadKey({}, ENV, term)).toEqual({ pem: PEM, teamId: TEAM, keyId: KEY_ID, from: "APPLE_MUSIC_PRIVATE_KEY", asked: false });
    expect(asked).toEqual([]);
  });

  test("a flag wins over its variable, each value on its own", async () => {
    const other = pemOf("P-256");
    await writeFile(keyFile, other);
    const { term } = fake();
    const key = await loadKey({ "key-file": keyFile, "team-id": "FLAGTEAM00", "key-id": "FLAGKEY000" }, ENV, term);
    expect(key).toMatchObject({ pem: other, teamId: "FLAGTEAM00", keyId: "FLAGKEY000", from: `--key-file ${resolve(keyFile)}` });
    expect(await loadKey({ "team-id": "FLAGTEAM00" }, ENV, term)).toMatchObject({ pem: PEM, teamId: "FLAGTEAM00", keyId: KEY_ID });
  });

  test("the key ID in the name of a --key-file comes after --key-id and before APPLE_MUSIC_KEY_ID, which may be another key's", async () => {
    const { term } = fake();
    expect(await loadKey({ "key-file": keyFile }, { ...ENV, APPLE_MUSIC_KEY_ID: "OTHERKEY00" }, term)).toMatchObject({ keyId: KEY_ID });
    expect(await loadKey({ "key-file": keyFile, "key-id": "FLAGKEY000" }, ENV, term)).toMatchObject({ keyId: "FLAGKEY000" });
    const renamed = join(dir, "musickit.p8");
    await writeFile(renamed, PEM);
    expect(await loadKey({ "key-file": renamed }, ENV, term)).toMatchObject({ keyId: KEY_ID });
  });

  test("a variable set to nothing is taken as not set", async () => {
    const { term } = fake({ interactive: false });
    const e = await thrown(() => loadKey({}, { ...ENV, APPLE_MUSIC_TEAM_ID: "" }, term));
    expect(e.message).toContain("No team ID");
  });

  test("the variable may hold the key with its line breaks escaped, with Windows line endings, or after a byte order mark", async () => {
    const { term } = fake();
    for (const value of [PEM.replaceAll("\n", String.fromCharCode(92) + "n"), PEM.replaceAll("\n", "\r\n"), String.fromCharCode(0xfeff) + PEM, `\n  ${PEM}  \n`]) {
      expect((await loadKey({}, { ...ENV, APPLE_MUSIC_PRIVATE_KEY: value }, term)).pem).toBe(PEM);
    }
  });

  test("a P-256 key in another form than Apple's, such as SEC1, is taken and handed on as PKCS8", async () => {
    const sec1 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const { term } = fake();
    const key = await loadKey({}, { ...ENV, APPLE_MUSIC_PRIVATE_KEY: sec1.export({ type: "sec1", format: "pem" }).toString() }, term);
    expect(key.pem).toBe(sec1.export({ type: "pkcs8", format: "pem" }).toString());
  });
});

describe("loadKey: a file is read only when --key-file names it", () => {
  test("a path in APPLE_MUSIC_PRIVATE_KEY is refused, with where a path goes instead, and is not repeated", async () => {
    const { term } = fake();
    for (const value of [keyFile, join(dir, "AuthKey_NOTTHERE00.p8"), dir]) {
      const e = await thrown(() => loadKey({}, { ...ENV, APPLE_MUSIC_PRIVATE_KEY: value }, term));
      expect(e.exitCode).toBe(2);
      expect(e.message).toContain("looks like a path");
      expect(e.message).toContain("--key-file <path>");
      expect(e.message).not.toContain(dir);
    }
  });

  test("the variable the path used to come from is not read", async () => {
    const { term } = fake({ interactive: false });
    const e = await thrown(() => loadKey({}, { APPLE_MUSIC_KEY_PATH: keyFile, APPLE_MUSIC_TEAM_ID: TEAM, APPLE_MUSIC_KEY_ID: KEY_ID }, term));
    expect(e.message).toContain("No key: set APPLE_MUSIC_PRIVATE_KEY");
  });

  test("a file that cannot be read is named by its path when it looks like one", async () => {
    const typo = join(dir, "AuthKey_ABC123DEFH.p8");
    const e = await thrown(() => loadKey({ "key-file": typo }, ENV, fake().term));
    expect(e).toMatchObject({ exitCode: 2 });
    expect(e.message).toContain(typo);
    expect(e.message).toContain("ENOENT");
  });

  test("the key's contents, or a token, put where the file's path goes, is not repeated", async () => {
    const musicUserToken = `Ag${"Bc/dEf+gH".repeat(40)}==`;
    for (const value of [PEM, BODY, musicUserToken]) {
      const e = await thrown(() => loadKey({ "key-file": value }, ENV, fake().term));
      expect(e.message).toContain("not repeated");
      for (const secret of [BODY.slice(0, 20), musicUserToken.slice(10, 40)]) expect(e.message).not.toContain(secret);
    }
  });

  test("a file that is no P-256 private key is refused by its path, and none of it is quoted", async () => {
    for (const contents of [`hello ${TEAM}`, pemOf("P-384"), generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString()]) {
      await writeFile(keyFile, contents);
      const e = await thrown(() => loadKey({ "key-file": keyFile }, ENV, fake().term));
      expect(e.exitCode).toBe(2);
      expect(e.message).toContain(resolve(keyFile));
      expect(e.message).toContain("not a MusicKit private key");
      expect(e.message).not.toContain(contents.split("\n")[1] ?? contents);
    }
  });
});

describe("loadKey: --key-file - reads the key from a pipe", () => {
  test("the piped key is taken, and named as stdin", async () => {
    const { term, asked } = fake({ interactive: false, piped: PEM });
    expect(await loadKey({ "key-file": "-" }, { APPLE_MUSIC_TEAM_ID: TEAM, APPLE_MUSIC_KEY_ID: KEY_ID }, term)).toMatchObject({ pem: PEM, from: "stdin, by --key-file -", asked: false });
    expect(asked).toEqual([]);
  });

  test("with stdin carrying the key nothing else can be asked for: a missing ID is a mistake named with its flag and variable", async () => {
    const { term, asked } = fake({ interactive: true, stdinIsTerminal: false, piped: PEM });
    const e = await thrown(() => loadKey({ "key-file": "-" }, { APPLE_MUSIC_TEAM_ID: TEAM }, term));
    expect(e.exitCode).toBe(2);
    expect(e.message).toContain("--key-id or set APPLE_MUSIC_KEY_ID");
    expect(e.message).toContain("stdin carries the key");
    expect(asked).toEqual([]);
  });

  test("a terminal on stdin is refused: the key would be typed where it shows", async () => {
    const e = await thrown(() => loadKey({ "key-file": "-" }, ENV, fake({ interactive: true, stdinIsTerminal: true, piped: PEM }).term));
    expect(e.exitCode).toBe(2);
    expect(e.message).toContain("stdin is this terminal");
  });

  test("more than any key is refused, and what was piped is not quoted", async () => {
    const piped = PEM.repeat(100);
    const e = await thrown(() => loadKey({ "key-file": "-" }, ENV, fake({ interactive: false, piped }).term));
    expect(e.message).toContain("over 16 KB");
    const notKey = await thrown(() => loadKey({ "key-file": "-" }, ENV, fake({ interactive: false, piped: BODY }).term));
    expect(notKey.message).toContain("What was piped to --key-file - is not a MusicKit private key");
    expect(notKey.message).not.toContain(BODY.slice(0, 20));
  });
});

describe("loadKey: what the flags and the environment leave out is asked for", () => {
  test("only what is missing is asked for, in the order team ID, key ID, key, after saying so once", async () => {
    const { term, asked, told } = fake({ lines: [TEAM, KEY_ID], secrets: [PEM] });
    const key = await loadKey({}, {}, term);
    expect(key).toEqual({ pem: PEM, teamId: TEAM, keyId: KEY_ID, from: "pasted", asked: true });
    expect(asked.map((question) => question.split(",")[0])).toEqual(["Team ID", "Key ID", "Private key"]);
    expect(told[0]).toContain("team ID, key ID, key");
    expect(told[0]).toContain("--no-input");
  });

  test("a value the environment has is not asked for", async () => {
    const { term, asked } = fake({ lines: [KEY_ID] });
    expect(await loadKey({}, { APPLE_MUSIC_PRIVATE_KEY: PEM, APPLE_MUSIC_TEAM_ID: TEAM }, term)).toMatchObject({ keyId: KEY_ID, from: "APPLE_MUSIC_PRIVATE_KEY", asked: true });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^Key ID/);
  });

  test("the key is asked for through the prompt that shows nothing", async () => {
    const { term, asked } = fake({ secrets: [PEM] });
    await loadKey({}, { APPLE_MUSIC_TEAM_ID: TEAM, APPLE_MUSIC_KEY_ID: KEY_ID }, term);
    expect(asked).toEqual(["Private key, the whole .p8 from BEGIN to END (not shown): "]);
  });

  test("an ID typed wrong, and a key pasted wrong, are asked for again, and what was typed is not repeated", async () => {
    const { term, told } = fake({ lines: ["def123ghij", TEAM, KEY_ID], secrets: [BODY, PEM] });
    expect(await loadKey({}, {}, term)).toMatchObject({ teamId: TEAM, pem: PEM });
    expect(told.join("\n")).toContain("That is 10 characters; a team ID is ten capital letters and digits");
    expect(told.join("\n")).toContain("That is not a MusicKit private key");
    expect(told.join("\n")).not.toContain("def123ghij");
    expect(told.join("\n")).not.toContain(BODY.slice(0, 20));
  });

  test("stdin ending at a question, or an empty paste, is a mistake: nothing was given", async () => {
    expect(await thrown(() => loadKey({}, {}, fake({ lines: [] }).term))).toMatchObject({ exitCode: 2, message: "No team ID was given." });
    expect(await thrown(() => loadKey({}, { APPLE_MUSIC_TEAM_ID: TEAM, APPLE_MUSIC_KEY_ID: KEY_ID }, fake({ secrets: [""] }).term))).toMatchObject({ exitCode: 2, message: "No key was given." });
  });

  test("Ctrl+C at a question stops it with exit status 130", async () => {
    const { term } = fake();
    const stopped = { ...term, line: () => Promise.reject(new CliError("Stopped. Nothing was kept.", 130)) };
    expect(await thrown(() => loadKey({}, {}, stopped))).toMatchObject({ exitCode: 130 });
  });

  test("nothing is asked with --no-input or away from a terminal: each missing value is named with its flag and its variable", async () => {
    const cases: [tKeyFlags, ReturnType<typeof fake>, string][] = [
      [{ input: false }, fake(), "--no-input was given"],
      [{}, fake({ interactive: false }), "this is no interactive terminal"],
    ];
    for (const [flags, { term, asked }, why] of cases) {
      const e = await thrown(() => loadKey(flags, {}, term));
      expect(e.exitCode, why).toBe(2);
      for (const name of ["--team-id or set APPLE_MUSIC_TEAM_ID", "--key-id or set APPLE_MUSIC_KEY_ID", "set APPLE_MUSIC_PRIVATE_KEY", "--key-file <path>", why]) expect(e.message, why).toContain(name);
      expect(asked, why).toEqual([]);
    }
  });

  test("an ID from a flag, a variable or a file name that is wrong is refused, named by where it came from and not by its value", async () => {
    const cases: [tKeyFlags, Record<string, string>, string][] = [
      [{ "team-id": "def123ghij" }, ENV, "team ID from --team-id"],
      [{}, { ...ENV, APPLE_MUSIC_KEY_ID: "SHORT" }, "key ID from APPLE_MUSIC_KEY_ID"],
    ];
    for (const [flags, env, named] of cases) {
      const { term, asked } = fake();
      const e = await thrown(() => loadKey(flags, env, term));
      expect(e.exitCode).toBe(2);
      expect(e.message).toContain(named);
      expect(e.message).not.toContain("def123ghij");
      expect(e.message).not.toContain("SHORT");
      expect(asked).toEqual([]);
    }
  });

  test("a variable that holds something that is no key is refused, and what it holds is not quoted", async () => {
    const token = `Ag${"Bc/dEf+gH".repeat(40)}==`;
    const e = await thrown(() => loadKey({}, { ...ENV, APPLE_MUSIC_PRIVATE_KEY: token }, fake().term));
    expect(e.message).toContain("APPLE_MUSIC_PRIVATE_KEY does not hold a MusicKit private key");
    expect(e.message).not.toContain(token.slice(10, 40));
  });
});

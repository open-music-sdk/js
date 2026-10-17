import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CliError, FileUserTokenStore, configDir, printable } from "./files";

/* eslint-disable @typescript-eslint/naming-convention -- environment variables are named as the system names them */

// The file system as it is, with a rename that can be made to fail: nothing here can make the system refuse one for real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

const TOKEN = "Ag-music-user-token.with.dots_and-dashes";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omsdk-cli-"));
});
afterEach(async () => {
  vi.mocked(rename).mockReset();
  await rm(dir, { recursive: true, force: true });
});

/** A rename refused by the system, with the code it gives. */
const refused = (code: string) => Object.assign(new Error(`${code}: rename refused`), { code });

/** Runs `fn` as it runs on `platform`. */
async function on<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const real = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", { value: real });
  }
}

/** Runs `fn` and gives back what it threw, so a test can say what the error does and does not say. */
async function thrown(fn: () => Promise<unknown>): Promise<CliError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof CliError) return e;
    throw e;
  }
  throw new Error("expected a CliError");
}

describe("printable: text from outside, without what a terminal would act on rather than show", () => {
  test("control characters are dropped, the 8-bit ones after DEL too, and every other character is kept, however far past ASCII", () => {
    const control = (code: number) => String.fromCharCode(code);
    // ESC, and the 8-bit CSI that stands for ESC [, each begin a sequence the terminal would carry out: here, clear the screen.
    expect(printable(`a${control(0x1b)}[2Jb${control(0x9b)}2Jc${control(0x07)}${control(0x7f)}`)).toBe("a[2Jb2Jc");
    const text = `Café ${String.fromCodePoint(0x1f3b5)}${control(0xa0)}`;
    expect(printable(text)).toBe(text);
  });
});

describe("configDir: where the CLI keeps what it keeps, by each system's own path rules, whichever system the tests run on", () => {
  const home = (path: typeof win32) => path.join(homedir(), ".config", "open-music-sdk");

  test("on Windows, a folder of its own in %LOCALAPPDATA%, which stays on this machine, and not the roaming %APPDATA%", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local", APPDATA: "C:\\Users\\a\\AppData\\Roaming" };
    expect(configDir(env, "win32")).toBe("C:\\Users\\a\\AppData\\Local\\open-music-sdk");
    expect(configDir({ APPDATA: env.APPDATA }, "win32")).toBe(home(win32));
  });

  test("elsewhere, in $XDG_CONFIG_HOME, or in ~/.config without it", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe("/xdg/open-music-sdk");
    expect(configDir({}, "darwin")).toBe(home(posix));
    // %LOCALAPPDATA% is Windows's alone, wherever it happens to be set.
    expect(configDir({ LOCALAPPDATA: "/appdata" }, "linux")).toBe(home(posix));
  });

  test("a relative or empty location is ignored, as the XDG spec says to, so a file never lands under whatever folder the CLI was run from", () => {
    expect(configDir({ XDG_CONFIG_HOME: "relative/dir" }, "linux")).toBe(home(posix));
    expect(configDir({ XDG_CONFIG_HOME: "" }, "linux")).toBe(home(posix));
    expect(configDir({ LOCALAPPDATA: "relative" }, "win32")).toBe(home(win32));
    // Absolute on Windows only by Windows's rules: a drive with no slash after it is relative to that drive's folder.
    expect(configDir({ LOCALAPPDATA: "C:relative" }, "win32")).toBe(home(win32));
  });
});

describe("FileUserTokenStore: core's three methods over one file", () => {
  test("a token set is the token got, a second set replaces it, and delete forgets it", async () => {
    const store = new FileUserTokenStore(join(dir, "nested", "user-token.json"));
    expect(await store.get("default")).toBeUndefined();
    await store.set("default", TOKEN);
    expect(await store.get("default")).toBe(TOKEN);
    await store.set("default", "second-token");
    expect(await store.get("default")).toBe("second-token");
    await store.delete("default");
    expect(await store.get("default")).toBeUndefined();
  });

  test("each listener is kept apart, and forgetting one leaves the others", async () => {
    const store = new FileUserTokenStore(join(dir, "user-token.json"));
    await store.set("a", "token-a");
    await store.set("b", "token-b");
    await store.delete("a");
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("b")).toBe("token-b");
  });

  test("forgetting what was never kept writes nothing", async () => {
    const path = join(dir, "user-token.json");
    await new FileUserTokenStore(path).delete("default");
    expect(await readdir(dir)).toEqual([]);
  });

  test("an id the store did not set is nothing, inherited names included: the file's object inherits nothing", async () => {
    const path = join(dir, "user-token.json");
    const store = new FileUserTokenStore(path);
    await store.set("__proto__", TOKEN);
    expect(await store.get("__proto__")).toBe(TOKEN);
    expect(await store.get("toString")).toBeUndefined();
    expect(await store.get("constructor")).toBeUndefined();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(JSON.parse(`{"__proto__":"${TOKEN}"}`));
  });

  test("a value that is no token, as a hand edit may leave, is no token: a string that is not one included", async () => {
    const path = join(dir, "user-token.json");
    await writeFile(path, JSON.stringify({ default: 42, other: { token: TOKEN }, edited: "edited by hand", blank: " " }));
    const store = new FileUserTokenStore(path);
    for (const id of ["default", "other", "edited", "blank"]) expect(await store.get(id), id).toBeUndefined();
  });

  test("a token with whitespace around it, as an editor may save it, is read without it", async () => {
    const path = join(dir, "user-token.json");
    await writeFile(path, JSON.stringify({ default: ` ${TOKEN}\r\n` }));
    expect(await new FileUserTokenStore(path).get("default")).toBe(TOKEN);
  });

  test("writes at the same time all land, each replacing the file whole, and leave nothing beside it", async () => {
    const path = join(dir, "user-token.json");
    const store = new FileUserTokenStore(path);
    // On Windows a rename is refused while another write has the file open; each is tried again until it lands.
    const tokens = Array.from({ length: 40 }, (_, i) => `token-${String(i)}`);
    await Promise.all(tokens.map((token) => store.set("default", token)));
    expect(await readdir(dir)).toEqual(["user-token.json"]);
    expect(tokens).toContain((JSON.parse(await readFile(path, "utf8")) as { default: string }).default);
  });

  test("on Windows, a rename refused while another handle has the file open is tried again until it lands", async () => {
    const path = join(dir, "user-token.json");
    vi.mocked(rename).mockRejectedValueOnce(refused("EPERM")).mockRejectedValueOnce(refused("EACCES")).mockRejectedValueOnce(refused("EBUSY"));
    await on("win32", () => new FileUserTokenStore(path).set("default", TOKEN));
    expect(await new FileUserTokenStore(path).get("default")).toBe(TOKEN);
    expect(await readdir(dir)).toEqual(["user-token.json"]);
  });

  test.each([
    ["on Windows, a refusal that waiting does not end", "win32", "EXDEV"],
    ["anywhere but Windows, any refusal", "linux", "EPERM"],
  ] as const)("%s fails the write at once, leaving the file as it was and nothing beside it", async (_, platform, code) => {
    const path = join(dir, "user-token.json");
    const store = new FileUserTokenStore(path);
    await store.set("default", TOKEN);
    vi.mocked(rename).mockClear().mockRejectedValueOnce(refused(code));
    await expect(on(platform, () => store.set("default", "second-token"))).rejects.toMatchObject({ code });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await store.get("default")).toBe(TOKEN);
    expect(await readdir(dir)).toEqual(["user-token.json"]);
  });

  test.skipIf(process.platform === "win32")("the file is readable by its user alone, and so is a folder the store makes", async () => {
    const path = join(dir, "made", "user-token.json");
    await new FileUserTokenStore(path).set("default", TOKEN);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "made"))).mode & 0o777).toBe(0o700);
  });

  test.skipIf(process.platform === "win32")("a file that was readable by others is replaced by one that is not", async () => {
    const path = join(dir, "user-token.json");
    await writeFile(path, "{}", { mode: 0o644 });
    await new FileUserTokenStore(path).set("default", TOKEN);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("a file that is not what the store writes is refused by its path, and what it holds is not repeated", async () => {
    const path = join(dir, "user-token.json");
    for (const contents of [`not json ${TOKEN}`, `["${TOKEN}"]`, "null", `"${TOKEN}"`]) {
      await writeFile(path, contents);
      const e = await thrown(() => new FileUserTokenStore(path).get("default"));
      expect(e.message).toContain(path);
      expect(e.message).not.toContain(TOKEN);
      expect(e.exitCode).toBe(1);
    }
  });

  test("a file that starts with a byte order mark, as Notepad may save it, is read as the JSON after it", async () => {
    const path = join(dir, "user-token.json");
    await writeFile(path, `${String.fromCharCode(0xfeff)}{"default":"${TOKEN}"}`);
    expect(await new FileUserTokenStore(path).get("default")).toBe(TOKEN);
  });

  test("a file that is there but cannot be read is an error that names it, not an empty store for a set to write over", async () => {
    // A folder where the file goes is one such, and the system's own error for it does not say which.
    const store = new FileUserTokenStore(dir);
    for (const e of [await thrown(() => store.get("default")), await thrown(() => store.set("default", TOKEN))]) {
      expect(e.message).toBe(`${dir} cannot be read: EISDIR: illegal operation on a directory, read`);
      expect(e.exitCode).toBe(1);
    }
    expect(await readdir(dir)).toEqual([]);
  });
});

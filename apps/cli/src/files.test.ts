import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CliError, FileUserTokenStore, configDir, loadKey, readSavedKey, saveKey, type tKey } from "./files";

/* eslint-disable @typescript-eslint/naming-convention -- environment variables are named as the system names them */

const TEAM = "DEF123GHIJ";
const KEY_ID = "ABC123DEFG";
const TOKEN = "Ag-music-user-token.with.dots_and-dashes";
const pemOf = (options: Parameters<typeof generateKeyPairSync>[1]) => {
  const { privateKey } = generateKeyPairSync("ec", options as { namedCurve: string });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
};
const PEM = pemOf({ namedCurve: "P-256" });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omsdk-cli-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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

describe("configDir: where the CLI keeps what it keeps", () => {
  test("on Windows, a folder of its own in %APPDATA%", () => {
    expect(configDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32")).toBe(join("C:\\Users\\a\\AppData\\Roaming", "open-music-sdk"));
  });

  test("elsewhere, in $XDG_CONFIG_HOME, or in ~/.config without it", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(join("/xdg", "open-music-sdk"));
    expect(configDir({}, "darwin")).toBe(join(homedir(), ".config", "open-music-sdk"));
    // %APPDATA% is Windows's alone, wherever it happens to be set.
    expect(configDir({ APPDATA: "/appdata" }, "linux")).toBe(join(homedir(), ".config", "open-music-sdk"));
  });

  test("a relative or empty location is ignored, as the XDG spec says to, so a file never lands under whatever folder the CLI was run from", () => {
    expect(configDir({ XDG_CONFIG_HOME: "relative/dir" }, "linux")).toBe(join(homedir(), ".config", "open-music-sdk"));
    expect(configDir({ XDG_CONFIG_HOME: "" }, "linux")).toBe(join(homedir(), ".config", "open-music-sdk"));
    expect(configDir({ APPDATA: "relative" }, "win32")).toBe(join(homedir(), ".config", "open-music-sdk"));
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

  test("a value that is no string is no token", async () => {
    const path = join(dir, "user-token.json");
    await writeFile(path, JSON.stringify({ default: 42, other: { token: TOKEN } }));
    const store = new FileUserTokenStore(path);
    expect(await store.get("default")).toBeUndefined();
    expect(await store.get("other")).toBeUndefined();
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
});

describe("saveKey and readSavedKey: the key's path and ids, never its contents", () => {
  const key: tKey = { pem: PEM, teamId: TEAM, keyId: KEY_ID, keyPath: "/keys/AuthKey_ABC123DEFG.p8" };

  test("what is saved is read back", async () => {
    const path = join(dir, "config.json");
    await saveKey(path, key);
    expect(await readSavedKey(path)).toEqual({ keyPath: key.keyPath, teamId: TEAM, keyId: KEY_ID });
  });

  test("the key itself is not written", async () => {
    const path = join(dir, "config.json");
    await saveKey(path, key);
    const written = await readFile(path, "utf8");
    expect(written).not.toContain("PRIVATE KEY");
    expect(written).not.toContain(PEM.split("\n")[1]);
  });

  test("nothing saved is nothing, and a field that is no string is not taken", async () => {
    expect(await readSavedKey(join(dir, "none.json"))).toEqual({ keyPath: undefined, teamId: undefined, keyId: undefined });
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ keyPath: 1, teamId: TEAM, keyId: null }));
    expect(await readSavedKey(path)).toEqual({ keyPath: undefined, teamId: TEAM, keyId: undefined });
  });
});

describe("loadKey: from the flags, else the environment, else the last login", () => {
  let keyPath: string;
  beforeEach(async () => {
    keyPath = join(dir, `AuthKey_${KEY_ID}.p8`);
    await writeFile(keyPath, PEM);
  });

  test("from the flags, with the key ID read from the file's name, and the path made absolute", async () => {
    const key = await loadKey({ key: keyPath, "team-id": TEAM }, {}, {});
    expect(key).toEqual({ pem: PEM, teamId: TEAM, keyId: KEY_ID, keyPath: resolve(keyPath) });
  });

  test("a flag wins over the environment, and the environment over what was saved", async () => {
    const other = join(dir, "other.p8");
    await writeFile(other, PEM);
    const env = { APPLE_MUSIC_KEY_PATH: other, APPLE_MUSIC_TEAM_ID: "ENV0000000", APPLE_MUSIC_KEY_ID: "ENVKEY0000" };
    const saved = { keyPath: "/saved.p8", teamId: "SAVED00000", keyId: "SAVEDKEY00" };
    expect(await loadKey({ key: keyPath, "team-id": TEAM, "key-id": "FLAGKEY000" }, env, saved)).toMatchObject({ keyPath: resolve(keyPath), teamId: TEAM, keyId: "FLAGKEY000" });
    expect(await loadKey({}, env, saved)).toMatchObject({ keyPath: resolve(other), teamId: "ENV0000000", keyId: "ENVKEY0000" });
    expect(await loadKey({}, {}, { ...saved, keyPath })).toMatchObject({ keyPath: resolve(keyPath), teamId: "SAVED00000", keyId: KEY_ID });
  });

  test("the key ID in the file's name wins over a saved one, which may be another key's", async () => {
    expect(await loadKey({ key: keyPath }, {}, { teamId: TEAM, keyId: "OLDKEY0000" })).toMatchObject({ keyId: KEY_ID });
  });

  test("a saved key ID serves a file whose name does not carry one", async () => {
    const renamed = join(dir, "musickit.p8");
    await writeFile(renamed, PEM);
    expect(await loadKey({ key: renamed }, {}, { teamId: TEAM, keyId: KEY_ID })).toMatchObject({ keyId: KEY_ID });
  });

  test("a variable set to nothing is taken as not set", async () => {
    expect(await loadKey({}, { APPLE_MUSIC_KEY_PATH: "", APPLE_MUSIC_TEAM_ID: "", APPLE_MUSIC_KEY_ID: "" }, { keyPath, teamId: TEAM })).toMatchObject({ keyId: KEY_ID, teamId: TEAM });
  });

  test("each missing piece is a mistake in how the CLI was run, named with where it can come from", async () => {
    expect(await thrown(() => loadKey({}, {}, {}))).toMatchObject({ exitCode: 2, message: expect.stringMatching(/--key.*APPLE_MUSIC_KEY_PATH/) as unknown });
    expect(await thrown(() => loadKey({ key: keyPath }, {}, {}))).toMatchObject({ exitCode: 2, message: expect.stringMatching(/--team-id.*APPLE_MUSIC_TEAM_ID/) as unknown });
    const renamed = join(dir, "musickit.p8");
    await writeFile(renamed, PEM);
    expect(await thrown(() => loadKey({ key: renamed, "team-id": TEAM }, {}, {}))).toMatchObject({ exitCode: 2, message: expect.stringMatching(/--key-id.*APPLE_MUSIC_KEY_ID/) as unknown });
  });

  test("an ID that is not ten capital letters and digits is refused before the file is read, by its length and not its value", async () => {
    for (const [flags, what] of [
      [{ key: keyPath, "team-id": "def123ghij" }, "team ID"],
      [{ key: keyPath, "team-id": "TOOSHORT" }, "team ID"],
      [{ key: keyPath, "team-id": TEAM, "key-id": "ABC123DEFG1" }, "key ID"],
    ] as const) {
      const e = await thrown(() => loadKey(flags, {}, {}));
      expect(e.exitCode).toBe(2);
      expect(e.message).toContain(what);
      expect(e.message).not.toContain(flags["team-id"] === TEAM ? "ABC123DEFG1" : flags["team-id"]);
    }
  });

  test("a file that cannot be read is named by its path and where the path came from", async () => {
    const missing = join(dir, "AuthKey_MISSING000.p8");
    const e = await thrown(() => loadKey({}, { APPLE_MUSIC_KEY_PATH: missing, APPLE_MUSIC_TEAM_ID: TEAM }, {}));
    expect(e).toMatchObject({ exitCode: 2 });
    expect(e.message).toContain(missing);
    expect(e.message).toContain("APPLE_MUSIC_KEY_PATH");
    expect(e.message).toContain("ENOENT");
  });

  test("a file that is no P-256 private key is refused here, not as a 401 from Apple, and none of it is quoted", async () => {
    const cases = {
      "not a key": `hello ${TEAM}`,
      "an RSA key": generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "a P-384 key": pemOf({ namedCurve: "P-384" }),
      "a public key": generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
    for (const [name, contents] of Object.entries(cases)) {
      const path = join(dir, `AuthKey_${KEY_ID}.p8`);
      await writeFile(path, contents);
      const e = await thrown(() => loadKey({ key: path, "team-id": TEAM }, {}, {}));
      expect(e.exitCode, name).toBe(2);
      expect(e.message, name).toContain(path);
      expect(e.message, name).toContain("not a MusicKit private key");
      expect(e.message, name).not.toContain(contents.split("\n")[1] ?? contents);
    }
  });
});

/* eslint-disable @typescript-eslint/naming-convention -- environment variables are UPPER_CASE by convention */
import { inspect, parseEnv } from "node:util";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { readEnv, type tSetting } from "./env.js";
import { developerTokenMinter, mintDeveloperToken, type tMintOptions } from "./mint.js";

let pem: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  publicKey = pair.publicKey;
  pem = (await exportPKCS8(pair.privateKey)).trim();
});

const ALL: tSetting[] = ["pem", "teamId", "keyId"];
/** An environment with the three settings under their default names. */
const env = (over: Record<string, unknown> = {}) => ({ APPLE_MUSIC_PRIVATE_KEY: pem, APPLE_MUSIC_TEAM_ID: "DEF123GHIJ", APPLE_MUSIC_KEY_ID: "ABC123DEFG", ...over });

const thrown = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error("expected an Error to be thrown");
};
const rejected = async (p: Promise<unknown>): Promise<Error> => {
  const error: unknown = await p.catch((e: unknown) => e);
  if (error instanceof Error) return error;
  throw new Error("expected a rejection");
};

/** True when any stretch of the key's body shows up in what an error can reveal. */
function leaks(error: Error): boolean {
  const said = `${error.message} ${error.stack ?? ""} ${inspect(error, { depth: null, showHidden: true })} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
  const body = pem.split("\n").slice(1, -1).join("");
  for (let i = 0; i + 12 <= body.length; i += 4) if (said.includes(body.slice(i, i + 12))) return true;
  return false;
}

/** What a token says, once its signature has been checked against the public key. */
async function read(token: string) {
  const { payload, protectedHeader } = await jwtVerify(token, publicKey);
  return { kid: protectedHeader.kid, iss: payload.iss, origin: payload.origin, life: (payload.exp ?? 0) - (payload.iat ?? 0) };
}

describe("readEnv: reading", () => {
  test("takes each wanted setting from its default variable, and says which variable that was", () => {
    expect(readEnv(env(), undefined, ALL)).toEqual({
      pem: { value: pem, variable: "APPLE_MUSIC_PRIVATE_KEY" },
      teamId: { value: "DEF123GHIJ", variable: "APPLE_MUSIC_TEAM_ID" },
      keyId: { value: "ABC123DEFG", variable: "APPLE_MUSIC_KEY_ID" },
    });
  });

  test.each<[string, tSetting[], string[]]>([
    ["the key alone", ["pem"], ["pem"]],
    ["the two IDs", ["teamId", "keyId"], ["keyId", "teamId"]],
    ["nothing", [], []],
  ])("reads %s when that is all that is wanted", (_name, wanted, keys) => {
    expect(Object.keys(readEnv(env(), undefined, wanted)).sort()).toEqual(keys);
  });

  test.each<[string, tSetting[], Record<string, unknown>]>([
    ["the IDs, when only the key is wanted", ["pem"], { APPLE_MUSIC_TEAM_ID: undefined, APPLE_MUSIC_KEY_ID: "" }],
    ["the key, when only the IDs are wanted", ["teamId", "keyId"], { APPLE_MUSIC_PRIVATE_KEY: undefined }],
    ["anything, when nothing is wanted", [], { APPLE_MUSIC_PRIVATE_KEY: undefined, APPLE_MUSIC_TEAM_ID: undefined, APPLE_MUSIC_KEY_ID: undefined }],
  ])("does not need %s", (_name, wanted, over) => {
    expect(() => readEnv(env(over), undefined, wanted)).not.toThrow();
  });

  test.each([
    ["the key", { pem: "MUSICKIT_KEY" }, { MUSICKIT_KEY: "other key", APPLE_MUSIC_PRIVATE_KEY: undefined }, { pem: { value: "other key", variable: "MUSICKIT_KEY" } }],
    ["the Team ID", { teamId: "TEAM" }, { TEAM: "TEAM000001", APPLE_MUSIC_TEAM_ID: undefined }, { teamId: { value: "TEAM000001", variable: "TEAM" } }],
    ["the key ID", { keyId: "kid_2" }, { kid_2: "KEY0000002", APPLE_MUSIC_KEY_ID: undefined }, { keyId: { value: "KEY0000002", variable: "kid_2" } }],
  ])("another name for %s is read instead of the default, not as well as it", (_name, variables, over, expected) => {
    expect(readEnv(env(over), variables, ALL)).toMatchObject(expected);
  });

  test("an undefined name means the default", () => {
    expect(readEnv(env(), { pem: undefined, teamId: undefined, keyId: undefined }, ALL).teamId?.variable).toBe("APPLE_MUSIC_TEAM_ID");
  });

  test.each([" DEF123GHIJ", "DEF123GHIJ ", "DEF123GHIJ\r", "\tDEF123GHIJ\n"])("whitespace around %j, as a hand-edited file leaves it, is dropped", (teamId) => {
    expect(readEnv(env({ APPLE_MUSIC_TEAM_ID: teamId }), undefined, ALL).teamId?.value).toBe("DEF123GHIJ");
  });

  test.each([
    ["with unrelated variables", () => env({ PATH: "/usr/bin", NODE_ENV: "production" })],
    ["with bindings that are not strings, as a Workers env has", () => env({ TOKENS: { get: () => null }, COUNT: 3 })],
    ["without a prototype", () => Object.assign(Object.create(null) as object, env())],
    [
      "that is a class instance",
      () =>
        Object.assign(
          new (class Env {
            readonly bound = true;
          })(),
          env(),
        ),
    ],
  ])("reads an environment %s", (_name, make) => {
    expect(readEnv(make(), undefined, ALL).keyId?.value).toBe("ABC123DEFG");
  });
});

describe("readEnv: a variable that is missing", () => {
  const variables = ["APPLE_MUSIC_PRIVATE_KEY", "APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID"];
  const absent: [string, unknown][] = [
    ["undefined", undefined],
    ["empty", ""],
    ["only whitespace", " \n"],
    ["a number", 42],
    ["null", null],
    ["an object", { value: "DEF123GHIJ" }],
  ];

  test.each(variables.flatMap((name) => absent.map(([how, value]) => [name, how, value] as const)))("%s being %s is a TypeError that names it alone", (name, _how, value) => {
    const error = thrown(() => readEnv(env({ [name]: value }), undefined, ALL));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain(name);
    for (const other of variables.filter((v) => v !== name)) expect(error.message).not.toContain(other);
  });

  test("every missing variable is named at once", () => {
    const error = thrown(() => readEnv({}, undefined, ALL));
    expect(error).toBeInstanceOf(TypeError);
    for (const name of variables) expect(error.message).toContain(name);
  });

  test("only the wanted ones are reported", () => {
    const error = thrown(() => readEnv({}, undefined, ["pem"]));
    expect(error.message).toContain("APPLE_MUSIC_PRIVATE_KEY");
    expect(error.message).not.toMatch(/TEAM_ID|KEY_ID/);
  });

  test("another name is the one reported", () => {
    const error = thrown(() => readEnv(env(), { keyId: "MUSICKIT_KEY_ID" }, ALL));
    expect(error.message).toContain("MUSICKIT_KEY_ID");
    expect(error.message).not.toContain("APPLE_MUSIC_KEY_ID");
  });
});

describe("readEnv: no error quotes a value", () => {
  test.each<[string, () => unknown]>([
    ["the key itself where the environment belongs", () => readEnv(pem, undefined, ALL)],
    ["undefined where the environment belongs", () => readEnv(undefined, undefined, ALL)],
    ["null where the environment belongs", () => readEnv(null, undefined, ALL)],
    ["a number where the environment belongs", () => readEnv(42, undefined, ALL)],
    ["the key where the names belong", () => readEnv(env(), pem, ALL)],
    ["null where the names belong", () => readEnv(env(), null, ALL)],
    ["the key where the name of its variable belongs", () => readEnv(env(), { pem }, ALL)],
    ["the key where another name belongs", () => readEnv(env(), { teamId: pem.replaceAll("\n", "\\n") }, ALL)],
    ["the key as the name of a setting that is not even wanted", () => readEnv(env(), { teamId: pem }, ["pem"])],
    ["a name with a space in it", () => readEnv(env(), { keyId: "KEY ID" }, ALL)],
    ["an empty name", () => readEnv(env(), { keyId: "" }, ALL)],
    ["a name that is not a string", () => readEnv(env(), { keyId: 42 }, ALL)],
    ["the key under the wrong variable, leaving its own empty", () => readEnv(env({ APPLE_MUSIC_PRIVATE_KEY: "", APPLE_MUSIC_TEAM_ID: pem }), { teamId: "APPLE_MUSIC_PRIVATE_KEY" }, ALL)],
    ["the key wrapped in an object", () => readEnv(env({ APPLE_MUSIC_PRIVATE_KEY: { pem } }), undefined, ALL)],
  ])("%s is a TypeError without the key in it", (_name, misuse) => {
    const error = thrown(misuse);
    expect(error).toBeInstanceOf(TypeError);
    expect(leaks(error)).toBe(false);
  });
});

describe("env as an option: from a .env file to a token", () => {
  const ids = "APPLE_MUSIC_TEAM_ID=DEF123GHIJ\nAPPLE_MUSIC_KEY_ID=ABC123DEFG\n";
  const escaped = () => pem.replaceAll("\n", "\\n");

  test.each([
    ["on one line with escaped line breaks, double-quoted", () => `${ids}APPLE_MUSIC_PRIVATE_KEY="${escaped()}"\n`],
    ["on one line with escaped line breaks, single-quoted", () => `${ids}APPLE_MUSIC_PRIVATE_KEY='${escaped()}'\n`],
    ["over several lines, double-quoted", () => `${ids}APPLE_MUSIC_PRIVATE_KEY="${pem}"\n`],
    ["in a file with Windows line endings", () => `${ids}APPLE_MUSIC_PRIVATE_KEY="${escaped()}"\n`.replaceAll("\n", "\r\n")],
    ["with Windows line breaks escaped inside it", () => `${ids}APPLE_MUSIC_PRIVATE_KEY="${pem.replaceAll("\n", "\\r\\n")}"\n`],
  ])("a key written %s mints a token that verifies", async (_name, file) => {
    // parseEnv is what `node --env-file` and process.loadEnvFile use.
    expect(await read(await mintDeveloperToken({ env: parseEnv(file()) }))).toMatchObject({ iss: "DEF123GHIJ", kid: "ABC123DEFG" });
  });

  test("a minter takes the environment beside its other options", async () => {
    const minter = developerTokenMinter({ env: env(), ttlSeconds: 3600, origin: ["https://app.example"] });
    expect(await read(await minter())).toEqual({ iss: "DEF123GHIJ", kid: "ABC123DEFG", origin: ["https://app.example"], life: 3600 });
  });

  test("other variable names are given in variables", async () => {
    const elsewhere = { MUSICKIT_KEY: pem, TEAM: "TEAM000001", KID: "KEY0000002" };
    const token = await mintDeveloperToken({ env: elsewhere, variables: { pem: "MUSICKIT_KEY", teamId: "TEAM", keyId: "KID" } });
    expect(await read(token)).toMatchObject({ iss: "TEAM000001", kid: "KEY0000002" });
  });

  test("the environment is read once, when the minter is created: emptying it afterwards changes nothing", async () => {
    const mine: Record<string, unknown> = env();
    const minter = developerTokenMinter({ env: mine });
    for (const name of Object.keys(mine)) Reflect.deleteProperty(mine, name);
    expect(await read(await minter())).toMatchObject({ iss: "DEF123GHIJ", kid: "ABC123DEFG" });
  });
});

describe("env as an option: what is given outright is used instead of its variable", () => {
  test.each<[string, Partial<Record<tSetting, string>>, { iss: string; kid: string }]>([
    ["a teamId", { teamId: "TEAM000001" }, { iss: "TEAM000001", kid: "ABC123DEFG" }],
    ["a keyId", { keyId: "KEY0000002" }, { iss: "DEF123GHIJ", kid: "KEY0000002" }],
    ["both IDs", { teamId: "TEAM000001", keyId: "KEY0000002" }, { iss: "TEAM000001", kid: "KEY0000002" }],
  ])("%s given outright wins over the one in the environment", async (_name, given, expected) => {
    expect(await read(await mintDeveloperToken({ env: env(), ...given }))).toMatchObject(expected);
  });

  test("a pem given outright wins over the one in the environment", async () => {
    const token = await mintDeveloperToken({ env: env({ APPLE_MUSIC_PRIVATE_KEY: "not a key" }), pem });
    expect(await read(token)).toMatchObject({ iss: "DEF123GHIJ" });
  });

  test.each<[string, () => tMintOptions]>([
    ["the key only, when both IDs are given", () => ({ env: { APPLE_MUSIC_PRIVATE_KEY: pem }, teamId: "DEF123GHIJ", keyId: "ABC123DEFG" })],
    ["the IDs only, when the key is given", () => ({ env: { APPLE_MUSIC_TEAM_ID: "DEF123GHIJ", APPLE_MUSIC_KEY_ID: "ABC123DEFG" }, pem })],
    ["nothing at all, when all three are given", () => ({ env: {}, pem, teamId: "DEF123GHIJ", keyId: "ABC123DEFG" })],
  ])("the environment has to hold %s", async (_name, options) => {
    expect(await read(await mintDeveloperToken(options()))).toMatchObject({ iss: "DEF123GHIJ", kid: "ABC123DEFG" });
    expect(() => developerTokenMinter(options())).not.toThrow();
  });
});

describe("env as an option: mistakes are TypeErrors when the options are read, naming a variable and never its value", () => {
  /** The same mistake as mintDeveloperToken rejects it and as developerTokenMinter throws it. */
  async function both(options: () => unknown): Promise<Error[]> {
    return [await rejected(mintDeveloperToken(options() as tMintOptions)), thrown(() => developerTokenMinter(options() as tMintOptions))];
  }

  test.each([
    ["APPLE_MUSIC_PRIVATE_KEY", { APPLE_MUSIC_PRIVATE_KEY: undefined }],
    ["APPLE_MUSIC_TEAM_ID", { APPLE_MUSIC_TEAM_ID: "" }],
    ["APPLE_MUSIC_KEY_ID", { APPLE_MUSIC_KEY_ID: "  " }],
  ])("a missing %s is named", async (name, over) => {
    for (const error of await both(() => ({ env: env(over) }))) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toContain(name);
      expect(leaks(error)).toBe(false);
    }
  });

  test.each([
    ["a Team ID in lower case", { APPLE_MUSIC_TEAM_ID: "def123ghij" }, "teamId (read from APPLE_MUSIC_TEAM_ID)", "def123ghij"],
    ["a key ID that is the file name", { APPLE_MUSIC_KEY_ID: "AuthKey_ABC123DEFG.p8" }, "keyId (read from APPLE_MUSIC_KEY_ID)", "AuthKey_ABC123DEFG"],
  ])("%s is reported with the variable it was read from, not its value", async (_name, over, label, value) => {
    for (const error of await both(() => ({ env: env(over) }))) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toContain(label);
      expect(error.message).not.toContain(value);
    }
  });

  test("the key put under the Team ID's variable is refused there, and not quoted", async () => {
    for (const error of await both(() => ({ env: env({ APPLE_MUSIC_TEAM_ID: pem }) }))) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toContain("APPLE_MUSIC_TEAM_ID");
      expect(leaks(error)).toBe(false);
    }
  });

  test("a value in the environment that is no key fails on first use, naming the variable", async () => {
    const error = await rejected(mintDeveloperToken({ env: env({ APPLE_MUSIC_PRIVATE_KEY: "not a key" }) }));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("APPLE_MUSIC_PRIVATE_KEY");
  });

  test.each<[string, () => unknown]>([
    ["the key where env belongs", () => ({ env: pem })],
    ["null where env belongs", () => ({ env: null })],
    ["variables without an env to read them from", () => ({ pem, teamId: "DEF123GHIJ", keyId: "ABC123DEFG", variables: { pem: "MUSICKIT_KEY" } })],
    ["the key where a variable's name belongs", () => ({ env: env(), variables: { pem } })],
    ["the key where variables belongs", () => ({ env: env(), variables: pem })],
  ])("%s is refused without the key in the error", async (_name, options) => {
    for (const error of await both(options)) {
      expect(error).toBeInstanceOf(TypeError);
      expect(leaks(error)).toBe(false);
    }
  });
});

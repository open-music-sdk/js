/* eslint-disable @typescript-eslint/naming-convention -- environment variables are UPPER_CASE by convention */
import { inspect, parseEnv } from "node:util";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { fromEnv } from "./env.js";
import { cachedMinter, mintDeveloperToken } from "./mint.js";

let pem: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  publicKey = pair.publicKey;
  pem = (await exportPKCS8(pair.privateKey)).trim();
});

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

/** True when any stretch of the key's body shows up in what an error can reveal. */
function leaks(error: Error): boolean {
  const said = `${error.message} ${error.stack ?? ""} ${inspect(error, { depth: null, showHidden: true })} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
  const body = pem.split("\n").slice(1, -1).join("");
  for (let i = 0; i + 12 <= body.length; i += 4) if (said.includes(body.slice(i, i + 12))) return true;
  return false;
}

describe("fromEnv: reading", () => {
  test("takes the key and both IDs from the default variables", () => {
    const key = fromEnv(env());
    expect(key.pem.unwrap()).toBe(pem);
    expect({ teamId: key.teamId, keyId: key.keyId }).toEqual({ teamId: "DEF123GHIJ", keyId: "ABC123DEFG" });
  });

  test("hands the key back redacted", () => {
    const key = fromEnv(env());
    expect(`${String(key.pem)} ${JSON.stringify(key)} ${inspect(key, { depth: null, showHidden: true })}`).not.toContain(pem.split("\n")[1]);
    expect(JSON.stringify(key)).toBe('{"pem":"<redacted>","teamId":"DEF123GHIJ","keyId":"ABC123DEFG"}');
  });

  test.each([
    ["the key", { pem: "MUSICKIT_KEY" }, { MUSICKIT_KEY: "other key", APPLE_MUSIC_PRIVATE_KEY: undefined }, { pem: "other key" }],
    ["the Team ID", { teamId: "TEAM" }, { TEAM: "TEAM000001", APPLE_MUSIC_TEAM_ID: undefined }, { teamId: "TEAM000001" }],
    ["the key ID", { keyId: "kid_2" }, { kid_2: "KEY0000002", APPLE_MUSIC_KEY_ID: undefined }, { keyId: "KEY0000002" }],
  ])("a custom name for %s is read instead of the default", (_name, names, over, expected) => {
    const key = fromEnv(env(over), names);
    expect({ pem: key.pem.unwrap(), teamId: key.teamId, keyId: key.keyId }).toMatchObject(expected);
  });

  test("an undefined name means the default", () => {
    expect(fromEnv(env(), { pem: undefined, teamId: undefined, keyId: undefined }).teamId).toBe("DEF123GHIJ");
  });

  test.each([" DEF123GHIJ", "DEF123GHIJ ", "DEF123GHIJ\r", "\tDEF123GHIJ\n"])("whitespace around %j, as a hand-edited file leaves it, is dropped", (teamId) => {
    expect(fromEnv(env({ APPLE_MUSIC_TEAM_ID: teamId })).teamId).toBe("DEF123GHIJ");
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
    expect(fromEnv(make()).keyId).toBe("ABC123DEFG");
  });
});

describe("fromEnv: a variable that is missing", () => {
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
    const error = thrown(() => fromEnv(env({ [name]: value })));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain(name);
    for (const other of variables.filter((v) => v !== name)) expect(error.message).not.toContain(other);
  });

  test("every missing variable is named at once", () => {
    const error = thrown(() => fromEnv({}));
    expect(error).toBeInstanceOf(TypeError);
    for (const name of variables) expect(error.message).toContain(name);
  });

  test("a custom name is the one reported", () => {
    const error = thrown(() => fromEnv(env(), { keyId: "MUSICKIT_KEY_ID" }));
    expect(error.message).toContain("MUSICKIT_KEY_ID");
    expect(error.message).not.toContain("APPLE_MUSIC_KEY_ID");
  });
});

describe("fromEnv: no error quotes a value", () => {
  test.each([
    ["the key itself where the environment belongs", () => fromEnv(pem as unknown as object)],
    ["undefined where the environment belongs", () => fromEnv(undefined as unknown as object)],
    ["null where the environment belongs", () => fromEnv(null as unknown as object)],
    ["the key where the name of its variable belongs", () => fromEnv(env(), { pem })],
    ["the key where another name belongs", () => fromEnv(env(), { teamId: pem.replaceAll("\n", "\\n") })],
    ["a name with a space in it", () => fromEnv(env(), { keyId: "KEY ID" })],
    ["an empty name", () => fromEnv(env(), { keyId: "" })],
    ["a name that is not a string", () => fromEnv(env(), { keyId: 42 as unknown as string })],
    ["the key under the wrong variable, leaving its own empty", () => fromEnv(env({ APPLE_MUSIC_PRIVATE_KEY: "", APPLE_MUSIC_TEAM_ID: pem }), { teamId: "APPLE_MUSIC_PRIVATE_KEY" })],
    ["the key wrapped in an object", () => fromEnv(env({ APPLE_MUSIC_PRIVATE_KEY: { pem } }))],
  ])("%s is a TypeError without the key in it", (_name, misuse) => {
    const error = thrown(misuse);
    expect(error).toBeInstanceOf(TypeError);
    expect(leaks(error)).toBe(false);
  });
});

describe("fromEnv: from a .env file to a token", () => {
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
    const token = await mintDeveloperToken(fromEnv(parseEnv(file())));
    const { payload, protectedHeader } = await jwtVerify(token, publicKey);
    expect([payload.iss, protectedHeader.kid]).toEqual(["DEF123GHIJ", "ABC123DEFG"]);
  });

  test("the result spreads into a minter beside its other options", async () => {
    const minter = cachedMinter({ ...fromEnv(env()), ttlSeconds: 3600, origin: ["https://app.example"] });
    const { payload } = await jwtVerify(await minter(), publicKey);
    expect(payload.origin).toEqual(["https://app.example"]);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
  });
});

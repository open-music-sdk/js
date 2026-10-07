import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mintDeveloperToken } from "./mint.js";
import { fromKeyFile } from "./node.js";

let dir: string;
let file: string;
let pem: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  publicKey = pair.publicKey;
  pem = await exportPKCS8(pair.privateKey);
  dir = await mkdtemp(join(tmpdir(), "developer-token-"));
  file = join(dir, "AuthKey_ABC123DEFG.p8");
  await writeFile(file, pem);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fromKeyFile", () => {
  test.each([
    ["a path", () => file],
    ["a file URL", () => pathToFileURL(file)],
  ])("reads the key from %s", async (_name, path) => {
    expect((await fromKeyFile(path())).unwrap()).toBe(pem);
  });

  test("hands the key back redacted", async () => {
    const key = await fromKeyFile(file);
    expect(`${String(key)} ${JSON.stringify({ key })} ${inspect({ key }, { depth: null, showHidden: true })}`).not.toContain(pem.split("\n")[1]);
  });

  test("the result mints a token that verifies", async () => {
    const token = await mintDeveloperToken({ pem: await fromKeyFile(file), teamId: "DEF123GHIJ", keyId: "ABC123DEFG" });
    expect((await jwtVerify(token, publicKey)).payload.iss).toBe("DEF123GHIJ");
  });

  test.each([
    ["a file that does not exist", () => join(dir, "missing.p8"), "ENOENT"],
    ["a directory", () => dir, "EISDIR"],
  ])("rejects %s", async (_name, path, code) => {
    await expect(fromKeyFile(path())).rejects.toMatchObject({ code });
  });
});

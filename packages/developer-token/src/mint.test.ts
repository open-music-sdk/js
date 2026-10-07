import { generateKeyPairSync } from "node:crypto";
import { createClient } from "@open-music-sdk/core";
import { decodeProtectedHeader, exportPKCS8, exportSPKI, generateKeyPair, jwtVerify } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cachedMinter, mintDeveloperToken, type tMintOptions } from "./mint.js";
import { redacted } from "./redacted.js";

const NOW = Date.UTC(2026, 9, 7);
const NOW_SECONDS = NOW / 1000;
const DAY_SECONDS = 86_400;

let publicKey: CryptoKey;
let valid: tMintOptions;
/** PEMs that are well formed but are not a PKCS8 P-256 private key. */
const wrongKeys: Record<string, string> = {};

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  publicKey = pair.publicKey;
  valid = { pem: await exportPKCS8(pair.privateKey), teamId: "DEF123GHIJ", keyId: "ABC123DEFG" };

  wrongKeys["a public key"] = await exportSPKI(pair.publicKey);
  wrongKeys["a P-384 key"] = await exportPKCS8((await generateKeyPair("ES384", { extractable: true })).privateKey);
  wrongKeys["an Ed25519 key"] = await exportPKCS8((await generateKeyPair("Ed25519", { extractable: true })).privateKey);
  wrongKeys["an RSA key"] = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
  wrongKeys["a P-256 key in SEC1 rather than PKCS8"] = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "sec1", format: "pem" }).toString();
});

/** Moves time to `ms` after the start, on the wall clock and the monotonic clock together. */
const at = (ms: number) => {
  vi.advanceTimersByTime(NOW + ms - Date.now());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Verifies the signature against the public key and returns what the token says. */
async function read(token: string) {
  const { payload, protectedHeader } = await jwtVerify(token, publicKey);
  return { header: protectedHeader, claims: payload };
}

const invalid: [string, Record<string, unknown>][] = [
  ["a missing pem", { pem: undefined }],
  ["an empty pem", { pem: "" }],
  ["a redacted pem holding nothing", { pem: redacted(undefined) }],
  ["an empty teamId", { teamId: "" }],
  ["a missing teamId", { teamId: undefined }],
  ["a numeric teamId", { teamId: 1234567890 }],
  ["a teamId of nine characters", { teamId: "DEF123GHI" }],
  ["a teamId of eleven characters", { teamId: "DEF123GHIJK" }],
  ["a teamId in lower case", { teamId: "def123ghij" }],
  ["a teamId with a trailing newline", { teamId: "DEF123GHIJ\n" }],
  ["a teamId with a leading space", { teamId: " DEF123GHIJ" }],
  ["a teamId of ten spaces", { teamId: " ".repeat(10) }],
  ["a teamId with punctuation", { teamId: "DEF-123-GH" }],
  ["an empty keyId", { keyId: "" }],
  ["a missing keyId", { keyId: undefined }],
  ["a keyId that is the key's file name", { keyId: "AuthKey_ABC123DEFG.p8" }],
  ["a keyId of nine characters", { keyId: "ABC123DEF" }],
  ["a keyId in lower case", { keyId: "abc123defg" }],
  ["a keyId with a trailing carriage return", { keyId: "ABC123DEFG\r" }],
  ["a keyId with a letter outside ASCII", { keyId: "ABC123DEFÉ" }],
  ["a zero ttl", { ttlSeconds: 0 }],
  ["a negative ttl", { ttlSeconds: -60 }],
  ["a fractional ttl", { ttlSeconds: 1.5 }],
  ["a NaN ttl", { ttlSeconds: Number.NaN }],
  ["an infinite ttl", { ttlSeconds: Number.POSITIVE_INFINITY }],
  ["a ttl one second past six months", { ttlSeconds: 15_777_001 }],
  ["a ttl given in milliseconds", { ttlSeconds: 150 * DAY_SECONDS * 1000 }],
  ["a string ttl", { ttlSeconds: "3600" }],
  ["a null ttl", { ttlSeconds: null }],
  ["an empty origin list", { origin: [] }],
  ["an origin that is a bare string", { origin: "https://example.com" }],
  ["an origin list with an empty entry", { origin: ["https://example.com", ""] }],
  ["an origin list with a non-string", { origin: [42] }],
  ["an origin list with a null", { origin: ["https://example.com", null] }],
  ["an origin list with a hole in it", { origin: new Array<string>(2) }],
  ["a wildcard origin", { origin: ["*"] }],
  ["an origin without a scheme", { origin: ["app.example"] }],
  ["an origin with a trailing slash", { origin: ["https://app.example/"] }],
  ["an origin with a path", { origin: ["https://app.example/music"] }],
  ["an origin with a query", { origin: ["https://app.example?x=1"] }],
  ["an origin with whitespace before it", { origin: [" https://app.example"] }],
  ["an origin with a newline after it", { origin: ["https://app.example\n"] }],
  ["an origin with capitals in the host", { origin: ["https://App.Example"] }],
  ["an origin that spells out the default port", { origin: ["https://app.example:443"] }],
  ["an origin with credentials", { origin: ["https://user:pass@app.example"] }],
  ["an origin on a scheme browsers do not send", { origin: ["ftp://app.example"] }],
  ["the opaque origin", { origin: ["null"] }],
  ["one bad origin after a good one", { origin: ["https://app.example", "https://app.example/"] }],
];

describe("mintDeveloperToken: the token", () => {
  test("is an ES256 JWT naming the key and the team, with nothing else in it", async () => {
    const { header, claims } = await read(await mintDeveloperToken(valid));
    expect(header).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(claims).toEqual({ iss: "DEF123GHIJ", iat: NOW_SECONDS, exp: NOW_SECONDS + 150 * DAY_SECONDS });
  });

  test("carries a raw 64-byte signature, not DER", async () => {
    const signature = (await mintDeveloperToken(valid)).split(".")[2] ?? "";
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
  });

  test.each([1, 60, 3600, 150 * DAY_SECONDS, 15_777_000])("ttlSeconds %i puts exp that many seconds after iat", async (ttlSeconds) => {
    const { claims } = await read(await mintDeveloperToken({ ...valid, ttlSeconds }));
    expect(claims.exp).toBe(NOW_SECONDS + ttlSeconds);
  });

  test("an undefined ttlSeconds means the default", async () => {
    const { claims } = await read(await mintDeveloperToken({ ...valid, ttlSeconds: undefined }));
    expect(claims.exp).toBe(NOW_SECONDS + 150 * DAY_SECONDS);
  });

  test("iat is in whole seconds even when the clock is between them", async () => {
    at(999);
    const { claims } = await read(await mintDeveloperToken(valid));
    expect(claims.iat).toBe(NOW_SECONDS);
  });

  test.each([
    [["https://example.com"]],
    [["https://example.com", "https://music.example.com", "http://localhost:3000"]],
    [["https://app.example:8443", "http://127.0.0.1:5173", "http://[::1]:3000"]],
    [["https://xn--bcher-kva.example"]],
  ])("origin %j is carried as given", async (origin) => {
    const { claims } = await read(await mintDeveloperToken({ ...valid, origin }));
    expect(claims.origin).toEqual(origin);
  });

  test.each(["DEF123GHIJ", "0123456789", "ABCDEFGHIJ", "A1B2C3D4E5"])("%s is accepted as a Team ID and as a key ID", async (value) => {
    const { header, claims } = await read(await mintDeveloperToken({ ...valid, teamId: value, keyId: value }));
    expect([claims.iss, header.kid]).toEqual([value, value]);
  });

  test("an undefined origin leaves the claim out", async () => {
    const { claims } = await read(await mintDeveloperToken({ ...valid, origin: undefined }));
    expect(claims).not.toHaveProperty("origin");
  });

  test("two mints are two tokens, both valid", async () => {
    const [a, b] = [await mintDeveloperToken(valid), await mintDeveloperToken(valid)];
    expect(a).not.toBe(b);
    await read(a);
    await read(b);
  });
});

describe("mintDeveloperToken: the key", () => {
  test.each([
    ["with escaped newlines, as an environment variable holds it", (pem: string) => pem.replaceAll("\n", "\\n")],
    ["with Windows line endings", (pem: string) => pem.replaceAll("\n", "\r\n")],
    ["with whitespace around it", (pem: string) => `\n  ${pem}\n\n`],
    ["with a byte order mark, as some editors save it", (pem: string) => String.fromCharCode(0xfeff) + pem],
    ["redacted", (pem: string) => redacted(pem)],
  ])("accepts the PEM %s", async (_name, wrap) => {
    await read(await mintDeveloperToken({ ...valid, pem: wrap(valid.pem as string) }));
  });

  test.each(["a public key", "a P-384 key", "an Ed25519 key", "an RSA key", "a P-256 key in SEC1 rather than PKCS8"])("rejects %s", async (name) => {
    await expect(mintDeveloperToken({ ...valid, pem: wrongKeys[name] ?? "" })).rejects.toThrow(TypeError);
  });

  test.each([
    ["text that is not a PEM", "not a key"],
    ["a file path", "./AuthKey_ABC123DEFG.p8"],
    ["a PEM with a corrupt body", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"],
    ["a truncated PEM", "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg"],
  ])("rejects %s", async (_name, pem) => {
    await expect(mintDeveloperToken({ ...valid, pem })).rejects.toThrow(TypeError);
  });

  test("a rejected key is not quoted in the error", async () => {
    const pem = valid.pem as string;
    const body = pem.split("\n")[1] ?? ""; // the first line of key material, which is cut short below
    const error: unknown = await mintDeveloperToken({ ...valid, pem: pem.replace(body, body.slice(0, -4)) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    const said = `${String(error)} ${String((error as Error).cause)} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
    expect(said).not.toContain(body.slice(0, 16));
  });
});

describe("mintDeveloperToken: invalid options", () => {
  test.each(invalid)("rejects %s with a TypeError", async (_name, bad) => {
    await expect(mintDeveloperToken({ ...valid, ...bad })).rejects.toThrow(TypeError);
  });
});

describe("mintDeveloperToken: the key never ends up in a token or an error by being put in the wrong option", () => {
  const body = () => (valid.pem as string).split("\n").slice(1, -1).join("");
  /** True when any stretch of the key's body shows up in the text. */
  const leaks = (text: string) => Array.from({ length: Math.floor((body().length - 12) / 4) }, (_unused, i) => body().slice(i * 4, i * 4 + 12)).some((part) => text.includes(part));

  test.each([
    ["keyId", (pem: string) => ({ keyId: pem })],
    ["teamId", (pem: string) => ({ teamId: pem })],
    ["keyId, with its line breaks escaped", (pem: string) => ({ keyId: pem.replaceAll("\n", "\\n") })],
    ["origin", (pem: string) => ({ origin: [pem] })],
    ["origin, after a good entry", (pem: string) => ({ origin: ["https://app.example", pem] })],
  ])("the key given as %s is refused, not signed, and not quoted", async (_name, misplace) => {
    const error: unknown = await mintDeveloperToken({ ...valid, ...misplace(valid.pem as string) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    const e = error as Error;
    expect(leaks(`${e.message} ${e.stack ?? ""} ${JSON.stringify(e, Object.getOwnPropertyNames(e))}`)).toBe(false);
  });
});

describe("cachedMinter", () => {
  test.each(invalid)("refuses %s when it is created, not on first use", (_name, bad) => {
    expect(() => cachedMinter({ ...valid, ...bad })).toThrow(TypeError);
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("refuses refreshAheadSeconds %s when it is created", (refreshAheadSeconds) => {
    expect(() => cachedMinter({ ...valid, refreshAheadSeconds })).toThrow(TypeError);
  });

  test("a key that cannot be parsed fails each call, and is never cached as a token", async () => {
    const minter = cachedMinter({ ...valid, pem: "not a key" });
    await expect(minter({})).rejects.toThrow(TypeError);
    await expect(minter({})).rejects.toThrow(TypeError);
  });

  test("mints once and hands every caller the same valid token", async () => {
    const minter = cachedMinter({ ...valid, origin: ["https://example.com"] });
    const tokens = await Promise.all([minter({}), minter({}), minter({})]);
    tokens.push(await minter({}));
    expect(new Set(tokens).size).toBe(1);
    const { header, claims } = await read(tokens[0]);
    expect(header.kid).toBe("ABC123DEFG");
    expect(claims).toEqual({ iss: "DEF123GHIJ", iat: NOW_SECONDS, exp: NOW_SECONDS + 150 * DAY_SECONDS, origin: ["https://example.com"] });
  });

  /** The token the minter hands out once the one being signed in the background has replaced `previous`. */
  const next = (minter: () => Promise<string>, previous: string) =>
    vi.waitFor(async () => {
      const token = await minter();
      expect(token).not.toBe(previous);
      return token;
    });

  test("a day before a token expires, by default, the next is signed in the background and then handed out", async () => {
    const minter = cachedMinter(valid);
    const first = await minter({});
    at(149 * DAY_SECONDS * 1000 - 1);
    expect(await minter({})).toBe(first);
    at(149 * DAY_SECONDS * 1000);
    expect(await minter({})).toBe(first); // good for another day, so nobody waits for the new one
    const second = await next(minter, first);
    expect((await read(second)).claims.iat).toBe(NOW_SECONDS + 149 * DAY_SECONDS);
  });

  test.each([
    [3600, 60, 3540],
    [3600, undefined, 1800],
    [7 * DAY_SECONDS, 2 * DAY_SECONDS, 5 * DAY_SECONDS],
  ])("with ttl %i and refreshAhead %s, replaces the token after %i seconds", async (ttlSeconds, refreshAheadSeconds, after) => {
    const minter = cachedMinter({ ...valid, ttlSeconds, refreshAheadSeconds });
    const first = await minter({});
    at(after * 1000 - 1);
    expect(await minter({})).toBe(first);
    at(after * 1000);
    expect(await minter({})).toBe(first);
    await next(minter, first);
  });

  test("replaces a token Apple rejected once it has been in use, and only that one", async () => {
    const minter = cachedMinter(valid);
    const first = await minter({});
    at(60_000);
    expect(await minter({ rejected: "some other token" })).toBe(first);
    const second = await minter({ rejected: first });
    expect(second).not.toBe(first);
    expect(await minter({ rejected: first })).toBe(second);
    await read(second);
  });

  test.each([0, 1000, 59_999])("does not mint again for a token Apple rejects %i ms after it was minted: the same key would sign the same claims", async (age) => {
    const minter = cachedMinter(valid);
    const first = await minter({});
    at(age);
    expect(await minter({ rejected: first })).toBe(first);
  });
});

describe("cachedMinter as a client's developerToken", () => {
  /** A fetch that answers with the given statuses in turn and records each Authorization header. */
  function apple(...statuses: number[]) {
    const sent: string[] = [];
    const fetch = (input: RequestInfo | URL): Promise<Response> => {
      sent.push(new Request(input).headers.get("authorization") ?? "");
      return Promise.resolve(new Response("{}", { status: statuses.shift() ?? 200 }));
    };
    return { fetch, sent };
  }

  test("every request carries the one minted token as a Bearer", async () => {
    const { fetch, sent } = apple();
    const music = createClient({ developerToken: cachedMinter(valid), fetch, retry: false });
    await Promise.all([music.request("v1/test"), music.request("v1/test")]);
    await music.request("v1/test");
    expect(new Set(sent).size).toBe(1);
    expect(sent[0]).toMatch(/^Bearer /);
    expect(decodeProtectedHeader((sent[0] ?? "").slice(7))).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
  });

  test("a 401 is answered with a fresh token, which later requests keep using", async () => {
    const { fetch, sent } = apple(200, 401, 200, 200);
    const music = createClient({ developerToken: cachedMinter(valid), fetch, retry: false });
    await music.request("v1/test");
    at(5 * 60_000);
    await music.request("v1/test");
    await music.request("v1/test");
    expect(sent[1]).toBe(sent[0]);
    expect(sent[2]).not.toBe(sent[0]);
    expect(sent[3]).toBe(sent[2]);
    await read((sent[2] ?? "").slice(7));
  });

  test("when Apple rejects everything, as with a revoked key, each request reaches Apple once and one token is minted a minute", async () => {
    const { fetch, sent } = apple(...Array.from({ length: 400 }, () => 401));
    const music = createClient({ developerToken: cachedMinter(valid), fetch, retry: false });
    for (let second = 0; second < 120; second++) {
      at(second * 1000);
      await expect(music.request("v1/test")).rejects.toMatchObject({ _tag: "DeveloperTokenRejected" });
    }
    expect(new Set(sent).size).toBe(2); // the first token, and the one minted at one minute
    expect(sent).toHaveLength(121); // one per request, plus the single resend that carried the new token
  });
});

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { developerTokenFetcher } from "@open-music-sdk/developer-token/fetcher";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, test } from "vitest";
import { tokenEndpoint, type tTokenEndpointOptions } from "./token-endpoint";

const IDS = { teamId: "DEF123GHIJ", keyId: "ABC123DEFG" } as const;
const PAGE = "https://app.example";
const ENDPOINT = "https://api.example/music/token";

/** A key of this suite's own, with its public half to verify what was signed with it. */
async function key(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  return { pem: await exportPKCS8(pair.privateKey), publicKey: pair.publicKey };
}

/** An endpoint for one page, over a fresh key, with whatever else the test wants. */
async function endpoint(overrides: Partial<tTokenEndpointOptions> = {}) {
  const { pem, publicKey } = await key();
  return { handler: tokenEndpoint({ pem, ...IDS, origin: [PAGE], ...overrides }), publicKey };
}

const get = (headers: Record<string, string> = {}) => new Request(ENDPOINT, { headers });

describe("tokenEndpoint: what it answers", () => {
  test("GET: the token as JSON, signed by the key, for the origins given, living fifteen minutes, with cache-control: no-store", async () => {
    const { handler, publicKey } = await endpoint();
    const res = await handler(get());
    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "application/json", "no-store"]);
    const { token } = (await res.json()) as { token: string };
    const { payload, protectedHeader } = await jwtVerify(token, publicKey);
    expect([payload.iss, protectedHeader.kid, payload.origin, (payload.exp ?? 0) - (payload.iat ?? 0)]).toEqual([IDS.teamId, IDS.keyId, [PAGE], 900]);
  });

  test("ttlSeconds is the token's life, and refreshAheadSeconds reaches the minter", async () => {
    const { handler, publicKey } = await endpoint({ ttlSeconds: 60, refreshAheadSeconds: 10 });
    const { token } = (await (await handler(get())).json()) as { token: string };
    const { payload } = await jwtVerify(token, publicKey);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
  });

  test("page loads within a token's life share one signature", async () => {
    const { handler } = await endpoint();
    const [a, b] = await Promise.all([handler(get()), handler(get())]);
    const c = await handler(get());
    const tokens = await Promise.all([a, b, c].map(async (res) => ((await res.json()) as { token: string }).token));
    expect(new Set(tokens).size).toBe(1);
  });

  test.each(["POST", "PUT", "DELETE", "PATCH", "HEAD"])("%s is 405 with allow: GET, no token, and no-store", async (method) => {
    const { handler } = await endpoint();
    const res = await handler(new Request(ENDPOINT, { method }));
    expect([res.status, res.headers.get("allow"), res.headers.get("cache-control")]).toEqual([405, "GET", "no-store"]);
    expect(method === "HEAD" ? null : await res.json()).toEqual(method === "HEAD" ? null : { error: "MethodNotAllowed" });
    if (method === "HEAD") await res.body?.cancel();
  });

  test("the body is read as a request's is: a request with a body is still answered", async () => {
    const { handler } = await endpoint();
    const res = await handler(new Request(ENDPOINT, { method: "POST", body: "token please", headers: { "content-type": "text/plain" } }));
    expect(res.status).toBe(405);
    await res.body?.cancel();
  });

  test("a request already aborted is answered all the same: the mint is one flight shared by every request, and no request's to cancel or to fail", async () => {
    const { handler } = await endpoint();
    const res = await handler(new Request(ENDPOINT, { signal: AbortSignal.abort(new Error("gone")) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("token");
  });

  test.each<[string, number]>([
    ["a day", 86_400],
    ["a minute", 60],
  ])("a lifetime of %s is taken", async (_name, ttlSeconds) => {
    const { handler, publicKey } = await endpoint({ ttlSeconds });
    const { token } = (await (await handler(get())).json()) as { token: string };
    const { payload } = await jwtVerify(token, publicKey);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(ttlSeconds);
  });
});

describe("tokenEndpoint: CORS, for the origins it was handed and no other", () => {
  test("a GET from one of the origins is answered with that origin, and vary: origin", async () => {
    const { handler } = await endpoint({ origin: [PAGE, "https://staging.app.example"] });
    const res = await handler(get({ origin: "https://staging.app.example" }));
    expect([res.headers.get("access-control-allow-origin"), res.headers.get("vary"), res.headers.get("access-control-allow-credentials")]).toEqual(["https://staging.app.example", "origin", null]);
    await res.body?.cancel();
  });

  test.each<[string, Record<string, string>]>([
    ["no Origin header", {}],
    ["an origin that is not one of them", { origin: "https://evil.example" }],
    ["a subdomain of one of them", { origin: "https://sub.app.example" }],
    ["one of them in another case", { origin: "https://APP.example" }],
    ["one of them with a path", { origin: `${PAGE}/` }],
  ])("a GET with %s is answered without a CORS header, and with the token all the same", async (_name, headers) => {
    const { handler } = await endpoint();
    const res = await handler(get(headers));
    expect([res.status, res.headers.get("access-control-allow-origin"), res.headers.get("vary")]).toEqual([200, null, "origin"]);
    expect(await res.json()).toHaveProperty("token");
  });

  test("every answer says vary: origin and cache-control: no-store, whatever the match and the method: no cache keyed on the URL alone hands one page's answer to another", async () => {
    const { handler } = await endpoint();
    for (const req of [get(), get({ origin: PAGE }), get({ origin: "https://evil.example" }), new Request(ENDPOINT, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), new Request(ENDPOINT, { method: "POST" })]) {
      const res = await handler(req);
      expect([res.headers.get("vary"), res.headers.get("cache-control")], `${req.method} ${req.headers.get("origin") ?? ""}`).toEqual(["origin", "no-store"]);
      await res.body?.cancel();
    }
  });

  test("the origins are read by index, as the family reads a list: an iterator that says otherwise reaches neither the claim nor the CORS check", async () => {
    class Lying extends Array<string> {
      override *[Symbol.iterator](): ArrayIterator<string> {
        yield "https://evil.example";
      }
    }
    const origin = new Lying();
    origin.push(PAGE);
    expect([...origin]).toEqual(["https://evil.example"]);
    const { pem, publicKey } = await key();
    const handler = tokenEndpoint({ pem, ...IDS, origin });
    const refused = await handler(get({ origin: "https://evil.example" }));
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    await refused.body?.cancel();
    const res = await handler(get({ origin: PAGE }));
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGE);
    const { token } = (await res.json()) as { token: string };
    expect((await jwtVerify(token, publicKey)).payload.origin).toEqual([PAGE]);
  });

  test("OPTIONS from one of the origins is 204 with the CORS headers and allow-methods: GET", async () => {
    const { handler } = await endpoint();
    const res = await handler(new Request(ENDPOINT, { method: "OPTIONS", headers: { origin: PAGE, "access-control-request-method": "GET" } }));
    expect([res.status, res.headers.get("access-control-allow-origin"), res.headers.get("access-control-allow-methods"), res.headers.get("allow")]).toEqual([204, PAGE, "GET", "GET"]);
    expect(res.body).toBeNull();
  });

  test("OPTIONS from anywhere else is 204 with no CORS header, which is a preflight refused", async () => {
    const { handler } = await endpoint();
    const res = await handler(new Request(ENDPOINT, { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect([res.status, res.headers.get("access-control-allow-origin")]).toEqual([204, null]);
  });

  test("the 405 carries the CORS header too, so a page sees why it was refused", async () => {
    const { handler } = await endpoint();
    const res = await handler(new Request(ENDPOINT, { method: "POST", headers: { origin: PAGE } }));
    expect([res.status, res.headers.get("access-control-allow-origin")]).toEqual([405, PAGE]);
    await res.body?.cancel();
  });

  test("the origins are read once: a change to the list afterwards reaches neither the claim nor the CORS check", async () => {
    const { pem } = await key();
    const origin = [PAGE];
    const handler = tokenEndpoint({ pem, ...IDS, origin });
    origin.push("https://evil.example");
    const res = await handler(get({ origin: "https://evil.example" }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    await res.body?.cancel();
  });
});

describe("tokenEndpoint: a mistake is a TypeError when it is made, named by what checks it", () => {
  test.each<[string, unknown, string | RegExp]>([
    ["no options at all", undefined, "tokenEndpoint: expected an options object with pem, teamId, keyId and origin; got undefined"],
    ["a list where the options belong", [], "tokenEndpoint: expected an options object with pem, teamId, keyId and origin; got a list"],
    ["no origin", { pem: "x", ...IDS }, /^tokenEndpoint: origin must be a list of one or more web origins the token is for, such as \["https:\/\/app\.example"\]; got undefined$/],
    ["an empty origin list", { pem: "x", ...IDS, origin: [] }, /^tokenEndpoint: origin must be a list of one or more web origins the token is for/],
    ["one origin as a string", { pem: "x", ...IDS, origin: PAGE }, /^tokenEndpoint: origin must be a list of one or more web origins the token is for, such as \["https:\/\/app\.example"\]; got 19 characters$/],
    ["an origin with a path", { pem: "x", ...IDS, origin: [`${PAGE}/music`] }, /^developer token: origin\[0\] must be a web origin/],
    ["no pem", { ...IDS, origin: [PAGE] }, /^developer token: pem must be the contents of the \.p8 file, as a string; got undefined$/],
    ["a key id that is no id", { pem: "x", teamId: IDS.teamId, keyId: "key", origin: [PAGE] }, /^developer token: keyId must be ten capital letters and digits/],
    ["a lifetime below a minute", { pem: "x", ...IDS, origin: [PAGE], ttlSeconds: 30 }, /^developer token: ttlSeconds must be an integer from 60/],
    ["a lifetime past a day, for a token anyone can fetch", { pem: "x", ...IDS, origin: [PAGE], ttlSeconds: 86_401 }, "tokenEndpoint: ttlSeconds must be a whole number of seconds up to 86400, one day, for a token a page holds; got 86401"],
    ["a lifetime that is null, which is no default", { pem: "x", ...IDS, origin: [PAGE], ttlSeconds: null }, /^tokenEndpoint: ttlSeconds must be a whole number of seconds up to 86400/],
    ["a lifetime that is a fraction", { pem: "x", ...IDS, origin: [PAGE], ttlSeconds: 900.5 }, "tokenEndpoint: ttlSeconds must be a whole number of seconds up to 86400, one day, for a token a page holds; got 900.5"],
  ])("%s", (_name, options, message) => {
    expect(() => tokenEndpoint(options as tTokenEndpointOptions)).toThrow(typeof message === "string" ? new TypeError(message) : message);
  });

  test("it catches nothing: a pem that is a string but no key fails at the first mint, inside the request, as the minter's TypeError", async () => {
    const handler = tokenEndpoint({ pem: "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----", ...IDS, origin: [PAGE] });
    const error: unknown = await handler(get()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/^developer token: pem is not a PKCS8 P-256 private key/);
    expect((error as Error).message).not.toContain("not a key");
  });
});

describe("tokenEndpoint: on the wire, behind node:http", () => {
  /** The handler mounted on a plain Node server: the request made web-standard, the response written back. */
  async function mounted(handler: (req: Request) => Promise<Response>) {
    const server = createServer((req, res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
      void handler(new Request(`http://127.0.0.1${req.url ?? "/"}`, { method: req.method ?? "GET", headers })).then(async (answer) => {
        res.statusCode = answer.status;
        answer.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(await answer.text());
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${String(port)}/music/token`, close: () => new Promise((resolve) => server.close(resolve)) };
  }

  test("a page's fetch gets the token with its CORS header, and the fetcher from developer-token reads it as a provider", async () => {
    const { handler, publicKey } = await endpoint();
    const { url, close } = await mounted(handler);
    try {
      const res = await fetch(url, { headers: { origin: PAGE } });
      expect([res.status, res.headers.get("access-control-allow-origin"), res.headers.get("cache-control")]).toEqual([200, PAGE, "no-store"]);
      const { token } = (await res.json()) as { token: string };
      expect((await jwtVerify(token, publicKey)).payload.origin).toEqual([PAGE]);
      expect(await developerTokenFetcher(url)()).toBe(token);
    } finally {
      await close();
    }
  });
});

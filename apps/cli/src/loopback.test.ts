import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import { MemoryUserTokenStore, createServerClient, type tUserTokenStore } from "@open-music-sdk/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CliError, type tKey } from "./files";
import { startLoopback, toRequest, type tLoopback } from "./loopback";

const TEAM = "DEF123GHIJ";
const KEY_ID = "ABC123DEFG";
const TOKEN = "Ag-music-user-token-from-apple";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KEY: tKey = { pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), teamId: TEAM, keyId: KEY_ID, keyPath: "/keys/AuthKey_ABC123DEFG.p8" };
const SCRIPT = "/* the page's script */";

/** What the fake Apple answers /v1/me/storefront with, or `"hang"` for no answer until the request is aborted, and every request it was asked. */
let appleStatus: number | "hang" = 200;
let asked: Request[] = [];
const responses: Response[] = [];
const appleFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const req = new Request(input, init);
  asked.push(req);
  if (appleStatus === "hang")
    return new Promise((_resolve, reject) => {
      req.signal.addEventListener("abort", () => {
        reject(req.signal.reason as Error);
      });
    });
  const res =
    appleStatus === 200
      ? Response.json({ data: [{ id: "gb", type: "storefronts" }] })
      : Response.json({ errors: [{ status: String(appleStatus), title: "Forbidden", detail: "apple-detail" }] }, { status: appleStatus });
  responses.push(res);
  return Promise.resolve(res);
};

let dir: string;
let store: MemoryUserTokenStore;
let loopback: tLoopback | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omsdk-loopback-"));
  await writeFile(join(dir, "page.js"), SCRIPT);
  appleStatus = 200;
  asked = [];
  store = new MemoryUserTokenStore();
});
afterEach(async () => {
  await loopback?.close();
  loopback = undefined;
  await rm(dir, { recursive: true, force: true });
  // Every answer the fake Apple gave was read: an unread body keeps its connection out of the pool.
  for (const res of responses.splice(0)) expect(res.bodyUsed).toBe(true);
});

async function start(overrides: { store?: tUserTokenStore; port?: number; timeoutMs?: number } = {}): Promise<{ loopback: tLoopback; port: number; state: string }> {
  const music = createServerClient({ pem: KEY.pem, teamId: TEAM, keyId: KEY_ID, fetch: appleFetch, retry: false });
  loopback = await startLoopback({
    key: KEY,
    music,
    store: overrides.store ?? store,
    userId: "default",
    port: overrides.port ?? 0,
    script: pathToFileURL(join(dir, "page.js")),
    timeoutMs: overrides.timeoutMs ?? 10_000,
  });
  const url = new URL(loopback.url);
  return { loopback, port: Number(url.port), state: url.searchParams.get("state") ?? "" };
}

interface tSent {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/** One request over node:http, with whatever Host and target it is given, as a browser or another program could send. */
function send(port: number, path: string, options: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {}): Promise<tSent> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host: options.host ?? `localhost:${String(port)}`, ...options.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

const postToken = (port: number, state: string | undefined, body = JSON.stringify({ token: TOKEN }), contentType = "application/json") =>
  send(port, "/user-token", { method: "POST", headers: { "content-type": contentType, ...(state === undefined ? {} : { "x-login-state": state }) }, body });

const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { origin?: string[]; iat: number; exp: number };

describe("startLoopback: the page and its address", () => {
  test("listens on a loopback address, and its page is on localhost with a state of its own each run", async () => {
    const first = await start();
    expect(first.loopback.url).toMatch(/^http:\/\/localhost:\d+\/\?state=[\w-]{43}$/);
    await first.loopback.close();
    const second = await start();
    expect(second.state).not.toBe(first.state);
  });

  test("serves the page for this run's state, with Apple's CDN let in, nothing kept by a cache, and no referrer rule that breaks Apple's sign-in", async () => {
    const { port, state } = await start();
    const page = await send(port, `/?state=${state}`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.body).toContain('<script type="module" src="/page.js"></script>');
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["content-security-policy"]).toMatch(/script-src 'self' https:\/\/js-cdn\.music\.apple\.com;/);
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.headers["referrer-policy"]).toBeUndefined();
    expect(page.headers["cross-origin-opener-policy"]).toBeUndefined();
  });

  test("serves the page's script, read from the file it was given", async () => {
    const { port } = await start();
    const script = await send(port, "/page.js");
    expect(script).toMatchObject({ status: 200, body: SCRIPT });
    expect(script.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  });

  test("the page and the token need this run's state; anything else is not here", async () => {
    const { port, state } = await start();
    const changed = state.slice(0, -1) + (state.endsWith("A") ? "B" : "A");
    for (const path of ["/", "/?state=", `/?state=${state}x`, `/?state=${state.slice(1)}`, `/?state=${changed}`, "/token", `/token?state=${changed}`, "/favicon.ico", "/user-token/x", `/page.js/x`]) {
      expect((await send(port, path)).status, path).toBe(404);
    }
  });

  test("only asked for as localhost:<port>: a name rebound to the address, or the address itself, reaches nothing", async () => {
    const { port, state } = await start();
    for (const host of ["evil.example", `evil.example:${String(port)}`, `127.0.0.1:${String(port)}`, "localhost", `localhost:${String(port + 1)}`]) {
      expect((await send(port, `/?state=${state}`, { host })).status, host).toBe(421);
      expect((await send(port, `/token?state=${state}`, { host })).status, host).toBe(421);
      expect((await send(port, "/page.js", { host })).status, host).toBe(421);
      expect((await send(port, "/user-token", { method: "POST", host, headers: { "content-type": "application/json", "x-login-state": state }, body: JSON.stringify({ token: TOKEN }) })).status, host).toBe(421);
    }
    expect(asked).toEqual([]);
    expect(await store.get("default")).toBeUndefined();
  });

  test("a target that is not a path on this server is refused", async () => {
    const { port, state } = await start();
    expect((await send(port, `http://evil.example/?state=${state}`)).status).toBe(400);
    expect((await send(port, `//evil.example/?state=${state}`)).status).toBe(404);
  });

  test("a request node:http takes and fetch does not, from anyone on this machine, is refused and leaves the server running", async () => {
    const { port, state } = await start();
    for (const method of ["TRACE", "TRACK", "CONNECT"]) {
      // node:http drops a CONNECT it has no handler for; the others are answered.
      const answered = await send(port, method === "CONNECT" ? `localhost:${String(port)}` : "/", { method }).catch((e: unknown) => e as Error);
      if (!(answered instanceof Error)) expect(answered.status, method).toBe(400);
    }
    expect((await send(port, `/?state=${state}`)).status).toBe(200);
  });

  test("a port that is taken is a mistake in how the CLI was run", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as AddressInfo;
    try {
      const failed = await start({ port }).catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(CliError);
      expect(failed).toMatchObject({ exitCode: 2, message: expect.stringContaining(`Port ${String(port)} is in use`) as unknown });
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });

  test("close stops listening", async () => {
    const { loopback: running, port } = await start();
    await running.close();
    loopback = undefined;
    await expect(send(port, "/page.js")).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("startLoopback: the token route, a dispenser only for this page", () => {
  test("hands out a fifteen-minute developer token bound to the page's origin, kept by no cache", async () => {
    const { port, state } = await start();
    const answer = await send(port, `/token?state=${state}`);
    expect(answer.status).toBe(200);
    expect(answer.headers["cache-control"]).toBe("no-store");
    const { origin, iat, exp } = claimsOf((JSON.parse(answer.body) as { token: string }).token);
    expect(origin).toEqual([`http://localhost:${String(port)}`]);
    expect(exp - iat).toBe(900);
  });

  test("the page's own origin may read it, and no other", async () => {
    const { port, state } = await start();
    const own = await send(port, `/token?state=${state}`, { headers: { origin: `http://localhost:${String(port)}` } });
    expect(own.headers["access-control-allow-origin"]).toBe(`http://localhost:${String(port)}`);
    const other = await send(port, `/token?state=${state}`, { headers: { origin: "https://evil.example" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("startLoopback: the intake, which asks Apple before it stores", () => {
  test("login hears only once the page has been told: closing the server the moment it hears leaves the page its 204", async () => {
    const { loopback: running, port, state } = await start();
    // What login does: close as soon as the wait settles.
    void running.stored.then(() => running.close());
    const answer = await postToken(port, state);
    expect(answer.status).toBe(204);
    await running.stored;
  });

  test("a page whose connection is gone before it is told does not leave login waiting for a token it has", async () => {
    let release!: () => void;
    const slow: tUserTokenStore = {
      get: (id) => store.get(id),
      delete: (id) => store.delete(id),
      set: async (id, token) => {
        await new Promise<void>((resolve) => (release = resolve));
        await store.set(id, token);
      },
    };
    const { loopback: running, port, state } = await start({ store: slow });
    const req = httpRequest({ host: "127.0.0.1", port, path: "/user-token", method: "POST", headers: { host: `localhost:${String(port)}`, "content-type": "application/json", "x-login-state": state } });
    req.on("error", () => undefined);
    req.end(JSON.stringify({ token: TOKEN }));
    await vi.waitFor(() => {
      expect(release).toBeTypeOf("function");
    });
    // The browser goes away while the store is writing, after Apple said yes.
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await expect(Promise.race([running.stored.then(() => "stored"), new Promise((resolve) => setTimeout(resolve, 2000, "still waiting"))])).resolves.toBe("stored");
    expect(await store.get("default")).toBe(TOKEN);
  });

  test("one token is taken: a post while another is being asked about, or once one is kept, is turned away", async () => {
    let release!: () => void;
    const slow: tUserTokenStore = {
      get: (id) => store.get(id),
      delete: (id) => store.delete(id),
      set: async (id, token) => {
        await new Promise<void>((resolve) => (release = resolve));
        await store.set(id, token);
      },
    };
    const { port, state } = await start({ store: slow });
    const first = postToken(port, state);
    await vi.waitFor(() => {
      expect(release).toBeTypeOf("function");
    });
    const during = await postToken(port, state, JSON.stringify({ token: "another-accounts-token" }));
    release();
    expect((await first).status).toBe(204);
    const after = await postToken(port, state, JSON.stringify({ token: "another-accounts-token" }));
    expect([during.status, after.status]).toEqual([409, 409]);
    expect(await store.get("default")).toBe(TOKEN);
    expect(asked).toHaveLength(1);
  });

  test("a token posted with this run's state is asked of Apple, stored, and settles what login waits for", async () => {
    const { loopback: running, port, state } = await start();
    const answer = await postToken(port, state);
    expect(answer.status).toBe(204);
    await running.stored;
    expect(await store.get("default")).toBe(TOKEN);
    expect(asked.map((req) => new URL(req.url).pathname)).toEqual(["/v1/me/storefront"]);
    expect(asked[0]?.headers.get("music-user-token")).toBe(TOKEN);
  });

  test("a post without this run's state is refused before Apple is asked, and nothing is stored", async () => {
    const { port, state } = await start();
    for (const given of [undefined, "", `${state}x`, state.toUpperCase() === state ? state.toLowerCase() : state.toUpperCase()]) {
      expect((await postToken(port, given)).status).toBe(401);
    }
    expect(asked).toEqual([]);
    expect(await store.get("default")).toBeUndefined();
  });

  test("another site's post, which cannot carry JSON or the header without asking first, gets no answer to that asking", async () => {
    const { port, state } = await start();
    // What a form or a no-cors fetch can send without asking first.
    expect((await postToken(port, state, `token=${TOKEN}`, "application/x-www-form-urlencoded")).status).toBe(415);
    expect((await postToken(port, state, JSON.stringify({ token: TOKEN }), "text/plain")).status).toBe(415);
    const preflight = await send(port, "/user-token", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-login-state" },
    });
    expect(preflight.status).toBe(405);
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    expect(preflight.headers["access-control-allow-headers"]).toBeUndefined();
    expect(await store.get("default")).toBeUndefined();
  });

  test("a token Apple refuses is answered 422, nothing is stored, and login goes on waiting", async () => {
    appleStatus = 403;
    const { loopback: running, port, state } = await start();
    const answer = await postToken(port, state);
    expect(answer.status).toBe(422);
    expect(answer.body).not.toContain(TOKEN);
    expect(answer.body).not.toContain("apple-detail");
    expect(await store.get("default")).toBeUndefined();
    const settled = await Promise.race([running.stored.then(() => "stored"), new Promise((resolve) => setTimeout(resolve, 50, "waiting"))]);
    expect(settled).toBe("waiting");
  });

  test("an Apple that does not answer is given up on in time: the page is answered 504, nothing is stored, and login goes on waiting", async () => {
    appleStatus = "hang";
    const { loopback: running, port, state } = await start({ timeoutMs: 200 });
    const answer = await postToken(port, state);
    expect(answer.status).toBe(504);
    expect(asked[0]?.signal.aborted).toBe(true);
    expect(await store.get("default")).toBeUndefined();
    const settled = await Promise.race([running.stored.then(() => "stored", () => "rejected"), new Promise((resolve) => setTimeout(resolve, 50, "waiting"))]);
    expect(settled).toBe("waiting");
    // A later post, once Apple answers, is taken.
    appleStatus = 200;
    expect((await postToken(port, state)).status).toBe(204);
  });

  test("a store that fails is the run's to hear about: the page is answered 500, and login's wait rejects with it", async () => {
    const failure = new Error("disk full");
    const failing: tUserTokenStore = { get: () => Promise.resolve(undefined), delete: () => Promise.resolve(), set: () => Promise.reject(failure) };
    const { loopback: running, port, state } = await start({ store: failing });
    const waited = running.stored.catch((e: unknown) => e);
    expect((await postToken(port, state)).status).toBe(500);
    expect(await waited).toBe(failure);
  });

  test("what is posted is read up to a limit, and the answer still reaches the page", async () => {
    const { port, state } = await start();
    const answer = await postToken(port, state, JSON.stringify({ token: "x".repeat(20_000) }));
    expect(answer.status).toBe(413);
    expect(asked).toEqual([]);
  });

});

describe("toRequest: node:http's request as a web-standard one", () => {
  test("a body is read only as far as the handler asks: while a handler neither reads nor answers, what is sent waits in the socket", { timeout: 30_000 }, async () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    // A handler that holds the request and does nothing with it, as a slow one would.
    const held: Request[] = [];
    const server = createServer((req, res) => {
      const request = toRequest(req, res, "http://localhost", 30_000);
      if (request !== undefined) held.push(request);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      gc();
      const before = process.memoryUsage().arrayBuffers;
      // Up to 64 MiB, one reused MiB at a time, so only what the server keeps can grow; the writing stops once the
      // server stops taking it in.
      const chunk = Buffer.alloc(1 << 20);
      const upload = httpRequest({ host: "127.0.0.1", port, method: "POST", headers: { "content-length": String(64 << 20) } });
      upload.on("error", () => undefined);
      for (let sent = 0; sent < 64; sent++) {
        if (upload.write(chunk)) continue;
        const drained = await Promise.race([new Promise((resolve) => upload.once("drain", () => { resolve(true); })), new Promise((resolve) => setTimeout(resolve, 1000, false))]);
        if (drained === false) break;
      }
      gc();
      const during = process.memoryUsage().arrayBuffers;
      upload.destroy();
      expect(held).toHaveLength(1);
      expect(during - before).toBeLessThan(16 << 20);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import { MemoryUserTokenStore, createServerClient, type tUserTokenStore } from "@open-music-sdk/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CliError } from "./files";
import type { tKey } from "./key";
import { openBrowser, startLoopback, toRequest, type tLoopback } from "./loopback";

// No browser is opened from a test: each test says what the system's command does.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const TEAM = "DEF123GHIJ";
const KEY_ID = "ABC123DEFG";
const TOKEN = "Ag-music-user-token-from-apple";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KEY: tKey = { pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), teamId: TEAM, keyId: KEY_ID, from: "APPLE_MUSIC_PRIVATE_KEY", asked: false };
const SCRIPT = "/* the page's script */";
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`;

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
  await writeFile(join(dir, "logo.svg"), LOGO);
  appleStatus = 200;
  asked = [];
  store = new MemoryUserTokenStore();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await loopback?.close();
  loopback = undefined;
  await rm(dir, { recursive: true, force: true });
  // Every answer the fake Apple gave was read: an unread body keeps its connection out of the pool.
  for (const res of responses.splice(0)) expect(res.bodyUsed).toBe(true);
});

/**
 * Starts the server and, unless `open` is false, opens its page as the browser would, which uses up the address's
 * ticket: `state` is then the secret the page carries for the token routes.
 */
async function start(overrides: { store?: tUserTokenStore; port?: number; timeoutMs?: number; open?: false } = {}): Promise<{ loopback: tLoopback; port: number; ticket: string; state: string }> {
  const music = createServerClient({ pem: KEY.pem, teamId: TEAM, keyId: KEY_ID, fetch: appleFetch, retry: false });
  loopback = await startLoopback({
    key: KEY,
    music,
    store: overrides.store ?? store,
    userId: "default",
    port: overrides.port ?? 0,
    script: pathToFileURL(join(dir, "page.js")),
    logo: pathToFileURL(join(dir, "logo.svg")),
    timeoutMs: overrides.timeoutMs ?? 10_000,
  });
  const url = new URL(loopback.url);
  const port = Number(url.port);
  const ticket = url.searchParams.get("state") ?? "";
  if (overrides.open === false) return { loopback, port, ticket, state: "" };
  const page = await send(port, `/?state=${ticket}`);
  return { loopback, port, ticket, state: secretOf(page.body) };
}

/** The secret a page carries for the token routes. */
const secretOf = (html: string) => /<meta name="login-state" content="([\w-]+)">/.exec(html)?.[1] ?? "";

interface tSent {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/**
 * One request over node:http, with whatever Host and target it is given, as a browser or another program could send,
 * each on a connection of its own.
 */
function send(port: number, path: string, options: { method?: string; host?: string; address?: string; headers?: Record<string, string>; body?: string } = {}): Promise<tSent> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ agent: false, host: options.address ?? "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host: options.host ?? `localhost:${String(port)}`, ...options.headers } }, (res) => {
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

/** Whether this system can listen on ::1. */
function hasIpv6(): Promise<boolean> {
  const probe = createServer();
  return new Promise((resolve) => {
    probe.once("error", () => {
      resolve(false);
    });
    probe.listen(0, "::1", () => {
      probe.close(() => {
        resolve(true);
      });
    });
  });
}

const IPV6 = await hasIpv6();

/**
 * Makes listening on `address` fail with the system's `code`, the first `times` times it is asked for or every time,
 * as a system without IPv6 or a port held by another program would; every other listen is real. Returns the ports
 * refused, in order.
 */
function failListen(address: string, code: string, times = Infinity): number[] {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the server it was asked on
  const listen = Server.prototype.listen;
  const refused: number[] = [];
  vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server, ...args: unknown[]) {
    if (args[1] !== address || refused.length >= times) return listen.apply(this, args as Parameters<typeof listen>);
    refused.push(args[0] as number);
    process.nextTick(() => this.emit("error", Object.assign(new Error(`listen ${code} ${address}`), { code })));
    return this;
  });
  return refused;
}

const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { origin?: string[]; iat: number; exp: number };

describe("startLoopback: the page and its address", () => {
  test("listens on a loopback address, and its page is on localhost with a ticket and a secret of its own each run", async () => {
    const first = await start();
    expect(first.loopback.url).toMatch(/^http:\/\/localhost:\d+\/\?state=[\w-]{43}$/);
    expect(first.state).toMatch(/^[\w-]{43}$/);
    expect(first.state).not.toBe(first.ticket);
    await first.loopback.close();
    const second = await start();
    expect(second.ticket).not.toBe(first.ticket);
    expect(second.state).not.toBe(first.state);
  });

  test("serves the page for this run's ticket, with Apple's CDN let in, nothing kept by a cache, and no referrer rule that breaks Apple's sign-in", async () => {
    const { port, ticket } = await start({ open: false });
    const page = await send(port, `/?state=${ticket}`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.body).toContain('<script type="module" src="/page.js"></script>');
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["content-security-policy"]).toMatch(/script-src 'self' https:\/\/js-cdn\.music\.apple\.com;/);
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    // Every source the page may load from is the page's own or Apple's, images included.
    expect(page.headers["content-security-policy"]).toContain("img-src 'self' data: https://*.apple.com https://*.mzstatic.com;");
    expect(page.headers["content-security-policy"]).not.toMatch(/ https:(;|$| )/);
    expect(page.headers["referrer-policy"]).toBeUndefined();
    expect(page.headers["cross-origin-opener-policy"]).toBeUndefined();
  });

  test("serves the page's script, read from the file it was given", async () => {
    const { port } = await start();
    const script = await send(port, "/page.js");
    expect(script).toMatchObject({ status: 200, body: SCRIPT });
    expect(script.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  });

  test("the page is the Open Music CLI's, with its logo shown and named to Apple's script as the app's icon", async () => {
    const { port, ticket } = await start({ open: false });
    const page = await send(port, `/?state=${ticket}`);
    expect(page.body).toContain("<title>Sign in · Open Music CLI</title>");
    expect(page.body).toContain("<h1>Open Music CLI</h1>");
    // The small print the page's script takes away once there is an outcome.
    expect(page.body).toContain('<p id="intro">');
    expect(page.body).toContain('<img src="/logo.svg"');
    // Where Apple's script looks for the icon it hands to Apple's sign-in window: an HTTPS address that page can load.
    expect(page.body).toContain('<link rel="apple-music-app-icon" sizes="120x120" href="https://avatars.githubusercontent.com/u/338387998?s=240">');
  });

  test("serves the logo as an image, in which nothing could run even when it is opened by itself", async () => {
    const { port } = await start();
    const logo = await send(port, "/logo.svg");
    expect(logo).toMatchObject({ status: 200, body: LOGO });
    expect(logo.headers["content-type"]).toBe("image/svg+xml");
    expect(logo.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(logo.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("the page needs this run's ticket and the token its secret, and neither is the other; anything else is not here", async () => {
    const { port, ticket } = await start({ open: false });
    const change = (value: string) => value.slice(0, -1) + (value.endsWith("A") ? "B" : "A");
    for (const path of ["/", "/?state=", `/?state=${ticket}x`, `/?state=${ticket.slice(1)}`, `/?state=${change(ticket)}`, "/token", `/token?state=${ticket}`, "/favicon.ico", "/user-token/x", `/page.js/x`]) {
      expect((await send(port, path)).status, path).toBe(404);
    }
    const state = secretOf((await send(port, `/?state=${ticket}`)).body);
    for (const path of [`/?state=${state}`, `/token?state=${change(state)}`]) expect((await send(port, path)).status, path).toBe(404);
    expect((await postToken(port, ticket)).status).toBe(401);
  });

  test("the ticket opens the page once: the address is in a command line others may read, so whoever opens it second is told", async () => {
    const { port, ticket } = await start({ open: false });
    const first = await send(port, `/?state=${ticket}`);
    expect(first.status).toBe(200);
    const second = await send(port, `/?state=${ticket}`);
    expect(second.status).toBe(410);
    expect(second.body).toContain("opened already");
    expect(second.body).toContain("Ctrl+C");
    expect(secretOf(second.body)).toBe("");
    // The page that did open still has what it needs.
    expect((await send(port, `/token?state=${secretOf(first.body)}`)).status).toBe(200);
  });

  test("only asked for as localhost:<port>: a name rebound to the address, or the address itself, reaches nothing", async () => {
    const { port, ticket, state } = await start();
    for (const host of ["evil.example", `evil.example:${String(port)}`, `127.0.0.1:${String(port)}`, "localhost", `localhost:${String(port + 1)}`]) {
      expect((await send(port, `/?state=${ticket}`, { host })).status, host).toBe(421);
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
    const { port, ticket } = await start({ open: false });
    for (const method of ["TRACE", "TRACK", "CONNECT"]) {
      // node:http drops a CONNECT it has no handler for; the others are answered.
      const answered = await send(port, method === "CONNECT" ? `localhost:${String(port)}` : "/", { method }).catch((e: unknown) => e as Error);
      if (!(answered instanceof Error)) expect(answered.status, method).toBe(400);
    }
    expect((await send(port, `/?state=${ticket}`)).status).toBe(200);
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

  test("a port the system will not let this user listen on is passed on as the system said it, not as a port in use", async () => {
    failListen("127.0.0.1", "EACCES");
    const failed = await start({ port: 80 }).catch((e: unknown) => e);
    expect(failed).not.toBeInstanceOf(CliError);
    expect(failed).toMatchObject({ code: "EACCES", message: "listen EACCES 127.0.0.1" });
  });

  test.each(["EADDRNOTAVAIL", "EAFNOSUPPORT"])("on a system without IPv6, where listening on ::1 fails with %s, the page is served on 127.0.0.1 alone", async (code) => {
    failListen("::1", code);
    const { loopback: running, port, state } = await start();
    expect(state).toMatch(/^[\w-]{43}$/);
    expect((await send(port, "/page.js")).status).toBe(200);
    await running.close();
    loopback = undefined;
    await expect(send(port, "/page.js")).rejects.toThrow(/ECONNREFUSED/);
  });

  test("a port the system picked that another program holds on ::1 is not shared with it: the system picks another", async () => {
    const refused = failListen("::1", "EADDRINUSE", 1);
    const { port, state } = await start();
    expect(refused).toHaveLength(1);
    expect(state).toMatch(/^[\w-]{43}$/);
    expect((await send(port, "/page.js")).status).toBe(200);
  });

  test("a system that picks ports held on ::1 time after time is given up on after five, each let go, as a port in use", async () => {
    const refused = failListen("::1", "EADDRINUSE");
    const failed = await start().catch((e: unknown) => e);
    expect(refused).toHaveLength(5);
    expect(failed).toBeInstanceOf(CliError);
    expect(failed).toMatchObject({ exitCode: 2, message: expect.stringContaining(`Port ${String(refused[4])} is in use`) as unknown });
    for (const port of refused) await expect(send(port, "/page.js")).rejects.toThrow(/ECONNREFUSED/);
  });

  describe.runIf(IPV6)("on a system with IPv6, where localhost is ::1 as well as 127.0.0.1", () => {
    test("it holds the port on both, so localhost reaches it whichever address the browser tries first", async () => {
      const { port, ticket } = await start({ open: false });
      expect((await send(port, `/?state=${ticket}`, { address: "::1" })).status).toBe(200);
      // The same server: the ticket the first used up is used up here too.
      expect((await send(port, `/?state=${ticket}`, { address: "127.0.0.1" })).status).toBe(410);
    });

    test("a port asked for that another program holds on ::1 is refused, not shared with it", async () => {
      const squatter = createServer((_req, res) => res.end("someone else"));
      await new Promise<void>((resolve) => squatter.listen(0, "::1", resolve));
      const { port } = squatter.address() as AddressInfo;
      try {
        const failed = await start({ port }).catch((e: unknown) => e);
        expect(failed).toMatchObject({ exitCode: 2, message: expect.stringContaining(`Port ${String(port)} is in use`) as unknown });
        // Nothing was left listening on 127.0.0.1 either.
        await expect(send(port, "/page.js")).rejects.toThrow(/ECONNREFUSED/);
      } finally {
        await new Promise((resolve) => squatter.close(resolve));
      }
    });

    test("close stops listening on both", async () => {
      const { loopback: running, port } = await start();
      await running.close();
      loopback = undefined;
      await expect(send(port, "/page.js", { address: "::1" })).rejects.toThrow(/ECONNREFUSED/);
    });
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

  test("the page's own origin may read it, and a request from any other origin, or from none as null, is refused outright", async () => {
    const { port, state } = await start();
    const own = await send(port, `/token?state=${state}`, { headers: { origin: `http://localhost:${String(port)}` } });
    expect(own.status).toBe(200);
    expect(own.headers["access-control-allow-origin"]).toBe(`http://localhost:${String(port)}`);
    for (const origin of ["https://evil.example", "null", `http://localhost:${String(port + 1)}`, `http://127.0.0.1:${String(port)}`]) {
      const other = await send(port, `/token?state=${state}`, { headers: { origin } });
      expect(other.status, origin).toBe(403);
      expect(other.body, origin).not.toContain("token");
      expect(other.headers["access-control-allow-origin"], origin).toBeUndefined();
    }
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
    expect(preflight.status).toBe(403);
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

  const ORIGIN = "http://localhost:4000";

  /**
   * A request as node:http hands it over, for what node:http itself never sends: no target, no method, headers that
   * end on a name. Whether it is paused is kept for the test to see.
   */
  function incoming(fields: { url?: string | undefined; method?: string | undefined; rawHeaders?: string[] } = {}) {
    const req = Object.assign(new EventEmitter(), { url: "/", method: "GET", rawHeaders: [] as string[], paused: false }, fields);
    return Object.assign(req, {
      pause() {
        req.paused = true;
        return req;
      },
      resume() {
        req.paused = false;
        return req;
      },
    });
  }
  const response = () => Object.assign(new EventEmitter(), { writableFinished: false }) as unknown as ServerResponse;
  const requestOf = (req: ReturnType<typeof incoming>) => toRequest(req as unknown as IncomingMessage, response(), ORIGIN, 10_000);

  test("a request with no target is for the server's root", () => {
    expect(requestOf(incoming({ url: undefined }))?.url).toBe(`${ORIGIN}/`);
  });

  test("a target that would make this server's address the user name of another host's URL makes no request: the URL is never anyone else's", () => {
    // node:http's own parser refuses this target; the URL is checked whatever the parser lets by.
    expect(requestOf(incoming({ url: "@evil.example/" }))).toBeUndefined();
  });

  test("a request with no method is a GET, with no body", () => {
    const request = requestOf(incoming({ method: undefined }));
    expect(request?.method).toBe("GET");
    expect(request?.body).toBeNull();
  });

  test("headers that end on a name are taken with that name empty, not thrown on", () => {
    expect(requestOf(incoming({ rawHeaders: ["x-one", "1", "x-two"] }))?.headers.get("x-two")).toBe("");
  });

  test("what arrives while the handler waits for it is passed straight on; what arrives before it asks pauses the request", async () => {
    const req = incoming({ method: "POST" });
    const reader = requestOf(req)?.body?.getReader();
    const read = reader?.read();
    req.emit("data", Buffer.from("first"));
    expect(req.paused).toBe(false);
    expect(Buffer.from((await read)?.value ?? []).toString()).toBe("first");
    req.emit("data", Buffer.from("second"));
    expect(req.paused).toBe(true);
  });

  test("a body the handler stops reading lets go of the request: what arrives after, an error included, is ignored", async () => {
    const req = incoming({ method: "POST" });
    const request = requestOf(req);
    req.emit("data", Buffer.from("read"));
    expect(req.paused).toBe(true);
    await request?.body?.cancel();
    expect(req.paused).toBe(false);
    req.emit("data", Buffer.from("not read"));
    req.emit("error", new Error("connection reset"));
    req.emit("end");
    expect(req.paused).toBe(false);
  });
});

describe("openBrowser", () => {
  const ADDRESS = "http://localhost:4000/?state=ticket";
  const real = process.platform;
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: real });
  });

  /** A browser command as spawn starts it, which the CLI lets run on by itself. */
  const child = () => Object.assign(new EventEmitter(), { unref: vi.fn() });

  test.each([
    ["win32", "rundll32", ["url.dll,FileProtocolHandler", ADDRESS]],
    ["darwin", "open", [ADDRESS]],
    ["linux", "xdg-open", [ADDRESS]],
    ["freebsd", "xdg-open", [ADDRESS]],
  ])("on %s, the address is opened with %s, as one argument and with no shell, and left to run by itself", (system, command, args) => {
    Object.defineProperty(process, "platform", { value: system });
    const started = child();
    vi.mocked(spawn).mockClear().mockReturnValueOnce(started as unknown as ReturnType<typeof spawn>);
    openBrowser(ADDRESS);
    expect(spawn).toHaveBeenCalledWith(command, args, { stdio: "ignore", detached: true });
    expect(started.unref).toHaveBeenCalled();
  });

  test("a system with no browser command to run is no failure: the address has been printed", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const started = child();
    vi.mocked(spawn).mockReturnValueOnce(started as unknown as ReturnType<typeof spawn>);
    openBrowser(ADDRESS);
    // What spawn emits when the command is not installed.
    expect(() => started.emit("error", Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }))).not.toThrow();
  });
});

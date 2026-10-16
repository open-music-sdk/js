// The sign-in server `login` runs while it waits: a page on a loopback address that runs Apple's sign-in, the
// server package's token endpoint for that page, and its user-token intake for what the page posts back.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tokenEndpoint, userTokenIntake, type tAppleMusicClient, type tUserTokenStore } from "@open-music-sdk/server";
import { usage } from "./files";
import type { tKey } from "./key";

export interface tLoopbackOptions {
  /** The key the token endpoint mints the page's developer tokens with. */
  readonly key: tKey;
  /** The client the intake asks Apple with. */
  readonly music: tAppleMusicClient;
  /** Where an accepted token goes. */
  readonly store: tUserTokenStore;
  /** The id the token is kept under. */
  readonly userId: string;
  /** The port to listen on; 0 lets the system pick one. */
  readonly port: number;
  /** The page's script, read when the page asks for it. */
  readonly script: URL;
  /** The logo, an SVG, shown on the page and named to Apple's script as the app's icon. */
  readonly logo: URL;
  /** How long a request may take, asking Apple about a posted token included. */
  readonly timeoutMs: number;
}

export interface tLoopback {
  /** The page, with this run's one-time ticket in it: what the browser opens. */
  readonly url: string;
  /**
   * Settles once the store has the token Apple accepted and the page has been told, or its connection is gone; or
   * rejects with what a request failed with that is not the request's own.
   */
  readonly stored: Promise<void>;
  /** Stops listening and drops every connection. */
  readonly close: () => Promise<void>;
}

// What the page may load. Apple's script comes from its CDN and talks to Apple's hosts; nothing else is let in.
// Which hosts it reaches in a real sign-in is checked on the first live run.
const CSP = [
  "default-src 'self' https://*.apple.com",
  "script-src 'self' https://js-cdn.music.apple.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.apple.com https://*.mzstatic.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// No `Referrer-Policy: no-referrer`, which developers report breaks Apple's sign-in, and no COOP, since the
// sign-in window has to talk back to the page that opened it.
const PAGE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

// An SVG of the CLI's own, served as an image: nothing in it runs, whatever it held, should it be opened by itself.
const LOGO_HEADERS = { ...PAGE_HEADERS, "content-type": "image/svg+xml", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" };

/**
 * The app's icon as Apple's sign-in window shows it: the project's logo, as its GitHub organisation's avatar, 240
 * pixels for a 120-pixel icon. Apple's script takes the icon from the `apple-music-app-icon` link, not from what it
 * is configured with, and hands its address to the window, an HTTPS page of Apple's. A public HTTPS address is one
 * that page can load; one on this server would be `http://localhost`.
 */
const APP_ICON = "https://avatars.githubusercontent.com/u/338387998?s=240";

/** The page, with the secret its script sends to the token routes. The secret is base64url, which needs no escaping. */
const page = (secret: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="login-state" content="${secret}">
<title>Sign in · Open Music CLI</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link rel="apple-music-app-icon" sizes="120x120" href="${APP_ICON}">
<style>
:root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
main { max-width: 34rem; text-align: center; }
h1 { margin: 0.4em 0 0.2em; }
button { font: inherit; font-weight: 600; padding: 0.7em 1.6em; border: none; border-radius: 999px; background: #fa233b; color: #fff; cursor: pointer; }
button:disabled { cursor: default; opacity: 0.6; }
</style>
</head>
<body>
<main>
<img src="/logo.svg" alt="" width="96" height="96">
<h1>Open Music CLI</h1>
<p>The command line is waiting for a Music User Token. Sign in to Apple Music with the Apple Account whose library it is for.</p>
<p id="status" role="status" aria-live="polite">Loading Apple's sign-in…</p>
<button id="connect" type="button" disabled>Sign in with Apple Music</button>
</main>
<script type="module" src="/page.js"></script>
</body>
</html>
`;

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

/** Whether `given` is `secret`, compared in constant time. */
function isSecret(secret: Buffer, given: string | null): boolean {
  const bytes = Buffer.from(given ?? "");
  return bytes.length === secret.length && timingSafeEqual(bytes, secret);
}

const OPENED =
  "This sign-in page has been opened already, and it opens once. If the tab that opened it is yours, use it. If not, someone else on this machine may have opened it first: press Ctrl+C in the terminal and run login again.";

/**
 * Starts the sign-in server on 127.0.0.1 and ::1. Its page is `http://localhost:<port>/?state=<ticket>`, and it
 * answers only requests whose `Host` is `localhost:<port>`, so a name rebound to the address reaches nothing:
 *
 * - `GET /?state=` is the page, once: the ticket in the address is used up by the first request, since the address
 *   is passed to the browser in a command line other users may read. The page carries a second secret, which its
 *   script sends to the two routes below. `GET /page.js` is its script, and `GET /logo.svg` its logo.
 * - `/token?state=<secret>` is `tokenEndpoint`, minting fifteen-minute tokens bound to the page's origin;
 * - `/user-token` is `userTokenIntake`, which takes a post only with the secret in an `x-login-state` header, asks
 *   Apple, and only then stores; the header and the JSON body make another site's post ask first, and nothing
 *   here answers that asking. One token is taken: a post while another is asked about, or after one is kept, is 409.
 *
 * Anything else is 404. Both secrets are fresh for each run.
 *
 * @throws CliError with exit status 2 when `port` is taken.
 */
export async function startLoopback(options: tLoopbackOptions): Promise<tLoopback> {
  const { key, music, store, userId, script } = options;
  const ticket = Buffer.from(randomBytes(32).toString("base64url"));
  const secret = randomBytes(32).toString("base64url");
  const secretBytes = Buffer.from(secret);
  let opened = false;

  let resolveStored!: () => void;
  let rejectStored!: (reason: unknown) => void;
  const stored = new Promise<void>((resolve, reject) => {
    resolveStored = resolve;
    rejectStored = reject;
  });
  // One token is taken: while a post is being asked about, or once one is kept, another is turned away, so the token
  // kept is the one the terminal reports.
  let asking = false;
  let kept = false;

  const { servers, port } = await listenOnLoopback(options.port);
  const host = `localhost:${String(port)}`;
  const origin = `http://${host}`;

  const endpoint = tokenEndpoint({ pem: key.pem, teamId: key.teamId, keyId: key.keyId, origin: [origin] });
  const intake = userTokenIntake(music, { store, userId: (req) => (isSecret(secretBytes, req.headers.get("x-login-state")) ? userId : undefined) });

  const route = async (req: Request): Promise<Response> => {
    if (req.headers.get("host")?.toLowerCase() !== host) return text(421, "Misdirected Request");
    // What a browser sends from another page, or from no page at all as `null`, is refused whatever it asks for: the
    // page's own requests carry its origin or none.
    const from = req.headers.get("origin");
    if (from !== null && from !== origin) return text(403, "Forbidden");
    const url = new URL(req.url);
    const given = url.searchParams.get("state");
    if (url.pathname === "/" && req.method === "GET" && isSecret(ticket, given)) {
      if (opened) return text(410, OPENED);
      opened = true;
      return new Response(page(secret), { headers: { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": CSP } });
    }
    if (url.pathname === "/page.js" && req.method === "GET") return new Response(await readFile(script), { headers: { ...PAGE_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
    if (url.pathname === "/logo.svg" && req.method === "GET") return new Response(await readFile(options.logo), { headers: LOGO_HEADERS });
    if (url.pathname === "/token" && isSecret(secretBytes, given)) return endpoint(req);
    if (url.pathname === "/user-token") {
      if (asking || kept) return text(409, kept ? "A token is kept already." : "Another token is being asked about.");
      asking = true;
      try {
        // 204 once Apple has accepted the token and the store has it.
        const answer = await intake(req);
        kept = answer.status === 204;
        return answer;
      } finally {
        asking = false;
      }
    }
    return text(404, "Not Found");
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const request = toRequest(req, res, origin, options.timeoutMs);
    if (request === undefined) {
      res.writeHead(400, { "cache-control": "no-store" }).end();
      return;
    }
    route(request).then(
      async (response) => {
        // The token is kept. `login` closes the server as soon as it hears, so it hears once the page has been told,
        // or once the page's connection is gone and there is no one left to tell.
        if (response.status === 204 && new URL(request.url).pathname === "/user-token") {
          if (res.closed) resolveStored();
          else res.once("close", resolveStored);
        }
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      },
      (e: unknown) => {
        // A request that ran out of time is answered 504, for the page to try again. A browser that went away aborts
        // its own request too; anything else is the run's to hear about.
        const late = request.signal.reason instanceof DOMException && request.signal.reason.name === "TimeoutError";
        res.writeHead(late ? 504 : 500, { "cache-control": "no-store" }).end();
        if (!request.signal.aborted) rejectStored(e);
      },
    );
  };
  for (const server of servers) server.on("request", handle);

  return {
    url: `${origin}/?state=${ticket.toString()}`,
    stored,
    close: () => Promise.all(servers.map(close)).then(() => undefined),
  };
}

/** Stops `server` listening and drops its connections. */
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  });

const listen = (server: Server, port: number, address: string) =>
  new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      resolve();
    });
  });

const taken = (e: unknown, port: number) =>
  (e as NodeJS.ErrnoException).code === "EADDRINUSE" ? usage(`Port ${String(port)} is in use: pick another with --port, or leave it out and the system picks one.`) : e;

/**
 * Servers on both loopback addresses, 127.0.0.1 and ::1, on one port. `localhost` is either, and a browser may try
 * ::1 first: a port held on one address alone leaves the other to whoever takes it, page, state and token included.
 * Where the system has no IPv6, 127.0.0.1 is all `localhost` can be. A port the system picked that someone holds on
 * ::1 is picked again; a port asked for is refused.
 */
async function listenOnLoopback(wanted: number): Promise<{ servers: Server[]; port: number }> {
  for (let attempt = 1; ; attempt++) {
    const v4 = createServer();
    await listen(v4, wanted, "127.0.0.1").catch((e: unknown) => {
      throw taken(e, wanted);
    });
    const { port } = v4.address() as AddressInfo;
    const v6 = createServer();
    try {
      await listen(v6, port, "::1");
      return { servers: [v4, v6], port };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") return { servers: [v4], port };
      await close(v4);
      if (code !== "EADDRINUSE" || wanted !== 0 || attempt === 5) throw taken(e, port);
    }
  }
}

/**
 * The web-standard Request for what node:http hands over, aborted when the connection closes before the answer is
 * sent or after `timeoutMs`, or undefined when its target is not a path on this server or fetch takes no request like
 * it. What is left of a body the intake stops reading is let go by, so its answer can still be written.
 */
export function toRequest(req: IncomingMessage, res: ServerResponse, origin: string, timeoutMs: number): Request | undefined {
  // The URL is this server's own origin and the target as sent, never the Host header, which is checked by itself:
  // a target that is not a path, such as `http://elsewhere/`, makes no URL here.
  let url: URL;
  try {
    url = new URL(origin + (req.url ?? "/"));
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i] ?? "", req.rawHeaders[i + 1] ?? "");
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      req.on("data", (chunk: Buffer) => {
        if (cancelled) return;
        stream.enqueue(new Uint8Array(chunk));
        // Read as far as the handler has asked and no further: the rest waits in the socket, not in memory. Once the
        // answer is sent, node:http stops reading of its own accord.
        if ((stream.desiredSize ?? 0) <= 0) req.pause();
      });
      req.on("end", () => {
        if (!cancelled) stream.close();
      });
      req.on("error", (e) => {
        if (!cancelled) stream.error(e);
      });
    },
    pull() {
      req.resume();
    },
    cancel() {
      cancelled = true;
      req.resume();
    },
  });
  const method = req.method ?? "GET";
  const sends = method !== "GET" && method !== "HEAD";
  // node:http takes methods that fetch's Request refuses, such as TRACE: a request like that is refused, not thrown
  // where nothing catches it.
  try {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    return new Request(url, { method, headers, body: sends ? body : null, signal, duplex: "half" } as RequestInit);
  } catch {
    return undefined;
  }
}

/** Opens `url` in the default browser with the system's own command. Whether it opens or not, `login` has printed the URL. */
export function openBrowser(url: string): void {
  // On Windows, explorer.exe given this address opened the Documents folder; the URL protocol handler opens the
  // default browser, and runs no shell over the address.
  const [command, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

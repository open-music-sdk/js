// The sign-in server `login` runs while it waits: a page on a loopback address that runs Apple's sign-in, the
// server package's token endpoint for that page, and its user-token intake for what the page posts back.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tokenEndpoint, userTokenIntake, type tAppleMusicClient, type tUserTokenStore } from "@open-music-sdk/server";
import { usage, type tKey } from "./files";

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
}

export interface tLoopback {
  /** The page, with this run's state in it: what the browser opens. */
  readonly url: string;
  /**
   * Settles once the store has the token Apple accepted and the page has been told, or rejects with what a request
   * failed with that is not the request's own.
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
  "img-src 'self' data: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// No `Referrer-Policy: no-referrer`, which developers report breaks Apple's sign-in, and no COOP, since the
// sign-in window has to talk back to the page that opened it.
const PAGE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · open-music-sdk</title>
<style>
:root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
main { max-width: 34rem; }
button { font: inherit; padding: 0.6em 1.2em; border-radius: 8px; cursor: pointer; }
button:disabled { cursor: default; opacity: 0.6; }
</style>
</head>
<body>
<main>
<h1>Sign in to Apple Music</h1>
<p>The open-music-sdk command line is waiting for a Music User Token. Sign in with the Apple Account whose library it is for.</p>
<p id="status" role="status" aria-live="polite">Loading Apple's sign-in…</p>
<button id="connect" type="button" disabled>Sign in with Apple Music</button>
</main>
<script type="module" src="/page.js"></script>
</body>
</html>
`;

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

/** Whether `given` is this run's state, compared in constant time. */
function isState(state: Buffer, given: string | null): boolean {
  const bytes = Buffer.from(given ?? "");
  return bytes.length === state.length && timingSafeEqual(bytes, state);
}

/**
 * Starts the sign-in server on 127.0.0.1. Its page is `http://localhost:<port>/?state=<state>`, and it answers only
 * requests whose `Host` is `localhost:<port>`, so a name rebound to the address reaches nothing:
 *
 * - `GET /?state=` is the page, and `GET /page.js` its script;
 * - `/token?state=` is `tokenEndpoint`, minting fifteen-minute tokens bound to the page's origin;
 * - `/user-token` is `userTokenIntake`, which takes a post only with the state in an `x-login-state` header, asks
 *   Apple, and only then stores; the header and the JSON body make another site's post ask first, and nothing
 *   here answers that asking.
 *
 * Anything else is 404. The state is fresh for each run.
 *
 * @throws CliError with exit status 2 when `port` is taken.
 */
export async function startLoopback(options: tLoopbackOptions): Promise<tLoopback> {
  const { key, music, store, userId, script } = options;
  const state = randomBytes(32).toString("base64url");
  const stateBytes = Buffer.from(state);

  let resolveStored!: () => void;
  let rejectStored!: (reason: unknown) => void;
  const stored = new Promise<void>((resolve, reject) => {
    resolveStored = resolve;
    rejectStored = reject;
  });
  // The intake calls `set` once Apple has accepted the token. What `login` waits for is the page being told so as
  // well, since the server closes as soon as it hears: until then, the answer is only on its way.
  let kept = false;
  const waited: tUserTokenStore = {
    get: (id) => store.get(id),
    delete: (id) => store.delete(id),
    set: async (id, token) => {
      await store.set(id, token);
      kept = true;
    },
  };

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) => {
      reject(e.code === "EADDRINUSE" ? usage(`Port ${String(options.port)} is in use: pick another with --port, or leave it out and the system picks one.`) : e);
    });
    server.listen(options.port, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const host = `localhost:${String(port)}`;
  const origin = `http://${host}`;

  const endpoint = tokenEndpoint({ pem: key.pem, teamId: key.teamId, keyId: key.keyId, origin: [origin] });
  const intake = userTokenIntake(music, { store: waited, userId: (req) => (isState(stateBytes, req.headers.get("x-login-state")) ? userId : undefined) });

  const route = async (req: Request): Promise<Response> => {
    if (req.headers.get("host")?.toLowerCase() !== host) return text(421, "Misdirected Request");
    const url = new URL(req.url);
    const ours = isState(stateBytes, url.searchParams.get("state"));
    if (url.pathname === "/" && req.method === "GET" && ours)
      return new Response(PAGE, { headers: { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": CSP } });
    if (url.pathname === "/page.js" && req.method === "GET") return new Response(await readFile(script), { headers: { ...PAGE_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
    if (url.pathname === "/token" && ours) return endpoint(req);
    if (url.pathname === "/user-token") return intake(req);
    return text(404, "Not Found");
  };

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const request = toRequest(req, res, origin);
    if (request === undefined) {
      res.writeHead(400, { "cache-control": "no-store" }).end();
      return;
    }
    route(request).then(
      async (response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()), () => {
          if (kept && response.status === 204 && new URL(request.url).pathname === "/user-token") resolveStored();
        });
      },
      (e: unknown) => {
        res.writeHead(500, { "cache-control": "no-store" }).end();
        // A browser that went away aborts its own request; anything else is the run's to hear about.
        if (!request.signal.aborted) rejectStored(e);
      },
    );
  });

  return {
    url: `${origin}/?state=${state}`,
    stored,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

/**
 * The web-standard Request for what node:http hands over, aborted when the connection closes before the answer is
 * sent, or undefined when its target is not a path on this server or fetch takes no request like it. What is left of
 * a body the intake stops reading is let go by, so its answer can still be written.
 */
export function toRequest(req: IncomingMessage, res: ServerResponse, origin: string): Request | undefined {
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
    return new Request(url, { method, headers, body: sends ? body : null, signal: controller.signal, duplex: "half" } as RequestInit);
  } catch {
    return undefined;
  }
}

/** Opens `url` in the default browser with the system's own command. Whether it opens or not, `login` has printed the URL. */
export function openBrowser(url: string): void {
  const [command, args] = process.platform === "win32" ? ["explorer.exe", [url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

// Shows: createServerClient, createRateLimiter, tokenEndpoint, acceptUserToken, parseToken, MemoryUserTokenStore,
// forUser, isAppleMusicError. Guides: /guides/token-endpoint, /guides/store-user-tokens
import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import { MemoryUserTokenStore, acceptUserToken, createRateLimiter, createServerClient, isAppleMusicError, parseToken, tokenEndpoint } from "@open-music-sdk/server";
import { web } from "./web.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy samples/.env.example to samples/express-server/.env and fill it in.`);
  return value;
}
const key = { pem: required("APPLE_MUSIC_PRIVATE_KEY"), teamId: required("APPLE_MUSIC_TEAM_ID"), keyId: required("APPLE_MUSIC_KEY_ID") };
// The page the developer token is bound to. A deployed copy has to name its own: there is no default to forget.
const pageOrigin = required("PAGE_ORIGIN");

// One client for the whole server. Every listener's requests count against the same developer token, so they
// share one limiter. The store loses its tokens when the server stops: a real app keeps them somewhere lasting.
const store = new MemoryUserTokenStore();
const music = createServerClient({ ...key, userTokenStore: store, rateLimit: createRateLimiter({ capacity: 20, refillPerSecond: 10 }) });

const app = express();

// Only requests sent to this server by its own name or the page's: a site whose name a DNS trick points at
// 127.0.0.1 would otherwise reach it from the listener's browser as if it were the page.
const hosts = new Set([new URL(pageOrigin).host, "127.0.0.1:8787"]);
app.use((req, res, next) => {
  if (hosts.has(req.headers.host ?? "")) next();
  else res.status(421).json({ error: "MisdirectedRequest" });
});

// A listener is a random id in a cookie, given with the first answer under /api. A real app has its own sessions.
const sessionOf = (req: Request) => /(?:^|;\s*)crate_session=([0-9a-f-]{36})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
app.use("/api", (req, res, next) => {
  if (sessionOf(req) === undefined) res.cookie("crate_session", randomUUID(), { httpOnly: true, sameSite: "lax", path: "/api" });
  res.set("cache-control", "no-store");
  next();
});

// #region token-route
// The page's developer token, minted for the page's origin alone and short-lived, since anyone can read a page.
const token = tokenEndpoint({ ...key, origin: [pageOrigin] });
app.all("/api/music/token", web(token));
// #endregion token-route

// #region user-token
// The listener's Music User Token, posted by the page after Apple's sign-in. acceptUserToken asks Apple whether it
// works, and stores it under this listener's session only then.
app.post("/api/music/user-token", express.json({ limit: "8kb" }), async (req, res) => {
  // Only JSON is taken: a form on another site cannot send it, so it cannot bind its own token to this listener.
  if (!req.is("application/json")) {
    res.status(415).json({ error: "UnsupportedMediaType" });
    return;
  }
  const session = sessionOf(req);
  if (session === undefined) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const posted: unknown = (req.body as { token?: unknown } | undefined)?.token;
  if (typeof posted !== "string") {
    res.status(400).json({ error: "BadRequest" });
    return;
  }
  // Checked here rather than left to acceptUserToken, whose TypeError means a string that is no token or a key that
  // is no key: the first is the listener's to hear about, the second the server's.
  const token = parseToken(posted);
  if (token === undefined) {
    res.status(422).json({ error: "UserTokenInvalid" });
    return;
  }
  try {
    await acceptUserToken(music, store, session, token);
    res.status(204).end();
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    // UserTokenInvalid: Apple will not take this token. Anything else: Apple could not be asked.
    res.status(e._tag === "UserTokenInvalid" ? 422 : 502).json({ error: e._tag });
  }
});
// #endregion user-token

// #region sign-out
// The listener signed out of Apple Music in the page: the server forgets its copy of their token.
app.delete("/api/music/user-token", async (req, res) => {
  const session = sessionOf(req);
  if (session !== undefined) await store.delete(session);
  res.status(204).end();
});
// #endregion sign-out

// #region act-for-listener
// What the listener played lately, asked by the server with the token it stored for them.
app.get("/api/me/recent", async (req, res) => {
  const session = sessionOf(req);
  if (session === undefined) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const recent: unknown[] = [];
    for await (const item of music.forUser(session).user.listRecentlyPlayed({ limit: 10, maxPages: 1 })) recent.push(item);
    res.json(recent);
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    // UserTokenInvalid: no token is stored for this listener, or Apple no longer takes it. The page asks them to sign in.
    res.status(e._tag === "UserTokenInvalid" ? 422 : 502).json({ error: e._tag });
  }
});
// #endregion act-for-listener

// Anything a route throws, and a body express.json() cannot read, is answered without the stack Express would print.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express tells an error handler by its four parameters
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (error as { status?: unknown }).status;
  const code = typeof status === "number" && status >= 400 && status < 500 ? status : 500;
  if (code === 500) console.error(error);
  // Named as userTokenIntake names them: "BadRequest", "PayloadTooLarge".
  res.status(code).json({ error: STATUS_CODES[code]?.replaceAll(" ", "") });
});

// On this machine's loopback address alone: the samples are never meant to be reached from elsewhere.
app.listen(8787, "127.0.0.1", (error) => {
  if (error) throw error;
  console.log(`express-server: http://127.0.0.1:8787, handing tokens to ${pageOrigin}`);
});

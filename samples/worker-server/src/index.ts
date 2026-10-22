// Shows: createServerClient, createRateLimiter, tokenEndpoint, userTokenIntake,
// KvUserTokenStore, forUser, isAppleMusicError. Guides:
// /guides/server-setup, /guides/token-endpoint, /guides/store-user-tokens
import {
  KvUserTokenStore,
  createRateLimiter,
  createServerClient,
  isAppleMusicError,
  tokenEndpoint,
  userTokenIntake,
  type tKvNamespace,
  type tMusic,
  type tTokenEndpoint,
  type tUserTokenIntake,
  type tUserTokenStore,
} from "@open-music-sdk/server";

// What Wrangler hands the Worker: the secrets from .env, and the KV namespace
// from wrangler.jsonc.
interface tEnv {
  readonly APPLE_MUSIC_PRIVATE_KEY?: string;
  readonly APPLE_MUSIC_TEAM_ID?: string;
  readonly APPLE_MUSIC_KEY_ID?: string;
  readonly PAGE_ORIGIN?: string;
  readonly MUSIC_USER_TOKENS: tKvNamespace;
}

// Everything the routes use, made once.
interface tApp {
  readonly music: tMusic;
  readonly store: tUserTokenStore;
  readonly token: tTokenEndpoint;
  readonly intake: tUserTokenIntake;
  readonly hosts: ReadonlySet<string>;
}

// #region server-client
// Made on the first request, from the secrets that request brings, and kept for
// every request after it: a client made per request would sign a new developer
// token every time.
let app: tApp | undefined;

function setUp(env: tEnv): tApp {
  const pem = env.APPLE_MUSIC_PRIVATE_KEY;
  const teamId = env.APPLE_MUSIC_TEAM_ID;
  const keyId = env.APPLE_MUSIC_KEY_ID;
  // The page the token is bound to has no default either: a deployed copy has
  // to name its own.
  const pageOrigin = env.PAGE_ORIGIN;
  if (!pem || !teamId || !keyId || !pageOrigin) {
    throw new Error(
      "The MusicKit key or PAGE_ORIGIN is not set. Copy "
        + "samples/.env.example to samples/worker-server/.env and fill it in.",
    );
  }
  const key = { pem, teamId, keyId };

  const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS);
  const music = createServerClient({
    ...key,
    userTokenStore: store,
    rateLimit: createRateLimiter({ capacity: 20, refillPerSecond: 10 }),
  });
  // #region token-route
  // The page's developer token, minted for the page's origin alone and
  // short-lived, since anyone can read a page. The handler takes the Worker's
  // request as it comes: see route() below.
  const token = tokenEndpoint({ ...key, origin: [pageOrigin] });
  // #endregion token-route
  // #region user-token
  // Asks Apple whether the posted token works, and keeps it under the session's
  // id only then.
  const intake = userTokenIntake(music, { store, userId: sessionOf });
  // #endregion user-token
  // Requests sent to the Worker by its own name or the page's: a site whose
  // name a DNS trick points at 127.0.0.1 would otherwise reach it from the
  // listener's browser as if it were the page.
  const hosts = new Set([new URL(pageOrigin).host, "127.0.0.1:8787"]);
  return { music, store, token, intake, hosts };
}
// #endregion server-client

// A listener is a random id in a cookie, given with the first answer. A real
// app has its own sessions.
const SESSION_COOKIE = /(?:^|;\s*)crate_session=([0-9a-f-]{36})(?:;|$)/;

function sessionOf(req: Request): string | undefined {
  return SESSION_COOKIE.exec(req.headers.get("cookie") ?? "")?.[1];
}

// #region fetch
export default {
  async fetch(req: Request, env: tEnv): Promise<Response> {
    app ??= setUp(env);
    const answer = await route(req, app);
    if (sessionOf(req) !== undefined) return answer;
    // A request with no session gets one with its answer.
    const withSession = new Response(answer.body, answer);
    const session = crypto.randomUUID();
    withSession.headers.append(
      "set-cookie",
      `crate_session=${session}; Path=/api; HttpOnly; SameSite=Lax`,
    );
    return withSession;
  },
};
// #endregion fetch

// #region route
// The two SDK handlers answer methods themselves, so each is routed by its
// path; the sign-out is the one DELETE.
async function route(req: Request, app: tApp): Promise<Response> {
  const { music, store, token, intake, hosts } = app;
  if (!hosts.has(req.headers.get("host") ?? "")) {
    return reply(421, { error: "MisdirectedRequest" });
  }
  const { pathname } = new URL(req.url);
  switch (pathname) {
    case "/api/music/token":
      return token(req);
    case "/api/music/user-token":
      return req.method === "DELETE" ? signOut(store, req) : intake(req);
    case "/api/me/recent":
      return recent(music, req);
    default:
      return reply(404, { error: "NotFound" });
  }
}
// #endregion route

// #region sign-out
// The listener signed out of Apple Music in the page: the Worker forgets its
// copy of their token.
async function signOut(
  store: tUserTokenStore,
  req: Request,
): Promise<Response> {
  const session = sessionOf(req);
  if (session !== undefined) await store.delete(session);
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
// #endregion sign-out

// What the listener played lately, asked by the server with the token it stored
// for them.
async function recent(music: tMusic, req: Request): Promise<Response> {
  const session = sessionOf(req);
  if (session === undefined) return reply(401, { error: "Unauthorized" });
  try {
    const listener = music.forUser(session);
    const items: unknown[] = [];
    const played = listener.user.listRecentlyPlayed({
      limit: 10,
      maxPages: 1,
    });
    for await (const item of played) items.push(item);
    return reply(200, items);
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    // UserTokenInvalid: no token is stored for this listener, or Apple no
    // longer takes it, and the page asks them to sign in.
    const status = e._tag === "UserTokenInvalid" ? 422 : 502;
    return reply(status, { error: e._tag });
  }
}

/** A JSON answer that no cache keeps. */
function reply(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

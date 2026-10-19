// Shows: createServerClient, createRateLimiter, tokenEndpoint, userTokenIntake, KvUserTokenStore, forUser,
// isAppleMusicError. Guides: /guides/cloudflare-workers, /guides/token-endpoint, /guides/store-user-tokens
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
} from "@open-music-sdk/server";

// What Wrangler hands the Worker: the secrets from .env, and the KV namespace from wrangler.jsonc.
interface tEnv {
  readonly APPLE_MUSIC_PRIVATE_KEY?: string;
  readonly APPLE_MUSIC_TEAM_ID?: string;
  readonly APPLE_MUSIC_KEY_ID?: string;
  readonly PAGE_ORIGIN?: string;
  readonly MUSIC_USER_TOKENS: tKvNamespace;
}

interface tApp {
  readonly music: tMusic;
  readonly token: tTokenEndpoint;
  readonly intake: tUserTokenIntake;
}

// Made on the first request, from the secrets that request brings, and kept for every request after it: a client
// made per request would sign a new developer token every time.
let app: tApp | undefined;

function setUp(env: tEnv): tApp {
  const { APPLE_MUSIC_PRIVATE_KEY: pem, APPLE_MUSIC_TEAM_ID: teamId, APPLE_MUSIC_KEY_ID: keyId } = env;
  if (!pem || !teamId || !keyId) throw new Error("The MusicKit key is not set. Copy samples/.env.example to samples/worker-server/.env and fill it in.");
  const key = { pem, teamId, keyId };
  const store = new KvUserTokenStore(env.MUSIC_USER_TOKENS);
  const music = createServerClient({ ...key, userTokenStore: store, rateLimit: createRateLimiter({ capacity: 20, refillPerSecond: 10 }) });
  return {
    music,
    // #region token-route
    token: tokenEndpoint({ ...key, origin: [env.PAGE_ORIGIN ?? "http://localhost:2728"] }),
    // #endregion token-route
    // #region user-token
    // Asks Apple whether the posted token works, and keeps it under the session's id only then.
    intake: userTokenIntake(music, { store, userId: sessionOf }),
    // #endregion user-token
  };
}

// A listener is a random id in a cookie, given with the first answer. A real app has its own sessions.
function sessionOf(req: Request): string | undefined {
  return /(?:^|;\s*)crate_session=([0-9a-f-]{36})(?:;|$)/.exec(req.headers.get("cookie") ?? "")?.[1];
}

export default {
  async fetch(req: Request, env: tEnv): Promise<Response> {
    const answer = await route(req, (app ??= setUp(env)));
    if (sessionOf(req) !== undefined) return answer;
    const withSession = new Response(answer.body, answer);
    withSession.headers.append("set-cookie", `crate_session=${crypto.randomUUID()}; Path=/api; HttpOnly; SameSite=Lax`);
    return withSession;
  },
};

// The two routes answer methods themselves, so each is routed by its path alone.
async function route(req: Request, { music, token, intake }: tApp): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/music/token") return token(req);
  if (pathname === "/api/music/user-token") return intake(req);
  if (pathname === "/api/me/recent") return recent(music, req);
  return reply(404, { error: "NotFound" });
}

// #region act-for-listener
// What the listener played lately, asked by the server with the token it stored for them.
async function recent(music: tMusic, req: Request): Promise<Response> {
  const session = sessionOf(req);
  if (session === undefined) return reply(401, { error: "Unauthorized" });
  try {
    const items: unknown[] = [];
    for await (const item of music.forUser(session).user.listRecentlyPlayed({ limit: 10, maxPages: 1 })) items.push(item);
    return reply(200, items);
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    // UserTokenInvalid: no token is stored for this listener, or Apple no longer takes it. The page asks them to sign in.
    return reply(e._tag === "UserTokenInvalid" ? 422 : 502, { error: e._tag });
  }
}
// #endregion act-for-listener

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

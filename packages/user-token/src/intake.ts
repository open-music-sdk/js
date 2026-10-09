// userTokenIntake: acceptUserToken behind a web-standard handler. It checks who is sending, reads what was sent
// up to a limit, and answers with a status; validating and storing are acceptUserToken's.
import { isAppleMusicError, parseToken, readBounded, type tAppleMusicClient, type tUserTokenStore } from "@open-music-sdk/core";
import { acceptUserToken } from "./accept.js";

// A token is a few hundred characters; nothing honest comes near this.
const MAX_BODY_BYTES = 8192;

export interface tUserTokenIntakeOptions {
  store: tUserTokenStore;
  /**
   * The signed-in user this request belongs to, from your own session; the token is stored under it.
   * Resolve to nothing when there is no session and the request is answered 401.
   */
  userId: (req: Request) => string | null | undefined | Promise<string | null | undefined>;
}

const reply = (status: number, error: string, headers: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });

/** Whether a Content-Type header says JSON: `application/json`, with or without parameters. */
export const isJson = (contentType: string | null): boolean => /^application\/json\s*(;|$)/i.test(contentType ?? "");

/**
 * A handler for `POST` with a JSON body `{ "token": "..." }`. Answers 204 once Apple has accepted the
 * token and the store has it; otherwise `{ "error": ... }` with 422 when the token is no good and
 * 502 when Apple did not confirm it. Neither the token nor Apple's error text is ever echoed.
 * Apple is asked through `client`, under its retry policy; bounding that wait is the caller's call.
 */
export function userTokenIntake(client: tAppleMusicClient, options: tUserTokenIntakeOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return reply(405, "MethodNotAllowed", { allow: "POST" });
    // A page on another site cannot send JSON without a preflight, so this also stops one from
    // binding its own token to a signed-in visitor.
    if (!isJson(req.headers.get("content-type"))) return reply(415, "UnsupportedMediaType");
    // The user comes from the session and nowhere else; nothing in the body can name one.
    const userId = await options.userId(req);
    if (!userId) return reply(401, "Unauthorized");

    // Whoever posts decides how much is sent, and must not decide how much is kept.
    const text = await readBounded(req, MAX_BODY_BYTES);
    if (text === undefined) return reply(413, "PayloadTooLarge");
    let posted: unknown;
    try {
      posted = (JSON.parse(text) as { token?: unknown } | null)?.token;
    } catch {
      return reply(400, "BadRequest");
    }
    if (typeof posted !== "string") return reply(400, "BadRequest");
    // What is posted is input, not a caller's mistake: a string that is no token is answered, not thrown.
    const token = parseToken(posted);
    if (token === undefined) return reply(422, "UserTokenInvalid");

    try {
      await acceptUserToken(client, options.store, userId, token, { signal: req.signal });
    } catch (e) {
      if (!isAppleMusicError(e)) throw e;
      return reply(e._tag === "UserTokenInvalid" ? 422 : 502, e._tag);
    }
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  };
}

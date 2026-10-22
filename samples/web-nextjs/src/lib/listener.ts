// Shows: forUser, getUserStorefront, getSongRatings, React's cache.
// Guide: /guides/store-user-tokens
import {
  isAppleMusicError,
  type tMusic,
  type tMusicVideo,
  type tSong,
} from "@open-music-sdk/server";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { getMusic, getStore } from "./music";
import { sessionId } from "./session";

export const STOREFRONT_COOKIE = "crate_storefront";
const STOREFRONT = /^[a-z]{2}$/;

/** Whether a value is a storefront's id, as `us` or `gb` are. */
export function isStorefront(value: unknown): value is string {
  return typeof value === "string" && STOREFRONT.test(value);
}

interface tListener {
  /**
   * A client for the listener, which finds their token in the store at each
   * request.
   */
  readonly music: tMusic;
  /** The storefront their account is in, from Apple. */
  readonly storefront: string;
}

/**
 * The signed-in listener, asked for once per render however many components
 * want them. Undefined when the store has no token for this session, or Apple
 * no longer takes the one it has.
 */
export const listener = cache(async (): Promise<tListener | undefined> => {
  // Every page asks for the listener before it asks Apple for anything, so
  // this makes each of them ask at request time, and never while Next draws a
  // page ahead: the client reads the clock to keep its developer token fresh,
  // which a page drawn ahead may not.
  await connection();
  const session = await sessionId();
  if (session === undefined) return undefined;
  const store = getStore();
  const token = await store.get(session);
  if (token === undefined) return undefined;
  // A client that acts for this session's listener, with the token the
  // user-token route stored for them.
  const music = getMusic().forUser(session);
  try {
    const storefront = await music.user.getUserStorefront();
    return { music, storefront: storefront.id };
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    // Forget only the token Apple refused: the listener may have signed in
    // again, and a new token been stored, while this was on its way.
    const refused = isAppleMusicError(e, "UserTokenInvalid");
    if (refused && (await store.get(session)) === token) {
      await store.delete(session);
    }
    // Any other failure leaves the token kept, and this render drawn as for no
    // one, rather than every page failing with it.
    return undefined;
  }
});

/**
 * The storefront every catalog read asks in: the listener's own while they
 * are signed in, else the one picked, `us` to begin with.
 */
export async function storefront(): Promise<string> {
  const you = await listener();
  if (you !== undefined) return you.storefront;
  const picked = (await cookies()).get(STOREFRONT_COOKIE)?.value;
  return isStorefront(picked) ? picked : "us";
}

/**
 * The ids of the songs among these the listener loves, from one request for
 * all of them; undefined while no one is signed in.
 */
export async function lovedOf(
  tracks: readonly (tSong | tMusicVideo)[],
): Promise<string[] | undefined> {
  const you = await listener();
  if (you === undefined) return undefined;
  const songs = tracks.filter((track) => track.type === "songs");
  const ids = songs.map((song) => song.id).slice(0, 300);
  if (ids.length === 0) return [];
  try {
    const ratings = await you.music.user.getSongRatings(ids);
    const loves = ratings.filter((rating) => rating.attributes?.value === 1);
    return loves.map((rating) => rating.id);
  } catch (e) {
    // The hearts are an extra: songs whose ratings Apple will not give are
    // drawn without them.
    if (isAppleMusicError(e)) return [];
    throw e;
  }
}

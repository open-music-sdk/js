"use server";
// Shows: forUser, addToLibrary, addToFavorites, setSongRating,
// deleteSongRating, getSearchHints, playlists.resolve, playlists.read,
// playlists.plan, playlists.apply, listLibraryPlaylists, getArtistRelationship.
// Guides: /guides/nextjs, /guides/import-playlist
//
// Everything the listener does runs here, on the server. Each action is a
// POST anyone could send, so each checks what it is handed, and acts only for
// the listener whose session sent it.
import {
  isAppleMusicError,
  type tMusic,
  type tPlaylistPlan,
  type tPlaylistSnapshot,
  type tNewPlaylist,
  type tPlaylistTrack,
  type tSkippedTrack,
  type tSong,
  type tTrackDescription,
} from "@open-music-sdk/server";
import { cookies } from "next/headers";
import {
  STOREFRONT_COOKIE,
  isStorefront,
} from "./listener";
import { getMusic } from "./music";
import { sessionId } from "./session";
import {
  catalogSleeves,
  playlistSleeves,
  type tSleeveData,
} from "./sleeves";
import { explain } from "./errors";

/**
 * What an action answers: what it made, or what went wrong, in words. Apple's
 * errors are answered rather than thrown, since Next keeps a thrown error's
 * message from the page.
 */
export type tAnswer<T = void> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly said: string };

const SIGN_IN_FIRST: tAnswer<never> = {
  ok: false,
  said: "Sign in with Apple Music first.",
};

/** A catalog or library id, as Apple writes them. */
const ID = /^[\w.-]{1,64}$/;

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

// #region add-to-library
/**
 * The client that acts for this request's listener. It finds their token in
 * the store at each request; without one, Apple's answer is a
 * UserTokenInvalid.
 */
async function forListener(): Promise<tMusic | undefined> {
  const session = await sessionId();
  if (session === undefined) return undefined;
  return getMusic().forUser(session);
}

/** Runs the work, and answers Apple's error in words rather than throw it. */
async function answer<T>(work: () => Promise<T>): Promise<tAnswer<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    if (isAppleMusicError(e)) return { ok: false, said: explain(e) };
    throw e;
  }
}

/**
 * Adds a song, a music video or an album to the listener's library. Apple
 * accepts the request at once, and adds it afterwards, within seconds.
 */
export async function addToLibrary(
  kind: "songs" | "music-videos" | "albums",
  id: string,
): Promise<tAnswer> {
  const ids = libraryIds(kind, id);
  if (ids === undefined) throw new TypeError("addToLibrary: not an id");
  const listener = await forListener();
  if (listener === undefined) return SIGN_IN_FIRST;
  return answer(async () => {
    await listener.user.addToLibrary(ids);
  });
}
// #endregion add-to-library

function libraryIds(kind: unknown, id: unknown) {
  if (!isId(id)) return undefined;
  switch (kind) {
    case "songs":
      return { songs: [id] };
    case "music-videos":
      return { "music-videos": [id] };
    case "albums":
      return { albums: [id] };
    default:
      return undefined;
  }
}

/** Makes an album a favorite, which adds it to the library too. */
export async function favorite(albumId: string): Promise<tAnswer> {
  if (!isId(albumId)) throw new TypeError("favorite: not an id");
  const listener = await forListener();
  if (listener === undefined) return SIGN_IN_FIRST;
  return answer(async () => {
    await listener.user.addToFavorites({ albums: [albumId] });
  });
}

/** Loves a song, a rating of 1, or takes the rating away again. */
export async function love(songId: string, loving: boolean): Promise<tAnswer> {
  if (!isId(songId) || typeof loving !== "boolean") {
    throw new TypeError("love: not a song id and a yes or no");
  }
  const listener = await forListener();
  if (listener === undefined) return SIGN_IN_FIRST;
  return answer(async () => {
    if (loving) await listener.user.setSongRating(songId, 1);
    else await listener.user.deleteSongRating(songId);
  });
}

/**
 * The storefront to ask the catalog in while signed out. Setting the cookie
 * draws the page again in it.
 */
export async function pickStorefront(id: string): Promise<void> {
  if (!isStorefront(id)) {
    throw new TypeError("pickStorefront: not a storefront");
  }
  (await cookies()).set(STOREFRONT_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

// The catalog's actions take the storefront the page was drawn in: the
// catalog is the same for everyone in a storefront, so the page may name one,
// and the server need not ask Apple for the listener's to learn it.

/** Terms to offer as the listener types. */
export async function searchHints(
  text: string,
  storefront: string,
): Promise<tAnswer<string[]>> {
  // The page's box takes 200 characters at most.
  if (typeof text !== "string" || text.length > 200) {
    throw new TypeError("searchHints: not a search");
  }
  if (!isStorefront(storefront)) {
    throw new TypeError("searchHints: not a storefront");
  }
  return answer(async () => {
    const hints = await getMusic().catalog.getSearchHints(text, {
      storefront,
    });
    return hints.results.terms;
  });
}

/** The next of an artist's albums, from `offset`, 25 at a time. */
export async function moreAlbums(
  artistId: string,
  storefront: string,
  offset: number,
): Promise<tAnswer<tSleeveData[]>> {
  if (!isId(artistId) || !isStorefront(storefront) || !isOffset(offset)) {
    throw new TypeError("moreAlbums: not an artist, storefront and offset");
  }
  return answer(async () => {
    const albums = getMusic().catalog.getArtistRelationship(
      artistId,
      "albums",
      { storefront, limit: 25, offset, maxPages: 1 },
    );
    const page = [];
    for await (const album of albums) page.push(album);
    return catalogSleeves(page);
  });
}

/** The next of the listener's playlists, from `offset`, 25 at a time. */
export async function morePlaylists(
  offset: number,
): Promise<tAnswer<tSleeveData[]>> {
  if (!isOffset(offset)) throw new TypeError("morePlaylists: not an offset");
  const listener = await forListener();
  if (listener === undefined) return SIGN_IN_FIRST;
  return answer(async () => {
    const playlists = listener.user.listLibraryPlaylists({
      limit: 25,
      offset,
      maxPages: 1,
    });
    const page = [];
    for await (const playlist of playlists) page.push(playlist);
    return playlistSleeves(page);
  });
}

function isOffset(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 1e5;
}

/**
 * A description for each line written "Artist - Title", where the title may
 * hold " - " too. Any other line is left out.
 */
function parseTracklist(text: string): tTrackDescription[] {
  const descriptions: tTrackDescription[] = [];
  for (const line of text.split("\n")) {
    const [artistName = "", ...title] = line.split(" - ");
    if (title.length === 0) continue;
    descriptions.push({
      artistName: artistName.trim(),
      name: title.join(" - ").trim(),
    });
  }
  return descriptions;
}

interface tFound {
  /** The storefront the songs were found in, whose ids they carry. */
  readonly storefront: string;
  readonly tracks: readonly tSong[];
  readonly skipped: readonly tSkippedTrack<tTrackDescription>[];
  /** How many lines were left out, past the 200 looked for. */
  readonly leftOut: number;
}

/** At most this many lines of a paste are looked for. */
const LINES = 200;

/**
 * Finds a pasted tracklist, one "Artist - Title" a line, in the catalog. No
 * sign-in needed: it asks the catalog only. A line with no exact match comes
 * back with the songs its search found, best first.
 */
export async function findTracklist(
  text: string,
  storefront: string,
): Promise<tAnswer<tFound>> {
  // The page's box takes 20,000 characters at most.
  if (typeof text !== "string" || text.length > 20_000) {
    throw new TypeError("findTracklist: not a tracklist");
  }
  if (!isStorefront(storefront)) {
    throw new TypeError("findTracklist: not a storefront");
  }
  // At most 200 lines are looked for, so a paste costs Apple a known number
  // of searches.
  const all = parseTracklist(text);
  const descriptions = all.slice(0, LINES);
  const leftOut = all.length - descriptions.length;
  return answer(async () => {
    const { tracks, skipped } = await getMusic().playlists.resolve(
      descriptions,
      { storefront },
    );
    return { storefront, tracks, skipped, leftOut };
  });
}

const APP_NAME = "Vinyl Collector Simulator";

/**
 * The playlist the crate goes to: one of the listener's, by its id, or a new
 * one, by its name.
 */
export type tTarget = { readonly id: string } | { readonly name: string };

/**
 * The crate's songs, as a playlist takes them: a crate holds at most 500,
 * which the page's crate holds it to, each a catalog id.
 */
function tracksOf(songIds: unknown): tPlaylistTrack[] {
  const ids = Array.isArray(songIds) ? (songIds as unknown[]) : [];
  if (ids.length === 0 || ids.length > 500 || !ids.every(isId)) {
    throw new TypeError("not a crate of song ids");
  }
  return ids.map((id) => ({ id, type: "songs" }));
}

/**
 * The target as the page sent it, checked. The page's own limits, such as a
 * name of at most 100 characters, are held by its form, so what passes them
 * here is not the page's.
 */
function targetOf(target: unknown): tTarget {
  const given = target as Partial<Record<"id" | "name", unknown>> | null;
  if (isId(given?.id)) return { id: given.id };
  const name = typeof given?.name === "string" ? given.name.trim() : "";
  if (name !== "" && name.length <= NAME) return { name };
  throw new TypeError("not a playlist to send to");
}

/** The longest name the page's form takes for a new playlist. */
const NAME = 100;

// Sending starts with a plan the listener sees before anything is written:
// Apple's API can add songs to the end of a playlist, but can neither take one
// out nor move one.
export async function planCrate(
  songIds: readonly string[],
  target: tTarget,
): Promise<tAnswer<string[]>> {
  const tracks = tracksOf(songIds);
  const to = targetOf(target);
  const listener = await forListener();
  if (listener === undefined) return SIGN_IN_FIRST;
  return answer(async () => {
    const playlist = await playlistFor(listener, to);
    const plan = listener.playlists.plan(playlist, tracks);
    return describe(plan, playlist);
  });
}

/**
 * A playlist that is there is read first, for the tracks it holds. A new one
 * is found again by its name and description, so the description carries the
 * app's mark.
 */
async function playlistFor(
  listener: tMusic,
  to: tTarget,
): Promise<tPlaylistSnapshot | tNewPlaylist> {
  if ("id" in to) return listener.playlists.read(to.id);
  return { name: to.name, description: `Made with ${APP_NAME}` };
}

/**
 * The plan in words: what goes on the playlist's end, and what stays as it is.
 */
function describe(
  plan: tPlaylistPlan,
  playlist: tPlaylistSnapshot | tNewPlaylist,
): string[] {
  const lines: string[] = [];
  if ("id" in playlist) {
    lines.push(`Into "${playlist.name ?? playlist.id}".`);
  } else {
    lines.push(
      `Into a new playlist named "${playlist.name}", `
        + "unless you have one of that name made here.",
    );
  }
  const appended = String(plan.append.length);
  const already = String(plan.tracks.length - plan.append.length);
  lines.push(
    `${appended} songs go on its end, and ${already} are in it already.`,
  );
  if (plan.extra.length > 0) {
    const extra = String(plan.extra.length);
    lines.push(
      `${extra} songs in it that are not in the crate stay, `
        + "since none can be taken out.",
    );
  }
  if (plan.reordered) {
    lines.push(
      "It will hold the songs in another order than the crate, "
        + "since none can be moved.",
    );
  }
  return lines;
}

interface tSent {
  /** The playlist's id, by which the page plans it from now on. */
  readonly id: string;
  /** What was done, in words. */
  readonly said: string;
}

/**
 * Sends the crate, once the listener has said "Send it" to its plan. It is
 * planned again first, from what the playlist holds now: a plan the page sent
 * back could say anything.
 */
export async function sendCrate(
  songIds: readonly string[],
  target: tTarget,
): Promise<tAnswer<tSent>> {
  const tracks = tracksOf(songIds);
  const to = targetOf(target);
  const listener = await forListener();
  if (listener === undefined) return SIGN_IN_FIRST;
  return answer(async () => {
    const playlist = await playlistFor(listener, to);
    const plan = listener.playlists.plan(playlist, tracks);
    const result = await listener.playlists.apply(plan);
    // Apple carries a write out after it answers: verified says whether the
    // write showed before apply returned.
    const songs = `${String(result.appended)} songs`;
    const added = result.created
      ? `Made the playlist, and added ${songs}.`
      : `Added ${songs}.`;
    const shown = result.verified
      ? "Apple shows them already."
      : "They can take a few seconds to show.";
    return { id: result.id, said: `${added} ${shown}` };
  });
}

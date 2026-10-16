// Tracks known from somewhere else, found in Apple's catalog. A track is looked for by its ISRC first, which names
// a recording whoever sells it, and then by a search for its name and artist, kept only when both are the same.
// A wrong match cannot be taken back: Apple's API cannot take a track out of a playlist. So a track that is not
// plainly the same is not matched. It is handed back with what the search found, for the app or the listener to
// choose from.
import { getSongsByIsrc, searchCatalog } from "@open-music-sdk/client-catalog";
import { got, isPlain, itemsOf, optionsOf, ownOf, segmentOf, signalOf, type tAppleMusicClient, type tStorefrontOption } from "@open-music-sdk/core";
import type { tSong } from "@open-music-sdk/types";
import { pause, progressOf, waitOf, type tAskOptions, type tPaceOptions } from "./options";
import { held } from "./own";

/**
 * What is known of a track from outside Apple's catalog. The names are the ones a song's attributes have, so a
 * song's attributes are a description, and so is a track of a playlist that was read. A description with an
 * `isrc` is looked up by it; one with a `name` and an `artistName` can be searched for; one with neither of those
 * is matched by nothing. A field that is a string and of no use, such as an empty name or an ISRC with a comma in
 * it, is taken as not given.
 */
export interface tTrackDescription {
  /**
   * The recording's International Standard Recording Code, such as `"USUM71703861"`. It may be written as it is
   * printed, with hyphens or spaces and in small letters: `GB-AYE-06-01498` is `GBAYE0601498`.
   */
  readonly isrc?: string | undefined;
  /** The track's title, as a song's `name` attribute has it. Searched for together with `artistName`, and a song is kept only when both are the same. */
  readonly name?: string | undefined;
  /** Who performs it, as a song's `artistName` attribute has it. Without it a name alone is searched for, and nothing the search finds is kept. */
  readonly artistName?: string | undefined;
  /** Decides between several songs that match: the one on this album is taken. */
  readonly albumName?: string | undefined;
  /** Decides between several songs that match: the one nearest this length is taken. */
  readonly durationInMillis?: number | undefined;
}

/** A description `resolve` found no song for: where it was in the list handed over, and the songs a search for it came back with. */
export interface tSkippedTrack<D> {
  /** Where the description was in the list handed over, counted from 0. */
  readonly index: number;
  /** The description as it was handed over. */
  readonly track: D;
  /** `"no-match"`: no song has its ISRC, and no song a search found has its name and its artist. */
  readonly reason: "no-match";
  /** The songs a search for its name and artist found, best first as Apple ranks them. None, when there was nothing to search for. */
  readonly candidates: readonly tSong[];
}

/** What `resolve` answers with: the songs found, in the order of the descriptions they were found for, and the descriptions left over. */
export interface tResolvedTracks<D> {
  /** The songs found, one for each description that found one, in the order of those descriptions. Each is a track `plan` takes and a track `previewPlayer` can play. */
  readonly tracks: readonly tSong[];
  /** The descriptions no song was found for, in order, each with where it was and the songs its search came back with. */
  readonly skipped: readonly tSkippedTrack<D>[];
}

/** The options of `resolve`. */
export interface tResolveOptions extends tAskOptions, tPaceOptions, tStorefrontOption {}

const FN = "playlists.resolve";
const OPTIONS = "an options object";
/** The most ISRCs Apple documents taking in one request. */
const MAX_ISRCS = 25;
/** The longest a search term may be: what the catalog's search function takes. */
const MAX_TERM = 256;
/** The longest an ISRC that can be sent may be: what a value in a list may be. A real one is 12 characters. */
const MAX_CODE = 64;

/**
 * Text as it is compared: without case, apostrophes or the accents on Latin letters, with one space wherever there
 * was punctuation or more than one space. `Beyoncé` is `beyonce`, `Don't` is `dont`, and `AC/DC` is `ac dc`. What a recording was
 * later called, `(Remastered 2011)` or `- Live`, is left in: whether those are the same song is not for a rule
 * to say. Text that is punctuation and nothing else is compared as it is, so that `!!!` is not `???`.
 *
 * An accent is a mark on a Latin letter, and only there is a mark dropped. In other scripts a mark is part of the
 * letter, and makes another word of it: the two dots that tell a Japanese `do` from `to`, a Thai vowel, the breve
 * that tells one Russian letter from another. Those are kept, and text is put back together around them, so that
 * a letter written as one character and the same letter written as two compare equal.
 */
export function fold(value: string): string {
  const folded = value
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['`´‘’]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
  return folded === "" ? value.trim() : folded;
}

/** What `resolve` goes by for one description: the fields that can be used, and the description itself to hand back. */
interface tWanted<D> {
  readonly given: D;
  /** The ISRC as it is compared: in capitals. */
  readonly code: string | undefined;
  readonly name: string | undefined;
  readonly artistName: string | undefined;
  readonly albumName: string | undefined;
  readonly durationInMillis: number | undefined;
}

/**
 * An ISRC as it is sent and compared: in capitals, and without the hyphens and spaces it is printed with, so that
 * `GB-AYE-06-01498` is `GBAYE0601498`. It is held to what can be sent as it will be sent, after it has been put in
 * capitals: some letters become two there. One that cannot be sent is no ISRC, and the track is looked for by
 * what else it has.
 */
function codeOf(isrc: string | undefined): string | undefined {
  const code = isrc?.replace(/[\s-]+/g, "").toUpperCase();
  return code !== undefined && code !== "" && code.length <= MAX_CODE && !code.includes(",") ? code : undefined;
}

/**
 * The descriptions as this call's own, each field read once. A field of the wrong kind is the caller's mistake. A
 * string that cannot be used, an empty name or an ISRC with a comma in it, is data that did not help: the track is
 * looked for by what else it has.
 */
function wantedOf<D>(descriptions: unknown): tWanted<D>[] {
  const list = itemsOf(descriptions, 0, Number.MAX_SAFE_INTEGER);
  if (list === undefined) {
    throw new TypeError(`${FN}: descriptions must be a list of descriptions of tracks, each a plain object such as { isrc: "USUM71703861" } or { name: "Hey Jude", artistName: "The Beatles" }; got ${got(descriptions)}`);
  }
  return list.map((given, at) => {
    const where = `${FN}: descriptions[${String(at)}]`;
    if (!isPlain(given)) throw new TypeError(`${where} must be a plain object that describes a track; got ${got(given)}`);
    const bag = ownOf(given as { readonly [K in keyof tTrackDescription]?: unknown });
    const words = (key: "isrc" | "name" | "artistName" | "albumName"): string | undefined => {
      const value = bag[key];
      if (value !== undefined && typeof value !== "string") throw new TypeError(`${where}.${key} must be a string; got ${got(value)}`);
      const trimmed = value?.trim();
      return trimmed === "" ? undefined : trimmed;
    };
    const [isrc, name, artistName, albumName] = [words("isrc"), words("name"), words("artistName"), words("albumName")];
    const { durationInMillis } = bag;
    if (durationInMillis !== undefined && typeof durationInMillis !== "number") throw new TypeError(`${where}.durationInMillis must be a number; got ${got(durationInMillis)}`);
    return {
      given: given as D,
      code: codeOf(isrc),
      name,
      artistName,
      albumName,
      durationInMillis: durationInMillis !== undefined && Number.isFinite(durationInMillis) && durationInMillis > 0 ? durationInMillis : undefined,
    };
  });
}

/** What a song says of itself, read as what Apple sent and not as what the types say it is: an answer is not checked here, and a field is the song's when the song holds it itself. */
function said(song: tSong): { readonly isrc: string; readonly name: string; readonly artistName: string; readonly albumName: string; readonly durationInMillis: number } {
  const attributes = held(held(song).attributes);
  const words = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    isrc: words(attributes.isrc).toUpperCase(),
    name: words(attributes.name),
    artistName: words(attributes.artistName),
    albumName: words(attributes.albumName),
    durationInMillis: typeof attributes.durationInMillis === "number" ? attributes.durationInMillis : Number.NaN,
  };
}

/**
 * The one of several songs that are all the track wanted. Songs that compare equal may still differ in what the
 * comparing left out, as `Papa` and `Papá` do: the ones whose name and artist are written as the description's
 * are, where there are any, are the ones meant. Of those it is the one on the album named, where one is, and of
 * those the one nearest the length given, or Apple's first where no length was.
 */
function pick<D>(wanted: tWanted<D>, songs: readonly tSong[]): tSong | undefined {
  const { name, artistName, albumName: album } = wanted;
  const asWritten = songs.filter((song) => (name === undefined || said(song).name.trim() === name) && (artistName === undefined || said(song).artistName.trim() === artistName));
  const written = asWritten.length > 0 ? asWritten : songs;
  const onAlbum = album === undefined ? [] : written.filter((song) => fold(said(song).albumName) === fold(album));
  const pool = onAlbum.length > 0 ? onAlbum : written;
  const length = wanted.durationInMillis;
  if (length === undefined) return pool[0];
  // A song that does not say how long it is, is as far off as a song can be.
  const off = (song: tSong): number => {
    const far = Math.abs(said(song).durationInMillis - length);
    return Number.isNaN(far) ? Number.POSITIVE_INFINITY : far;
  };
  return pool.reduce<tSong | undefined>((best, song) => (best === undefined || off(song) < off(best) ? song : best), undefined);
}

/** What a plain object holds under `key` itself, and nothing where it is no plain object or holds no such thing. */
const own = (value: unknown, key: string): unknown => (isPlain(value) && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined);

/** The songs an answer holds under `data`, where it holds any. */
const songsOf = (data: unknown): tSong[] => (Array.isArray(data) ? (data as unknown[]).filter((song): song is tSong => isPlain(song)) : []);

/**
 * Finds a song in the catalog for each description of a track. The ones with an ISRC are looked up by it first, 25
 * to a request. Each one still not found that has a name is searched for, one request each, and a song the search
 * found is taken only when its name and its artist are the description's, compared without case, punctuation or
 * the accents on Latin letters. Where several songs fit, the description's album and length decide.
 *
 * It resolves to `{ tracks, skipped }`: the songs, in the order of the descriptions they were found for, and each
 * description left over, with where it was in the list and the songs its search came back with. A description that
 * finds nothing is never an error. A request that fails is: it rejects the call, and nothing found so far is handed
 * over.
 *
 * Only the catalog is asked, and no request made of it carries the Music User Token, so a client that has none
 * will do. The one thing that may be asked beside is the client's own: where neither the call nor the client names
 * a storefront, the client looks up the listener's, with their token, as it does for any catalog function.
 */
export async function resolve<D extends tTrackDescription>(client: tAppleMusicClient, descriptions: readonly D[], options?: tResolveOptions): Promise<tResolvedTracks<D>> {
  const wanted = wantedOf<D>(descriptions);
  const bag = optionsOf(FN, options, OPTIONS);
  const signal = signalOf(FN, bag.signal);
  const report = progressOf(FN, bag.onProgress);
  const delayMs = waitOf(FN, "delayMs", bag.delayMs, 0);
  // Checked here, so that a mistake in it is named for this verb and not for the function it is passed on to.
  if (bag.storefront !== undefined) segmentOf(FN, "storefront", bag.storefront);
  const ask = { storefront: bag.storefront, signal };

  const found = wanted.map((): tSong | undefined => undefined);
  const candidates = wanted.map((): readonly tSong[] => []);
  let done = 0;
  let asked = 0;
  /** Before every request but the first: the wait the caller asked for. */
  const between = async (): Promise<void> => {
    if (asked++ > 0) await pause(delayMs, signal);
    else signal?.throwIfAborted();
  };

  // By ISRC: each code once, however many descriptions have it.
  const codes = [...new Set(wanted.flatMap((each) => each.code ?? []))];
  for (let from = 0; from < codes.length; from += MAX_ISRCS) {
    const chunk = codes.slice(from, from + MAX_ISRCS);
    await between();
    const songs = songsOf(own(await getSongsByIsrc(client, chunk, ask), "data"));
    const before = done;
    wanted.forEach((each, at) => {
      if (each.code === undefined || !chunk.includes(each.code)) return;
      const song = pick(each, songs.filter((candidate) => said(candidate).isrc === each.code));
      if (song === undefined) return;
      found[at] = song;
      done++;
    });
    if (done > before) report(done, wanted.length);
  }

  // By name and artist: what the ISRCs did not find.
  for (const [at, each] of wanted.entries()) {
    if (found[at] !== undefined) continue;
    const { name, artistName } = each;
    if (name !== undefined) {
      await between();
      const term = `${name} ${artistName ?? ""}`.trim().slice(0, MAX_TERM);
      const answer = await searchCatalog(client, term, { ...ask, types: ["songs"] });
      const songs = songsOf(own(own(own(answer, "results"), "songs"), "data"));
      candidates[at] = Object.freeze(songs);
      // Without an artist to hold a song to, a name alone is not enough to say it is the same track.
      const same = artistName === undefined ? [] : songs.filter((song) => fold(said(song).name) === fold(name) && fold(said(song).artistName) === fold(artistName));
      found[at] = pick(each, same);
    }
    done++;
    report(done, wanted.length);
  }

  return Object.freeze({
    tracks: Object.freeze(found.filter((song) => song !== undefined)),
    skipped: Object.freeze(wanted.flatMap((each, at) => (found[at] === undefined ? [Object.freeze({ index: at, track: each.given, reason: "no-match" as const, candidates: candidates[at] ?? [] })] : []))),
  });
}

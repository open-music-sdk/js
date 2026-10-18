// A plan carried out: the playlist found or made, read again, and what it is missing added to its end.
//
// A write is sent once. The client does not send a POST again after a lost answer, since it cannot tell whether
// Apple carried it out, and neither does this: when an answer is lost, the playlist is read back, and what it
// holds decides. So a run never adds the same tracks twice, and a run that stopped part way is carried on by
// calling `apply` again with the same plan, which reads the playlist first and adds only what is still missing.
import { addLibraryPlaylistTracks, createLibraryPlaylist, listLibraryPlaylists, type tPlaylistTrack } from "@open-music-sdk/client-user";
import { AppleMusicError, got, isAppleMusicError, isName, isPlain, optionsOf, ownOf, signalOf, sleep, type tAppleMusicClient } from "@open-music-sdk/core";
import { countOf, maxPagesOf, pause, progressOf, waitOf, type tAskOptions, type tLimitOptions, type tPaceOptions } from "./options";
import { held } from "./own";
import { diff, isThere, refsOf, targetOf, type tHeld, type tNewPlaylist, type tPlaylistPlan, type tPlaylistSnapshotTrack } from "./plan";
import { taken } from "./read";
import { pagesOf, type tWalk } from "./walk";

/**
 * How long a write is given to show in a read. Apple takes a write in and carries it out afterwards, so a read made
 * at once may not show it. The defaults come from one run against the live API, on 18 October 2026: a new playlist
 * could be read by its id at once and was among the listener's playlists after 4 seconds, and 300 tracks added to it
 * showed after 2. Ten reads a second apart leave room for a slower day than that one.
 */
export interface tSettleOptions {
  /** How many times the playlist is read before what was written is taken not to show: a whole number from 1. Default 10. */
  readonly tries?: number | undefined;
  /** How long to wait between one such read and the next, in milliseconds. Default 1000. */
  readonly waitMs?: number | undefined;
}

/** The options of `apply`. */
export interface tApplyOptions extends tAskOptions, tPaceOptions, tLimitOptions {
  /**
   * How many tracks go in one request: a whole number from 1 to 300, the most the client's function takes. Default
   * 300, which one request took against the live API on 18 October 2026.
   */
  readonly chunk?: number | undefined;
  /** How long a write is given to show in a read. */
  readonly settle?: tSettleOptions | undefined;
}

/** What `apply` resolves to. */
export interface tAppliedPlan {
  /** The playlist's id in the listener's library: the one to `read`, or to plan for, from here on. */
  readonly id: string;
  /** Whether this run made the playlist. */
  readonly created: boolean;
  /** How many tracks this run added. */
  readonly appended: number;
  /**
   * Whether what this run wrote showed before it resolved: every track wanted in a read of the playlist and, for
   * a playlist this run made, the playlist itself among the listener's playlists, under the name and description
   * it was made with. `false` does not mean a write failed: Apple took every one, and not all of it showed within
   * the reads `settle` allows. It does mean the same plan carried out again now may not find what this run did.
   */
  readonly verified: boolean;
}

const FN = "playlists.apply";
const OPTIONS = "an options object";
/** The most tracks the client's function takes in one request. */
const MAX_CHUNK = 300;
const DEFAULTS = { chunk: MAX_CHUNK, tries: 10, waitMs: 1000 } as const;

/**
 * Whether an error leaves open if Apple carried the write out: the answer was lost, Apple failed part way, or Apple
 * answered that it was done with a body that could not be read, which the client makes an error of with the 2xx it
 * came with. Anything else says it was not: a refusal, a limit the client already waited out, or the caller's own
 * abort.
 */
const unsure = (error: unknown): boolean => {
  if (!isAppleMusicError(error)) return false;
  const status = error._tag === "ApiError" ? (error.status ?? 0) : 0;
  return error._tag === "NetworkError" || (status >= 500 && status !== 501) || (status >= 200 && status < 300);
};

/** Whether a track the playlist holds is the one wanted: by its catalog id, or by its own. */
const same = (held: tHeld | undefined, wanted: tPlaylistTrack): boolean => held !== undefined && (held.catalogId === wanted.id || held.id === wanted.id);

/**
 * What the diff reads of each track a playlist holds, read as the track's own. A track that was read has no field
 * for what Apple did not give, so a catalog id found on Object.prototype is not the track's.
 */
const idsOf = (tracks: readonly tPlaylistSnapshotTrack[]): tHeld[] =>
  tracks.map((track) => {
    const { id, catalogId } = held(track);
    return { id: id as string, catalogId: isName(catalogId) ? catalogId : undefined };
  });

/** A plan as this call's own: the playlist it is for and the tracks wanted. What it says is missing is worked out again from what the playlist holds now. */
function planOf(plan: unknown): { readonly target: { readonly id: string } | tNewPlaylist; readonly wanted: tPlaylistTrack[] } {
  if (!isPlain(plan)) throw new TypeError(`${FN}: plan must be a plan as plan gives one, with a playlist and the tracks it is to hold; got ${got(plan)}`);
  const { playlist, tracks } = ownOf(plan as { readonly playlist?: unknown; readonly tracks?: unknown });
  return { target: targetOf(FN, playlist), wanted: refsOf(FN, tracks) };
}

/** The listener's playlist with exactly this name and description that they may add to, or nothing. */
async function find(client: tAppleMusicClient, target: tNewPlaylist, walk: tWalk): Promise<string | undefined> {
  for await (const page of pagesOf(client, () => listLibraryPlaylists(client, { signal: walk.signal }), walk)) {
    for (const playlist of page) {
      const { id, attributes } = held(playlist);
      const { name, description, canEdit } = held(attributes);
      const { standard } = held(description);
      if (isName(id) && name === target.name && (standard ?? "") === (target.description ?? "") && canEdit !== false) return id;
    }
  }
  return undefined;
}

interface tSettle {
  readonly tries: number;
  readonly waitMs: number;
}

/**
 * Asks `look` until it finds something, as many times as `settle` allows, with its wait between. A look that
 * fails is a look that found nothing, unless it was the caller's abort: what is being settled is whether a write
 * shows, and a read that could not be made does not say.
 */
async function settled<T>(look: () => Promise<T | undefined>, settle: tSettle, signal: AbortSignal | undefined): Promise<T | undefined> {
  for (let attempt = 1; attempt <= settle.tries; attempt++) {
    if (attempt > 1) await sleep(settle.waitMs, signal);
    try {
      const seen = await look();
      if (seen !== undefined) return seen;
    } catch (error) {
      if (signal?.aborted === true || !isAppleMusicError(error)) throw error;
    }
  }
  return undefined;
}

/**
 * Makes the playlist, once. Where the answer is lost, or holds no playlist, the library is looked through for it,
 * and it is not made again. It gives the playlist's id, and whether it has been seen among the listener's playlists.
 */
async function make(client: tAppleMusicClient, target: tNewPlaylist, walk: tWalk, settle: tSettle): Promise<{ readonly id: string; readonly listed: boolean }> {
  const { signal } = walk;
  const attributes = target.description === undefined ? { name: target.name } : { name: target.name, description: target.description };
  let failure: unknown;
  try {
    const made: unknown = await createLibraryPlaylist.bound(client)({ attributes }, { signal });
    const { id } = held(made);
    if (isName(id)) return { id, listed: false };
    failure = new AppleMusicError("ApiError", `${FN}: Apple took the new playlist and answered with none, and it does not show in the library yet`, { status: 201 });
  } catch (error) {
    if (!unsure(error)) throw error;
    failure = error;
  }
  const there = await settled(() => find(client, target, walk), settle, signal);
  if (there === undefined) throw failure;
  return { id: there, listed: true };
}

/**
 * Carries out a plan. The playlist is the one with the plan's id, or the one in the listener's library with the
 * plan's name and description, made if there is none. It is read, what it is missing of the plan's tracks is
 * worked out afresh, and that is added to its end, `chunk` tracks to a request. Then it is read once more.
 *
 * No write is sent twice. When the answer to one is lost, the playlist is read back: if the tracks are at its end
 * the run carries on, and if they are not it rejects with the error it got. Whatever stops a run, what it wrote
 * stays written, and calling `apply` again with the same plan adds only what is still missing.
 *
 * Apple takes a write in and carries it out afterwards. So a run begun straight after another may read the
 * playlist before the first run's tracks show, and add them again, or look for a playlist the first run made
 * before it is listed, and make another. `verified` says whether what this run wrote showed before it resolved.
 */
export async function apply(client: tAppleMusicClient, plan: tPlaylistPlan, options?: tApplyOptions): Promise<tAppliedPlan> {
  const { target, wanted } = planOf(plan);
  const bag = optionsOf(FN, options, OPTIONS);
  const signal = signalOf(FN, bag.signal);
  const report = progressOf(FN, bag.onProgress);
  const delayMs = waitOf(FN, "delayMs", bag.delayMs, 0);
  const walk = { fn: FN, signal, maxPages: maxPagesOf(FN, bag.maxPages) };
  const chunk = countOf(FN, "chunk", bag.chunk, 1, MAX_CHUNK, DEFAULTS.chunk);
  const given = optionsOf(FN, bag.settle, "settle to be an options object");
  const settle = { tries: countOf(FN, "settle.tries", given.tries, 1, Number.MAX_SAFE_INTEGER, DEFAULTS.tries), waitMs: waitOf(FN, "settle.waitMs", given.waitMs, DEFAULTS.waitMs) };

  // The playlist, and what it holds now. One made here holds nothing, and is not read: it may not show yet.
  const there = isThere(target) ? target.id : await find(client, target, walk);
  const made = there === undefined ? await make(client, target as tNewPlaylist, walk, settle) : undefined;
  const id = there ?? made?.id ?? "";
  const before: readonly tHeld[] = there === undefined ? [] : idsOf((await taken(client, id, walk)).tracks);
  const { append } = diff(before, wanted);

  let done = 0;
  for (let from = 0; from < append.length; from += chunk) {
    if (from > 0) await pause(delayMs, signal);
    const part = append.slice(from, from + chunk);
    try {
      await addLibraryPlaylistTracks(client, id, part, { signal });
    } catch (error) {
      if (!unsure(error)) throw error;
      // The tracks went to the playlist's end if they went at all: after what it held, and what this run has added.
      const landed = await settled(
        async () => {
          const now = idsOf((await taken(client, id, walk)).tracks);
          return part.every((track, at) => same(now[before.length + from + at], track)) ? true : undefined;
        },
        settle,
        signal,
      );
      if (landed !== true) throw error;
    }
    done += part.length;
    report(done, append.length);
  }

  // Read once more, unless nothing was added: then the read that the plan was worked out from is the proof.
  const shown = append.length === 0 ? true : await settled(async () => (diff(idsOf((await taken(client, id, walk)).tracks), wanted).append.length === 0 ? true : undefined), settle, signal);
  // A playlist made here is found by the next run only once it is among the listener's playlists, as it was made.
  // Until it is, the same plan carried out again would make a second one, which nothing can take away.
  const listed = made === undefined || made.listed || (await settled(async () => ((await find(client, target as tNewPlaylist, walk)) === id ? true : undefined), settle, signal)) === true;
  return Object.freeze({ id, created: made !== undefined, appended: done, verified: shown === true && listed });
}

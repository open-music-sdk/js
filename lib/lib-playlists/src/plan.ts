// What a playlist is missing. Apple's API can make a playlist and add tracks to the end of one, and nothing else:
// it cannot take a track out, move one, or delete the playlist. So bringing a playlist to a list of tracks comes
// to working out which of them it does not hold yet. That is done here, with no request made: a plan is something
// to look at before anything is written.
import type { tPlaylistTrack } from "@open-music-sdk/client-user";
import { got, isName, isPlain, itemsOf, ownOf, segmentOf } from "@open-music-sdk/core";
import { held } from "./own";

/**
 * A track of a playlist as `read` gives it. Plain JSON, and the same fields a track is described by to `resolve`,
 * so a playlist that was read can be written to a file and resolved again from it, for another listener or another
 * service. Every field but the first two is there when Apple gave it.
 */
export interface tPlaylistSnapshotTrack {
  /** The track's id in the listener's library. */
  readonly id: string;
  /** What kind of track it is: the two kinds Apple documents a playlist of a library as holding. */
  readonly type: "library-songs" | "library-music-videos";
  /** The id of the same track in the catalog, where the library knows of one. A track the listener uploaded has none. */
  readonly catalogId?: string;
  /** The recording's ISRC, from the catalog. */
  readonly isrc?: string;
  /** The track's title. */
  readonly name?: string;
  /** Who performs it. */
  readonly artistName?: string;
  /** The album it is on. */
  readonly albumName?: string;
  /** How long it is, in milliseconds. */
  readonly durationInMillis?: number;
}

/** A playlist of the listener's library as `read` gives it: what it is called and every track it holds, in order. */
export interface tPlaylistSnapshot {
  /** The playlist's id in the listener's library: what `read` was asked for. */
  readonly id: string;
  /** What the playlist is called, where Apple gave it. */
  readonly name?: string;
  /** The playlist's description as written, where it has one. */
  readonly description?: string;
  /** Whether the listener may add to it. */
  readonly canEdit?: boolean;
  /** Every track it holds, in order. */
  readonly tracks: readonly tPlaylistSnapshotTrack[];
}

/**
 * A playlist that may not be there yet, by what it is to be called. `apply` looks through the listener's library
 * for one they may add to with exactly this name and description before it makes one, so the description is the
 * place for a mark of your own: Apple keeps nothing else of yours with a playlist.
 */
export interface tNewPlaylist {
  /** What the playlist is to be called. A playlist of the listener's is the one meant only when its name is exactly this. */
  readonly name: string;
  /** Its description. A playlist is the one meant only when its description is exactly this, or has none where this is not given. */
  readonly description?: string | undefined;
}

/**
 * What `plan` gives: the tracks a playlist is to hold, and what that takes. Plain, and frozen all the way down: it
 * holds nothing of the caller's that could change under it, and can be written to a file and applied later.
 */
export interface tPlaylistPlan {
  /** The playlist the plan is for: by its id, or by the name and description of one to find or make. */
  readonly playlist:
    | {
        /** The id in the listener's library of a playlist that is there. */
        readonly id: string;
      }
    | tNewPlaylist;
  /** The tracks the playlist is to hold, each as `{ id, type }`, in order. */
  readonly tracks: readonly tPlaylistTrack[];
  /**
   * The ones it does not hold yet, in order: what `apply` adds to its end. A wanted track is held when one of the
   * playlist's tracks has its id, as its `catalogId` or as its own `id`. Each track of the playlist answers for one
   * wanted track at most, so a song wanted twice and held once is added once more.
   */
  readonly append: readonly tPlaylistTrack[];
  /** The tracks it holds that are not wanted. Apple's API cannot take a track out, so they stay. */
  readonly extra: readonly tPlaylistSnapshotTrack[];
  /**
   * Whether the playlist, once what is missing is added, will hold the wanted tracks in another order than wanted:
   * because it holds some of them in another order already, or because a track to add belongs before one it holds
   * and can only go after it. Apple's API cannot move a track, or put one anywhere but at the end.
   */
  readonly reordered: boolean;
}

const FN = "playlists.plan";

/** What the diff reads of a track a playlist holds: the two ids it may be wanted by. */
export interface tHeld {
  readonly id: string;
  readonly catalogId?: string | undefined;
}

/**
 * Which of the `wanted` tracks a playlist that holds `held` is missing. A wanted track is held when one of the
 * playlist's tracks has its id, as its catalog id or as its own. Each held track answers for one wanted track at
 * most, so a song wanted twice and held once is missing once.
 *
 * `reordered` says whether the wanted tracks will be in another order than wanted once the missing ones are at the
 * end: some are held in another order, or one that is missing is wanted before one that is held.
 */
export function diff(held: readonly tHeld[], wanted: readonly tPlaylistTrack[]): { readonly append: tPlaylistTrack[]; readonly extra: number[]; readonly reordered: boolean } {
  // Where each id is held, in order, and how far along that list has been used up. A Map, so that an id is a key and nothing else.
  const places = new Map<string, { readonly at: number[]; next: number }>();
  held.forEach((track, at) => {
    for (const key of new Set([track.id, track.catalogId])) {
      if (key === undefined) continue;
      const place = places.get(key) ?? { at: [], next: 0 };
      place.at.push(at);
      places.set(key, place);
    }
  });
  const used = held.map(() => false);
  const found: number[] = [];
  const append: tPlaylistTrack[] = [];
  /** Whether a track that is held is wanted after one that has to be added, which will come after it all the same. */
  let overtaken = false;
  for (const track of wanted) {
    const place = places.get(track.id);
    // A track listed under two ids may have been used under the other one.
    while (place !== undefined && used[place.at[place.next] ?? -1] === true) place.next++;
    const at = place?.at[place.next];
    if (at === undefined) append.push(track);
    else {
      used[at] = true;
      found.push(at);
      overtaken ||= append.length > 0;
    }
  }
  return {
    append,
    extra: used.flatMap((taken, at) => (taken ? [] : [at])),
    reordered: overtaken || found.some((at, i) => at < (found[i - 1] ?? -1)),
  };
}

/** The tracks wanted, as this call's own list of `{ id, type }` and nothing else of what each one held: a song from the catalog is a track as it is. */
export function refsOf(fn: string, tracks: unknown): tPlaylistTrack[] {
  const given = itemsOf(tracks, 0, Number.MAX_SAFE_INTEGER);
  const own = (given ?? []).map((track) => {
    const { id, type } = held(track);
    return isName(id) && isName(type) ? (Object.freeze({ id, type }) as tPlaylistTrack) : undefined;
  });
  const bad = own.indexOf(undefined);
  if (given !== undefined && bad === -1) return own as tPlaylistTrack[];
  const what = given === undefined ? got(tracks) : `${got(given[bad])} at index ${String(bad)}`;
  throw new TypeError(`${fn}: tracks must be a list of tracks, each a plain object with an id and a type of its own that are strings of 1 to 64 characters, such as { id: "1", type: "songs" }; got ${what}`);
}

/**
 * The playlist a plan is for, as this call's own: `{ id }` for one that is there, or `{ name, description }` for
 * one to find or make. An id is one that could be a segment of a path; what a name may be is Apple's to say.
 */
export function targetOf(fn: string, playlist: unknown): { readonly id: string } | tNewPlaylist {
  const WHAT = `${fn}: playlist must be a playlist as read gives one, with an id, or one to make, as { name, description }`;
  if (!isPlain(playlist)) throw new TypeError(`${WHAT}; got ${got(playlist)}`);
  const { id, name, description } = ownOf(playlist as { readonly id?: unknown; readonly name?: unknown; readonly description?: unknown });
  if (id !== undefined) {
    // Held to what a segment of a path may be, here, so that a mistake in it is named for this verb and not for the function it is passed on to.
    segmentOf(fn, "playlist.id", id);
    return { id: id as string };
  }
  if (typeof name !== "string" || name === "") throw new TypeError(`${WHAT}; got one with no id, and ${got(name)} for a name`);
  if (description !== undefined && typeof description !== "string") throw new TypeError(`${fn}: playlist.description must be a string; got ${got(description)}`);
  return description === undefined ? { name } : { name, description };
}

/**
 * Whether the playlist a plan is for is one that is there, by an id of its own. An `id` found on Object.prototype,
 * where other code may have put one, is not the playlist's: a playlist named by what it is called has none.
 */
export const isThere = (target: { readonly id: string } | tNewPlaylist): target is { readonly id: string } => Object.hasOwn(target, "id");

/** The tracks of a playlist that was read, each as what the diff reads of it and as a frozen copy of what was handed over, for the plan to hold. */
function heldOf(fn: string, playlist: object): { readonly track: tPlaylistSnapshotTrack; readonly ids: tHeld }[] {
  const { tracks } = ownOf(playlist as { readonly tracks?: unknown });
  const given = itemsOf(tracks, 0, Number.MAX_SAFE_INTEGER);
  const own = (given ?? []).map((track) => {
    const { id, catalogId } = held(track);
    return isName(id) && (catalogId === undefined || isName(catalogId)) ? { track: Object.freeze({ ...(track as tPlaylistSnapshotTrack) }), ids: { id, catalogId } } : undefined;
  });
  const bad = own.indexOf(undefined);
  if (given !== undefined && bad === -1) return own as { readonly track: tPlaylistSnapshotTrack; readonly ids: tHeld }[];
  const what = given === undefined ? got(tracks) : `${got(given[bad])} at index ${String(bad)}`;
  throw new TypeError(`${fn}: playlist.tracks must be the list of tracks read gave, each a plain object with an id of its own, and a catalogId where it has one, that are strings of 1 to 64 characters; got ${what}`);
}

/**
 * Plans bringing a playlist to a list of tracks, and makes no request. `playlist` is what `read` gave, or
 * `{ name, description }` for one that `apply` is to find or make. `tracks` are the tracks it is to hold, in
 * order: songs as `resolve` gave them, the tracks of another playlist that was read, or anything else with an
 * `id` and a `type`.
 *
 * The plan says what will be added, and what cannot be done: the tracks that would have to come out, and whether
 * the playlist will be in another order than wanted, since a track can only be added at the end. Looking at it is
 * the dry run.
 */
export function plan(playlist: tPlaylistSnapshot | tNewPlaylist, tracks: readonly tPlaylistTrack[]): tPlaylistPlan {
  const target = targetOf(FN, playlist);
  const held = isThere(target) ? heldOf(FN, playlist) : [];
  const wanted = refsOf(FN, tracks);
  const { append, extra, reordered } = diff(
    held.map((each) => each.ids),
    wanted,
  );
  return Object.freeze({
    playlist: Object.freeze(target),
    tracks: Object.freeze(wanted),
    append: Object.freeze(append),
    extra: Object.freeze(extra.flatMap((at) => held[at]?.track ?? [])),
    reordered,
  });
}

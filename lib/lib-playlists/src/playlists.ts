// The package's one noun: its four verbs for one client. It is what an integration offers as `music.playlists`.
import type { tPlaylistTrack } from "@open-music-sdk/client-user";
import { clientOf, ownOf, type tAppleMusicClient } from "@open-music-sdk/core";
import { apply, type tAppliedPlan, type tApplyOptions } from "./apply";
import { plan, type tNewPlaylist, type tPlaylistPlan, type tPlaylistSnapshot } from "./plan";
import { read, type tReadPlaylistOptions } from "./read";
import { resolve, type tResolveOptions, type tResolvedTracks, type tTrackDescription } from "./resolve";

/** What `playlists(client)` gives. Its functions need no `this`, so each can be handed on by itself. */
export interface tPlaylists {
  /**
   * Finds a song in the catalog for each description of a track: by ISRC first, then by a search kept only when
   * name and artist are the same. Resolves to the songs found and the descriptions left over, each with the songs
   * its search came back with. Asks the catalog alone, with no Music User Token: a client that has none will do,
   * so long as it or the call names a storefront.
   *
   * @param descriptions - The tracks to find, each by its ISRC, or by its name and artist, with its album and
   * length to decide between songs that fit.
   * @param options - The storefront to ask in, how long to leave between requests, what stops the call, and what
   * hears how many descriptions are done with.
   * @returns The songs found, in the order of the descriptions they were found for, and each description left
   * over, with where it was in the list and the songs its search came back with. A description that finds nothing
   * is never an error.
   * @throws TypeError if a description, an option or the storefront is not what it should be, before Apple is asked.
   * @throws AppleMusicError if a request fails: Apple refused or answered wrongly, the network failed, or a token
   * provider did; `_tag` says which. Nothing found before it is handed over.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws What `options.onProgress` threw, when it did, as it is.
   */
  readonly resolve: <D extends tTrackDescription>(descriptions: readonly D[], options?: tResolveOptions) => Promise<tResolvedTracks<D>>;
  /**
   * Reads a playlist of the listener's library whole, as plain JSON: its name and description, and every track
   * with the catalog's id for it and its ISRC where the library knows them. It is also the export.
   *
   * @param id - The playlist's id in the listener's library.
   * @param options - What stops the call, what hears how many tracks have been read, and the most pages to walk.
   * @returns The playlist: its id, its name, description and whether the listener may add to it where Apple gave
   * them, and every track in order, each with the catalog's id and the ISRC where the library knows them.
   * @throws TypeError if `id` could not be one segment of a path, or an option is not what it should be, before
   * Apple is asked.
   * @throws AppleMusicError if a request fails, if the answer holds no playlist or a track with no id or no type,
   * or if Apple names another page after the `maxPages` allowed: what was read is not all there is, and none of it
   * is handed over. `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws What `options.onProgress` threw, when it did, as it is.
   */
  readonly read: (id: string, options?: tReadPlaylistOptions) => Promise<tPlaylistSnapshot>;
  /**
   * Plans bringing a playlist to a list of tracks, with no request made: what will be added to its end, and what
   * cannot be done, since Apple's API can neither take a track out nor move one. `playlist` is what `read` gave,
   * or `{ name, description }` for one to find or make.
   *
   * @param playlist - The playlist as `read` gave it, or `{ name, description }` for one `apply` is to find or make.
   * @param tracks - The tracks it is to hold, in order: songs as `resolve` gave them, the tracks of a playlist that
   * was read, or anything else with an `id` and a `type`.
   * @returns The plan: the playlist it is for, the tracks wanted, the ones to add to its end, the ones it holds that
   * are not wanted, and whether it will be in another order than wanted. Frozen all the way down.
   * @throws TypeError if `playlist` is neither one with an id nor one to make with a name, if its tracks are not
   * the list `read` gave, or if a track in `tracks` has no id or no type of its own.
   */
  readonly plan: (playlist: tPlaylistSnapshot | tNewPlaylist, tracks: readonly tPlaylistTrack[]) => tPlaylistPlan;
  /**
   * Carries out a plan: finds or makes the playlist, reads it, adds what it is missing to its end, and reads it
   * once more. No write is sent twice, and calling it again with the same plan adds only what is still missing.
   *
   * @param plan - The plan as `plan` gave it. Its playlist and its tracks are what is read: what is missing is
   * worked out afresh from what the playlist holds now.
   * @param options - How many tracks go in one request and how long to leave between those requests, how long a
   * write is given to show, the most pages to walk, what stops the call, and what hears how many tracks have been
   * added.
   * @returns The playlist's id, whether this run made it, how many tracks it added, and whether what it wrote
   * showed before it resolved.
   * @throws TypeError if the plan or an option is not what it should be, before Apple is asked.
   * @throws AppleMusicError if a request fails and what it wrote cannot be seen to have landed, if Apple took the
   * new playlist and neither answered with it nor lists it within what `settle` allows, if a playlist that was
   * read holds a track with no id or no type, or if Apple names another page after the `maxPages` allowed. What
   * was written before it stays written. `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws What `options.onProgress` threw, when it did, as it is.
   */
  readonly apply: (plan: tPlaylistPlan, options?: tApplyOptions) => Promise<tAppliedPlan>;
}

/** The client's functions the verbs call, through the two client packages. */
const METHODS = ["paginate", "request", "storefront"] as const;

/**
 * The playlist verbs for one client: `resolve`, `read`, `plan` and `apply`. The client is checked here, and
 * nothing is asked of it until a verb is called. What it gives is frozen and inherits nothing.
 *
 * `read` and `apply` are the listener's, and need a client with a Music User Token: `music.as(token)` or
 * `music.forUser(userId)`. `resolve` asks the catalog, and `plan` asks nothing.
 *
 * @param client - The client to ask with: one from `createClient`, or anything with its `request`, `paginate` and
 * `storefront`.
 * @returns The four verbs for that client, frozen and inheriting nothing.
 * @throws TypeError if `client` is no client.
 */
export function playlists(client: tAppleMusicClient): tPlaylists {
  const music = clientOf("playlists", client, METHODS);
  return Object.freeze(
    ownOf<tPlaylists>({
      resolve: (descriptions, options) => resolve(music, descriptions, options),
      read: (id, options) => read(music, id, options),
      plan,
      apply: (given, options) => apply(music, given, options),
    }),
  );
}

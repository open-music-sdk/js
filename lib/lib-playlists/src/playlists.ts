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
   */
  readonly resolve: <D extends tTrackDescription>(descriptions: readonly D[], options?: tResolveOptions) => Promise<tResolvedTracks<D>>;
  /**
   * Reads a playlist of the listener's library whole, as plain JSON: its name and description, and every track
   * with the catalog's id for it and its ISRC where the library knows them. It is also the export.
   */
  readonly read: (id: string, options?: tReadPlaylistOptions) => Promise<tPlaylistSnapshot>;
  /**
   * Plans bringing a playlist to a list of tracks, with no request made: what will be added to its end, and what
   * cannot be done, since Apple's API can neither take a track out nor move one. `playlist` is what `read` gave,
   * or `{ name, description }` for one to find or make.
   */
  readonly plan: (playlist: tPlaylistSnapshot | tNewPlaylist, tracks: readonly tPlaylistTrack[]) => tPlaylistPlan;
  /**
   * Carries out a plan: finds or makes the playlist, reads it, adds what it is missing to its end, and reads it
   * once more. No write is sent twice, and calling it again with the same plan adds only what is still missing.
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

// A playlist of the listener's library, read whole: what it is called, and every track on every page, each with
// the catalog's id for it and the recording's ISRC where the library knows them. What comes of it is plain JSON.
import { getLibraryPlaylist, getLibraryPlaylistRelationship } from "@open-music-sdk/client-user";
import { AppleMusicError, isAppleMusicError, isName, optionsOf, segmentOf, signalOf, type tAppleMusicClient } from "@open-music-sdk/core";
import { maxPagesOf, progressOf, type tAskOptions, type tLimitOptions } from "./options";
import { first, held } from "./own";
import type { tPlaylistSnapshot, tPlaylistSnapshotTrack } from "./plan";
import { pagesOf, type tWalk } from "./walk";

const FN = "playlists.read";
const OPTIONS = "an options object";
/** The options of `read`. */
export interface tReadPlaylistOptions extends tAskOptions, tLimitOptions {}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** `bag` without the fields it has nothing under, so that what is handed over is the same before and after it has been JSON. */
const filled = <T extends object>(bag: { readonly [K in keyof T]: T[K] | undefined }): T => Object.freeze(Object.fromEntries(Object.entries(bag).filter(([, value]) => value !== undefined))) as T;

/**
 * One track of a playlist as the snapshot holds it. The catalog's id for it is the id of the song under its
 * `catalog` relationship, which is asked for with the tracks. Where an answer has no such relationship, the id
 * Apple puts under `playParams.catalogId` is taken: Apple's documentation does not list that field, and its
 * answers carry it. Without either, the track is one the catalog does not know, such as an upload.
 *
 * None of what an answer holds is taken on trust: an answer is checked only where a caller passes a schema, and
 * none is passed here. Each field is read as the answer's own, so nothing on Object.prototype is read as Apple's.
 */
function trackOf(fn: string, track: unknown): tPlaylistSnapshotTrack {
  const { id, type, attributes, relationships } = held(track);
  if (!isName(id) || !isName(type)) throw new AppleMusicError("ApiError", `${fn}: Apple answered with a track that has no id or no type`, { status: 200 });
  const { name, artistName, albumName, durationInMillis, playParams } = held(attributes);
  const { data } = held(held(relationships).catalog);
  const song = held(first(data));
  const catalogId = isName(song.id) ? song.id : held(playParams).catalogId;
  return filled<tPlaylistSnapshotTrack>({
    id,
    // What Apple sent, whatever it is: the type says what Apple documents sending here.
    type: type as tPlaylistSnapshotTrack["type"],
    catalogId: isName(catalogId) ? catalogId : undefined,
    isrc: text(held(song.attributes).isrc),
    name: text(name),
    artistName: text(artistName),
    albumName: text(albumName),
    durationInMillis: typeof durationInMillis === "number" && Number.isFinite(durationInMillis) && durationInMillis > 0 ? durationInMillis : undefined,
  });
}

/**
 * The playlist with `id`, read whole. For a verb that has already checked what it was handed: `report` is told how
 * many tracks have been read after each page of them, and the total is not known until the last page. The first
 * page of tracks is asked for by the client's function, and the rest by the links Apple gives, each with its catalog
 * songs asked for again, since Apple's links leave that out.
 */
export async function taken(client: tAppleMusicClient, id: string, walk: tWalk, report: (done: number, total: undefined) => void = () => undefined): Promise<tPlaylistSnapshot> {
  const { fn, signal } = walk;
  const playlist = await getLibraryPlaylist.bound(client)(id, { signal });
  const { name, description, canEdit } = held(held(playlist).attributes);
  const tracks: tPlaylistSnapshotTrack[] = [];
  const include = ["catalog"];
  try {
    for await (const page of pagesOf(client, () => getLibraryPlaylistRelationship(client, id, "tracks", { include, signal }), { ...walk, include })) {
      for (const track of page) tracks.push(trackOf(fn, track));
      if (page.length > 0) report(tracks.length, undefined);
    }
  } catch (error) {
    if (!(tracks.length === 0 && isAppleMusicError(error, "ApiError") && error.status === 404)) throw error;
    // The playlist is there: it was just read. A 404 for its tracks before any of them came is taken to mean it
    // has none, which Apple's documentation does not say, though a new playlist with no tracks was answered so
    // against the live API on 18 October 2026. So the playlist is asked once more, with its tracks,
    // and has to bear that out: a playlist that then shows a track is not empty, and the 404 stands. What is read
    // here decides what `apply` adds, and a playlist wrongly taken for empty would have all of it added again.
    const again = await getLibraryPlaylist.bound(client)(id, { include: ["tracks"], signal });
    if (first(held(held(held(again).relationships).tracks).data) !== undefined) throw error;
  }
  return filled<tPlaylistSnapshot>({
    id,
    name: text(name),
    description: text(held(description).standard),
    canEdit: typeof canEdit === "boolean" ? canEdit : undefined,
    tracks: Object.freeze(tracks),
  });
}

/**
 * Reads a playlist of the listener's library whole: its name and description, and every track it holds, in order,
 * with the catalog's id for each and the recording's ISRC where the library knows them.
 *
 * What it resolves to is plain JSON, and is the export: written to a file, its `tracks` are descriptions `resolve`
 * takes, in this storefront or another, and what another service needs to find the same recordings.
 */
export async function read(client: tAppleMusicClient, id: string, options?: tReadPlaylistOptions): Promise<tPlaylistSnapshot> {
  segmentOf(FN, "id", id);
  const bag = optionsOf(FN, options, OPTIONS);
  const walk = { fn: FN, signal: signalOf(FN, bag.signal), maxPages: maxPagesOf(FN, bag.maxPages) };
  return taken(client, id, walk, progressOf(FN, bag.onProgress));
}

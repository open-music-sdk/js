// A playlist of the listener's library, read whole: what it is called, and every track on every page, each with
// the catalog's id for it and the recording's ISRC where the library knows them. What comes of it is plain JSON.
import { getLibraryPlaylist, getLibraryPlaylistRelationship } from "@open-music-sdk/client-user";
import { AppleMusicError, isAppleMusicError, isName, optionsOf, segmentOf, type tAppleMusicClient } from "@open-music-sdk/core";
import { progressOf, signalOf, type tAskOptions } from "./options";
import { first, held } from "./own";
import type { tPlaylistSnapshot, tPlaylistSnapshotTrack } from "./plan";

const FN = "playlists.read";
const OPTIONS = "an options object";
/** The most tracks Apple documents sending in one answer. Progress is told a page at a time. */
const PAGE = 100;

/** The options of `read`. */
export type tReadPlaylistOptions = tAskOptions;

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
function trackOf(track: unknown): tPlaylistSnapshotTrack {
  const { id, type, attributes, relationships } = held(track);
  if (!isName(id) || !isName(type)) throw new AppleMusicError("ApiError", `${FN}: Apple answered with a track that has no id or no type`, { status: 200 });
  const { name, artistName, albumName, durationInMillis, playParams } = held(attributes);
  const { data } = held(held(relationships).catalog);
  const song = held(first(data));
  const catalogId = isName(song.id) ? song.id : held(playParams).catalogId;
  return filled<tPlaylistSnapshotTrack>({
    id,
    type,
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
 * many tracks have been read, a page at a time, and the total is not known until the last page.
 */
export async function taken(client: tAppleMusicClient, id: string, signal: AbortSignal | undefined, report: (done: number, total: undefined) => void = () => undefined): Promise<tPlaylistSnapshot> {
  const playlist = await getLibraryPlaylist.bound(client)(id, { signal });
  const { name, description, canEdit } = held(held(playlist).attributes);
  const tracks: tPlaylistSnapshotTrack[] = [];
  try {
    for await (const track of getLibraryPlaylistRelationship.bound(client)(id, "tracks", { include: ["catalog"], signal })) {
      tracks.push(trackOf(track));
      if (tracks.length % PAGE === 0) report(tracks.length, undefined);
    }
  } catch (error) {
    if (!(tracks.length === 0 && isAppleMusicError(error, "ApiError") && error.status === 404)) throw error;
    // The playlist is there: it was just read. A 404 for its tracks before any of them came is taken to mean it
    // has none, which Apple's documentation does not say. So the playlist is asked once more, with its tracks,
    // and has to bear that out: a playlist that then shows a track is not empty, and the 404 stands. What is read
    // here decides what `apply` adds, and a playlist wrongly taken for empty would have all of it added again.
    const again = await getLibraryPlaylist.bound(client)(id, { include: ["tracks"], signal });
    if (first(held(held(held(again).relationships).tracks).data) !== undefined) throw error;
  }
  if (tracks.length % PAGE !== 0) report(tracks.length, undefined);
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
  const signal = signalOf(FN, bag.signal);
  return taken(client, id, signal, progressOf(FN, bag.onProgress));
}

// Records as the crates draw them, made on the server from what Apple sent:
// plain data, which a server component can hand to the page.
import type {
  tAlbum,
  tArtist,
  tArtwork,
  tLibraryPlaylist,
  tPlaylist,
} from "@open-music-sdk/react";

/** A record in a crate, and the page it opens. */
export interface tSleeveData {
  readonly id: string;
  readonly artwork: tArtwork | undefined;
  readonly name: string;
  readonly by?: string | undefined;
  /** Where pulling it out goes; none for a record that opens nothing. */
  readonly href?: string | undefined;
}

type tCatalogItem = tAlbum | tArtist | tPlaylist;

/** Catalog albums, artists or playlists, each opening its page. */
export function catalogSleeves(
  items: readonly tCatalogItem[],
): tSleeveData[] {
  return items.map((item) => ({
    id: item.id,
    artwork: item.attributes?.artwork,
    name: item.attributes?.name ?? item.id,
    by: byLine(item),
    href: `/${item.type}/${encodeURIComponent(item.id)}`,
  }));
}

/**
 * Who an album is by, or who put a playlist together. An artist has no such
 * line.
 */
function byLine(item: tCatalogItem): string | undefined {
  if (item.type === "albums") return item.attributes?.artistName;
  if (item.type === "playlists") return item.attributes?.curatorName;
  return undefined;
}

/** The listener's playlists, each opening a page of its tracks. */
export function playlistSleeves(
  playlists: readonly tLibraryPlaylist[],
): tSleeveData[] {
  return playlists.map((playlist) => ({
    id: playlist.id,
    artwork: playlist.attributes?.artwork,
    name: playlist.attributes?.name ?? playlist.id,
    href: `/library/playlists/${encodeURIComponent(playlist.id)}`,
  }));
}

/**
 * What every list of the listener's holds: albums, playlists, stations, each
 * with a name and a cover.
 */
interface tCard {
  readonly id: string;
  readonly attributes?: {
    readonly name?: string | undefined;
    readonly artistName?: string | undefined;
    readonly artwork?: tArtwork | undefined;
  } | undefined;
}

/** Anything of the listener's lists, opening nothing. */
export function cards(items: readonly tCard[]): tSleeveData[] {
  return items.map(({ id, attributes }) => ({
    id,
    artwork: attributes?.artwork,
    name: attributes?.name ?? id,
    by: attributes?.artistName,
  }));
}

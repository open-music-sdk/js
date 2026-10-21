// Shows: getAlbum, getArtist, getArtistView, getArtistRelationship,
// getPlaylist, schemas, request, segmentOf, addToLibrary, addToFavorites.
// Guides: /guides/validation, /guides/direct-requests
import {
  isAppleMusicError,
  schemas,
  type tAlbum,
  type tArtist,
  type tArtwork,
  type tBrowserMusic,
  type tLibraryAlbum,
  type tPage,
  type tPlaylist,
  type tSong,
} from "@open-music-sdk/browser";
import { segmentOf } from "@open-music-sdk/core";
import { cover } from "./artwork";
import { crate } from "./box";
import { button, h } from "./dom";
import { say, showError } from "./errors";
import { music, now } from "./music";
import type { tSleeve } from "./sleeve";
import { songCrate, songRows } from "./songs";
import { go, route } from "./view";

type tCatalogItem = tAlbum | tArtist | tPlaylist;

/** Catalog albums, artists or playlists as sleeves, each opening its page. */
export function sleeves(items: readonly tCatalogItem[]): tSleeve[] {
  return items.map((item) => ({
    artwork: item.attributes?.artwork,
    name: item.attributes?.name ?? item.id,
    by: byLine(item),
    open: () => { go(item.type, item.id); },
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

route("albums", async (id) => {
  // Held to the album's generated type as it arrives: an answer in another
  // shape is a ValidationError here, with the path of each value that differs,
  // rather than an undefined somewhere later.
  const album = await music.catalog.getAlbum(id, {
    include: ["tracks"],
    storefront: now.storefront,
    schema: schemas.albumsResponse,
  });
  const actions = await albumActions(id);
  const tracklist = await songRows(album.relationships?.tracks?.data ?? []);
  const { name, artistName, artwork } = album.attributes ?? {};
  return [heading(name, artistName, artwork), ...actions, tracklist];
});

route("artists", async (id) => {
  const { storefront } = now;
  const artist = await music.catalog.getArtist(id, { storefront });

  // A view, one page of it: the artist's top songs.
  const topSongs: tSong[] = [];
  const view = music.catalog.getArtistView(id, "top-songs", {
    storefront,
    limit: 10,
    maxPages: 1,
  });
  for await (const song of view) topSongs.push(song);

  // A relationship, walked a page at a time until its pages or maxPages run
  // out: the artist's albums.
  const albums: tAlbum[] = [];
  const relationship = music.catalog.getArtistRelationship(id, "albums", {
    storefront,
    limit: 25,
    maxPages: 4,
  });
  for await (const album of relationship) albums.push(album);

  const crates = h(
    "div",
    { className: "crates" },
    await songCrate("Top songs", topSongs),
    crate("Albums", sleeves(albums)),
  );
  const { name, artwork } = artist.attributes ?? {};
  return [heading(name, undefined, artwork), crates];
});

route("playlists", async (id) => {
  const playlist = await music.catalog.getPlaylist(id, {
    include: ["tracks"],
    storefront: now.storefront,
  });
  const tracks = playlist.relationships?.tracks?.data ?? [];
  const tracklist = await songRows(tracks);
  const { name, curatorName, artwork } = playlist.attributes ?? {};
  return [heading(name, curatorName, artwork), tracklist];
});

/**
 * What a signed-in listener can do with an album: add it to their library
 * unless it's there, or make it a favorite.
 */
async function albumActions(id: string): Promise<HTMLElement[]> {
  const { listener } = now;
  if (listener === undefined) return [];
  // An extra: if Apple cannot say whether the listener holds the album, the
  // page offers to add it, and says why.
  const held = await inLibrary(listener, id).catch((e: unknown) => {
    showError(e);
    return false;
  });

  const add = () => {
    const done = "Added the album to your library.";
    write(listener.user.addToLibrary({ albums: [id] }), done);
  };
  const favorite = () => {
    const done = "Made the album a favorite, "
      + "which adds it to your library too.";
    write(listener.user.addToFavorites({ albums: [id] }), done);
  };
  const library = held
    ? h("span", {}, "In your library")
    : button("Add album to library", add);
  const favoriteButton = button("Favorite", favorite);
  return [h("p", { className: "actions" }, library, favoriteButton)];
}

// #region in-library
/**
 * Whether the listener holds the album: its `library` relationship, which needs
 * their token and which no client function asks for. Apple answers 404 for an
 * album they do not hold, and counts one they hold a song of.
 */
async function inLibrary(
  listener: tBrowserMusic,
  albumId: string,
): Promise<boolean> {
  // Each value is checked as one segment of the path, as the clients check
  // every id: `..` would point the request, and the listener's token with it,
  // somewhere else on Apple's API.
  const storefront = segmentOf("inLibrary", "storefront", now.storefront);
  const id = segmentOf("inLibrary", "id", albumId);
  const path = `v1/catalog/${storefront}/albums/${id}/library`;
  try {
    const { data = [] } = await listener.request<tPage<tLibraryAlbum>>(path, {
      user: true,
    });
    return data.length > 0;
  } catch (e) {
    if (isAppleMusicError(e, "ApiError") && e.status === 404) return false;
    throw e;
  }
}
// #endregion in-library

/**
 * A write, and what to say once Apple has accepted it: Apple carries it out
 * afterwards, within seconds.
 */
function write(accepted: Promise<unknown>, done: string): void {
  accepted.then(() => {
    say(`${done} It can take a few seconds to show.`);
  }, showError);
}

function heading(
  name: string | undefined,
  by: string | undefined,
  artwork: tArtwork | undefined,
): HTMLElement {
  return h(
    "div",
    { className: "heading" },
    cover(artwork, 240),
    h("h2", {}, name ?? ""),
    h("p", {}, by ?? ""),
  );
}

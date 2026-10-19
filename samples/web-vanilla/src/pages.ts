// Shows: getAlbum, getArtist, getArtistView, getArtistRelationship, getPlaylist, schemas, request, addToLibrary,
// addToFavorites. Guides: /guides/validation, /guides/direct-requests
import { isAppleMusicError, schemas, type tAlbum, type tArtist, type tArtwork, type tBrowserMusic, type tLibraryAlbum, type tPage, type tPlaylist, type tSong } from "@open-music-sdk/browser";
import { h } from "./dom";
import { say, showError } from "./errors";
import { music, now } from "./music";
import { cover, songRows } from "./songs";
import { shelf } from "./view";

export async function openAlbum({ id }: tAlbum): Promise<HTMLElement[]> {
  // #region schema
  // Held to the album's generated type as it arrives: an answer in another shape is a ValidationError here, with
  // the path of each value that differs, rather than an undefined somewhere later.
  const album = await music.catalog.getAlbum(id, { include: ["tracks"], storefront: now.storefront, schema: schemas.albumsResponse });
  // #endregion schema
  const { name, artistName, artwork } = album.attributes ?? {};
  return [heading(name, artistName, artwork), ...(await albumActions(id)), await songRows(album.relationships?.tracks?.data ?? [])];
}

export async function openArtist({ id }: tArtist): Promise<HTMLElement[]> {
  const { storefront } = now;
  const artist = await music.catalog.getArtist(id, { storefront });
  // #region view-and-relationship
  // A view, one page of it: the artist's top songs.
  const top: tSong[] = [];
  for await (const song of music.catalog.getArtistView(id, "top-songs", { storefront, limit: 10, maxPages: 1 })) top.push(song);
  // A relationship, walked a page at a time until its pages or maxPages run out: the artist's albums.
  const albums: tAlbum[] = [];
  for await (const album of music.catalog.getArtistRelationship(id, "albums", { storefront, limit: 25, maxPages: 4 })) albums.push(album);
  // #endregion view-and-relationship
  return [heading(artist.attributes?.name, undefined, artist.attributes?.artwork), h("h3", {}, "Top songs"), await songRows(top), ...shelf("Albums", albums, openAlbum)];
}

export async function openPlaylist({ id }: tPlaylist): Promise<HTMLElement[]> {
  const playlist = await music.catalog.getPlaylist(id, { include: ["tracks"], storefront: now.storefront });
  const { name, curatorName, artwork } = playlist.attributes ?? {};
  return [heading(name, curatorName, artwork), await songRows(playlist.relationships?.tracks?.data ?? [])];
}

/** What a signed-in listener can do with an album: add it to their library unless it is there, or make it a favorite. */
async function albumActions(id: string): Promise<HTMLElement[]> {
  const { listener } = now;
  if (listener === undefined) return [];
  const add = () => {
    write(listener.user.addToLibrary({ albums: [id] }), "Added the album to your library.");
  };
  const favorite = () => {
    write(listener.user.addToFavorites({ albums: [id] }), "Made the album a favorite, which adds it to your library too.");
  };
  return [
    h(
      "p",
      { className: "actions" },
      (await inLibrary(listener, id)) ? h("span", {}, "In your library") : h("button", { type: "button", textContent: "Add album to library", onclick: add }),
      h("button", { type: "button", textContent: "Favorite", onclick: favorite }),
    ),
  ];
}

// #region in-library
/**
 * Whether the listener holds the album: its `library` relationship, which needs their token and which no client
 * function asks for. Apple answers 404 for an album they do not hold, and counts one they hold a song of.
 */
async function inLibrary(listener: tBrowserMusic, id: string): Promise<boolean> {
  try {
    const path = `v1/catalog/${encodeURIComponent(now.storefront)}/albums/${encodeURIComponent(id)}/library`;
    const { data = [] } = await listener.request<tPage<tLibraryAlbum>>(path, { user: true });
    return data.length > 0;
  } catch (e) {
    if (isAppleMusicError(e, "ApiError") && e.status === 404) return false;
    throw e;
  }
}
// #endregion in-library

/** A write, and what to say once Apple has accepted it: Apple carries it out afterwards, within seconds. */
function write(accepted: Promise<unknown>, done: string): void {
  accepted.then(() => { say(`${done} It can take a few seconds to show.`); }, showError);
}

function heading(name: string | undefined, by: string | undefined, artwork: tArtwork | undefined): HTMLElement {
  return h("div", { className: "heading" }, cover(artwork, 160), h("h2", {}, name ?? ""), h("p", {}, by ?? ""));
}

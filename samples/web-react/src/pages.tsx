// Shows: getAlbum, getArtist, getArtistView, getArtistRelationship,
// getPlaylist, schemas, request, segmentOf, addToLibrary, addToFavorites,
// useInfiniteQuery. Guides: /guides/validation, /guides/direct-requests
import {
  isAppleMusicError,
  schemas,
  useMusic,
  type tAlbum,
  type tArtist,
  type tArtwork,
  type tBrowserMusic,
  type tLibraryAlbum,
  type tPage,
  type tPlaylist,
  type tSong,
} from "@open-music-sdk/react";
import { segmentOf } from "@open-music-sdk/core";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { Cover } from "./artwork";
import { Crate } from "./box";
import { say, showError, useShowError } from "./errors";
import { catalog, useNow } from "./music";
import type { tSleeve } from "./sleeve";
import { SongCrate, SongRows } from "./songs";
import { go, Pulling } from "./view";

type tCatalogItem = tAlbum | tArtist | tPlaylist;

/** Catalog albums, artists or playlists as sleeves, each opening its page. */
export function sleeves(items: readonly tCatalogItem[]): tSleeve[] {
  return items.map((item) => ({
    id: item.id,
    artwork: item.attributes?.artwork,
    name: item.attributes?.name ?? item.id,
    by: byLine(item),
    open: () => {
      go(item.type, item.id);
    },
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

export function AlbumPage({ id }: { id: string }) {
  const { signedIn, storefront } = useNow();
  // Held to the album's generated type as it arrives: an answer in another
  // shape is a ValidationError here, with the path of each value that differs,
  // rather than an undefined somewhere later.
  const album = useQuery(
    catalog.getAlbum(id, {
      include: ["tracks"],
      storefront,
      schema: schemas.albumsResponse,
    }),
  );
  if (album.data === undefined) return <Pulling query={album} />;
  const { name, artistName, artwork } = album.data.attributes ?? {};
  const tracks = album.data.relationships?.tracks?.data ?? [];
  return (
    <>
      <Heading name={name} by={artistName} artwork={artwork} />
      {signedIn && <AlbumActions id={id} />}
      <SongRows tracks={tracks} />
    </>
  );
}

export function ArtistPage({ id }: { id: string }) {
  const { storefront } = useNow();
  const artist = useQuery(catalog.getArtist(id, { storefront }));

  // A view, one page of it: the artist's top songs. A view's items are typed
  // as anything one of the artist's views holds, so each is narrowed.
  const view = useInfiniteQuery(
    catalog.getArtistView(id, "top-songs", { storefront, limit: 10 }),
  );
  const topSongs = (view.data?.pages[0]?.data ?? []).filter(
    (item): item is tSong => item.type === "songs",
  );

  // A relationship, a page at a time: flipping near the back of the crate
  // asks Apple for the next page of the artist's albums.
  const relationship = useInfiniteQuery(
    catalog.getArtistRelationship(id, "albums", {
      storefront,
      limit: 25,
    }),
  );
  useShowError(view.error ?? relationship.error);
  const pages = relationship.data?.pages ?? [];
  const albums = pages.flatMap((page) =>
    page.data.filter((item): item is tAlbum => item.type === "albums"),
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = relationship;
  const more = hasNextPage
    ? () => {
      void fetchNextPage();
    }
    : undefined;

  if (artist.data === undefined) return <Pulling query={artist} />;
  const { name, artwork } = artist.data.attributes ?? {};
  return (
    <>
      <Heading name={name} by={undefined} artwork={artwork} />
      <div className="crates">
        <SongCrate label="Top songs" tracks={topSongs} />
        <Crate
          label="Albums"
          sleeves={sleeves(albums)}
          more={more}
          looking={isFetchingNextPage || relationship.isPending}
        />
      </div>
    </>
  );
}

export function PlaylistPage({ id }: { id: string }) {
  const { storefront } = useNow();
  const playlist = useQuery(
    catalog.getPlaylist(id, { include: ["tracks"], storefront }),
  );
  if (playlist.data === undefined) return <Pulling query={playlist} />;
  const { name, curatorName, artwork } = playlist.data.attributes ?? {};
  const tracks = playlist.data.relationships?.tracks?.data ?? [];
  return (
    <>
      <Heading name={name} by={curatorName} artwork={artwork} />
      <SongRows tracks={tracks} />
    </>
  );
}

/**
 * What a signed-in listener can do with an album: add it to their library
 * unless it's there, or make it a favorite. Drawn only while they are signed
 * in.
 */
function AlbumActions({ id }: { id: string }) {
  const { storefront } = useNow();
  const music = useMusic();
  const held = useQuery({
    queryKey: ["in-library", storefront, id],
    queryFn: () => inLibrary(music, storefront, id),
    retry: false,
    // Kept no longer than these actions are drawn: the answer is this
    // listener's alone, and its key does not say whose it is.
    gcTime: 0,
  });
  // An extra: if Apple cannot say whether the listener holds the album, the
  // page offers to add it, and says why.
  useShowError(held.error);

  const add = useMutation({
    mutationFn: () => music.user.addToLibrary({ albums: [id] }),
    onSuccess: () => {
      written("Added the album to your library.");
    },
    onError: showError,
  });
  const favorite = useMutation({
    mutationFn: () => music.user.addToFavorites({ albums: [id] }),
    onSuccess: () => {
      written(
        "Made the album a favorite, which adds it to your library too.",
      );
    },
    onError: showError,
  });

  const library = held.data === true
    ? <span>In your library</span>
    : (
      <button
        type="button"
        disabled={add.isPending}
        onClick={() => {
          add.mutate();
        }}
      >
        Add album to library
      </button>
    );
  return (
    <p className="actions">
      {library}
      <button
        type="button"
        disabled={favorite.isPending}
        onClick={() => {
          favorite.mutate();
        }}
      >
        Favorite
      </button>
    </p>
  );
}

// #region in-library
/**
 * Whether the listener holds the album: its `library` relationship, which needs
 * their token and which no client function asks for. Apple answers 404 for an
 * album they do not hold, and counts one they hold a song of.
 */
async function inLibrary(
  listener: tBrowserMusic,
  inStorefront: string,
  albumId: string,
): Promise<boolean> {
  // Each value is checked as one segment of the path, as the clients check
  // every id: `..` would point the request, and the listener's token with it,
  // somewhere else on Apple's API.
  const storefront = segmentOf("inLibrary", "storefront", inStorefront);
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
 * Says a write Apple has accepted: Apple carries it out afterwards, within
 * seconds.
 */
function written(done: string): void {
  say(`${done} It can take a few seconds to show.`);
}

interface tHeadingProps {
  readonly name: string | undefined;
  readonly by: string | undefined;
  readonly artwork: tArtwork | undefined;
}

function Heading({ name, by, artwork }: tHeadingProps) {
  return (
    <div className="heading">
      <Cover artwork={artwork} size={240} />
      <h2>{name}</h2>
      <p>{by}</p>
    </div>
  );
}

// Shows: musicQueries, getAlbum with schemas, request, segmentOf, forUser.
// Guides: /guides/tanstack-query, /guides/direct-requests
import {
  isAppleMusicError,
  musicQueries,
  schemas,
} from "@open-music-sdk/react";
import type {
  tLibraryAlbum,
  tMusic,
  tPage,
} from "@open-music-sdk/server";
import { segmentOf } from "@open-music-sdk/core";
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import { Suspense } from "react";
import { listener, lovedOf, storefront } from "@/lib/listener";
import { getMusic } from "@/lib/music";
import { BackToTheCrates, CouldNot, Pulling } from "../../pages";
import { AlbumButtons, AlbumView } from "./album";

export default function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <BackToTheCrates />
      <Suspense fallback={<Pulling />}>
        <Album params={params} />
      </Suspense>
    </>
  );
}

async function Album({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const where = await storefront();
  const queryClient = new QueryClient();
  let album;
  try {
    album = await prefetchAlbum(queryClient, id, where);
  } catch (e) {
    return <CouldNot error={e} />;
  }
  const tracks = album.relationships?.tracks?.data ?? [];
  const loved = await lovedOf(tracks);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AlbumView
        id={id}
        storefront={where}
        loved={loved}
        actions={<AlbumActions id={id} storefront={where} />}
      />
    </HydrationBoundary>
  );
}

// #region prefetch
/**
 * The album, asked for as the page's query asks for it, into the cache the
 * page is handed with its HTML: the page draws it at once, and asks Apple
 * again only once it is stale. Held to the album's generated type as it
 * arrives.
 */
async function prefetchAlbum(
  queryClient: QueryClient,
  id: string,
  storefront: string,
) {
  return queryClient.query(
    musicQueries(getMusic()).catalog.getAlbum(id, {
      include: ["tracks"],
      storefront,
      schema: schemas.albumsResponse,
    }),
  );
}
// #endregion prefetch

/**
 * What a signed-in listener can do with an album: add it to their library
 * unless it's there, or make it a favorite.
 */
async function AlbumActions({ id, storefront }: {
  id: string;
  storefront: string;
}) {
  const you = await listener();
  if (you === undefined) return null;
  // An extra: if Apple cannot say whether the listener holds the album, the
  // page offers to add it.
  const held = await inLibrary(you.music, storefront, id).catch(
    (e: unknown) => {
      if (isAppleMusicError(e)) return false;
      throw e;
    },
  );
  return <AlbumButtons id={id} held={held} />;
}

// #region in-library
/**
 * Whether the listener holds the album: its `library` relationship, which needs
 * their token and which no client function asks for. Apple answers 404 for an
 * album they do not hold, and counts one they hold a song of.
 */
async function inLibrary(
  listener: tMusic,
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

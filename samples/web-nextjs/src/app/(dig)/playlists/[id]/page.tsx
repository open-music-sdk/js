// Shows: getPlaylist.
import { Suspense } from "react";
import { lovedOf, storefront } from "@/lib/listener";
import { getMusic } from "@/lib/music";
import { SongRows } from "@/components/songs";
import {
  BackToTheCrates,
  CouldNot,
  Heading,
  Pulling,
} from "@/components/pages";

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <BackToTheCrates />
      <Suspense fallback={<Pulling />}>
        <Playlist params={params} />
      </Suspense>
    </>
  );
}

async function Playlist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const where = await storefront();
  let playlist;
  try {
    playlist = await getMusic().catalog.getPlaylist(id, {
      include: ["tracks"],
      storefront: where,
    });
  } catch (e) {
    return <CouldNot error={e} />;
  }
  const tracks = playlist.relationships?.tracks?.data ?? [];
  const loved = await lovedOf(tracks);
  const { name, curatorName, artwork } = playlist.attributes ?? {};
  return (
    <>
      <Heading name={name} by={curatorName} artwork={artwork} />
      <SongRows tracks={tracks} loved={loved} storefront={where} />
    </>
  );
}

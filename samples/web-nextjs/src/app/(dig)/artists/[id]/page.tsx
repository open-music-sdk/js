// Shows: getArtist, getArtistView, getArtistRelationship.
import type { tAlbum, tSong } from "@open-music-sdk/server";
import { Suspense } from "react";
import { lovedOf, storefront } from "@/lib/listener";
import { getMusic } from "@/lib/music";
import { catalogSleeves } from "@/lib/sleeves";
import { moreAlbums } from "@/lib/actions";
import { LinkCrate } from "@/components/catalog";
import { SongCrate } from "@/components/songs";
import {
  BackToTheCrates,
  CouldNot,
  Heading,
  Pulling,
} from "@/components/pages";

export default function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <BackToTheCrates />
      <Suspense fallback={<Pulling />}>
        <Artist params={params} />
      </Suspense>
    </>
  );
}

async function Artist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const where = await storefront();
  const music = getMusic();
  let artist;
  try {
    artist = await music.catalog.getArtist(id, { storefront: where });
  } catch (e) {
    return <CouldNot error={e} />;
  }

  // A view, one page of it: the artist's top songs.
  const topSongs: tSong[] = [];
  const view = music.catalog.getArtistView(id, "top-songs", {
    storefront: where,
    limit: 10,
    maxPages: 1,
  });
  for await (const song of view) topSongs.push(song);

  // A relationship, its first page: the artist's albums. Flipping near the
  // back of the crate asks the server for the next.
  const albums: tAlbum[] = [];
  const relationship = music.catalog.getArtistRelationship(id, "albums", {
    storefront: where,
    limit: 25,
    maxPages: 1,
  });
  for await (const album of relationship) albums.push(album);

  const loved = await lovedOf(topSongs);
  const { name, artwork } = artist.attributes ?? {};
  return (
    <>
      <Heading name={name} by={undefined} artwork={artwork} />
      <div className="crates">
        <SongCrate
          label="Top songs"
          tracks={topSongs}
          loved={loved}
          storefront={where}
        />
        {/* Drawn afresh in another storefront, rather than keep the albums
            it paged in from this one. */}
        <LinkCrate
          key={where}
          label="Albums"
          sleeves={catalogSleeves(albums)}
          more={moreAlbums.bind(null, id, where)}
        />
      </div>
    </>
  );
}

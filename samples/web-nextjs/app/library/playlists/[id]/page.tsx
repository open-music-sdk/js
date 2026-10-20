// Shows: getLibraryPlaylist, asked by the server for the listener.
//
// A page of its own, so the Library stays as the listener left it, search and
// all, for Back.
import { isAppleMusicError, type tMusic } from "@open-music-sdk/server";
import Link from "next/link";
import { Suspense } from "react";
import { listener } from "@/lib/listener";
import { explain } from "../../../errors";

type tParams = Promise<{ id: string }>;

export default function YourPlaylistPage({ params }: { params: tParams }) {
  return (
    <>
      <Link href="/library" className="back">
        ‹ Back to your library
      </Link>
      <Suspense fallback={<p>Pulling it out…</p>}>
        <ForTheListener params={params} />
      </Suspense>
    </>
  );
}

async function ForTheListener({ params }: { params: tParams }) {
  const you = await listener();
  if (you === undefined) {
    return <p>Sign in with Apple Music to see your library.</p>;
  }
  const { id } = await params;
  return <PlaylistTracks music={you.music} id={id} />;
}

/**
 * A playlist of the listener's, with its tracks. Songs in a library have no
 * previews.
 */
async function PlaylistTracks({ music, id }: { music: tMusic; id: string }) {
  let playlist;
  try {
    playlist = await music.user.getLibraryPlaylist(id, { include: ["tracks"] });
  } catch (e) {
    if (!isAppleMusicError(e) && !(e instanceof TypeError)) throw e;
    return <p>{explain(e)}</p>;
  }
  const tracks = playlist.relationships?.tracks?.data ?? [];
  return (
    <>
      <h2>{playlist.attributes?.name ?? id}</h2>
      <ol className="tracklist">
        {/* A playlist can hold the same song twice. */}
        {tracks.map((track, place) => (
          <li key={`${String(place)}:${track.id}`}>
            <span className="name">
              {track.attributes?.name ?? track.id}
              <small>{track.attributes?.artistName ?? ""}</small>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

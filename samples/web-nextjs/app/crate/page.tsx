// Your crate. The songs are the page's, in the browser; the playlists they
// can go to are the listener's, from the server.
import type { tLibraryPlaylist } from "@open-music-sdk/server";
import { Suspense } from "react";
import { listener } from "@/lib/listener";
import { CrateScreen } from "../crate";

export default function CratePage() {
  return (
    <Suspense fallback={<CrateScreen signedIn={false} editable={[]} />}>
      <ForTheListener />
    </Suspense>
  );
}

/** The listener's playlists they may add to, among the first 100. */
async function ForTheListener() {
  const you = await listener();
  if (you === undefined) return <CrateScreen signedIn={false} editable={[]} />;
  const editable: tLibraryPlaylist[] = [];
  const playlists = you.music.user.listLibraryPlaylists({
    limit: 100,
    maxPages: 1,
  });
  for await (const playlist of playlists) {
    if (playlist.attributes?.canEdit === true) editable.push(playlist);
  }
  return <CrateScreen signedIn editable={editable} />;
}

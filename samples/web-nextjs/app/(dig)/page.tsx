// Shows: getCharts and listGenres, read through "use cache".
import { isAppleMusicError } from "@open-music-sdk/server";
import { Suspense } from "react";
import { genreAlbums, genres, topCharts } from "@/lib/catalog";
import { lovedOf, storefront } from "@/lib/listener";
import { catalogSleeves } from "@/lib/sleeves";
import { LinkCrate } from "../catalog";
import { explain } from "../errors";
import { SongCrate } from "../songs";

export default function Dig() {
  return (
    <Suspense fallback={<p>Looking…</p>}>
      <Floor />
    </Suspense>
  );
}

// The floor, before anyone searches: the storefront's top charts, then a crate
// for each genre the charts are kept by.
async function Floor() {
  const where = await storefront();
  const charts = await topCharts(where);
  // Each type has a list of charts; the first is the storefront's most played.
  // Its name is the crate's label.
  const songs = charts.songs[0];
  const albums = charts.albums[0];
  const playlists = charts.playlists[0];
  const loved = await lovedOf(songs?.data ?? []);
  return (
    <>
      <h2>Top charts</h2>
      <div className="crates">
        <SongCrate
          label={songs?.name ?? "Top songs"}
          tracks={songs?.data ?? []}
          loved={loved}
          storefront={where}
        />
        <LinkCrate
          label={albums?.name ?? "Top albums"}
          sleeves={catalogSleeves(albums?.data ?? [])}
        />
        <LinkCrate
          label={playlists?.name ?? "Top playlists"}
          sleeves={catalogSleeves(playlists?.data ?? [])}
        />
      </div>
      <h2>Genres</h2>
      <Suspense fallback={null}>
        <GenreCrates storefront={where} />
      </Suspense>
    </>
  );
}

/**
 * A crate for each genre, each streamed into the page as its chart arrives.
 * If Apple won't list the genres, the charts still show.
 */
async function GenreCrates({ storefront }: { storefront: string }) {
  let all;
  try {
    all = await genres(storefront);
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    return <p>{explain(e)}</p>;
  }
  return (
    <div className="crates">
      {all.map(({ id, attributes }) => {
        const label = attributes?.name ?? id;
        const waiting = (
          <LinkCrate label={label} sleeves={[]} empty="Looking…" />
        );
        return (
          <Suspense key={id} fallback={waiting}>
            <GenreCrate genre={id} label={label} storefront={storefront} />
          </Suspense>
        );
      })}
    </div>
  );
}

interface tGenreCrateProps {
  readonly genre: string;
  readonly label: string;
  readonly storefront: string;
}

/** The albums of a genre's chart. A chart Apple won't give says why. */
async function GenreCrate({ genre, label, storefront }: tGenreCrateProps) {
  let albums;
  try {
    albums = await genreAlbums(genre, storefront);
  } catch (e) {
    if (!isAppleMusicError(e)) throw e;
    return <LinkCrate label={label} sleeves={[]} empty={explain(e)} />;
  }
  return <LinkCrate label={label} sleeves={catalogSleeves(albums)} />;
}

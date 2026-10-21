// Shows: searchCatalog.
import { Suspense } from "react";
import { lovedOf, storefront } from "@/lib/listener";
import { getMusic } from "@/lib/music";
import { catalogSleeves } from "@/lib/sleeves";
import { LinkCrate } from "@/components/catalog";
import { SongCrate } from "@/components/songs";
import { BackToTheCrates, CouldNot, Pulling } from "@/components/pages";

type tSearchParams = Promise<{ term?: string | string[] | undefined }>;

export default function SearchPage({
  searchParams,
}: {
  searchParams: tSearchParams;
}) {
  return (
    <>
      <BackToTheCrates />
      <Suspense fallback={<Pulling />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: tSearchParams }) {
  const { term } = await searchParams;
  const text = typeof term === "string" ? term.trim() : "";
  if (text === "") return <p>Search the catalog with the box above.</p>;
  const where = await storefront();
  let found;
  try {
    found = await getMusic().catalog.searchCatalog(text, {
      types: ["songs", "albums", "artists", "playlists"],
      limit: 20,
      storefront: where,
    });
  } catch (e) {
    return <CouldNot error={e} />;
  }
  const { songs, albums, artists, playlists } = found.results;
  const loved = await lovedOf(songs?.data ?? []);
  return (
    <>
      <h2>Results for "{text}"</h2>
      <div className="crates">
        <SongCrate
          label="Songs"
          tracks={songs?.data ?? []}
          loved={loved}
          storefront={where}
        />
        <LinkCrate
          label="Albums"
          sleeves={catalogSleeves(albums?.data ?? [])}
        />
        <LinkCrate
          label="Artists"
          sleeves={catalogSleeves(artists?.data ?? [])}
        />
        <LinkCrate
          label="Playlists"
          sleeves={catalogSleeves(playlists?.data ?? [])}
        />
      </div>
    </>
  );
}

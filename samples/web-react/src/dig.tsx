// Shows: getCharts, listGenres, listStorefronts.
import {
  useMusicQueries,
  type tGenre,
  type tStorefront,
} from "@open-music-sdk/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Crate } from "./box";
import { explain, useShowError } from "./errors";
import { useNow } from "./music";
import { AlbumPage, ArtistPage, PlaylistPage, sleeves } from "./pages";
import { SearchForm, SearchPage } from "./search";
import { SongCrate } from "./songs";
import { View, type tPage } from "./view";

/** The pages a sleeve, or a search, opens over the floor. */
const PAGES: Readonly<Record<string, tPage>> = {
  albums: AlbumPage,
  artists: ArtistPage,
  playlists: PlaylistPage,
  search: SearchPage,
};

export function Dig() {
  return (
    <>
      <SearchForm />
      <View floor={<Floor />} pages={PAGES} />
    </>
  );
}

// The floor, before anyone searches: the storefront's top charts, then a crate
// for each genre the charts are kept by.
function Floor() {
  const { storefront } = useNow();
  const queries = useMusicQueries();
  const charts = useQuery(
    queries.catalog.getCharts({
      types: ["songs", "albums", "playlists"],
      limit: 20,
      storefront,
    }),
  );
  useShowError(charts.error);
  // Each type has a list of charts; the first is the storefront's most played.
  // Its name is the crate's label.
  const results = charts.data?.results;
  const songs = results?.songs[0];
  const albums = results?.albums[0];
  const playlists = results?.playlists[0];
  const empty = waitingFor(charts);
  return (
    <>
      <h2>Top charts</h2>
      <div className="crates">
        <SongCrate
          label={songs?.name ?? "Top songs"}
          tracks={songs?.data ?? []}
          empty={empty}
        />
        <Crate
          label={albums?.name ?? "Top albums"}
          sleeves={sleeves(albums?.data ?? [])}
          empty={empty}
        />
        <Crate
          label={playlists?.name ?? "Top playlists"}
          sleeves={sleeves(playlists?.data ?? [])}
          empty={empty}
        />
      </div>
      <h2>Genres</h2>
      <GenreCrates storefront={storefront} />
    </>
  );
}

/**
 * A crate for each genre but Music, the one the others belong to. If Apple
 * won't list them, the charts still show.
 */
function GenreCrates({ storefront }: { storefront: string }) {
  const queries = useMusicQueries();
  const genres = useInfiniteQuery(queries.catalog.listGenres({ storefront }));
  useShowError(genres.error);
  useEveryPage(genres);

  const pages = genres.data?.pages ?? [];
  const all = pages.flatMap((page): tGenre[] => page.data);
  return (
    <div className="crates">
      {all.map(({ id, attributes }) => {
        if (attributes?.parentId === undefined) return null;
        return (
          <GenreCrate
            key={id}
            genre={id}
            label={attributes.name}
            storefront={storefront}
          />
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

/**
 * The albums of a genre's chart, in a crate filled once it scrolls into view,
 * so a floor of them asks Apple only for the ones the listener reaches.
 */
function GenreCrate({ genre, label, storefront }: tGenreCrateProps) {
  const queries = useMusicQueries();
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting !== true) return;
        watcher.disconnect();
        setSeen(true);
      },
      // Filled a little before it comes into view.
      { rootMargin: "200px" },
    );
    if (ref.current !== null) watcher.observe(ref.current);
    return () => {
      watcher.disconnect();
    };
  }, []);

  const chart = useQuery({
    ...queries.catalog.getCharts({
      types: ["albums"],
      genre,
      limit: 20,
      storefront,
    }),
    enabled: seen,
  });
  useShowError(chart.error);
  const albums = chart.data?.results.albums[0]?.data ?? [];
  const empty = seen ? waitingFor(chart) : "Not looked through yet.";
  return (
    <Crate ref={ref} label={label} sleeves={sleeves(albums)} empty={empty} />
  );
}

interface tWalk {
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isFetchNextPageError: boolean;
  readonly fetchNextPage: () => Promise<unknown>;
}

/**
 * Asks for every page of a walk, one after another. A page that fails is not
 * asked for again: its error is said, and the pages before it are drawn.
 */
function useEveryPage(walk: tWalk): void {
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError } = walk;
  const { fetchNextPage } = walk;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
}

/** What an empty crate says while its list is asked for, or once it failed. */
function waitingFor(query: {
  readonly isPending: boolean;
  readonly error: Error | null;
}): string | undefined {
  if (query.error !== null) return explain(query.error);
  if (query.isPending) return "Looking…";
  return undefined;
}

/**
 * Signed out, the listener picks the storefront. Signed in, it is their own,
 * from Apple, and the picker goes.
 */
export function StorefrontPicker() {
  const { signedIn, storefront, pick } = useNow();
  const queries = useMusicQueries();
  const walk = useInfiniteQuery(queries.catalog.listStorefronts());
  useShowError(walk.error);
  useEveryPage(walk);

  if (signedIn) return null;
  const pages = walk.data?.pages ?? [];
  const storefronts = pages
    .flatMap((page): tStorefront[] => page.data)
    .map(({ id, attributes }) => ({ id, name: attributes?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The storefront asked in, before the list arrives.
  if (storefronts.length === 0) {
    storefronts.push({ id: storefront, name: storefront });
  }
  return (
    <label id="storefront-picker">
      Storefront{" "}
      <select
        value={storefront}
        onChange={(event) => {
          pick(event.target.value);
        }}
      >
        {storefronts.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

// Shows: listHeavyRotation, listPersonalRecommendations, listRecentlyAdded,
// listLibraryPlaylists, getLibraryPlaylist, searchLibrary, useInfiniteQuery,
// and one list the server asks for. Guides: /guides/tanstack-query,
// /guides/store-user-tokens
import {
  useMusicQueries,
  type tArtwork,
  type tLibraryPlaylist,
} from "@open-music-sdk/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { Crate } from "./box";
import { fromServer, useShowError } from "./errors";
import type { tSleeve } from "./sleeve";

/**
 * What every list of the listener's holds: albums, playlists, stations, each
 * with a name and a cover.
 */
interface tCard {
  readonly id: string;
  readonly attributes?: tCardAttributes | undefined;
}

interface tCardAttributes {
  readonly name?: string | undefined;
  readonly artistName?: string | undefined;
  readonly artwork?: tArtwork | undefined;
}

/**
 * The listener's side: drawn only while they are signed in, so every query here
 * runs with their token, in their own scope.
 */
export function Library() {
  const queries = useMusicQueries();
  const [opened, setOpened] = useState<string>();
  // The first page of each list is enough here.
  const heavyRotation = useInfiniteQuery(
    queries.user.listHeavyRotation({ limit: 10 }),
  );
  const recentlyAdded = useInfiniteQuery(
    queries.user.listRecentlyAdded({ limit: 10 }),
  );
  const recommendations = useInfiniteQuery(
    queries.user.listPersonalRecommendations({ limit: 3 }),
  );
  useShowError(
    heavyRotation.error ?? recentlyAdded.error ?? recommendations.error,
  );

  const recommended = recommendations.data?.pages[0]?.data ?? [];
  return (
    <>
      <LibrarySearch />
      <div className="crates">
        <FromTheServer />
        <Crate
          label="Heavy rotation"
          sleeves={cards(heavyRotation.data?.pages[0]?.data ?? [])}
        />
        {recommended.map(({ id, attributes, relationships }) => (
          <Crate
            key={id}
            label={attributes?.title?.stringForDisplay ?? "Made for you"}
            sleeves={cards(relationships?.contents?.data ?? [])}
          />
        ))}
        <Crate
          label="Recently added"
          sleeves={cards(recentlyAdded.data?.pages[0]?.data ?? [])}
        />
        <YourPlaylists open={setOpened} />
      </div>
      {opened !== undefined && <PlaylistTracks id={opened} />}
    </>
  );
}

/**
 * One list the server asks for, with the token it kept for this listener when
 * they signed in.
 */
function FromTheServer() {
  const label = "Recently played, asked by the server";
  const recent = useQuery({
    queryKey: ["recently-played", "server"],
    queryFn: recentlyPlayed,
    retry: false,
    // Kept no longer than the Library is drawn: the answer is this listener's
    // alone, and its key does not say whose it is.
    gcTime: 0,
  });
  // A list that cannot be had says why in its own crate, and the rest of the
  // Library is drawn all the same.
  const empty = recent.error === null ? undefined : recent.error.message;
  return (
    <Crate label={label} sleeves={cards(recent.data ?? [])} empty={empty} />
  );
}

async function recentlyPlayed(): Promise<tCard[]> {
  const answer = await fetch("/api/me/recent");
  if (!answer.ok) throw new Error(fromServer(answer.status));
  return (await answer.json()) as tCard[];
}

// #region your-playlists
/**
 * The listener's playlists, 25 at a time: flipping near the back of the crate
 * asks Apple for the next page.
 */
function YourPlaylists({ open }: { open: (id: string) => void }) {
  const queries = useMusicQueries();
  const { data, error, hasNextPage, isFetching, fetchNextPage } =
    useInfiniteQuery(queries.user.listLibraryPlaylists({ limit: 25 }));
  useShowError(error);
  const pages = data?.pages ?? [];
  const playlists = pages.flatMap(
    (page): tLibraryPlaylist[] => page.data,
  );
  const more = hasNextPage
    ? () => {
      void fetchNextPage();
    }
    : undefined;
  const sleeves = playlists.map((playlist): tSleeve => ({
    id: playlist.id,
    artwork: playlist.attributes?.artwork,
    name: playlist.attributes?.name ?? playlist.id,
    open: () => {
      open(playlist.id);
    },
  }));
  return (
    <Crate
      label="Your playlists"
      sleeves={sleeves}
      more={more}
      looking={isFetching}
      empty="No playlists in your library."
    />
  );
}
// #endregion your-playlists

/**
 * A playlist of the listener's, with its tracks, under the crates. Songs in a
 * library have no previews.
 */
function PlaylistTracks({ id }: { id: string }) {
  const queries = useMusicQueries();
  const { data: playlist, error } = useQuery(
    queries.user.getLibraryPlaylist(id, { include: ["tracks"] }),
  );
  useShowError(error);
  if (playlist === undefined) return null;
  const tracks = playlist.relationships?.tracks?.data ?? [];
  return (
    <>
      <h2>{playlist.attributes?.name ?? id}</h2>
      <ol className="tracklist">
        {tracks.map((track) => (
          <li key={track.id}>
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

function LibrarySearch() {
  const queries = useMusicQueries();
  const [typed, setTyped] = useState("");
  const [text, setText] = useState("");
  const found = useQuery({
    ...queries.user.searchLibrary(text, {
      types: ["library-songs", "library-albums"],
      limit: 10,
    }),
    enabled: text !== "",
  });
  useShowError(found.error);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setText(typed.trim());
  };
  const results = found.data?.results;
  const items = [
    ...(results?.["library-songs"]?.data ?? []),
    ...(results?.["library-albums"]?.data ?? []),
  ];
  const nothing = "Nothing. Apple's library search finds a song by the first "
    + "word of its name more often than by the whole name.";
  return (
    <>
      <form id="library-search" onSubmit={submit}>
        <input
          id="library-term"
          type="search"
          placeholder="Find in your library"
          aria-label="Find in your library"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
        <button>Find</button>
      </form>
      {found.data !== undefined && (
        <div className="crates">
          <Crate
            label={`In your library: "${text}"`}
            sleeves={cards(items)}
            empty={nothing}
          />
        </div>
      )}
    </>
  );
}

function cards(items: readonly tCard[]): tSleeve[] {
  return items.map(({ id, attributes }) => ({
    id,
    artwork: attributes?.artwork,
    name: attributes?.name ?? id,
    by: attributes?.artistName,
  }));
}

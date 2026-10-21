// Shows: getCharts, listGenres, "use cache". Guide: /guides/nextjs
//
// The catalog reads that are the same for everyone in a storefront, kept for
// an hour across requests and listeners. A listener's library is theirs
// alone, and is never cached this way.
import type { tGenre } from "@open-music-sdk/server";
import { cacheLife } from "next/cache";
import { getMusic } from "./music";

// #region cache-catalog
/** A storefront's top charts: the first of each type is its most played. */
export async function topCharts(storefront: string) {
  "use cache";
  cacheLife("hours");
  const { results } = await getMusic().catalog.getCharts({
    types: ["songs", "albums", "playlists"],
    limit: 20,
    storefront,
  });
  return results;
}
// #endregion cache-catalog

/** Every genre the storefront's charts are kept by, but Music, their root. */
export async function genres(storefront: string): Promise<tGenre[]> {
  "use cache";
  cacheLife("hours");
  const all: tGenre[] = [];
  for await (const genre of getMusic().catalog.listGenres({ storefront })) {
    if (genre.attributes?.parentId !== undefined) all.push(genre);
  }
  return all;
}

/** Every storefront, by name, for the picker. */
export async function storefronts(): Promise<{ id: string; name: string }[]> {
  "use cache";
  cacheLife("days");
  const all: { id: string; name: string }[] = [];
  for await (const { id, attributes } of getMusic().catalog.listStorefronts()) {
    all.push({ id, name: attributes?.name ?? id });
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/** The albums of a genre's chart. */
export async function genreAlbums(genre: string, storefront: string) {
  "use cache";
  cacheLife("hours");
  const { results } = await getMusic().catalog.getCharts({
    types: ["albums"],
    genre,
    limit: 20,
    storefront,
  });
  return results.albums[0]?.data ?? [];
}

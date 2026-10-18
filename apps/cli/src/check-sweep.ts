// `check`'s sweep: every endpoint function client-catalog and client-user export, asked once against the live API
// with what the run finds to ask with, and its answer held to the generated type of it with the validator the
// `validate` package has for that type. A function with names, a relationship's or a view's, is asked once for each.
// The functions that write to ratings and folders are round trips of their own, run only with --write, and those
// already asked by a question are that question.
import * as sdk from "@open-music-sdk/server";
import { schemas, type tCatalogFunctions, type tUserFunctions } from "@open-music-sdk/server";
import {
  ORIGIN,
  added,
  at,
  brief,
  defined,
  diffsOf,
  idOf,
  inLibrary,
  isNotFound,
  itemsOf,
  list,
  once,
  ownPlaylist,
  refused,
  resourcesIn,
  seconds,
  shown,
  someOf,
  text,
  took,
  whereOf,
  type tDiff,
  type tItem,
  type tMark,
  type tRun,
} from "./check-ask";
import type { tCheck } from "./check-questions";
import { printable } from "./files";

/** What a row is asked with: the run's client and signal, the charts, and what the run makes once. */
export type tAsk = Pick<tRun, "music" | "storefront" | "signal" | "charts" | "memo">;

/** What a row came to, for one function or one of its names. */
export interface tOutcome {
  readonly mark: tMark;
  readonly words: string;
  /** How the answer differed from its type, for the run's list of them. */
  readonly diffs: readonly tDiff[];
  /** Why it was not asked, for stderr: it may say what the listener's library holds. */
  readonly why?: string | undefined;
}

/** One function of the sweep, asked for itself, or for each of its names. */
export interface tRow {
  readonly kind: "row";
  /** The names it is asked for, each a row of its own: its relationships or its views. */
  readonly names?: readonly string[];
  readonly noun?: "relationships" | "views";
  readonly ask: (a: tAsk, name: string | undefined) => Promise<tOutcome>;
}

/** A function the sweep leaves to a check: a round trip of its own, or the question that already asks it. */
export type tEntry = tRow | { readonly kind: "check"; readonly to: string };

/** Something to ask with, found at run time, the first five of it: what it is, for the person, and how it is found. */
interface tSeed<T> {
  readonly what: string;
  readonly get: (a: tAsk) => Promise<readonly T[]>;
}
const seed = <T>(what: string, get: (a: tAsk) => Promise<readonly T[]>): tSeed<T> => ({ what, get: (a) => once(a, `seed ${what}`, async () => (await get(a)).slice(0, 5)) });

const o = (a: tAsk) => ({ signal: a.signal });
const idsIn = (body: unknown) => list(at(body, "data")).map(idOf).filter(defined);
/** The ids of the first page a lister or a relationship answers with, or none for its 404. */
const idsOf = async (asked: Promise<unknown>) => {
  try {
    return idsIn(await asked);
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
};
const unique = <T>(values: readonly T[]) => [...new Set(values)];

// The catalog: the charts first, and what they lead to; the rest from a list or a search of its own.
const charted = (pick: (charts: Awaited<ReturnType<tAsk["charts"]>>) => readonly tItem[]) => async (a: tAsk) => pick(await a.charts()).map((item) => item.id);
const attribute = (pick: (charts: Awaited<ReturnType<tAsk["charts"]>>) => readonly tItem[], name: string) => async (a: tAsk) =>
  unique(pick(await a.charts()).map((item) => text(at(item.attributes, name))).filter(defined));
const SONGS = seed("chart song", charted((c) => c.songs));
const ALBUMS = seed("chart album", charted((c) => c.albums));
const PLAYLISTS = seed("chart playlist", charted((c) => c.playlists));
const MUSIC_VIDEOS = seed("chart music video", charted((c) => c.musicVideos));
const ISRCS = seed("ISRC of a chart song", attribute((c) => c.songs, "isrc"));
const VIDEO_ISRCS = seed("ISRC of a chart music video", attribute((c) => c.musicVideos, "isrc"));
const UPCS = seed("UPC of a chart album", attribute((c) => c.albums, "upc"));

/** The resources of a type a search for `term` finds, of a type the charts do not lead to. */
const searched = (type: sdk.tCatalogSearchType, term: string) => async (a: tAsk) => idsIn(at(await sdk.searchCatalog(a.music, term, { types: [type], limit: 5, ...o(a) }), "results", type));
/** Each of `ids`' relationship of this name, in turn, until one holds something. */
const related = (ids: tSeed<string>, ask: (a: tAsk, id: string) => Promise<unknown>) => async (a: tAsk) => {
  for (const id of await ids.get(a)) {
    const found = await idsOf(ask(a, id));
    if (found.length > 0) return found;
  }
  return [];
};
// The first artist of each chart song, not every artist of one: one artist alone had few of the twelve views on 18
// October 2026.
const ARTISTS = seed("artist of a chart song", async (a) => {
  const firsts: string[] = [];
  for (const id of await SONGS.get(a)) firsts.push(...(await idsOf(sdk.getSongRelationship(a.music, id, "artists", o(a)))).slice(0, 1));
  return unique(firsts);
});
const LABELS = seed("record label", async (a) => {
  const labels = await related(ALBUMS, (b, id) => sdk.getAlbumRelationship(b.music, id, "record-labels", o(b)))(a);
  return labels.length > 0 ? labels : searched("record-labels", "records")(a);
});
/** The curators of the chart's playlists, of either type, and what a search finds where they have none of one. */
const curated = (type: "curators" | "apple-curators", term: string) => async (a: tAsk) => {
  const curators = await once(a, "chart curators", async () => {
    const all: unknown[] = [];
    for (const id of await PLAYLISTS.get(a)) {
      try {
        all.push(...list(at(await sdk.getPlaylistRelationship(a.music, id, "curator", o(a)), "data")));
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    }
    return all;
  });
  // Apple's own playlists are by an Apple curator, which is a type of its own.
  const ids = unique(curators.filter((curator) => at(curator, "type") === type).map(idOf).filter(defined));
  return ids.length > 0 ? ids : searched(type, term)(a);
};
const CURATORS = seed("curator", curated("curators", "radio"));
const APPLE_CURATORS = seed("Apple curator", curated("apple-curators", "apple music"));
const ACTIVITIES = seed("activity", searched("activities", "workout"));
/** The live radio stations, as the cleanup names one. */
const stations = (a: tAsk) => once(a, "stations", async () => itemsOf("stations", at(await sdk.getLiveRadioStations(a.music, o(a)), "data"), a.storefront));
const STATIONS = seed("live radio station", async (a) => {
  const live = (await stations(a)).map((item) => item.id);
  return live.length > 0 ? live : searched("stations", "radio")(a);
});
const STATION_GENRES = seed("station genre", async (a) => idsIn(await sdk.listStationGenres(a.music, { limit: 5, ...o(a) })));
const GENRES = seed("genre", async (a) => idsIn(await sdk.listGenres(a.music, { limit: 5, ...o(a) })));
const STOREFRONTS = seed("storefront", (a) => Promise.resolve([a.storefront]));
/** What a search is for: the name of a chart song, which a search finds. */
const TERMS = seed("name of a chart song", async (a) => (await a.charts()).songs.map((song) => song.name));
/** The language the storefront answers in by default: a storefront with one gets it asked for by name all the same. */
const LANGUAGES = seed("language of the storefront", async (a) => {
  const tag = text(at(list(at(await sdk.getStorefront(a.music, a.storefront, o(a)), "data"))[0], "attributes", "defaultLanguageTag"));
  return tag === undefined ? [] : [tag];
});

// The listener's library, first of each list, for the reads a read run makes of it: none of it is printed.
const librarySongs = (a: tAsk) => once(a, "library songs", async () => list(at(await sdk.listLibrarySongs(a.music, { limit: 5, ...o(a) }), "data")));
const LIBRARY_SONGS = seed("song in your library", async (a) => (await librarySongs(a)).map(idOf).filter(defined));
const LIBRARY_ALBUMS = seed("album in your library", async (a) => idsIn(await sdk.listLibraryAlbums(a.music, { limit: 5, ...o(a) })));
const LIBRARY_ARTISTS = seed("artist in your library", async (a) => idsIn(await sdk.listLibraryArtists(a.music, { limit: 5, ...o(a) })));
const LIBRARY_VIDEOS = seed("music video in your library", async (a) => idsIn(await sdk.listLibraryMusicVideos(a.music, { limit: 5, ...o(a) })));
const LIBRARY_PLAYLISTS = seed("playlist in your library", async (a) => idsIn(await sdk.listLibraryPlaylists(a.music, { limit: 5, ...o(a) })));
/**
 * The id of the root playlist folder, as Apple answers for it, or the one its children were found under on 18 October
 * 2026, when the identity filter answered with none for a listener with no folder.
 */
const ROOT_ID = "p.playlistsroot";
const rootOf = async (a: tAsk) => (await idsOf(sdk.getRootLibraryPlaylistFolder(a.music, o(a))))[0] ?? ROOT_ID;
const ROOT = seed("root playlist folder", async (a) => [await rootOf(a)]);
/** The folders in the root folder, which have a parent to ask for, as the root does not. */
const FOLDERS = seed("playlist folder in your library", async (a) => {
  const children = list(at(await sdk.getLibraryPlaylistFolderRelationship(a.music, await rootOf(a), "children", { limit: 100, ...o(a) }), "data"));
  return children.filter((child) => at(child, "type") === "library-playlist-folders").map(idOf).filter(defined);
});
/** A folder to read by its id: one in the root, whose id Apple gave, and then the root, which was a 404 by its id on 18 October 2026. */
const SOME_FOLDERS = seed("playlist folder in your library", async (a) => [...(await FOLDERS.get(a)), ...(await ROOT.get(a))]);
const RECOMMENDATIONS = seed("recommendation for you", async (a) => idsIn(await sdk.listPersonalRecommendations(a.music, { limit: 5, ...o(a) })));
// The first word of a song's name: a library search for a whole name of three words or more found nothing on 18
// October 2026, where its first word found the song.
const LIBRARY_TERMS = seed("name of a song in your library", async (a) =>
  unique((await librarySongs(a)).map((song) => text(at(song, "attributes", "name"))?.split(/\s+/)[0]).filter((word): word is string => word !== undefined && word !== "")),
);

/** How a row is asked beyond what it is asked with: whether its next page is asked too, and where its answer holds what it finds. */
interface tOptions {
  readonly paged?: boolean;
  /** How many things the answer holds, where they are not resources: a hint's terms, a tag. */
  readonly seen?: (body: unknown) => number;
  /**
   * What the answer has to hold, for a function asked for what Apple gave in another answer, or for what there always
   * is: a 404 or nothing for it is no "none here" but a difference, as a request the SDK makes wrongly would answer.
   */
  readonly holds?: string;
}
/** What a function asked by ids Apple gave has to hold. */
const GIVEN = { holds: "what it gave the ids of in another answer" } as const;

/** The names of the query a next link carries, without their values, which may be a listener's. */
const carries = (next: string) => {
  const names = [...new Set(new URL(next, ORIGIN).searchParams.keys())].filter((name) => /^[\w[\]-]{1,32}$/.test(name));
  return names.length === 0 ? "nothing" : names.join(", ");
};

/**
 * Asks with each of `tries`, of the first five, until Apple answers with something to check, and holds the answer to
 * `schema`, and the next page too where there is one and the row walks pages. A 404, or an answer with nothing in it,
 * is tried again with the next: a song may have no composers. Anything else Apple fails with is thrown, for the
 * runner to say.
 */
async function attempt<T>(a: tAsk, what: string, tries: readonly T[], call: (input: T) => Promise<unknown>, schema: schemas.tSchema<unknown>, options: tOptions): Promise<tOutcome> {
  if (tries.length === 0) return { mark: "skipped", words: "not asked, since there was nothing to ask it with (stderr says why)", diffs: [], why: `no ${what} was found to ask it with` };
  for (const input of tries.slice(0, 5)) {
    let body: unknown;
    try {
      body = await call(input);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      if (options.holds !== undefined) return { mark: "differs", words: `Apple answered 404 for ${options.holds}.`, diffs: [] };
      continue;
    }
    if ((options.seen ?? resourcesIn)(body) === 0) {
      if (options.holds !== undefined) return { mark: "differs", words: `Apple answered with nothing for ${options.holds}.`, diffs: [] };
      continue;
    }
    const diffs = diffsOf(schema, body);
    if (diffs.length > 0) return { mark: "differs", words: `types: ${someOf(diffs)}.`, diffs };
    const next = text(at(body, "next"));
    if (options.paged !== true || next === undefined) return { mark: "same", words: "as the types have it.", diffs: [] };
    // The next link as Apple gave it, as core's paginate sends it: a page 2 that differs where page 1 did not is the
    // link's doing, as when it leaves out what page 1 was asked with.
    const second = await a.music.request(next, o(a));
    const later = resourcesIn(second) > 0 ? diffsOf(schema, second) : [];
    if (later.length > 0) return { mark: "differs", words: `page 1 is as the types have it, and page 2, by its next link, which carries ${carries(next)}, is not: ${someOf(later)}. The link may leave out what page 1 was asked with, and core's paginate sends it as Apple gave it.`, diffs: [] };
    return { mark: "same", words: `as the types have it, and page 2 too, by its next link, which carries ${carries(next)}.`, diffs: [] };
  }
  return { mark: "skipped", words: "Apple held none here: it answered 404, or with nothing, for each one asked, so its shape was not seen.", diffs: [] };
}

type tSchema<T> = schemas.tSchema<T>;

/** A function asked with each of a seed's first five in turn. */
const one = <T, R>(from: tSeed<T>, call: (a: tAsk, input: T) => Promise<R>, schema: tSchema<NoInfer<R>>, options: tOptions = {}): tRow => ({
  kind: "row",
  ask: async (a) => attempt(a, from.what, await from.get(a), (input) => call(a, input), schema as tSchema<unknown>, options),
});
/** A function asked once with all of a seed's first five. */
const all = <T, R>(from: tSeed<T>, call: (a: tAsk, inputs: readonly T[]) => Promise<R>, schema: tSchema<NoInfer<R>>, options: tOptions = {}): tRow => ({
  kind: "row",
  ask: async (a) => {
    const inputs = await from.get(a);
    return attempt(a, from.what, inputs.length === 0 ? [] : [inputs], (each) => call(a, each), schema as tSchema<unknown>, options);
  },
});
/** A function asked with nothing but its options, so always asked. */
const bare = <R>(call: (a: tAsk) => Promise<R>, schema: tSchema<NoInfer<R>>, options: tOptions = {}): tRow => ({
  kind: "row",
  ask: (a) => attempt(a, "", [undefined], () => call(a), schema as tSchema<unknown>, options),
});
/**
 * A function asked for each of its names with each of a seed's first five in turn, the name's own type held to its
 * own validator. A name the seed has nothing for, such as the root folder's parent, is asked with a seed of its own.
 */
const named = <K extends string>(
  noun: "relationships" | "views",
  from: tSeed<string>,
  call: (a: tAsk, id: string, name: K) => Promise<unknown>,
  shapes: Readonly<Record<K, tSchema<unknown>>>,
  seeds?: Readonly<Partial<Record<K, tSeed<string>>>>,
): tRow => ({
  kind: "row",
  noun,
  names: Object.keys(shapes),
  ask: async (a, name) => {
    const each = seeds?.[name as K] ?? from;
    return attempt(a, each.what, await each.get(a), (id) => call(a, id, name as K), shapes[name as K], { paged: true });
  },
});
const paged = { paged: true } as const;
const check = (to: string) => ({ kind: "check", to }) as const;

/** The names of a type of the generated types, without the one the getters leave out. */
type tNames<T, Without extends string = never> = Exclude<keyof T, Without> & string;

/** Every function client-catalog exports: a key missing here, or one too many, is a type error. */
export const CATALOG = {
  getSong: one(SONGS, async (a, id) => sdk.getSong(a.music, id, { extend: ["artistUrl"], language: (await LANGUAGES.get(a))[0], ...o(a) }), schemas.songsResponse, GIVEN),
  getSongs: all(SONGS, (a, ids) => sdk.getSongs(a.music, ids, o(a)), schemas.songsResponse, GIVEN),
  getSongsByIsrc: all(ISRCS, (a, isrcs) => sdk.getSongsByIsrc(a.music, isrcs, o(a)), schemas.songsResponse, GIVEN),
  getSongsByEquivalents: all(SONGS, (a, ids) => sdk.getSongsByEquivalents(a.music, ids, { restrict: ["explicit"], ...o(a) }), schemas.songsResponse),
  getSongRelationship: named<tNames<sdk.tSongRelationships, "library">>("relationships", SONGS, (a, id, name) => sdk.getSongRelationship(a.music, id, name, o(a)), {
    albums: schemas.songRelationshipsSongAlbumsRelationship,
    artists: schemas.songRelationshipsSongArtistsRelationship,
    composers: schemas.songRelationshipsSongComposersRelationship,
    genres: schemas.songRelationshipsSongGenresRelationship,
    "music-videos": schemas.songRelationshipsSongMusicVideosRelationship,
    station: schemas.songRelationshipsSongStationRelationship,
  }),
  getAlbum: one(ALBUMS, (a, id) => sdk.getAlbum(a.music, id, { include: ["artists"], ...o(a) }), schemas.albumsResponse, GIVEN),
  getAlbums: all(ALBUMS, (a, ids) => sdk.getAlbums(a.music, ids, o(a)), schemas.albumsResponse, GIVEN),
  getAlbumsByUpc: all(UPCS, (a, upcs) => sdk.getAlbumsByUpc(a.music, upcs, o(a)), schemas.albumsResponse, GIVEN),
  getAlbumsByEquivalents: all(ALBUMS, (a, ids) => sdk.getAlbumsByEquivalents(a.music, ids, o(a)), schemas.albumsResponse),
  getAlbumRelationship: named<tNames<sdk.tAlbumRelationships, "library">>("relationships", ALBUMS, (a, id, name) => sdk.getAlbumRelationship(a.music, id, name, o(a)), {
    artists: schemas.albumRelationshipsAlbumArtistsRelationship,
    genres: schemas.albumRelationshipsAlbumGenresRelationship,
    tracks: schemas.albumRelationshipsAlbumTracksRelationship,
    "record-labels": schemas.albumRelationshipsAlbumRecordLabelsRelationship,
  }),
  getAlbumView: named<tNames<sdk.tAlbumViews>>("views", ALBUMS, (a, id, name) => sdk.getAlbumView(a.music, id, name, { with: ["attributes"], ...o(a) }), {
    "appears-on": schemas.albumViewsAlbumAppearsOnView,
    "other-versions": schemas.albumViewsAlbumOtherVersionsView,
    "related-albums": schemas.albumViewsAlbumRelatedAlbumsView,
    "related-videos": schemas.albumViewsAlbumRelatedVideosView,
  }),
  getArtist: one(ARTISTS, (a, id) => sdk.getArtist(a.music, id, { views: ["top-songs"], ...o(a) }), schemas.artistsResponse, GIVEN),
  getArtists: all(ARTISTS, (a, ids) => sdk.getArtists(a.music, ids, o(a)), schemas.artistsResponse, GIVEN),
  getArtistRelationship: named<tNames<sdk.tArtistRelationships>>("relationships", ARTISTS, (a, id, name) => sdk.getArtistRelationship(a.music, id, name, o(a)), {
    albums: schemas.artistRelationshipsArtistAlbumsRelationship,
    genres: schemas.artistRelationshipsArtistGenresRelationship,
    "music-videos": schemas.artistRelationshipsArtistMusicVideosRelationship,
    playlists: schemas.artistRelationshipsArtistPlaylistsRelationship,
    station: schemas.artistRelationshipsArtistStationRelationship,
  }),
  getArtistView: named<tNames<sdk.tArtistViews>>("views", ARTISTS, (a, id, name) => sdk.getArtistView(a.music, id, name, { with: ["attributes"], ...o(a) }), {
    "appears-on-albums": schemas.artistViewsArtistAppearsOnAlbumsView,
    "compilation-albums": schemas.artistViewsArtistCompilationAlbumsView,
    "featured-albums": schemas.artistViewsArtistFeaturedAlbumsView,
    "featured-music-videos": schemas.artistViewsArtistFeaturedMusicVideosView,
    "featured-playlists": schemas.artistViewsArtistFeaturedPlaylistsView,
    "full-albums": schemas.artistViewsArtistFullAlbumsView,
    "latest-release": schemas.artistViewsArtistLatestReleaseView,
    "live-albums": schemas.artistViewsArtistLiveAlbumsView,
    "similar-artists": schemas.artistViewsArtistSimilarArtistsView,
    singles: schemas.artistViewsArtistSinglesView,
    "top-music-videos": schemas.artistViewsArtistTopMusicVideosView,
    "top-songs": schemas.artistViewsArtistTopSongsView,
  }),
  getPlaylist: one(PLAYLISTS, (a, id) => sdk.getPlaylist(a.music, id, o(a)), schemas.playlistsResponse, GIVEN),
  getPlaylists: all(PLAYLISTS, (a, ids) => sdk.getPlaylists(a.music, ids, o(a)), schemas.playlistsResponse, GIVEN),
  getPlaylistsByStorefrontChart: all(STOREFRONTS, (a, ids) => sdk.getPlaylistsByStorefrontChart(a.music, ids, o(a)), schemas.playlistsResponse),
  getPlaylistRelationship: named<tNames<sdk.tPlaylistRelationships, "library">>("relationships", PLAYLISTS, (a, id, name) => sdk.getPlaylistRelationship(a.music, id, name, o(a)), {
    curator: schemas.playlistRelationshipsPlaylistCuratorRelationship,
    tracks: schemas.playlistRelationshipsPlaylistTracksRelationship,
  }),
  getPlaylistView: named<tNames<sdk.tPlaylistViews>>("views", PLAYLISTS, (a, id, name) => sdk.getPlaylistView(a.music, id, name, { with: ["attributes"], ...o(a) }), {
    "featured-artists": schemas.playlistViewsPlaylistFeaturedArtistsView,
    "more-by-curator": schemas.playlistViewsPlaylistMoreByCuratorView,
  }),
  getMusicVideo: one(MUSIC_VIDEOS, (a, id) => sdk.getMusicVideo(a.music, id, o(a)), schemas.musicVideosResponse, GIVEN),
  getMusicVideos: all(MUSIC_VIDEOS, (a, ids) => sdk.getMusicVideos(a.music, ids, o(a)), schemas.musicVideosResponse, GIVEN),
  getMusicVideosByIsrc: all(VIDEO_ISRCS, (a, isrcs) => sdk.getMusicVideosByIsrc(a.music, isrcs, o(a)), schemas.musicVideosResponse, GIVEN),
  getMusicVideosByEquivalents: all(MUSIC_VIDEOS, (a, ids) => sdk.getMusicVideosByEquivalents(a.music, ids, o(a)), schemas.musicVideosResponse),
  getMusicVideoRelationship: named<tNames<sdk.tMusicVideoRelationships, "library">>("relationships", MUSIC_VIDEOS, (a, id, name) => sdk.getMusicVideoRelationship(a.music, id, name, o(a)), {
    albums: schemas.musicVideoRelationshipsMusicVideoAlbumsRelationship,
    artists: schemas.musicVideoRelationshipsMusicVideoArtistsRelationship,
    genres: schemas.musicVideoRelationshipsMusicVideoGenresRelationship,
    songs: schemas.musicVideoRelationshipsMusicVideoSongsRelationship,
  }),
  getMusicVideoView: named<tNames<sdk.tMusicVideoViews>>("views", MUSIC_VIDEOS, (a, id, name) => sdk.getMusicVideoView(a.music, id, name, { with: ["attributes"], ...o(a) }), {
    "more-by-artist": schemas.musicVideoViewsMusicVideoMoreByArtistView,
    "more-in-genre": schemas.musicVideoViewsMusicVideoMoreInGenreView,
  }),
  getStation: one(STATIONS, (a, id) => sdk.getStation(a.music, id, o(a)), schemas.stationsResponse, GIVEN),
  getStations: all(STATIONS, (a, ids) => sdk.getStations(a.music, ids, o(a)), schemas.stationsResponse, GIVEN),
  getStationRelationship: named<tNames<sdk.tStationRelationships>>("relationships", STATIONS, (a, id, name) => sdk.getStationRelationship(a.music, id, name, o(a)), {
    "radio-show": schemas.stationRelationshipsStationRadioShowRelationship,
  }),
  getStationGenre: one(STATION_GENRES, (a, id) => sdk.getStationGenre(a.music, id, o(a)), schemas.stationGenresResponse, GIVEN),
  getStationGenres: all(STATION_GENRES, (a, ids) => sdk.getStationGenres(a.music, ids, o(a)), schemas.stationGenresResponse, GIVEN),
  listStationGenres: bare((a) => sdk.listStationGenres(a.music, o(a)), schemas.stationGenresResponse, { ...paged, holds: "the station genres" }),
  getStationGenreRelationship: named<tNames<sdk.tStationGenreRelationships>>("relationships", STATION_GENRES, (a, id, name) => sdk.getStationGenreRelationship(a.music, id, name, o(a)), {
    stations: schemas.stationGenreRelationshipsStationGenreStationsRelationship,
  }),
  getGenre: one(GENRES, (a, id) => sdk.getGenre(a.music, id, o(a)), schemas.genresResponse, GIVEN),
  getGenres: all(GENRES, (a, ids) => sdk.getGenres(a.music, ids, o(a)), schemas.genresResponse, GIVEN),
  listGenres: bare((a) => sdk.listGenres(a.music, o(a)), schemas.genresResponse, { ...paged, holds: "the genres" }),
  getCurator: one(CURATORS, (a, id) => sdk.getCurator(a.music, id, o(a)), schemas.curatorsResponse, GIVEN),
  getCurators: all(CURATORS, (a, ids) => sdk.getCurators(a.music, ids, o(a)), schemas.curatorsResponse, GIVEN),
  getCuratorRelationship: named<tNames<sdk.tCuratorRelationships>>("relationships", CURATORS, (a, id, name) => sdk.getCuratorRelationship(a.music, id, name, o(a)), {
    playlists: schemas.curatorRelationshipsCuratorPlaylistsRelationship,
  }),
  getAppleCurator: one(APPLE_CURATORS, (a, id) => sdk.getAppleCurator(a.music, id, o(a)), schemas.appleCuratorsResponse, GIVEN),
  getAppleCurators: all(APPLE_CURATORS, (a, ids) => sdk.getAppleCurators(a.music, ids, o(a)), schemas.appleCuratorsResponse, GIVEN),
  getAppleCuratorRelationship: named<tNames<sdk.tAppleCuratorRelationships>>("relationships", APPLE_CURATORS, (a, id, name) => sdk.getAppleCuratorRelationship(a.music, id, name, o(a)), {
    playlists: schemas.appleCuratorRelationshipsAppleCuratorPlaylistsRelationship,
  }),
  getActivity: one(ACTIVITIES, (a, id) => sdk.getActivity(a.music, id, o(a)), schemas.activitiesResponse, GIVEN),
  getActivities: all(ACTIVITIES, (a, ids) => sdk.getActivities(a.music, ids, o(a)), schemas.activitiesResponse, GIVEN),
  getActivityRelationship: named<tNames<sdk.tActivityRelationships>>("relationships", ACTIVITIES, (a, id, name) => sdk.getActivityRelationship(a.music, id, name, o(a)), {
    playlists: schemas.activityRelationshipsActivityPlaylistsRelationship,
  }),
  getRecordLabel: one(LABELS, (a, id) => sdk.getRecordLabel(a.music, id, o(a)), schemas.recordLabelsResponse, GIVEN),
  getRecordLabels: all(LABELS, (a, ids) => sdk.getRecordLabels(a.music, ids, o(a)), schemas.recordLabelsResponse, GIVEN),
  getRecordLabelView: named<tNames<sdk.tRecordLabelViews>>("views", LABELS, (a, id, name) => sdk.getRecordLabelView(a.music, id, name, { with: ["attributes"], ...o(a) }), {
    "latest-releases": schemas.recordLabelViewsRecordLabelLatestReleasesView,
    "top-releases": schemas.recordLabelViewsRecordLabelTopReleasesView,
  }),
  getStorefront: one(STOREFRONTS, (a, id) => sdk.getStorefront(a.music, id, o(a)), schemas.storefrontsResponse, GIVEN),
  getStorefronts: all(STOREFRONTS, (a, ids) => sdk.getStorefronts(a.music, ids, o(a)), schemas.storefrontsResponse, GIVEN),
  listStorefronts: bare((a) => sdk.listStorefronts(a.music, o(a)), schemas.storefrontsResponse, { ...paged, holds: "the storefronts" }),
  searchCatalog: one(
    TERMS,
    (a, term) =>
      sdk.searchCatalog(a.music, term, { types: ["activities", "albums", "apple-curators", "artists", "curators", "music-videos", "playlists", "record-labels", "songs", "stations"], with: ["topResults"], ...o(a) }),
    schemas.searchResponse,
  ),
  getSearchHints: one(TERMS, (a, term) => sdk.getSearchHints(a.music, term, o(a)), schemas.searchHintsResponse, { seen: (body) => list(at(body, "results", "terms")).length }),
  getSearchSuggestions: one(TERMS, (a, term) => sdk.getSearchSuggestions(a.music, term, { kinds: ["terms", "topResults"], types: ["songs", "albums", "artists"], ...o(a) }), schemas.searchSuggestionsResponse, {
    seen: (body) => list(at(body, "results", "suggestions")).length,
  }),
  getCharts: all(GENRES, (a, [genre]) => sdk.getCharts(a.music, { types: ["songs", "albums", "playlists", "music-videos"], genre, with: ["dailyGlobalTopCharts"], ...o(a) }), schemas.chartResponse),
  getCatalogResources: all(SONGS, async (a, songs) => sdk.getCatalogResources(a.music, { songs, albums: await ALBUMS.get(a) }, o(a)), schemas.resourceCollectionResponse, GIVEN),
  getLiveRadioStations: bare((a) => sdk.getLiveRadioStations(a.music, o(a)), schemas.stationsResponse),
  getLanguageTag: one(LANGUAGES, (a, tag) => sdk.getLanguageTag(a.music, [tag, "en"], o(a)), schemas.langageTagResponse, { seen: (body) => (text(at(body, "results", "tag")) === undefined ? 0 : 1) }),
} satisfies Record<keyof tCatalogFunctions, tEntry>;

/** Every function client-user exports: a key missing here, or one too many, is a type error. */
export const USER = {
  getLibrarySong: one(LIBRARY_SONGS, (a, id) => sdk.getLibrarySong(a.music, id, o(a)), schemas.librarySongsResponse, GIVEN),
  getLibrarySongs: all(LIBRARY_SONGS, (a, ids) => sdk.getLibrarySongs(a.music, ids, o(a)), schemas.librarySongsResponse, GIVEN),
  listLibrarySongs: bare((a) => sdk.listLibrarySongs(a.music, o(a)), schemas.librarySongsResponse, paged),
  getLibrarySongRelationship: named<tNames<sdk.tLibrarySongRelationships>>("relationships", LIBRARY_SONGS, (a, id, name) => sdk.getLibrarySongRelationship(a.music, id, name, o(a)), {
    albums: schemas.librarySongRelationshipsLibrarySongAlbumsRelationship,
    artists: schemas.librarySongRelationshipsLibrarySongArtistsRelationship,
    catalog: schemas.librarySongRelationshipsLibrarySongCatalogRelationship,
  }),
  getLibraryAlbum: one(LIBRARY_ALBUMS, (a, id) => sdk.getLibraryAlbum(a.music, id, o(a)), schemas.libraryAlbumsResponse, GIVEN),
  getLibraryAlbums: all(LIBRARY_ALBUMS, (a, ids) => sdk.getLibraryAlbums(a.music, ids, o(a)), schemas.libraryAlbumsResponse, GIVEN),
  listLibraryAlbums: bare((a) => sdk.listLibraryAlbums(a.music, o(a)), schemas.libraryAlbumsResponse, paged),
  getLibraryAlbumRelationship: named<tNames<sdk.tLibraryAlbumRelationships>>("relationships", LIBRARY_ALBUMS, (a, id, name) => sdk.getLibraryAlbumRelationship(a.music, id, name, o(a)), {
    artists: schemas.libraryAlbumRelationshipsLibraryAlbumArtistsRelationship,
    catalog: schemas.libraryAlbumRelationshipsLibraryAlbumCatalogRelationship,
    tracks: schemas.libraryAlbumRelationshipsLibraryAlbumTracksRelationship,
  }),
  getLibraryArtist: one(LIBRARY_ARTISTS, (a, id) => sdk.getLibraryArtist(a.music, id, o(a)), schemas.libraryArtistsResponse, GIVEN),
  getLibraryArtists: all(LIBRARY_ARTISTS, (a, ids) => sdk.getLibraryArtists(a.music, ids, o(a)), schemas.libraryArtistsResponse, GIVEN),
  listLibraryArtists: bare((a) => sdk.listLibraryArtists(a.music, o(a)), schemas.libraryArtistsResponse, paged),
  getLibraryArtistRelationship: named<tNames<sdk.tLibraryArtistRelationships>>("relationships", LIBRARY_ARTISTS, (a, id, name) => sdk.getLibraryArtistRelationship(a.music, id, name, o(a)), {
    albums: schemas.libraryArtistRelationshipsLibraryArtistAlbumsRelationship,
    catalog: schemas.libraryArtistRelationshipsLibraryArtistCatalogRelationship,
  }),
  getLibraryMusicVideo: one(LIBRARY_VIDEOS, (a, id) => sdk.getLibraryMusicVideo(a.music, id, o(a)), schemas.libraryMusicVideosResponse, GIVEN),
  getLibraryMusicVideos: all(LIBRARY_VIDEOS, (a, ids) => sdk.getLibraryMusicVideos(a.music, ids, o(a)), schemas.libraryMusicVideosResponse, GIVEN),
  listLibraryMusicVideos: bare((a) => sdk.listLibraryMusicVideos(a.music, o(a)), schemas.libraryMusicVideosResponse, paged),
  getLibraryMusicVideoRelationship: named<tNames<sdk.tLibraryMusicVideoRelationships>>("relationships", LIBRARY_VIDEOS, (a, id, name) => sdk.getLibraryMusicVideoRelationship(a.music, id, name, o(a)), {
    albums: schemas.libraryMusicVideoRelationshipsLibraryMusicVideoAlbumsRelationship,
    artists: schemas.libraryMusicVideoRelationshipsLibraryMusicVideoArtistsRelationship,
    catalog: schemas.libraryMusicVideoRelationshipsLibraryMusicVideoCatalogRelationship,
  }),
  getLibraryPlaylist: one(LIBRARY_PLAYLISTS, (a, id) => sdk.getLibraryPlaylist(a.music, id, o(a)), schemas.libraryPlaylistsResponse, GIVEN),
  getLibraryPlaylists: all(LIBRARY_PLAYLISTS, (a, ids) => sdk.getLibraryPlaylists(a.music, ids, o(a)), schemas.libraryPlaylistsResponse, GIVEN),
  listLibraryPlaylists: bare((a) => sdk.listLibraryPlaylists(a.music, o(a)), schemas.libraryPlaylistsResponse, paged),
  getLibraryPlaylistRelationship: named<tNames<sdk.tLibraryPlaylistRelationships>>("relationships", LIBRARY_PLAYLISTS, (a, id, name) => sdk.getLibraryPlaylistRelationship(a.music, id, name, o(a)), {
    catalog: schemas.libraryPlaylistRelationshipsLibraryPlaylistCatalogRelationship,
    tracks: schemas.libraryPlaylistRelationshipsLibraryPlaylistTracksRelationship,
  }),
  createLibraryPlaylist: check("playlist"),
  getLibraryPlaylistFolder: one(SOME_FOLDERS, (a, id) => sdk.getLibraryPlaylistFolder(a.music, id, o(a)), schemas.libraryPlaylistFoldersResponse),
  getLibraryPlaylistFolders: all(SOME_FOLDERS, (a, ids) => sdk.getLibraryPlaylistFolders(a.music, ids, o(a)), schemas.libraryPlaylistFoldersResponse),
  getLibraryPlaylistFolderRelationship: named<tNames<sdk.tLibraryPlaylistFolderRelationships>>(
    "relationships",
    ROOT,
    (a, id, name) => sdk.getLibraryPlaylistFolderRelationship(a.music, id, name, o(a)),
    {
      children: schemas.libraryPlaylistFolderRelationshipsLibraryPlaylistFolderChildrenRelationship,
      parent: schemas.libraryPlaylistFolderRelationshipsLibraryPlaylistFolderParentRelationship,
    },
    // The root has no parent, so the parent is asked of a folder in it.
    { parent: FOLDERS },
  ),
  createLibraryPlaylistFolder: check("createLibraryPlaylistFolder"),
  getPersonalRecommendation: one(RECOMMENDATIONS, (a, id) => sdk.getPersonalRecommendation(a.music, id, o(a)), schemas.personalRecommendationResponse, GIVEN),
  getPersonalRecommendations: all(RECOMMENDATIONS, (a, ids) => sdk.getPersonalRecommendations(a.music, ids, o(a)), schemas.personalRecommendationResponse, GIVEN),
  listPersonalRecommendations: bare((a) => sdk.listPersonalRecommendations(a.music, o(a)), schemas.personalRecommendationResponse, paged),
  getPersonalRecommendationRelationship: named<tNames<sdk.tPersonalRecommendationRelationships>>("relationships", RECOMMENDATIONS, (a, id, name) => sdk.getPersonalRecommendationRelationship(a.music, id, name, o(a)), {
    contents: schemas.personalRecommendationRelationshipsPersonalRecommendationContentsRelationship,
  }),
  searchLibrary: one(LIBRARY_TERMS, (a, term) => sdk.searchLibrary(a.music, term, { types: ["library-albums", "library-artists", "library-music-videos", "library-playlists", "library-songs"], ...o(a) }), schemas.librarySearchResponse),
  getLibraryResources: all(LIBRARY_SONGS, async (a, songs) => sdk.getLibraryResources(a.music, { "library-songs": songs, "library-playlists": await LIBRARY_PLAYLISTS.get(a) }, o(a)), schemas.resourceCollectionResponse, GIVEN),
  addToLibrary: check("add-to-library"),
  addToFavorites: check("add-to-favorites"),
  addLibraryPlaylistTracks: check("playlist"),
  // The root is always there, and client-user's bound form rejects an answer without it.
  getRootLibraryPlaylistFolder: bare((a) => sdk.getRootLibraryPlaylistFolder(a.music, o(a)), schemas.libraryPlaylistFoldersResponse, { holds: "the listener's root folder" }),
  listRecentlyAdded: bare((a) => sdk.listRecentlyAdded(a.music, o(a)), schemas.resourceCollectionResponse, paged),
  listHeavyRotation: bare((a) => sdk.listHeavyRotation(a.music, o(a)), schemas.paginatedResourceCollectionResponse, paged),
  listRecentlyPlayed: bare((a) => sdk.listRecentlyPlayed(a.music, o(a)), schemas.paginatedResourceCollectionResponse, paged),
  listRecentlyPlayedTracks: bare((a) => sdk.listRecentlyPlayedTracks(a.music, o(a)), schemas.paginatedResourceCollectionResponse, paged),
  listRecentlyPlayedStations: bare((a) => sdk.listRecentlyPlayedStations(a.music, o(a)), schemas.paginatedResourceCollectionResponse, paged),
  getMusicSummariesByYear: bare((a) => sdk.getMusicSummariesByYear(a.music, ["latest"], { views: ["top-albums", "top-artists", "top-songs"], ...o(a) }), schemas.musicSummariesResponse),
  getPersonalStation: bare((a) => sdk.getPersonalStation(a.music, o(a)), schemas.stationsResponse),
  getUserStorefront: bare((a) => sdk.getUserStorefront(a.music, o(a)), schemas.storefrontsResponse, { holds: "the listener's storefront" }),
  // Each rating function is its type's round trip, run only with --write: in a read run, a rating's answer would say
  // whether the listener rated a song anyone can name.
  ...ratingEntries("Song"),
  ...ratingEntries("Album"),
  ...ratingEntries("MusicVideo"),
  ...ratingEntries("Playlist"),
  ...ratingEntries("Station"),
  ...ratingEntries("LibrarySong"),
  ...ratingEntries("LibraryAlbum"),
  ...ratingEntries("LibraryMusicVideo"),
  ...ratingEntries("LibraryPlaylist"),
} satisfies Record<keyof tUserFunctions, tEntry>;

/** The types a listener rates. */
type tRatedType = "Song" | "Album" | "MusicVideo" | "Playlist" | "Station" | "LibrarySong" | "LibraryAlbum" | "LibraryMusicVideo" | "LibraryPlaylist";

/** A rated type's four functions, each its round trip. */
function ratingEntries<T extends tRatedType>(type: T) {
  const trip = check(`set${type}Rating`);
  return { [`get${type}Rating`]: trip, [`get${type}Ratings`]: trip, [`set${type}Rating`]: trip, [`delete${type}Rating`]: trip } as Record<`${"get" | "set" | "delete"}${T}Rating` | `get${T}Ratings`, typeof trip>;
}

/** What one of a run's rating round trips is asked of: what it rates, by the id the ratings go by, and the catalog's twin of a library item. */
interface tRatable {
  readonly item: tItem;
  readonly id: string;
  /** For a library item, the catalog item it is a copy of, whose rating is looked at too. */
  readonly catalog?: string | undefined;
}

type tGet = (music: sdk.tMusic, id: string, options: { readonly signal: AbortSignal }) => Promise<unknown>;
type tGets = (music: sdk.tMusic, ids: readonly string[], options: { readonly signal: AbortSignal }) => Promise<unknown>;
type tSet = (music: sdk.tMusic, id: string, value: -1, options: { readonly signal: AbortSignal }) => Promise<unknown>;
type tDelete = (music: sdk.tMusic, id: string, options?: { readonly signal?: AbortSignal }) => Promise<unknown>;

/** A rating as Apple answers for it, if at all. */
interface tRating {
  /** Whether Apple answered with a rating, whatever it holds: a rating there in a shape not foreseen is still one. */
  readonly held: boolean;
  readonly value: unknown;
  readonly body: unknown;
}
const NONE: tRating = { held: false, value: undefined, body: undefined };

/** The rating Apple answers with, or none: a 404, as a rating never set answered on 18 October 2026, or an empty list. */
async function ratingIn(get: () => Promise<unknown>): Promise<tRating> {
  try {
    const body = await get();
    const [first] = list(at(body, "data"));
    return { held: first !== undefined, value: at(first, "attributes", "value"), body };
  } catch (e) {
    if (isNotFound(e)) return NONE;
    throw e;
  }
}

/** The first of `items` that is unrated, and not in the library either where it can be: a rating set on it takes away nothing the listener had. */
async function unrated(r: tRun, items: readonly tItem[], get: tGet, library: boolean): Promise<tRatable | string> {
  for (const item of items.slice(0, 5)) {
    if (library && (await inLibrary(r, item))) continue;
    if (!(await ratingIn(() => get(r.music, item.id, { signal: r.signal }))).held) return { item, id: item.id };
  }
  return "none of the chart's could be picked";
}

/** One of the run's own additions to the library, by its library id, once it shows there. */
async function ownCopy(r: tRun, type: "songs" | "albums" | "music-videos"): Promise<tRatable | string> {
  const addition = await added(r, type);
  if (addition === undefined) return `none of the chart's ${type} could be picked to add to your library`;
  if ("refused" in addition) return `Apple refused to add one to your library: ${addition.refused}`;
  const { id } = await shown(r, addition);
  return id === undefined ? `the ${type} added did not show in your library within a minute` : { item: addition.item, id, catalog: addition.item.id };
}

/** The run's own empty playlist, once it can be read by its id. */
async function ownPlaylistCopy(r: tRun): Promise<tRatable | string> {
  const id = await ownPlaylist(r);
  if (id === undefined) return "the answer to making a playlist held none to rate";
  const readable = await seconds(r, "the new playlist to be read by its id", async () => (await sdk.getLibraryPlaylist(r.music, id, { signal: r.signal }), true));
  return readable === undefined ? "the playlist made could not be read by its id within a minute" : { item: { type: "playlists", id, name: `${r.name} (for a rating)`, by: undefined, url: undefined, attributes: undefined }, id };
}

/**
 * A rating's round trip: a dislike set on something the listener had not rated, read back alone and in a batch, and
 * taken away again, each answer held to its type. The rating is recorded before it is set, and the run takes away
 * any it ends with, through the API, before it prints the cleanup.
 */
function ratingTrip(type: tRatedType, fns: { readonly get: tGet; readonly gets: tGets; readonly set: tSet; readonly del: tDelete }, pick: (r: tRun) => Promise<tRatable | string>, twin?: { readonly get: tGet; readonly del: tDelete }): tCheck {
  return {
    id: `set${type}Rating`,
    pkg: "client-user",
    about: `A dislike set, read back alone and in a batch, and taken away, on ${type.startsWith("Library") ? "something check added to your library" : "something you had not rated"}`,
    writes: true,
    run: async (r) => {
      const picked = await pick(r);
      if (typeof picked === "string") {
        r.line("skipped", picked);
        return;
      }
      const { item, id } = picked;
      const signal = { signal: r.signal };
      // A library copy's rating may be its catalog item's too. The copy was added as one the listener had not rated,
      // and is not rated if its catalog item now is: a rating set on it, and taken away, could take theirs with it.
      const catalog = twin === undefined ? undefined : picked.catalog;
      if (twin !== undefined && catalog !== undefined && (await ratingIn(() => twin.get(r.music, catalog, signal))).held) {
        r.line("skipped", "the catalog item of what check added is rated, so its copy is not: a rating of the one may be the other's");
        return;
      }
      const rated = { what: item, sure: false, undo: () => fns.del(r.music, id) };
      r.left.ratings.push(rated);
      let set: unknown;
      try {
        set = await fns.set(r.music, id, -1, signal);
      } catch (e) {
        if (!refused(e)) throw e;
        // Refused, so nothing was set: there is nothing to take away.
        r.left.ratings.splice(r.left.ratings.indexOf(rated), 1);
        r.line("failed", `Apple refused a rating of -1: ${brief(e)} (at ${whereOf(e)}).`);
        return;
      }
      rated.sure = true;
      const diffs: tDiff[] = [];
      if (resourcesIn(set) > 0) diffs.push(...diffsOf(schemas.ratingsResponse, set));
      let alone = NONE;
      const showed = await seconds(r, "the rating to show", async () => (alone = await ratingIn(() => fns.get(r.music, id, signal))).held);
      if (alone.body !== undefined) diffs.push(...diffsOf(schemas.ratingsResponse, alone.body));
      const batch = await ratingIn(() => fns.gets(r.music, [id], signal));
      if (batch.body !== undefined) diffs.push(...diffsOf(schemas.ratingsResponse, batch.body));
      const linked = twin === undefined || catalog === undefined ? undefined : (await ratingIn(() => twin.get(r.music, catalog, signal))).value;

      await fns.del(r.music, id, signal);
      const gone = await seconds(r, "the rating to be taken away", async () => !(await ratingIn(() => fns.get(r.music, id, signal))).held);
      if (gone !== undefined) r.left.ratings.splice(r.left.ratings.indexOf(rated), 1);
      if (diffs.length > 0) r.line("differs", `types: ${someOf(diffs)}.`);

      const wrong = [
        showed === undefined ? "it did not show within a minute" : alone.value === -1 ? undefined : `it was read back as ${printable(String(alone.value))}`,
        batch.value === -1 ? undefined : "a batch of its ratings left it out",
        gone === undefined ? "it was still there a minute after it was taken away" : undefined,
      ].filter(defined);
      if (wrong.length === 0) r.line("same", `a rating of -1 was set, and read back alone and in a batch after ${took(showed)}, and was gone after ${took(gone)} once taken away, as client-user has it.`);
      else r.line("differs", `a rating of -1 was set, but ${wrong.join("; ")}.`);

      // Whether the copy's rating was its catalog item's too, which had none before: one it still has is the run's,
      // and the run takes it away itself.
      if (twin !== undefined && catalog !== undefined) {
        const after = (await ratingIn(() => twin.get(r.music, catalog, signal))).held;
        r.line("report", `the catalog item it is a copy of ${linked === -1 ? "took the rating too" : "did not take the rating"}${after ? ", and kept it once the copy's was taken away" : ""}.`);
        if (after) r.left.ratings.push({ what: item, sure: true, undo: () => twin.del(r.music, catalog) });
      }
    },
  };
}

const chartItems = (pick: (charts: Awaited<ReturnType<tRun["charts"]>>) => readonly tItem[]) => async (r: tRun) => pick(await r.charts());

/** Every rating round trip, by the name of its setter. */
export const TRIPS: readonly tCheck[] = [
  ratingTrip("Song", { get: sdk.getSongRating, gets: sdk.getSongRatings, set: sdk.setSongRating, del: sdk.deleteSongRating }, async (r) => unrated(r, await chartItems((c) => c.songs)(r), sdk.getSongRating, true)),
  ratingTrip("Album", { get: sdk.getAlbumRating, gets: sdk.getAlbumRatings, set: sdk.setAlbumRating, del: sdk.deleteAlbumRating }, async (r) => unrated(r, await chartItems((c) => c.albums)(r), sdk.getAlbumRating, true)),
  ratingTrip("MusicVideo", { get: sdk.getMusicVideoRating, gets: sdk.getMusicVideoRatings, set: sdk.setMusicVideoRating, del: sdk.deleteMusicVideoRating }, async (r) =>
    unrated(r, await chartItems((c) => c.musicVideos)(r), sdk.getMusicVideoRating, true),
  ),
  ratingTrip("Playlist", { get: sdk.getPlaylistRating, gets: sdk.getPlaylistRatings, set: sdk.setPlaylistRating, del: sdk.deletePlaylistRating }, async (r) =>
    unrated(r, await chartItems((c) => c.playlists)(r), sdk.getPlaylistRating, true),
  ),
  // A station is never in a library.
  ratingTrip("Station", { get: sdk.getStationRating, gets: sdk.getStationRatings, set: sdk.setStationRating, del: sdk.deleteStationRating }, async (r) => unrated(r, await stations(r), sdk.getStationRating, false)),
  ratingTrip("LibrarySong", { get: sdk.getLibrarySongRating, gets: sdk.getLibrarySongRatings, set: sdk.setLibrarySongRating, del: sdk.deleteLibrarySongRating }, (r) => ownCopy(r, "songs"), {
    get: sdk.getSongRating,
    del: sdk.deleteSongRating,
  }),
  ratingTrip("LibraryAlbum", { get: sdk.getLibraryAlbumRating, gets: sdk.getLibraryAlbumRatings, set: sdk.setLibraryAlbumRating, del: sdk.deleteLibraryAlbumRating }, (r) => ownCopy(r, "albums"), {
    get: sdk.getAlbumRating,
    del: sdk.deleteAlbumRating,
  }),
  ratingTrip(
    "LibraryMusicVideo",
    { get: sdk.getLibraryMusicVideoRating, gets: sdk.getLibraryMusicVideoRatings, set: sdk.setLibraryMusicVideoRating, del: sdk.deleteLibraryMusicVideoRating },
    (r) => ownCopy(r, "music-videos"),
    { get: sdk.getMusicVideoRating, del: sdk.deleteMusicVideoRating },
  ),
  ratingTrip("LibraryPlaylist", { get: sdk.getLibraryPlaylistRating, gets: sdk.getLibraryPlaylistRatings, set: sdk.setLibraryPlaylistRating, del: sdk.deleteLibraryPlaylistRating }, ownPlaylistCopy),
  {
    id: "createLibraryPlaylistFolder",
    pkg: "client-user",
    about: "A playlist folder made in the root folder, read back, and its parent asked for",
    writes: true,
    run: folderTrip,
  },
];

/** A folder made, read back by its id and among the root's children, and its parent asked for, each answer held to its type. */
async function folderTrip(r: tRun): Promise<void> {
  const signal = { signal: r.signal };
  const name = r.name;
  const made = { what: name, sure: false };
  r.left.folders.push(made);
  let answer: unknown;
  try {
    answer = await sdk.createLibraryPlaylistFolder(r.music, { attributes: { name } }, signal);
  } catch (e) {
    if (!refused(e)) throw e;
    r.left.folders.splice(r.left.folders.indexOf(made), 1);
    r.line("failed", `Apple refused to make a playlist folder: ${brief(e)} (at ${whereOf(e)}).`);
    return;
  }
  made.sure = true;
  const madeAt = Date.now();
  const diffs = [...diffsOf(schemas.libraryPlaylistFoldersResponse, answer)];
  const id = idOf(list(at(answer, "data"))[0]);
  if (id === undefined) {
    r.line("skipped", "the answer to making a playlist folder held none, so nothing more can be asked of it");
    return;
  }
  let folder: unknown;
  const readable = await seconds(r, "the new folder to be read by its id", async () => ((folder = await sdk.getLibraryPlaylistFolder(r.music, id, signal)), true), madeAt);
  if (readable !== undefined) diffs.push(...diffsOf(schemas.libraryPlaylistFoldersResponse, folder));
  const root = await rootOf(r);
  let parent: string | undefined;
  if (readable !== undefined) {
    const body = await sdk.getLibraryPlaylistFolderRelationship(r.music, id, "parent", signal);
    diffs.push(...diffsOf(schemas.libraryPlaylistFolderRelationshipsLibraryPlaylistFolderParentRelationship, body));
    parent = idsIn(body)[0];
  }
  const listed = await seconds(r, "the new folder to be among the root folder's", async () => (await idsOf(sdk.getLibraryPlaylistFolderRelationship(r.music, root, "children", { limit: 100, ...signal }))).includes(id), madeAt);
  if (diffs.length > 0) r.line("differs", `types: ${someOf(diffs)}.`);
  const wrong = [
    readable === undefined ? "it could not be read by its id within a minute" : undefined,
    listed === undefined ? "it was not among the root folder's children within a minute" : undefined,
    readable !== undefined && parent !== root ? "its parent was not the root folder" : undefined,
  ].filter(defined);
  if (wrong.length === 0) r.line("same", `a folder was made, could be read by its id after ${took(readable)}, was among the root folder's children after ${took(listed)}, and has the root for its parent.`);
  else r.line("differs", `a folder was made, but ${wrong.join("; ")}.`);
}

/** Every row of the sweep, by package and function, in the order a run prints them. */
export const ROWS: readonly { readonly pkg: "client-catalog" | "client-user"; readonly fn: string; readonly entry: tEntry }[] = [
  ...Object.entries(CATALOG).map(([fn, entry]) => ({ pkg: "client-catalog" as const, fn, entry })),
  ...Object.entries(USER).map(([fn, entry]) => ({ pkg: "client-user" as const, fn, entry })),
];

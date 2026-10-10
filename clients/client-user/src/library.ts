// The functions for a listener's endpoints that follow no pattern: the library searched and asked for by type,
// what is added to it, the root of its playlist folders, what the listener has played and added lately, their
// replay, their own station, and their storefront.
import {
  endpoint,
  got,
  initOf,
  listOf,
  optionsOf,
  resourceLister,
  resourcesFinder,
  segmentOf,
  typedIdsOf,
  type tNone,
  type tReadOptions,
  type tRequestPlan,
} from "@open-music-sdk/core";
import type {
  tLibraryPlaylistFoldersResponse,
  tLibraryPlaylistTracksRequest,
  tLibraryPlaylistTracksRequestData,
  tLibrarySearchResponse,
  tLibrarySearchResponseResults,
  tMusicSummariesResponse,
  tMusicSummaryViews,
  tPaginatedResourceCollectionResponse,
  tResourceCollectionResponse,
  tStationsResponse,
  tStorefrontsResponse,
} from "@open-music-sdk/types";

const OPTIONS = "an options object";
/** Longer than anything typed into a search box. What is searched for is sent in the URL, so it is not left open. */
const MAX_TERM = 256;
/** The most Apple documents taking in one request. Each track is a part of the body, so the list is not left open. */
const MAX_TRACKS = 300;
/** As long as an id or a type's name may be anywhere else: longer than any of Apple's, and shorter than a token. */
const MAX_NAME = 64;

/** The text to search for, as the caller gave it: a string with something in it. */
function termOf(fn: string, term: unknown): string {
  if (typeof term === "string" && term !== "" && term.length <= MAX_TERM) return term;
  throw new TypeError(`${fn}: term must be a string of 1 to ${String(MAX_TERM)} characters; got ${got(term)}`);
}

/** A type of resource a search of the library can look for. */
export type tLibrarySearchType = keyof tLibrarySearchResponseResults;

/** The options of `searchLibrary`. */
export interface tSearchLibraryOptions extends tReadOptions<tLibrarySearchResponse> {
  /** The types of resource to look for, such as `["library-songs", "library-albums"]`. There is no default: Apple wants one at least. */
  readonly types: readonly tLibrarySearchType[];
}

/**
 * Searches the listener's library for a term, and resolves to the results by type, each one a first page. `limit`
 * and `offset` apply to every type asked for.
 */
export const searchLibrary = /*#__PURE__*/ endpoint("searchLibrary", "answer", (_client, term: string, options: tSearchLibraryOptions): tRequestPlan<tLibrarySearchResponse> => {
  const text = termOf("searchLibrary", term);
  const bag = optionsOf("searchLibrary", options, OPTIONS);
  return ["v1/me/library/search", initOf<tLibrarySearchResponse>("searchLibrary", bag, { term: text, types: listOf("searchLibrary", "types", bag.types) })];
});

/** A type of resource the library can be asked for by id, beside others. */
export type tLibraryType = "library-albums" | "library-artists" | "library-music-videos" | "library-playlist-folders" | "library-playlists" | "library-songs";

/** Ids by type of library resource, such as `{ "library-songs": ["i.1"], "library-albums": ["l.2"] }`. */
export type tLibraryIds = Readonly<Partial<Record<tLibraryType, readonly string[] | undefined>>>;

/** The options of `getLibraryResources`. */
export type tLibraryResourcesOptions = tReadOptions<tResourceCollectionResponse>;

/** Library resources of several types in one request, by their ids: `{ "library-songs": [...] }`. One type at least has to be given. */
export const getLibraryResources = /*#__PURE__*/ endpoint("getLibraryResources", "resources", (_client, ids: tLibraryIds, options?: tLibraryResourcesOptions): tRequestPlan<tResourceCollectionResponse> => {
  const lists = typedIdsOf("getLibraryResources", "ids", ids);
  return ["v1/me/library", initOf<tResourceCollectionResponse>("getLibraryResources", optionsOf("getLibraryResources", options, OPTIONS), lists)];
});

/**
 * Ids by type of catalog resource, such as `{ songs: ["1"], albums: ["2"] }`. Apple does not list the types a
 * library or the favorites take, so a type is any name here, and Apple says whether it is one.
 */
export type tAddedIds = Readonly<Partial<Record<"albums" | "music-videos" | "playlists" | "songs", readonly string[] | undefined>> & Record<string, readonly string[] | undefined>>;

/** The options of a function that adds to what the listener has. Apple answers with nothing, so there is nothing for a `schema` to check. */
export type tAddOptions = tReadOptions<void>;

/** Adds catalog resources to the listener's library, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards. */
export const addToLibrary = /*#__PURE__*/ endpoint("addToLibrary", "answer", (_client, ids: tAddedIds, options?: tAddOptions): tRequestPlan<void> => {
  const lists = typedIdsOf("addToLibrary", "ids", ids);
  return ["v1/me/library", { ...initOf("addToLibrary", optionsOf("addToLibrary", options, OPTIONS), lists), method: "POST" }];
});

/** Adds resources to the listener's favorites, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards. */
export const addToFavorites = /*#__PURE__*/ endpoint("addToFavorites", "answer", (_client, ids: tAddedIds, options?: tAddOptions): tRequestPlan<void> => {
  const lists = typedIdsOf("addToFavorites", "ids", ids);
  return ["v1/me/favorites", { ...initOf("addToFavorites", optionsOf("addToFavorites", options, OPTIONS), lists), method: "POST" }];
});

/** A track to add to a playlist: its id, and whether it is a song or a music video, of the catalog or of the library. */
export type tPlaylistTrack = tLibraryPlaylistTracksRequestData;

const isName = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= MAX_NAME;

/** The tracks to add, as this call's own list of `{ id, type }` and nothing else of what each one held. */
function tracksOf(fn: string, tracks: unknown): tPlaylistTrack[] {
  const length: unknown = Array.isArray(tracks) ? tracks.length : undefined;
  const given = typeof length === "number" && length >= 1 && length <= MAX_TRACKS ? Array.from({ length }, (_, index) => (tracks as readonly unknown[])[index]) : [];
  const own = given.map((track) => {
    const { id, type } = (typeof track === "object" && track !== null ? track : {}) as { id?: unknown; type?: unknown };
    return isName(id) && isName(type) ? ({ id, type } as tPlaylistTrack) : undefined;
  });
  const bad = own.indexOf(undefined);
  if (own.length > 0 && bad === -1) return own as tPlaylistTrack[];
  const what = typeof length !== "number" ? got(tracks) : bad === -1 ? `a list of ${String(length)}` : `${got(given[bad])} at index ${String(bad)}`;
  throw new TypeError(
    `${fn}: tracks must be a list of 1 to ${String(MAX_TRACKS)} tracks, each an object with an id and a type that are strings of 1 to ${String(MAX_NAME)} characters, such as { id: "1", type: "songs" }; got ${what}`,
  );
}

/** Adds tracks to the end of a playlist in the listener's library: `[{ id, type: "songs" }]`. It resolves to nothing. */
export const addLibraryPlaylistTracks = /*#__PURE__*/ endpoint(
  "addLibraryPlaylistTracks",
  "answer",
  (_client, id: string, tracks: readonly tPlaylistTrack[], options?: tAddOptions): tRequestPlan<void> => {
    const segment = segmentOf("addLibraryPlaylistTracks", "id", id);
    const body: tLibraryPlaylistTracksRequest = { data: tracksOf("addLibraryPlaylistTracks", tracks) };
    const init = initOf("addLibraryPlaylistTracks", optionsOf("addLibraryPlaylistTracks", options, OPTIONS));
    return [`v1/me/library/playlists/${segment}/tracks`, { ...init, method: "POST", body }];
  },
);

/** The options of `getRootLibraryPlaylistFolder`. */
export type tRootLibraryPlaylistFolderOptions = tReadOptions<tLibraryPlaylistFoldersResponse>;

/** The folder every playlist and playlist folder of the listener's library is in, at the top: where to start going down from. */
export const getRootLibraryPlaylistFolder = /*#__PURE__*/ endpoint(
  "getRootLibraryPlaylistFolder",
  "resource",
  (_client, options?: tRootLibraryPlaylistFolderOptions): tRequestPlan<tLibraryPlaylistFoldersResponse> => [
    "v1/me/library/playlist-folders",
    initOf<tLibraryPlaylistFoldersResponse>("getRootLibraryPlaylistFolder", optionsOf("getRootLibraryPlaylistFolder", options, OPTIONS), { "filter[identity]": "playlistsroot" }),
  ],
);

/** What the listener added to their library lately, newest first, a page at a time. */
export const listRecentlyAdded = /*#__PURE__*/ resourceLister<tResourceCollectionResponse>("listRecentlyAdded", () => "v1/me/library/recently-added");

/** What the listener plays most at present, a page at a time. */
export const listHeavyRotation = /*#__PURE__*/ resourceLister<tPaginatedResourceCollectionResponse>("listHeavyRotation", () => "v1/me/history/heavy-rotation");

/** The option of `listRecentlyPlayed`: which types of what was played. */
export interface tRecentlyPlayedTypesOption {
  /** The types of resource to keep to, such as `["albums", "playlists"]`. Apple's documentation says to name one at least. */
  readonly types?: readonly ("albums" | "artists" | "curators" | "library-albums" | "library-playlists" | "playlists" | "stations")[] | undefined;
}

/** What the listener played lately, newest first, a page at a time: the albums, playlists and stations, not the tracks in them. */
export const listRecentlyPlayed = /*#__PURE__*/ resourceLister<tPaginatedResourceCollectionResponse, tNone, tRecentlyPlayedTypesOption>("listRecentlyPlayed", () => "v1/me/recent/played", { types: true });

/** The option of `listRecentlyPlayedTracks`: which types of track. */
export interface tRecentlyPlayedTrackTypesOption {
  /** The types of track to keep to, such as `["songs"]`. Apple's documentation says to name one at least. */
  readonly types?: readonly tPlaylistTrack["type"][] | undefined;
}

/** The tracks the listener played lately, newest first, a page at a time. */
export const listRecentlyPlayedTracks = /*#__PURE__*/ resourceLister<tPaginatedResourceCollectionResponse, tNone, tRecentlyPlayedTrackTypesOption>(
  "listRecentlyPlayedTracks",
  () => "v1/me/recent/played/tracks",
  { types: true },
);

/** The radio stations the listener played lately, newest first, a page at a time. */
export const listRecentlyPlayedStations = /*#__PURE__*/ resourceLister<tPaginatedResourceCollectionResponse>("listRecentlyPlayedStations", () => "v1/me/recent/radio-stations");

/** The option of `getMusicSummariesByYear`: which views to send with each summary. */
export interface tMusicSummaryViewsOption {
  /** The views to send with each summary, by name, such as `["top-songs"]`. Default: none. */
  readonly views?: readonly (keyof tMusicSummaryViews)[] | undefined;
}

/** The listener's replay: a summary of what they played in each of the years given. The one year Apple takes at present is `"latest"`. */
export const getMusicSummariesByYear = /*#__PURE__*/ resourcesFinder<tMusicSummariesResponse, tNone, tMusicSummaryViewsOption>("getMusicSummariesByYear", "year", () => "v1/me/music-summaries", { views: true });

/** The options of `getPersonalStation`. */
export interface tPersonalStationOptions extends tReadOptions<tStationsResponse> {
  /** The storefront whose catalog the station is in, by its id, such as `"gb"`. Default: the client's, which is the one it was created with, or else the listener's. */
  readonly storefront?: string | undefined;
}

/**
 * The listener's own station, which plays what Apple picks for them. It is kept in the catalog, and is the one
 * resource there that is asked for with the Music User Token.
 */
export const getPersonalStation = /*#__PURE__*/ endpoint("getPersonalStation", "resource", (client, options?: tPersonalStationOptions) => {
  const bag = optionsOf("getPersonalStation", options, OPTIONS);
  const init = { ...initOf<tStationsResponse>("getPersonalStation", bag, { "filter[identity]": "personal" }), user: true };
  // One segment of a path, checked and encoded, so a storefront from outside cannot send the listener's token to another path.
  const stations = (storefront: unknown): tRequestPlan<tStationsResponse> => [`v1/catalog/${segmentOf("getPersonalStation", "storefront", storefront)}/stations`, init];
  // Which storefront is the client's may mean asking Apple, and is left for when the request is about to be made.
  return bag.storefront === undefined ? () => client.storefront().then(stations) : stations(bag.storefront);
});

/** The options of `getUserStorefront`. */
export type tUserStorefrontOptions = tReadOptions<tStorefrontsResponse>;

/** The storefront the listener's account is in: the one whose catalog they see. */
export const getUserStorefront = /*#__PURE__*/ endpoint("getUserStorefront", "resource", (_client, options?: tUserStorefrontOptions): tRequestPlan<tStorefrontsResponse> => [
  "v1/me/storefront",
  initOf<tStorefrontsResponse>("getUserStorefront", optionsOf("getUserStorefront", options, OPTIONS)),
]);

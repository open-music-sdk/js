// The functions for the catalog's resources, each declared once by the pattern its endpoint follows: the resource
// with an id, the resources with some ids, the ones a filter picks out, a whole collection, a resource's
// relationship, and a resource's view. A function is named for the generated type it is about: `getSong` and `tSong`.
import {
  endpoint,
  optionsOf,
  relationshipGetter,
  resourceGetter,
  resourceLister,
  resourcesFinder,
  resourcesGetter,
  segmentOf,
  type tAppleMusicClient,
  type tEndpointOptions,
  type tRelated,
  type tRequestPlan,
  type tWalkOptions,
  walkOf,
} from "@open-music-sdk/core";
import type {
  tActivitiesResponse,
  tActivityRelationships,
  tAlbumRelationships,
  tAlbumsResponse,
  tAlbumViews,
  tAppleCuratorRelationships,
  tAppleCuratorsResponse,
  tArtistRelationships,
  tArtistsResponse,
  tArtistViews,
  tCuratorRelationships,
  tCuratorsResponse,
  tGenresResponse,
  tMusicVideoRelationships,
  tMusicVideosResponse,
  tMusicVideoViews,
  tPlaylistRelationships,
  tPlaylistsResponse,
  tPlaylistViews,
  tRecordLabelsResponse,
  tRecordLabelViews,
  tRelationshipViewResponse,
  tSongRelationships,
  tSongsResponse,
  tStationGenreRelationships,
  tStationGenresResponse,
  tStationRelationships,
  tStationsResponse,
  tStorefrontsResponse,
} from "@open-music-sdk/types";
import { NO_LISTENER, catalogOf, inStorefront, storefronts, type tStorefrontOption } from "./storefront";

/** The option of a function for a resource that has views: which of them to send with the resource. */
export interface tViewsOption<Views> {
  /** The views to send with the resource, by name, such as `["top-songs"]`. Default: none. */
  readonly views?: readonly (keyof Views & string)[] | undefined;
}

/** The option of a function that looks for equivalents: what to leave out of them. */
export interface tRestrictOption {
  /** What to leave out of the answer: `["explicit"]` for explicit content. Default: nothing. */
  readonly restrict?: readonly "explicit"[] | undefined;
}

/** The option of a function for a view: what to send beside its resources. */
export interface tWithOption {
  /** What to send beside the resources: `["attributes"]` for the view's own, such as its title. Default: nothing. */
  readonly with?: readonly "attributes"[] | undefined;
}

/** What Apple answers when a view is asked for by name: a page of what it holds. */
export type tViewPage<Views, K extends keyof Views> = Omit<tRelationshipViewResponse, "data"> & { data: tRelated<Views, K>[] };

/** The options of a function for a view. */
export type tViewOptions<Views, K extends keyof Views> = tEndpointOptions<tViewPage<Views, K>, tStorefrontOption, tWithOption> & tWalkOptions;

/**
 * A function for a resource's views: `GET {collection}/{id}/view/{name}`. `Views` is the resource's views as the
 * generated types have them, such as `tAlbumViews`: its keys are the names that may be asked for, and the name
 * asked for decides what comes back.
 */
export interface tViewEndpoint<Views> {
  <K extends keyof Views & string>(client: tAppleMusicClient, id: string, name: K, options?: tViewOptions<Views, K>): Promise<tViewPage<Views, K>>;
  readonly bound: (client: tAppleMusicClient) => <K extends keyof Views & string>(id: string, name: K, options?: tViewOptions<Views, K>) => AsyncIterable<tRelated<Views, K>>;
}

/** The names are held to `Views` by the types alone: at runtime a name is any one segment of a path, and Apple says whether there is such a view. */
function viewGetter<Views>(fn: string, type: string): tViewEndpoint<Views> {
  const declared = endpoint(fn, "pages", (client, id: string, name: string, options?: tEndpointOptions<tRelationshipViewResponse, tStorefrontOption, tWithOption> & tWalkOptions) => {
    const segments = `${segmentOf(fn, "id", id)}/view/${segmentOf(fn, "name", name)}`;
    const bag = optionsOf(fn, options, "an options object");
    const init = { ...walkOf<tRelationshipViewResponse>(fn, bag, {}, ["with"]), ...NO_LISTENER };
    return inStorefront(fn, client, bag.storefront, (storefront): tRequestPlan<tRelationshipViewResponse> => [`v1/catalog/${storefront}/${type}/${segments}`, init]);
  });
  // What is declared takes any name and gives any resource; the type handed out ties the one to the other.
  return declared as unknown as tViewEndpoint<Views>;
}

// Each collection is made once and marked as having no effect of its own, as every declaration below is, so that a
// bundler leaves out of an app whatever the app did not import.
const songs =/*#__PURE__*/ catalogOf("songs");
const albums = /*#__PURE__*/ catalogOf("albums");
const artists = /*#__PURE__*/ catalogOf("artists");
const playlists = /*#__PURE__*/ catalogOf("playlists");
const musicVideos = /*#__PURE__*/ catalogOf("music-videos");
const stations = /*#__PURE__*/ catalogOf("stations");
const stationGenres = /*#__PURE__*/ catalogOf("station-genres");
const genres = /*#__PURE__*/ catalogOf("genres");
const curators = /*#__PURE__*/ catalogOf("curators");
const appleCurators = /*#__PURE__*/ catalogOf("apple-curators");
const activities = /*#__PURE__*/ catalogOf("activities");
const recordLabels = /*#__PURE__*/ catalogOf("record-labels");

// Songs

/** The song with an id. */
export const getSong = /*#__PURE__*/ resourceGetter<tSongsResponse, tStorefrontOption>("getSong", songs);
/** The songs with the ids given. */
export const getSongs = /*#__PURE__*/ resourcesGetter<tSongsResponse, tStorefrontOption>("getSongs", songs);
/** The songs with the ISRCs given. One ISRC may be that of more than one song. */
export const getSongsByIsrc = /*#__PURE__*/ resourcesFinder<tSongsResponse, tStorefrontOption>("getSongsByIsrc", "isrc", songs);
/** The songs in this storefront that are the equivalents of the songs with the ids given, which may be from another. */
export const getSongsByEquivalents = /*#__PURE__*/ resourcesFinder<tSongsResponse, tStorefrontOption, tRestrictOption>("getSongsByEquivalents", "equivalents", songs, { restrict: true });
/** One relationship of a song, such as its `albums`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
export const getSongRelationship = /*#__PURE__*/ relationshipGetter<Omit<tSongRelationships, "library">, tStorefrontOption>("getSongRelationship", songs);

// Albums

/** The album with an id. */
export const getAlbum = /*#__PURE__*/ resourceGetter<tAlbumsResponse, tStorefrontOption, tViewsOption<tAlbumViews>>("getAlbum", albums, { views: true });
/** The albums with the ids given. */
export const getAlbums = /*#__PURE__*/ resourcesGetter<tAlbumsResponse, tStorefrontOption>("getAlbums", albums);
/** The albums with the UPCs given. */
export const getAlbumsByUpc = /*#__PURE__*/ resourcesFinder<tAlbumsResponse, tStorefrontOption>("getAlbumsByUpc", "upc", albums);
/** The albums in this storefront that are the equivalents of the albums with the ids given, which may be from another. */
export const getAlbumsByEquivalents = /*#__PURE__*/ resourcesFinder<tAlbumsResponse, tStorefrontOption, tRestrictOption>("getAlbumsByEquivalents", "equivalents", albums, { restrict: true });
/** One relationship of an album, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
export const getAlbumRelationship = /*#__PURE__*/ relationshipGetter<Omit<tAlbumRelationships, "library">, tStorefrontOption>("getAlbumRelationship", albums);
/** One view of an album, such as `other-versions`, a page at a time. */
export const getAlbumView = /*#__PURE__*/ viewGetter<tAlbumViews>("getAlbumView", "albums");

// Artists

/** The artist with an id. */
export const getArtist = /*#__PURE__*/ resourceGetter<tArtistsResponse, tStorefrontOption, tViewsOption<tArtistViews>>("getArtist", artists, { views: true });
/** The artists with the ids given. */
export const getArtists = /*#__PURE__*/ resourcesGetter<tArtistsResponse, tStorefrontOption>("getArtists", artists);
/** One relationship of an artist, such as their `albums`, a page at a time. */
export const getArtistRelationship = /*#__PURE__*/ relationshipGetter<tArtistRelationships, tStorefrontOption>("getArtistRelationship", artists);
/** One view of an artist, such as `top-songs`, a page at a time. */
export const getArtistView = /*#__PURE__*/ viewGetter<tArtistViews>("getArtistView", "artists");

// Playlists

/** The playlist with an id. */
export const getPlaylist = /*#__PURE__*/ resourceGetter<tPlaylistsResponse, tStorefrontOption, tViewsOption<tPlaylistViews>>("getPlaylist", playlists, { views: true });
/** The playlists with the ids given. */
export const getPlaylists = /*#__PURE__*/ resourcesGetter<tPlaylistsResponse, tStorefrontOption>("getPlaylists", playlists);
/** The chart playlists of the storefronts with the ids given: each storefront's own charts, kept as playlists. */
export const getPlaylistsByStorefrontChart = /*#__PURE__*/ resourcesFinder<tPlaylistsResponse, tStorefrontOption>("getPlaylistsByStorefrontChart", "storefront-chart", playlists);
/** One relationship of a playlist, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
export const getPlaylistRelationship = /*#__PURE__*/ relationshipGetter<Omit<tPlaylistRelationships, "library">, tStorefrontOption>("getPlaylistRelationship", playlists);
/** One view of a playlist, such as `featured-artists`, a page at a time. */
export const getPlaylistView = /*#__PURE__*/ viewGetter<tPlaylistViews>("getPlaylistView", "playlists");

// Music videos

/** The music video with an id. */
export const getMusicVideo = /*#__PURE__*/ resourceGetter<tMusicVideosResponse, tStorefrontOption, tViewsOption<tMusicVideoViews>>("getMusicVideo", musicVideos, { views: true });
/** The music videos with the ids given. */
export const getMusicVideos = /*#__PURE__*/ resourcesGetter<tMusicVideosResponse, tStorefrontOption>("getMusicVideos", musicVideos);
/** The music videos with the ISRCs given. One ISRC may be that of more than one music video. */
export const getMusicVideosByIsrc = /*#__PURE__*/ resourcesFinder<tMusicVideosResponse, tStorefrontOption>("getMusicVideosByIsrc", "isrc", musicVideos);
/** The music videos in this storefront that are the equivalents of the ones with the ids given, which may be from another. */
export const getMusicVideosByEquivalents = /*#__PURE__*/ resourcesFinder<tMusicVideosResponse, tStorefrontOption, tRestrictOption>("getMusicVideosByEquivalents", "equivalents", musicVideos, { restrict: true });
/** One relationship of a music video, such as its `artists`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
export const getMusicVideoRelationship = /*#__PURE__*/ relationshipGetter<Omit<tMusicVideoRelationships, "library">, tStorefrontOption>("getMusicVideoRelationship", musicVideos);
/** One view of a music video, such as `more-by-artist`, a page at a time. */
export const getMusicVideoView = /*#__PURE__*/ viewGetter<tMusicVideoViews>("getMusicVideoView", "music-videos");

// Stations and their genres

/** The station with an id. */
export const getStation = /*#__PURE__*/ resourceGetter<tStationsResponse, tStorefrontOption>("getStation", stations);
/** The stations with the ids given. */
export const getStations = /*#__PURE__*/ resourcesGetter<tStationsResponse, tStorefrontOption>("getStations", stations);
/** One relationship of a station, such as its `radio-show`, a page at a time. */
export const getStationRelationship = /*#__PURE__*/ relationshipGetter<tStationRelationships, tStorefrontOption>("getStationRelationship", stations);
/** The station genre with an id. */
export const getStationGenre = /*#__PURE__*/ resourceGetter<tStationGenresResponse, tStorefrontOption>("getStationGenre", stationGenres);
/** The station genres with the ids given. */
export const getStationGenres = /*#__PURE__*/ resourcesGetter<tStationGenresResponse, tStorefrontOption>("getStationGenres", stationGenres);
/** Every station genre, a page at a time. */
export const listStationGenres = /*#__PURE__*/ resourceLister<tStationGenresResponse, tStorefrontOption>("listStationGenres", stationGenres);
/** One relationship of a station genre, such as its `stations`, a page at a time. */
export const getStationGenreRelationship = /*#__PURE__*/ relationshipGetter<tStationGenreRelationships, tStorefrontOption>("getStationGenreRelationship", stationGenres);

// Genres

/** The genre with an id. */
export const getGenre = /*#__PURE__*/ resourceGetter<tGenresResponse, tStorefrontOption>("getGenre", genres);
/** The genres with the ids given. */
export const getGenres = /*#__PURE__*/ resourcesGetter<tGenresResponse, tStorefrontOption>("getGenres", genres);
/** Every genre the charts are kept by, a page at a time. */
export const listGenres = /*#__PURE__*/ resourceLister<tGenresResponse, tStorefrontOption>("listGenres", genres);

// Curators, Apple curators and activities

/** The curator with an id. */
export const getCurator = /*#__PURE__*/ resourceGetter<tCuratorsResponse, tStorefrontOption>("getCurator", curators);
/** The curators with the ids given. */
export const getCurators = /*#__PURE__*/ resourcesGetter<tCuratorsResponse, tStorefrontOption>("getCurators", curators);
/** One relationship of a curator, such as their `playlists`, a page at a time. */
export const getCuratorRelationship = /*#__PURE__*/ relationshipGetter<tCuratorRelationships, tStorefrontOption>("getCuratorRelationship", curators);
/** The Apple curator with an id. */
export const getAppleCurator = /*#__PURE__*/ resourceGetter<tAppleCuratorsResponse, tStorefrontOption>("getAppleCurator", appleCurators);
/** The Apple curators with the ids given. */
export const getAppleCurators = /*#__PURE__*/ resourcesGetter<tAppleCuratorsResponse, tStorefrontOption>("getAppleCurators", appleCurators);
/** One relationship of an Apple curator, such as their `playlists`, a page at a time. */
export const getAppleCuratorRelationship = /*#__PURE__*/ relationshipGetter<tAppleCuratorRelationships, tStorefrontOption>("getAppleCuratorRelationship", appleCurators);
/** The activity with an id. */
export const getActivity = /*#__PURE__*/ resourceGetter<tActivitiesResponse, tStorefrontOption>("getActivity", activities);
/** The activities with the ids given. */
export const getActivities = /*#__PURE__*/ resourcesGetter<tActivitiesResponse, tStorefrontOption>("getActivities", activities);
/** One relationship of an activity, such as its `playlists`, a page at a time. */
export const getActivityRelationship = /*#__PURE__*/ relationshipGetter<tActivityRelationships, tStorefrontOption>("getActivityRelationship", activities);

// Record labels

/** The record label with an id. */
export const getRecordLabel = /*#__PURE__*/ resourceGetter<tRecordLabelsResponse, tStorefrontOption, tViewsOption<tRecordLabelViews>>("getRecordLabel", recordLabels, { views: true });
/** The record labels with the ids given. */
export const getRecordLabels = /*#__PURE__*/ resourcesGetter<tRecordLabelsResponse, tStorefrontOption>("getRecordLabels", recordLabels);
/** One view of a record label, such as `latest-releases`, a page at a time. */
export const getRecordLabelView = /*#__PURE__*/ viewGetter<tRecordLabelViews>("getRecordLabelView", "record-labels");

// Storefronts

/** The storefront with an id, such as `"gb"`. */
export const getStorefront = /*#__PURE__*/ resourceGetter<tStorefrontsResponse>("getStorefront", storefronts);
/** The storefronts with the ids given. */
export const getStorefronts = /*#__PURE__*/ resourcesGetter<tStorefrontsResponse>("getStorefronts", storefronts);
/** Every storefront, a page at a time. */
export const listStorefronts = /*#__PURE__*/ resourceLister<tStorefrontsResponse>("listStorefronts", storefronts);

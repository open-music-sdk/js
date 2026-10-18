// The functions for the catalog's resources, each declared once by the pattern its endpoint follows: the resource
// with an id, the resources with some ids, the ones a filter picks out, a whole collection, a resource's
// relationship, and a resource's view. A function is named for the generated type it is about: `getSong` and `tSong`.
import {
  endpoint,
  inStorefront,
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
  type tStorefrontOption,
  type tViewsOption,
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
import { NO_LISTENER, catalogOf, storefronts } from "./storefront";

/** The option of a function that looks for equivalents: what to leave out of them. */
export interface tRestrictOption {
  /** What to leave out of the answer: `["explicit"]` for explicit content. Default: nothing. */
  readonly restrict?: readonly "explicit"[] | undefined;
}

/** The option of a function for a view: what to send beside its resources. */
export interface tWithOption {
  /**
   * What to send beside the resources: `["attributes"]` for the view's own, such as its title, which come on the
   * first page alone, since a view's `next` link keeps only its offset. Default: nothing.
   */
  readonly with?: readonly "attributes"[] | undefined;
}

/** What the view `K` says of itself beside what it holds, such as its title, as the generated types have it. */
export type tViewAttributesOf<Views, K extends keyof Views> = NonNullable<Views[K]> extends {
  /** The view's own attributes, as the generated type of the view has them. */
  readonly attributes?: infer Attributes;
}
  ? Attributes
  : never;

/**
 * What Apple answers when a view is asked for by name: a page of what it holds, with the view's own attributes when
 * they were asked for. Both are typed from the view, so that a validator of the view is a validator of this page.
 */
export type tViewPage<Views, K extends keyof Views> = Omit<tRelationshipViewResponse, "data" | "attributes"> & {
  /** What the view holds, this page of it: the resources the name asked for decides. */
  data: tRelated<Views, K>[];
  /** The view's own attributes, such as its title: there when `with: ["attributes"]` asked for them, on the first page alone. */
  attributes?: tViewAttributesOf<Views, K>;
};

/** The options of a function for a view. */
export type tViewOptions<Views, K extends keyof Views> = tEndpointOptions<tViewPage<Views, K>, tStorefrontOption, tWithOption> & tWalkOptions;

/**
 * A function for a resource's views: `GET {collection}/{id}/view/{name}`. `Views` is the resource's views as the
 * generated types have them, such as `tAlbumViews`: its keys are the names that may be asked for, and the name
 * asked for decides what comes back.
 */
export interface tViewEndpoint<Views> {
  /**
   * Asks for one view of the resource with an id.
   *
   * @param client - The client to ask with.
   * @param id - The resource's id.
   * @param name - The view's name, one of `Views` as the type has them; Apple says whether there is such a one.
   * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one
   *   page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns What Apple answered: the first page, with its own attributes where they were asked for and `next` where
   *   there is more; `maxPages` plays no part.
   * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  <K extends keyof Views & string>(client: tAppleMusicClient, id: string, name: K, options?: tViewOptions<Views, K>): Promise<tViewPage<Views, K>>;
  /**
   * The same call with the client fixed and the pages walked: every item of the view, asked for as a loop reaches
   * them. It is what `catalog(client)` holds under the function's name.
   */
  readonly bound: (client: tAppleMusicClient) => <K extends keyof Views & string>(id: string, name: K, options?: tViewOptions<Views, K>) => AsyncIterable<tRelated<Views, K>>;
  /** How the bound form hands the answer over: every item of all its pages. */
  readonly unwrap: "pages";
}

/** The names are held to `Views` by the types alone: at runtime a name is any one segment of a path, and Apple says whether there is such a view. */
function viewGetter<Views>(fn: string, type: string): tViewEndpoint<Views> {
  const declared = endpoint(fn, "pages", (client, id: string, name: string, options?: tEndpointOptions<tRelationshipViewResponse, tStorefrontOption, tWithOption> & tWalkOptions) => {
    const segments = `${segmentOf(fn, "id", id)}/view/${segmentOf(fn, "name", name)}`;
    const bag = optionsOf(fn, options, "an options object");
    const init = { ...walkOf<tRelationshipViewResponse>(fn, bag, {}, { with: "list" }), ...NO_LISTENER };
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

/**
 * The song with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The song's id.
 * @param options - The storefront to ask in, and what to send beside the song.
 * @returns What Apple answered: the song under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSong = /*#__PURE__*/ resourceGetter<tSongsResponse, tStorefrontOption>("getSong", songs);
/**
 * The songs with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The songs' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the songs.
 * @returns What Apple answered: the songs under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSongs = /*#__PURE__*/ resourcesGetter<tSongsResponse, tStorefrontOption>("getSongs", songs);
/**
 * The songs with the ISRCs given. One ISRC may be that of more than one song.
 *
 * @function
 * @param client - The client to ask with.
 * @param values - The ISRCs, 1 to 300 of them; one ISRC may be that of more than one song.
 * @param options - The storefront to ask in, and what to send beside the songs.
 * @returns What Apple answered: the songs under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSongsByIsrc = /*#__PURE__*/ resourcesFinder<tSongsResponse, tStorefrontOption>("getSongsByIsrc", "isrc", songs);
/**
 * The songs in this storefront that are the equivalents of the songs with the ids given, which may be from another.
 *
 * @function
 * @param client - The client to ask with.
 * @param values - The ids of the songs to find the equivalents of, 1 to 300 of them; they may be another storefront's.
 * @param options - The storefront to ask in, which is where the equivalents are looked for; what to leave out of them;
 *   and what to send beside them.
 * @returns What Apple answered: the songs under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSongsByEquivalents = /*#__PURE__*/ resourcesFinder<tSongsResponse, tStorefrontOption, tRestrictOption>("getSongsByEquivalents", "equivalents", songs, { restrict: "list" });
/**
 * One relationship of a song, such as its `albums`, a page at a time. The `library` relationship needs the listener, and is not among the names.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The song's id.
 * @param name - The relationship's name, one of the song's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSongRelationship = /*#__PURE__*/ relationshipGetter<Omit<tSongRelationships, "library">, tStorefrontOption>("getSongRelationship", songs);

// Albums

/**
 * The album with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The album's id.
 * @param options - The storefront to ask in, the views to send with the album, and what else to send beside it.
 * @returns What Apple answered: the album under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbum = /*#__PURE__*/ resourceGetter<tAlbumsResponse, tStorefrontOption, tViewsOption<tAlbumViews>>("getAlbum", albums, { views: "list" });
/**
 * The albums with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The albums' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the albums.
 * @returns What Apple answered: the albums under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbums = /*#__PURE__*/ resourcesGetter<tAlbumsResponse, tStorefrontOption>("getAlbums", albums);
/**
 * The albums with the UPCs given.
 *
 * @function
 * @param client - The client to ask with.
 * @param values - The UPCs, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the albums.
 * @returns What Apple answered: the albums under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbumsByUpc = /*#__PURE__*/ resourcesFinder<tAlbumsResponse, tStorefrontOption>("getAlbumsByUpc", "upc", albums);
/**
 * The albums in this storefront that are the equivalents of the albums with the ids given, which may be from another.
 *
 * @function
 * @param client - The client to ask with.
 * @param values - The ids of the albums to find the equivalents of, 1 to 300 of them; they may be another storefront's.
 * @param options - The storefront to ask in, which is where the equivalents are looked for; what to leave out of them;
 *   and what to send beside them.
 * @returns What Apple answered: the albums under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbumsByEquivalents = /*#__PURE__*/ resourcesFinder<tAlbumsResponse, tStorefrontOption, tRestrictOption>("getAlbumsByEquivalents", "equivalents", albums, { restrict: "list" });
/**
 * One relationship of an album, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The album's id.
 * @param name - The relationship's name, one of the album's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbumRelationship = /*#__PURE__*/ relationshipGetter<Omit<tAlbumRelationships, "library">, tStorefrontOption>("getAlbumRelationship", albums);
/**
 * One view of an album, such as `other-versions`, a page at a time. Its `next` link kept only its offset against the
 * live API on 18 October 2026, so the view's own attributes come on the first page alone.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The album's id.
 * @param name - The view's name, one of the album's as the type has them; Apple says whether there is such a one.
 * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
 *   where to start, what to send beside them, and the signal and schema of the request.
 * @returns What Apple answered: the first page, with its own attributes where they were asked for and `next` where
 *   there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbumView = /*#__PURE__*/ viewGetter<tAlbumViews>("getAlbumView", "albums");

// Artists

/**
 * The artist with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The artist's id.
 * @param options - The storefront to ask in, the views to send with the artist, and what else to send beside it.
 * @returns What Apple answered: the artist under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getArtist = /*#__PURE__*/ resourceGetter<tArtistsResponse, tStorefrontOption, tViewsOption<tArtistViews>>("getArtist", artists, { views: "list" });
/**
 * The artists with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The artists' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the artists.
 * @returns What Apple answered: the artists under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getArtists = /*#__PURE__*/ resourcesGetter<tArtistsResponse, tStorefrontOption>("getArtists", artists);
/**
 * One relationship of an artist, such as their `albums`, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The artist's id.
 * @param name - The relationship's name, one of the artist's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getArtistRelationship = /*#__PURE__*/ relationshipGetter<tArtistRelationships, tStorefrontOption>("getArtistRelationship", artists);
/**
 * One view of an artist, such as `top-songs`, a page at a time. Its `next` link kept only its offset against the
 * live API on 18 October 2026, so the view's own attributes come on the first page alone.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The artist's id.
 * @param name - The view's name, one of the artist's as the type has them; Apple says whether there is such a one.
 * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
 *   where to start, what to send beside them, and the signal and schema of the request.
 * @returns What Apple answered: the first page, with its own attributes where they were asked for and `next` where
 *   there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getArtistView = /*#__PURE__*/ viewGetter<tArtistViews>("getArtistView", "artists");

// Playlists

/**
 * The playlist with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The playlist's id.
 * @param options - The storefront to ask in, the views to send with the playlist, and what else to send beside it.
 * @returns What Apple answered: the playlist under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getPlaylist = /*#__PURE__*/ resourceGetter<tPlaylistsResponse, tStorefrontOption, tViewsOption<tPlaylistViews>>("getPlaylist", playlists, { views: "list" });
/**
 * The playlists with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The playlists' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the playlists.
 * @returns What Apple answered: the playlists under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getPlaylists = /*#__PURE__*/ resourcesGetter<tPlaylistsResponse, tStorefrontOption>("getPlaylists", playlists);
/**
 * The chart playlists of the storefronts with the ids given: each storefront's own charts, kept as playlists.
 *
 * @function
 * @param client - The client to ask with.
 * @param values - The storefronts' ids, 1 to 300 of them; each one such as `"gb"`.
 * @param options - The storefront to ask in, and what to send beside the playlists.
 * @returns What Apple answered: the playlists under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getPlaylistsByStorefrontChart = /*#__PURE__*/ resourcesFinder<tPlaylistsResponse, tStorefrontOption>("getPlaylistsByStorefrontChart", "storefront-chart", playlists);
/**
 * One relationship of a playlist, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The playlist's id.
 * @param name - The relationship's name, one of the playlist's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getPlaylistRelationship = /*#__PURE__*/ relationshipGetter<Omit<tPlaylistRelationships, "library">, tStorefrontOption>("getPlaylistRelationship", playlists);
/**
 * One view of a playlist, such as `featured-artists`, a page at a time. Its `next` link kept only its offset against
 * the live API on 18 October 2026, so the view's own attributes come on the first page alone.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The playlist's id.
 * @param name - The view's name, one of the playlist's as the type has them; Apple says whether there is such a one.
 * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
 *   where to start, what to send beside them, and the signal and schema of the request.
 * @returns What Apple answered: the first page, with its own attributes where they were asked for and `next` where
 *   there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getPlaylistView = /*#__PURE__*/ viewGetter<tPlaylistViews>("getPlaylistView", "playlists");

// Music videos

/**
 * The music video with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The music video's id.
 * @param options - The storefront to ask in, the views to send with the music video, and what else to send beside it.
 * @returns What Apple answered: the music video under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideo = /*#__PURE__*/ resourceGetter<tMusicVideosResponse, tStorefrontOption, tViewsOption<tMusicVideoViews>>("getMusicVideo", musicVideos, { views: "list" });
/**
 * The music videos with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The music videos' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the music videos.
 * @returns What Apple answered: the music videos under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideos = /*#__PURE__*/ resourcesGetter<tMusicVideosResponse, tStorefrontOption>("getMusicVideos", musicVideos);
/**
 * The music videos with the ISRCs given. One ISRC may be that of more than one music video.
 *
 * @function
 * @param client - The client to ask with.
 * @param values - The ISRCs, 1 to 300 of them; one ISRC may be that of more than one music video.
 * @param options - The storefront to ask in, and what to send beside the music videos.
 * @returns What Apple answered: the music videos under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideosByIsrc = /*#__PURE__*/ resourcesFinder<tMusicVideosResponse, tStorefrontOption>("getMusicVideosByIsrc", "isrc", musicVideos);
/**
 * The music videos in this storefront that are the equivalents of the ones with the ids given, which may be from another.
 *
 * @function
 * @param client - The client to ask with.
 * @param values - The ids of the music videos to find the equivalents of, 1 to 300 of them; they may be another
 *   storefront's.
 * @param options - The storefront to ask in, which is where the equivalents are looked for; what to leave out of them;
 *   and what to send beside them.
 * @returns What Apple answered: the music videos under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideosByEquivalents = /*#__PURE__*/ resourcesFinder<tMusicVideosResponse, tStorefrontOption, tRestrictOption>("getMusicVideosByEquivalents", "equivalents", musicVideos, { restrict: "list" });
/**
 * One relationship of a music video, such as its `artists`, a page at a time. The `library` relationship needs the listener, and is not among the names.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The music video's id.
 * @param name - The relationship's name, one of the music video's as the type has them; Apple says whether there is
 *   such a one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideoRelationship = /*#__PURE__*/ relationshipGetter<Omit<tMusicVideoRelationships, "library">, tStorefrontOption>("getMusicVideoRelationship", musicVideos);
/**
 * One view of a music video, such as `more-by-artist`, a page at a time. Its `next` link kept only its offset
 * against the live API on 18 October 2026, so the view's own attributes come on the first page alone.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The music video's id.
 * @param name - The view's name, one of the music video's as the type has them; Apple says whether there is such a one.
 * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
 *   where to start, what to send beside them, and the signal and schema of the request.
 * @returns What Apple answered: the first page, with its own attributes where they were asked for and `next` where
 *   there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideoView = /*#__PURE__*/ viewGetter<tMusicVideoViews>("getMusicVideoView", "music-videos");

// Stations and their genres

/**
 * The station with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The station's id.
 * @param options - The storefront to ask in, and what to send beside the station.
 * @returns What Apple answered: the station under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStation = /*#__PURE__*/ resourceGetter<tStationsResponse, tStorefrontOption>("getStation", stations);
/**
 * The stations with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The stations' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the stations.
 * @returns What Apple answered: the stations under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStations = /*#__PURE__*/ resourcesGetter<tStationsResponse, tStorefrontOption>("getStations", stations);
/**
 * One relationship of a station, such as its `radio-show`, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The station's id.
 * @param name - The relationship's name, one of the station's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStationRelationship = /*#__PURE__*/ relationshipGetter<tStationRelationships, tStorefrontOption>("getStationRelationship", stations);
/**
 * The station genre with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The station genre's id.
 * @param options - The storefront to ask in, and what to send beside the station genre.
 * @returns What Apple answered: the station genre under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStationGenre = /*#__PURE__*/ resourceGetter<tStationGenresResponse, tStorefrontOption>("getStationGenre", stationGenres);
/**
 * The station genres with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The station genres' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the station genres.
 * @returns What Apple answered: the station genres under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStationGenres = /*#__PURE__*/ resourcesGetter<tStationGenresResponse, tStorefrontOption>("getStationGenres", stationGenres);
/**
 * Every station genre, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const listStationGenres = /*#__PURE__*/ resourceLister<tStationGenresResponse, tStorefrontOption>("listStationGenres", stationGenres);
/**
 * One relationship of a station genre, such as its `stations`, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The station genre's id.
 * @param name - The relationship's name, one of the station genre's as the type has them; Apple says whether there is
 *   such a one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStationGenreRelationship = /*#__PURE__*/ relationshipGetter<tStationGenreRelationships, tStorefrontOption>("getStationGenreRelationship", stationGenres);

// Genres

/**
 * The genre with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The genre's id.
 * @param options - The storefront to ask in, and what to send beside the genre.
 * @returns What Apple answered: the genre under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getGenre = /*#__PURE__*/ resourceGetter<tGenresResponse, tStorefrontOption>("getGenre", genres);
/**
 * The genres with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The genres' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the genres.
 * @returns What Apple answered: the genres under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getGenres = /*#__PURE__*/ resourcesGetter<tGenresResponse, tStorefrontOption>("getGenres", genres);
/**
 * Every genre the charts are kept by, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const listGenres = /*#__PURE__*/ resourceLister<tGenresResponse, tStorefrontOption>("listGenres", genres);

// Curators, Apple curators and activities

/**
 * The curator with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The curator's id.
 * @param options - The storefront to ask in, and what to send beside the curator.
 * @returns What Apple answered: the curator under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getCurator = /*#__PURE__*/ resourceGetter<tCuratorsResponse, tStorefrontOption>("getCurator", curators);
/**
 * The curators with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The curators' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the curators.
 * @returns What Apple answered: the curators under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getCurators = /*#__PURE__*/ resourcesGetter<tCuratorsResponse, tStorefrontOption>("getCurators", curators);
/**
 * One relationship of a curator, such as their `playlists`, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The curator's id.
 * @param name - The relationship's name, one of the curator's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getCuratorRelationship = /*#__PURE__*/ relationshipGetter<tCuratorRelationships, tStorefrontOption>("getCuratorRelationship", curators);
/**
 * The Apple curator with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The Apple curator's id.
 * @param options - The storefront to ask in, and what to send beside the Apple curator.
 * @returns What Apple answered: the Apple curator under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAppleCurator = /*#__PURE__*/ resourceGetter<tAppleCuratorsResponse, tStorefrontOption>("getAppleCurator", appleCurators);
/**
 * The Apple curators with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The Apple curators' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the Apple curators.
 * @returns What Apple answered: the Apple curators under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAppleCurators = /*#__PURE__*/ resourcesGetter<tAppleCuratorsResponse, tStorefrontOption>("getAppleCurators", appleCurators);
/**
 * One relationship of an Apple curator, such as their `playlists`, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The Apple curator's id.
 * @param name - The relationship's name, one of the Apple curator's as the type has them; Apple says whether there is
 *   such a one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAppleCuratorRelationship = /*#__PURE__*/ relationshipGetter<tAppleCuratorRelationships, tStorefrontOption>("getAppleCuratorRelationship", appleCurators);
/**
 * The activity with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The activity's id.
 * @param options - The storefront to ask in, and what to send beside the activity.
 * @returns What Apple answered: the activity under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getActivity = /*#__PURE__*/ resourceGetter<tActivitiesResponse, tStorefrontOption>("getActivity", activities);
/**
 * The activities with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The activities' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the activities.
 * @returns What Apple answered: the activities under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getActivities = /*#__PURE__*/ resourcesGetter<tActivitiesResponse, tStorefrontOption>("getActivities", activities);
/**
 * One relationship of an activity, such as its `playlists`, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The activity's id.
 * @param name - The relationship's name, one of the activity's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
 *   and the signal and schema of the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getActivityRelationship = /*#__PURE__*/ relationshipGetter<tActivityRelationships, tStorefrontOption>("getActivityRelationship", activities);

// Record labels

/**
 * The record label with an id.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The record label's id.
 * @param options - The storefront to ask in, the views to send with the record label, and what else to send beside it.
 * @returns What Apple answered: the record label under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getRecordLabel = /*#__PURE__*/ resourceGetter<tRecordLabelsResponse, tStorefrontOption, tViewsOption<tRecordLabelViews>>("getRecordLabel", recordLabels, { views: "list" });
/**
 * The record labels with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The record labels' ids, 1 to 300 of them.
 * @param options - The storefront to ask in, and what to send beside the record labels.
 * @returns What Apple answered: the record labels under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getRecordLabels = /*#__PURE__*/ resourcesGetter<tRecordLabelsResponse, tStorefrontOption>("getRecordLabels", recordLabels);
/**
 * One view of a record label, such as `latest-releases`, a page at a time. Its `next` link kept only its offset
 * against the live API on 18 October 2026, so the view's own attributes come on the first page alone.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The record label's id.
 * @param name - The view's name, one of the record label's as the type has them; Apple says whether there is such a
 *   one.
 * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
 *   where to start, what to send beside them, and the signal and schema of the request.
 * @returns What Apple answered: the first page, with its own attributes where they were asked for and `next` where
 *   there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in,
 *   or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getRecordLabelView = /*#__PURE__*/ viewGetter<tRecordLabelViews>("getRecordLabelView", "record-labels");

// Storefronts

/**
 * The storefront with an id, such as `"gb"`.
 *
 * @function
 * @param client - The client to ask with.
 * @param id - The storefront's id.
 * @param options - What to send beside the storefront.
 * @returns What Apple answered: the storefront under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says
 *   which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStorefront = /*#__PURE__*/ resourceGetter<tStorefrontsResponse>("getStorefront", storefronts);
/**
 * The storefronts with the ids given.
 *
 * @function
 * @param client - The client to ask with.
 * @param ids - The storefronts' ids, 1 to 300 of them; each one such as `"gb"`.
 * @param options - What to send beside the storefronts.
 * @returns What Apple answered: the storefronts under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says
 *   which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStorefronts = /*#__PURE__*/ resourcesGetter<tStorefrontsResponse>("getStorefronts", storefronts);
/**
 * Every storefront, a page at a time.
 *
 * @function
 * @param client - The client to ask with.
 * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of
 *   the request.
 * @returns What Apple answered: the first page, with `next` where there is more; `maxPages` plays no part.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says
 *   which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const listStorefronts = /*#__PURE__*/ resourceLister<tStorefrontsResponse>("listStorefronts", storefronts);

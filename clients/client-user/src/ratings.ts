// The functions for a listener's ratings. Nine types of resource can be rated, and each has the same four: the
// rating of one, the ratings of several, a rating set, and a rating taken away. A rating is 1 for a like and -1
// for a dislike, and its id is that of the resource it is of.
import { endpoint, got, initOf, optionsOf, resourceGetter, resourcesGetter, segmentOf, type tEndpoint, type tItem, type tReadOptions, type tRequestPlan } from "@open-music-sdk/core";
import type { tRatingRequest, tRatingsResponse } from "@open-music-sdk/types";

const OPTIONS = "an options object";

/** What a rating says: 1 for a like, -1 for a dislike. */
export type tRatingValue = tRatingRequest["attributes"]["value"];

/** The options of a function that sets a rating. */
export type tSetRatingOptions = tReadOptions<tRatingsResponse>;

/** The options of a function that takes a rating away. Apple answers with nothing, so there is nothing for a `schema` to check. */
export type tDeleteRatingOptions = tReadOptions<void>;

/**
 * A function that sets the listener's rating of the resource with an id: `PUT {collection}/{id}`. Bound, it gives
 * the rating, or `undefined` if Apple's answer holds none: the rating was set either way.
 */
function ratingSetter(fn: string, collection: () => string): tEndpoint<[id: string, value: tRatingValue, options?: tSetRatingOptions], tRatingsResponse, Promise<tItem<tRatingsResponse> | undefined>, "written"> {
  return endpoint(fn, "written", (_client, id: string, value: tRatingValue, options?: tSetRatingOptions): tRequestPlan<tRatingsResponse> => {
    const segment = segmentOf(fn, "id", id);
    if ((value as unknown) !== 1 && (value as unknown) !== -1) throw new TypeError(`${fn}: value must be 1, for a like, or -1, for a dislike; got ${got(value)}`);
    const init = initOf<tRatingsResponse>(fn, optionsOf(fn, options, OPTIONS));
    const body: tRatingRequest = { type: "ratings", attributes: { value } };
    return [`${collection()}/${segment}`, { ...init, method: "PUT", body }];
  });
}

/** A function that takes away the listener's rating of the resource with an id: `DELETE {collection}/{id}`. It resolves to nothing. */
function ratingDeleter(fn: string, collection: () => string): tEndpoint<[id: string, options?: tDeleteRatingOptions], void, Promise<undefined>, "written"> {
  return endpoint(fn, "written", (_client, id: string, options?: tDeleteRatingOptions): tRequestPlan<void> => {
    const segment = segmentOf(fn, "id", id);
    const init = initOf(fn, optionsOf(fn, options, OPTIONS));
    return [`${collection()}/${segment}`, { ...init, method: "DELETE" }];
  });
}

// Where each type's ratings are.
const songs = () => "v1/me/ratings/songs";
const albums = () => "v1/me/ratings/albums";
const musicVideos = () => "v1/me/ratings/music-videos";
const playlists = () => "v1/me/ratings/playlists";
const stations = () => "v1/me/ratings/stations";
const librarySongs = () => "v1/me/ratings/library-songs";
const libraryAlbums = () => "v1/me/ratings/library-albums";
const libraryMusicVideos = () => "v1/me/ratings/library-music-videos";
const libraryPlaylists = () => "v1/me/ratings/library-playlists";

// Songs

/**
 * The listener's rating of the song with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The song's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSongRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getSongRating", songs);
/**
 * The listener's ratings of the songs with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The songs' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getSongRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getSongRatings", songs);
/**
 * Sets the listener's rating of the song with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The song's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setSongRating = /*#__PURE__*/ ratingSetter("setSongRating", songs);
/**
 * Takes away the listener's rating of the song with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The song's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteSongRating = /*#__PURE__*/ ratingDeleter("deleteSongRating", songs);

// Albums

/**
 * The listener's rating of the album with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The album's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbumRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getAlbumRating", albums);
/**
 * The listener's ratings of the albums with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The albums' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getAlbumRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getAlbumRatings", albums);
/**
 * Sets the listener's rating of the album with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The album's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setAlbumRating = /*#__PURE__*/ ratingSetter("setAlbumRating", albums);
/**
 * Takes away the listener's rating of the album with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The album's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteAlbumRating = /*#__PURE__*/ ratingDeleter("deleteAlbumRating", albums);

// Music videos

/**
 * The listener's rating of the music video with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The music video's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideoRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getMusicVideoRating", musicVideos);
/**
 * The listener's ratings of the music videos with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The music videos' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getMusicVideoRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getMusicVideoRatings", musicVideos);
/**
 * Sets the listener's rating of the music video with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The music video's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setMusicVideoRating = /*#__PURE__*/ ratingSetter("setMusicVideoRating", musicVideos);
/**
 * Takes away the listener's rating of the music video with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The music video's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteMusicVideoRating = /*#__PURE__*/ ratingDeleter("deleteMusicVideoRating", musicVideos);

// Playlists

/**
 * The listener's rating of the playlist with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The playlist's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getPlaylistRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getPlaylistRating", playlists);
/**
 * The listener's ratings of the playlists with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The playlists' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getPlaylistRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getPlaylistRatings", playlists);
/**
 * Sets the listener's rating of the playlist with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The playlist's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setPlaylistRating = /*#__PURE__*/ ratingSetter("setPlaylistRating", playlists);
/**
 * Takes away the listener's rating of the playlist with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The playlist's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deletePlaylistRating = /*#__PURE__*/ ratingDeleter("deletePlaylistRating", playlists);

// Stations

/**
 * The listener's rating of the station with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The station's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStationRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getStationRating", stations);
/**
 * The listener's ratings of the stations with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The stations' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getStationRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getStationRatings", stations);
/**
 * Sets the listener's rating of the station with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The station's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setStationRating = /*#__PURE__*/ ratingSetter("setStationRating", stations);
/**
 * Takes away the listener's rating of the station with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The station's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteStationRating = /*#__PURE__*/ ratingDeleter("deleteStationRating", stations);

// Library songs

/**
 * The listener's rating of the library song with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library song's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibrarySongRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibrarySongRating", librarySongs);
/**
 * The listener's ratings of the library songs with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library songs' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibrarySongRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibrarySongRatings", librarySongs);
/**
 * Sets the listener's rating of the library song with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library song's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setLibrarySongRating = /*#__PURE__*/ ratingSetter("setLibrarySongRating", librarySongs);
/**
 * Takes away the listener's rating of the library song with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library song's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteLibrarySongRating = /*#__PURE__*/ ratingDeleter("deleteLibrarySongRating", librarySongs);

// Library albums

/**
 * The listener's rating of the library album with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library album's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibraryAlbumRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibraryAlbumRating", libraryAlbums);
/**
 * The listener's ratings of the library albums with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library albums' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibraryAlbumRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibraryAlbumRatings", libraryAlbums);
/**
 * Sets the listener's rating of the library album with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library album's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setLibraryAlbumRating = /*#__PURE__*/ ratingSetter("setLibraryAlbumRating", libraryAlbums);
/**
 * Takes away the listener's rating of the library album with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library album's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteLibraryAlbumRating = /*#__PURE__*/ ratingDeleter("deleteLibraryAlbumRating", libraryAlbums);

// Library music videos

/**
 * The listener's rating of the library music video with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library music video's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibraryMusicVideoRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibraryMusicVideoRating", libraryMusicVideos);
/**
 * The listener's ratings of the library music videos with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library music videos' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibraryMusicVideoRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibraryMusicVideoRatings", libraryMusicVideos);
/**
 * Sets the listener's rating of the library music video with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library music video's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setLibraryMusicVideoRating = /*#__PURE__*/ ratingSetter("setLibraryMusicVideoRating", libraryMusicVideos);
/**
 * Takes away the listener's rating of the library music video with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library music video's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteLibraryMusicVideoRating = /*#__PURE__*/ ratingDeleter("deleteLibraryMusicVideoRating", libraryMusicVideos);

// Library playlists

/**
 * The listener's rating of the library playlist with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library playlist's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibraryPlaylistRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibraryPlaylistRating", libraryPlaylists);
/**
 * The listener's ratings of the library playlists with the ids given.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library playlists' ids, 1 to 300 of them.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the ratings under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const getLibraryPlaylistRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibraryPlaylistRatings", libraryPlaylists);
/**
 * Sets the listener's rating of the library playlist with an id: 1 for a like, -1 for a dislike.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library playlist's id.
 * @param value - The rating: 1 for a like, -1 for a dislike.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the rating as set, under `data`.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const setLibraryPlaylistRating = /*#__PURE__*/ ratingSetter("setLibraryPlaylistRating", libraryPlaylists);
/**
 * Takes away the listener's rating of the library playlist with an id.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library playlist's id.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns Nothing: it resolves once Apple has taken the rating away.
 * @throws TypeError if `client` is no client or an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
 */
export const deleteLibraryPlaylistRating = /*#__PURE__*/ ratingDeleter("deleteLibraryPlaylistRating", libraryPlaylists);

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

/** A function that sets the listener's rating of the resource with an id: `PUT {collection}/{id}`. Bound, it gives the rating. */
function ratingSetter(fn: string, collection: () => string): tEndpoint<[id: string, value: tRatingValue, options?: tSetRatingOptions], tRatingsResponse, Promise<tItem<tRatingsResponse>>> {
  return endpoint(fn, "resource", (_client, id: string, value: tRatingValue, options?: tSetRatingOptions): tRequestPlan<tRatingsResponse> => {
    const segment = segmentOf(fn, "id", id);
    if ((value as unknown) !== 1 && (value as unknown) !== -1) throw new TypeError(`${fn}: value must be 1, for a like, or -1, for a dislike; got ${got(value)}`);
    const init = initOf<tRatingsResponse>(fn, optionsOf(fn, options, OPTIONS));
    const body: tRatingRequest = { type: "ratings", attributes: { value } };
    return [`${collection()}/${segment}`, { ...init, method: "PUT", body }];
  });
}

/** A function that takes away the listener's rating of the resource with an id: `DELETE {collection}/{id}`. It resolves to nothing. */
function ratingDeleter(fn: string, collection: () => string): tEndpoint<[id: string, options?: tDeleteRatingOptions], void, Promise<void>> {
  return endpoint(fn, "answer", (_client, id: string, options?: tDeleteRatingOptions): tRequestPlan<void> => {
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

/** The listener's rating of the song with an id. */
export const getSongRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getSongRating", songs);
/** The listener's ratings of the songs with the ids given. */
export const getSongRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getSongRatings", songs);
/** Sets the listener's rating of the song with an id: 1 for a like, -1 for a dislike. */
export const setSongRating = /*#__PURE__*/ ratingSetter("setSongRating", songs);
/** Takes away the listener's rating of the song with an id. */
export const deleteSongRating = /*#__PURE__*/ ratingDeleter("deleteSongRating", songs);

// Albums

/** The listener's rating of the album with an id. */
export const getAlbumRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getAlbumRating", albums);
/** The listener's ratings of the albums with the ids given. */
export const getAlbumRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getAlbumRatings", albums);
/** Sets the listener's rating of the album with an id: 1 for a like, -1 for a dislike. */
export const setAlbumRating = /*#__PURE__*/ ratingSetter("setAlbumRating", albums);
/** Takes away the listener's rating of the album with an id. */
export const deleteAlbumRating = /*#__PURE__*/ ratingDeleter("deleteAlbumRating", albums);

// Music videos

/** The listener's rating of the music video with an id. */
export const getMusicVideoRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getMusicVideoRating", musicVideos);
/** The listener's ratings of the music videos with the ids given. */
export const getMusicVideoRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getMusicVideoRatings", musicVideos);
/** Sets the listener's rating of the music video with an id: 1 for a like, -1 for a dislike. */
export const setMusicVideoRating = /*#__PURE__*/ ratingSetter("setMusicVideoRating", musicVideos);
/** Takes away the listener's rating of the music video with an id. */
export const deleteMusicVideoRating = /*#__PURE__*/ ratingDeleter("deleteMusicVideoRating", musicVideos);

// Playlists

/** The listener's rating of the playlist with an id. */
export const getPlaylistRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getPlaylistRating", playlists);
/** The listener's ratings of the playlists with the ids given. */
export const getPlaylistRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getPlaylistRatings", playlists);
/** Sets the listener's rating of the playlist with an id: 1 for a like, -1 for a dislike. */
export const setPlaylistRating = /*#__PURE__*/ ratingSetter("setPlaylistRating", playlists);
/** Takes away the listener's rating of the playlist with an id. */
export const deletePlaylistRating = /*#__PURE__*/ ratingDeleter("deletePlaylistRating", playlists);

// Stations

/** The listener's rating of the station with an id. */
export const getStationRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getStationRating", stations);
/** The listener's ratings of the stations with the ids given. */
export const getStationRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getStationRatings", stations);
/** Sets the listener's rating of the station with an id: 1 for a like, -1 for a dislike. */
export const setStationRating = /*#__PURE__*/ ratingSetter("setStationRating", stations);
/** Takes away the listener's rating of the station with an id. */
export const deleteStationRating = /*#__PURE__*/ ratingDeleter("deleteStationRating", stations);

// Library songs

/** The listener's rating of the library song with an id. */
export const getLibrarySongRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibrarySongRating", librarySongs);
/** The listener's ratings of the library songs with the ids given. */
export const getLibrarySongRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibrarySongRatings", librarySongs);
/** Sets the listener's rating of the library song with an id: 1 for a like, -1 for a dislike. */
export const setLibrarySongRating = /*#__PURE__*/ ratingSetter("setLibrarySongRating", librarySongs);
/** Takes away the listener's rating of the library song with an id. */
export const deleteLibrarySongRating = /*#__PURE__*/ ratingDeleter("deleteLibrarySongRating", librarySongs);

// Library albums

/** The listener's rating of the library album with an id. */
export const getLibraryAlbumRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibraryAlbumRating", libraryAlbums);
/** The listener's ratings of the library albums with the ids given. */
export const getLibraryAlbumRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibraryAlbumRatings", libraryAlbums);
/** Sets the listener's rating of the library album with an id: 1 for a like, -1 for a dislike. */
export const setLibraryAlbumRating = /*#__PURE__*/ ratingSetter("setLibraryAlbumRating", libraryAlbums);
/** Takes away the listener's rating of the library album with an id. */
export const deleteLibraryAlbumRating = /*#__PURE__*/ ratingDeleter("deleteLibraryAlbumRating", libraryAlbums);

// Library music videos

/** The listener's rating of the library music video with an id. */
export const getLibraryMusicVideoRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibraryMusicVideoRating", libraryMusicVideos);
/** The listener's ratings of the library music videos with the ids given. */
export const getLibraryMusicVideoRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibraryMusicVideoRatings", libraryMusicVideos);
/** Sets the listener's rating of the library music video with an id: 1 for a like, -1 for a dislike. */
export const setLibraryMusicVideoRating = /*#__PURE__*/ ratingSetter("setLibraryMusicVideoRating", libraryMusicVideos);
/** Takes away the listener's rating of the library music video with an id. */
export const deleteLibraryMusicVideoRating = /*#__PURE__*/ ratingDeleter("deleteLibraryMusicVideoRating", libraryMusicVideos);

// Library playlists

/** The listener's rating of the library playlist with an id. */
export const getLibraryPlaylistRating = /*#__PURE__*/ resourceGetter<tRatingsResponse>("getLibraryPlaylistRating", libraryPlaylists);
/** The listener's ratings of the library playlists with the ids given. */
export const getLibraryPlaylistRatings = /*#__PURE__*/ resourcesGetter<tRatingsResponse>("getLibraryPlaylistRatings", libraryPlaylists);
/** Sets the listener's rating of the library playlist with an id: 1 for a like, -1 for a dislike. */
export const setLibraryPlaylistRating = /*#__PURE__*/ ratingSetter("setLibraryPlaylistRating", libraryPlaylists);
/** Takes away the listener's rating of the library playlist with an id. */
export const deleteLibraryPlaylistRating = /*#__PURE__*/ ratingDeleter("deleteLibraryPlaylistRating", libraryPlaylists);

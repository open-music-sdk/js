// The functions for a listener's resources, each declared once by the pattern its endpoint follows: the resource
// with an id, the resources with some ids, a whole collection, a resource's relationship, and a new resource. A
// function is named for the generated type it is about: `getLibrarySong` and `tLibrarySong`.
import { endpoint, initOf, optionsOf, relationshipGetter, resourceGetter, resourceLister, resourcesGetter, type tReadOptions, type tRequestPlan } from "@open-music-sdk/core";
import type {
  tLibraryAlbumRelationships,
  tLibraryAlbumsResponse,
  tLibraryArtistRelationships,
  tLibraryArtistsResponse,
  tLibraryMusicVideoRelationships,
  tLibraryMusicVideosResponse,
  tLibraryPlaylistCreationRequest,
  tLibraryPlaylistFolderCreationRequest,
  tLibraryPlaylistFolderRelationships,
  tLibraryPlaylistFoldersResponse,
  tLibraryPlaylistRelationships,
  tLibraryPlaylistsResponse,
  tLibrarySongRelationships,
  tLibrarySongsResponse,
  tPersonalRecommendationRelationships,
  tPersonalRecommendationResponse,
} from "@open-music-sdk/types";
import { bodyOf } from "./body";

const OPTIONS = "an options object";

// Where each collection is. A listener's are under /v1/me, which is where the client sends the Music User Token.
const librarySongs = () => "v1/me/library/songs";
const libraryAlbums = () => "v1/me/library/albums";
const libraryArtists = () => "v1/me/library/artists";
const libraryMusicVideos = () => "v1/me/library/music-videos";
const libraryPlaylists = () => "v1/me/library/playlists";
const libraryPlaylistFolders = () => "v1/me/library/playlist-folders";
const personalRecommendations = () => "v1/me/recommendations";

// Library songs

/** The song with an id in the listener's library. */
export const getLibrarySong = /*#__PURE__*/ resourceGetter<tLibrarySongsResponse>("getLibrarySong", librarySongs);
/** The songs with the ids given in the listener's library. */
export const getLibrarySongs = /*#__PURE__*/ resourcesGetter<tLibrarySongsResponse>("getLibrarySongs", librarySongs);
/** Every song in the listener's library, a page at a time. */
export const listLibrarySongs = /*#__PURE__*/ resourceLister<tLibrarySongsResponse>("listLibrarySongs", librarySongs);
/** One relationship of a library song, such as its `albums`, a page at a time. */
export const getLibrarySongRelationship = /*#__PURE__*/ relationshipGetter<tLibrarySongRelationships>("getLibrarySongRelationship", librarySongs);

// Library albums

/** The album with an id in the listener's library. */
export const getLibraryAlbum = /*#__PURE__*/ resourceGetter<tLibraryAlbumsResponse>("getLibraryAlbum", libraryAlbums);
/** The albums with the ids given in the listener's library. */
export const getLibraryAlbums = /*#__PURE__*/ resourcesGetter<tLibraryAlbumsResponse>("getLibraryAlbums", libraryAlbums);
/** Every album in the listener's library, a page at a time. */
export const listLibraryAlbums = /*#__PURE__*/ resourceLister<tLibraryAlbumsResponse>("listLibraryAlbums", libraryAlbums);
/** One relationship of a library album, such as its `tracks`, a page at a time. */
export const getLibraryAlbumRelationship = /*#__PURE__*/ relationshipGetter<tLibraryAlbumRelationships>("getLibraryAlbumRelationship", libraryAlbums);

// Library artists

/** The artist with an id in the listener's library. */
export const getLibraryArtist = /*#__PURE__*/ resourceGetter<tLibraryArtistsResponse>("getLibraryArtist", libraryArtists);
/** The artists with the ids given in the listener's library. */
export const getLibraryArtists = /*#__PURE__*/ resourcesGetter<tLibraryArtistsResponse>("getLibraryArtists", libraryArtists);
/** Every artist in the listener's library, a page at a time. */
export const listLibraryArtists = /*#__PURE__*/ resourceLister<tLibraryArtistsResponse>("listLibraryArtists", libraryArtists);
/** One relationship of a library artist, such as their `albums`, a page at a time. */
export const getLibraryArtistRelationship = /*#__PURE__*/ relationshipGetter<tLibraryArtistRelationships>("getLibraryArtistRelationship", libraryArtists);

// Library music videos

/** The music video with an id in the listener's library. */
export const getLibraryMusicVideo = /*#__PURE__*/ resourceGetter<tLibraryMusicVideosResponse>("getLibraryMusicVideo", libraryMusicVideos);
/** The music videos with the ids given in the listener's library. */
export const getLibraryMusicVideos = /*#__PURE__*/ resourcesGetter<tLibraryMusicVideosResponse>("getLibraryMusicVideos", libraryMusicVideos);
/** Every music video in the listener's library, a page at a time. */
export const listLibraryMusicVideos = /*#__PURE__*/ resourceLister<tLibraryMusicVideosResponse>("listLibraryMusicVideos", libraryMusicVideos);
/** One relationship of a library music video, such as its `artists`, a page at a time. */
export const getLibraryMusicVideoRelationship = /*#__PURE__*/ relationshipGetter<tLibraryMusicVideoRelationships>("getLibraryMusicVideoRelationship", libraryMusicVideos);

// Library playlists

/** The playlist with an id in the listener's library. */
export const getLibraryPlaylist = /*#__PURE__*/ resourceGetter<tLibraryPlaylistsResponse>("getLibraryPlaylist", libraryPlaylists);
/** The playlists with the ids given in the listener's library. */
export const getLibraryPlaylists = /*#__PURE__*/ resourcesGetter<tLibraryPlaylistsResponse>("getLibraryPlaylists", libraryPlaylists);
/** Every playlist in the listener's library, a page at a time. */
export const listLibraryPlaylists = /*#__PURE__*/ resourceLister<tLibraryPlaylistsResponse>("listLibraryPlaylists", libraryPlaylists);
/** One relationship of a library playlist, such as its `tracks`, a page at a time. */
export const getLibraryPlaylistRelationship = /*#__PURE__*/ relationshipGetter<tLibraryPlaylistRelationships>("getLibraryPlaylistRelationship", libraryPlaylists);

/** The options of `createLibraryPlaylist`. */
export type tCreateLibraryPlaylistOptions = tReadOptions<tLibraryPlaylistsResponse>;

/**
 * Makes a playlist in the listener's library: `{ attributes: { name } }`, with its tracks and the folder to put it
 * in under `relationships`. Resolves to the answer that holds the new playlist.
 */
export const createLibraryPlaylist = /*#__PURE__*/ endpoint(
  "createLibraryPlaylist",
  "resource",
  (_client, playlist: tLibraryPlaylistCreationRequest, options?: tCreateLibraryPlaylistOptions): tRequestPlan<tLibraryPlaylistsResponse> => {
    const body = bodyOf("createLibraryPlaylist", playlist, "a playlist to create, as { attributes: { name } }");
    const init = initOf<tLibraryPlaylistsResponse>("createLibraryPlaylist", optionsOf("createLibraryPlaylist", options, OPTIONS));
    return [libraryPlaylists(), { ...init, method: "POST", body }];
  },
);

// Library playlist folders

/** The playlist folder with an id in the listener's library. */
export const getLibraryPlaylistFolder = /*#__PURE__*/ resourceGetter<tLibraryPlaylistFoldersResponse>("getLibraryPlaylistFolder", libraryPlaylistFolders);
/** The playlist folders with the ids given in the listener's library. */
export const getLibraryPlaylistFolders = /*#__PURE__*/ resourcesGetter<tLibraryPlaylistFoldersResponse>("getLibraryPlaylistFolders", libraryPlaylistFolders);
/** One relationship of a library playlist folder, such as its `children`, a page at a time. */
export const getLibraryPlaylistFolderRelationship = /*#__PURE__*/ relationshipGetter<tLibraryPlaylistFolderRelationships>("getLibraryPlaylistFolderRelationship", libraryPlaylistFolders);

/** The options of `createLibraryPlaylistFolder`. */
export type tCreateLibraryPlaylistFolderOptions = tReadOptions<tLibraryPlaylistFoldersResponse>;

/**
 * Makes a playlist folder in the listener's library: `{ attributes: { name } }`, with the folder to put it in under
 * `relationships`. Resolves to the answer that holds the new folder.
 */
export const createLibraryPlaylistFolder = /*#__PURE__*/ endpoint(
  "createLibraryPlaylistFolder",
  "resource",
  (_client, folder: tLibraryPlaylistFolderCreationRequest, options?: tCreateLibraryPlaylistFolderOptions): tRequestPlan<tLibraryPlaylistFoldersResponse> => {
    const body = bodyOf("createLibraryPlaylistFolder", folder, "a playlist folder to create, as { attributes: { name } }");
    const init = initOf<tLibraryPlaylistFoldersResponse>("createLibraryPlaylistFolder", optionsOf("createLibraryPlaylistFolder", options, OPTIONS));
    return [libraryPlaylistFolders(), { ...init, method: "POST", body }];
  },
);

// Recommendations

/** The recommendation with an id, of the ones made for the listener. */
export const getPersonalRecommendation = /*#__PURE__*/ resourceGetter<tPersonalRecommendationResponse>("getPersonalRecommendation", personalRecommendations);
/** The recommendations with the ids given, of the ones made for the listener. */
export const getPersonalRecommendations = /*#__PURE__*/ resourcesGetter<tPersonalRecommendationResponse>("getPersonalRecommendations", personalRecommendations);
/** Every recommendation made for the listener, a page at a time. */
export const listPersonalRecommendations = /*#__PURE__*/ resourceLister<tPersonalRecommendationResponse>("listPersonalRecommendations", personalRecommendations);
/** One relationship of a recommendation, such as its `contents`, a page at a time. */
export const getPersonalRecommendationRelationship = /*#__PURE__*/ relationshipGetter<tPersonalRecommendationRelationships>("getPersonalRecommendationRelationship", personalRecommendations);

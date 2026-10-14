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

/**
 * The song with an id in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library song's id.
 * @param options - What to send beside the song.
 * @returns What Apple answered: the song under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibrarySong = /*#__PURE__*/ resourceGetter<tLibrarySongsResponse>("getLibrarySong", librarySongs);
/**
 * The songs with the ids given in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library songs' ids.
 * @param options - What to send beside the songs.
 * @returns What Apple answered: the songs under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibrarySongs = /*#__PURE__*/ resourcesGetter<tLibrarySongsResponse>("getLibrarySongs", librarySongs);
/**
 * Every song in the listener's library, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page, the songs under `data` and `next` when there are more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const listLibrarySongs = /*#__PURE__*/ resourceLister<tLibrarySongsResponse>("listLibrarySongs", librarySongs);
/**
 * One relationship of a library song, such as its `albums`, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library song's id.
 * @param name - The relationship's name, such as its `albums`.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page of what the relationship holds, under `data`, and `next` when there is more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibrarySongRelationship = /*#__PURE__*/ relationshipGetter<tLibrarySongRelationships>("getLibrarySongRelationship", librarySongs);

// Library albums

/**
 * The album with an id in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library album's id.
 * @param options - What to send beside the album.
 * @returns What Apple answered: the album under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryAlbum = /*#__PURE__*/ resourceGetter<tLibraryAlbumsResponse>("getLibraryAlbum", libraryAlbums);
/**
 * The albums with the ids given in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library albums' ids.
 * @param options - What to send beside the albums.
 * @returns What Apple answered: the albums under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryAlbums = /*#__PURE__*/ resourcesGetter<tLibraryAlbumsResponse>("getLibraryAlbums", libraryAlbums);
/**
 * Every album in the listener's library, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page, the albums under `data` and `next` when there are more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const listLibraryAlbums = /*#__PURE__*/ resourceLister<tLibraryAlbumsResponse>("listLibraryAlbums", libraryAlbums);
/**
 * One relationship of a library album, such as its `tracks`, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library album's id.
 * @param name - The relationship's name, such as its `tracks`.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page of what the relationship holds, under `data`, and `next` when there is more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryAlbumRelationship = /*#__PURE__*/ relationshipGetter<tLibraryAlbumRelationships>("getLibraryAlbumRelationship", libraryAlbums);

// Library artists

/**
 * The artist with an id in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library artist's id.
 * @param options - What to send beside the artist.
 * @returns What Apple answered: the artist under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryArtist = /*#__PURE__*/ resourceGetter<tLibraryArtistsResponse>("getLibraryArtist", libraryArtists);
/**
 * The artists with the ids given in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library artists' ids.
 * @param options - What to send beside the artists.
 * @returns What Apple answered: the artists under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryArtists = /*#__PURE__*/ resourcesGetter<tLibraryArtistsResponse>("getLibraryArtists", libraryArtists);
/**
 * Every artist in the listener's library, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page, the artists under `data` and `next` when there are more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const listLibraryArtists = /*#__PURE__*/ resourceLister<tLibraryArtistsResponse>("listLibraryArtists", libraryArtists);
/**
 * One relationship of a library artist, such as their `albums`, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library artist's id.
 * @param name - The relationship's name, such as their `albums`.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page of what the relationship holds, under `data`, and `next` when there is more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryArtistRelationship = /*#__PURE__*/ relationshipGetter<tLibraryArtistRelationships>("getLibraryArtistRelationship", libraryArtists);

// Library music videos

/**
 * The music video with an id in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library music video's id.
 * @param options - What to send beside the music video.
 * @returns What Apple answered: the music video under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryMusicVideo = /*#__PURE__*/ resourceGetter<tLibraryMusicVideosResponse>("getLibraryMusicVideo", libraryMusicVideos);
/**
 * The music videos with the ids given in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library music videos' ids.
 * @param options - What to send beside the music videos.
 * @returns What Apple answered: the music videos under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryMusicVideos = /*#__PURE__*/ resourcesGetter<tLibraryMusicVideosResponse>("getLibraryMusicVideos", libraryMusicVideos);
/**
 * Every music video in the listener's library, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page, the music videos under `data` and `next` when there are more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const listLibraryMusicVideos = /*#__PURE__*/ resourceLister<tLibraryMusicVideosResponse>("listLibraryMusicVideos", libraryMusicVideos);
/**
 * One relationship of a library music video, such as its `artists`, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library music video's id.
 * @param name - The relationship's name, such as its `artists`.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page of what the relationship holds, under `data`, and `next` when there is more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryMusicVideoRelationship = /*#__PURE__*/ relationshipGetter<tLibraryMusicVideoRelationships>("getLibraryMusicVideoRelationship", libraryMusicVideos);

// Library playlists

/**
 * The playlist with an id in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library playlist's id.
 * @param options - What to send beside the playlist.
 * @returns What Apple answered: the playlist under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryPlaylist = /*#__PURE__*/ resourceGetter<tLibraryPlaylistsResponse>("getLibraryPlaylist", libraryPlaylists);
/**
 * The playlists with the ids given in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library playlists' ids.
 * @param options - What to send beside the playlists.
 * @returns What Apple answered: the playlists under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryPlaylists = /*#__PURE__*/ resourcesGetter<tLibraryPlaylistsResponse>("getLibraryPlaylists", libraryPlaylists);
/**
 * Every playlist in the listener's library, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page, the playlists under `data` and `next` when there are more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const listLibraryPlaylists = /*#__PURE__*/ resourceLister<tLibraryPlaylistsResponse>("listLibraryPlaylists", libraryPlaylists);
/**
 * One relationship of a library playlist, such as its `tracks`, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library playlist's id.
 * @param name - The relationship's name, such as its `tracks`.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page of what the relationship holds, under `data`, and `next` when there is more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryPlaylistRelationship = /*#__PURE__*/ relationshipGetter<tLibraryPlaylistRelationships>("getLibraryPlaylistRelationship", libraryPlaylists);

/** The options of `createLibraryPlaylist`. */
export type tCreateLibraryPlaylistOptions = tReadOptions<tLibraryPlaylistsResponse>;

/**
 * Makes a playlist in the listener's library: `{ attributes: { name } }`, with its tracks and the folder to put it
 * in under `relationships`. Resolves to the answer that holds the new playlist. Bound, it gives the playlist, or
 * `undefined` if Apple's answer holds none: the playlist was made either way.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param playlist - The playlist to make: its name under `attributes`, and its tracks and the folder to put it in under `relationships`.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the new playlist under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const createLibraryPlaylist = /*#__PURE__*/ endpoint(
  "createLibraryPlaylist",
  "written",
  (_client, playlist: tLibraryPlaylistCreationRequest, options?: tCreateLibraryPlaylistOptions): tRequestPlan<tLibraryPlaylistsResponse> => {
    const body = bodyOf("createLibraryPlaylist", playlist, "a playlist to create, as { attributes: { name } }");
    const init = initOf<tLibraryPlaylistsResponse>("createLibraryPlaylist", optionsOf("createLibraryPlaylist", options, OPTIONS));
    return [libraryPlaylists(), { ...init, method: "POST", body }];
  },
);

// Library playlist folders

/**
 * The playlist folder with an id in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library playlist folder's id.
 * @param options - What to send beside the playlist folder.
 * @returns What Apple answered: the playlist folder under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryPlaylistFolder = /*#__PURE__*/ resourceGetter<tLibraryPlaylistFoldersResponse>("getLibraryPlaylistFolder", libraryPlaylistFolders);
/**
 * The playlist folders with the ids given in the listener's library.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The library playlist folders' ids.
 * @param options - What to send beside the playlist folders.
 * @returns What Apple answered: the playlist folders under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryPlaylistFolders = /*#__PURE__*/ resourcesGetter<tLibraryPlaylistFoldersResponse>("getLibraryPlaylistFolders", libraryPlaylistFolders);
/**
 * One relationship of a library playlist folder, such as its `children`, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The library playlist folder's id.
 * @param name - The relationship's name, such as its `children`.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page of what the relationship holds, under `data`, and `next` when there is more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getLibraryPlaylistFolderRelationship = /*#__PURE__*/ relationshipGetter<tLibraryPlaylistFolderRelationships>("getLibraryPlaylistFolderRelationship", libraryPlaylistFolders);

/** The options of `createLibraryPlaylistFolder`. */
export type tCreateLibraryPlaylistFolderOptions = tReadOptions<tLibraryPlaylistFoldersResponse>;

/**
 * Makes a playlist folder in the listener's library: `{ attributes: { name } }`, with the folder to put it in under
 * `relationships`. Resolves to the answer that holds the new folder. Bound, it gives the folder, or `undefined` if
 * Apple's answer holds none: the folder was made either way.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param folder - The folder to make: its name under `attributes`, and the folder to put it in under `relationships`.
 * @param options - The language to answer in, and what else to send with the request.
 * @returns What Apple answered: the new folder under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const createLibraryPlaylistFolder = /*#__PURE__*/ endpoint(
  "createLibraryPlaylistFolder",
  "written",
  (_client, folder: tLibraryPlaylistFolderCreationRequest, options?: tCreateLibraryPlaylistFolderOptions): tRequestPlan<tLibraryPlaylistFoldersResponse> => {
    const body = bodyOf("createLibraryPlaylistFolder", folder, "a playlist folder to create, as { attributes: { name } }");
    const init = initOf<tLibraryPlaylistFoldersResponse>("createLibraryPlaylistFolder", optionsOf("createLibraryPlaylistFolder", options, OPTIONS));
    return [libraryPlaylistFolders(), { ...init, method: "POST", body }];
  },
);

// Recommendations

/**
 * The recommendation with an id, of the ones made for the listener.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The recommendation's id.
 * @param options - What to send beside the recommendation.
 * @returns What Apple answered: the recommendation under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getPersonalRecommendation = /*#__PURE__*/ resourceGetter<tPersonalRecommendationResponse>("getPersonalRecommendation", personalRecommendations);
/**
 * The recommendations with the ids given, of the ones made for the listener.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param ids - The recommendations' ids.
 * @param options - What to send beside the recommendations.
 * @returns What Apple answered: the recommendations under `data`.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getPersonalRecommendations = /*#__PURE__*/ resourcesGetter<tPersonalRecommendationResponse>("getPersonalRecommendations", personalRecommendations);
/**
 * Every recommendation made for the listener, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page, the recommendations under `data` and `next` when there are more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const listPersonalRecommendations = /*#__PURE__*/ resourceLister<tPersonalRecommendationResponse>("listPersonalRecommendations", personalRecommendations);
/**
 * One relationship of a recommendation, such as its `contents`, a page at a time.
 *
 * @function
 * @param client - The listener's client to ask with.
 * @param id - The recommendation's id.
 * @param name - The relationship's name, such as its `contents`.
 * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
 * @returns What Apple answered: the first page of what the relationship holds, under `data`, and `next` when there is more.
 * @throws TypeError if an argument is not what it should be, before Apple is asked.
 * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
 * @throws The reason `options.signal` aborted with, when it does.
 */
export const getPersonalRecommendationRelationship = /*#__PURE__*/ relationshipGetter<tPersonalRecommendationRelationships>("getPersonalRecommendationRelationship", personalRecommendations);

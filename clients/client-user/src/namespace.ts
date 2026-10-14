// Every function of this package bound to one client, for code that holds a listener's client and wants what the
// answers hold. It is what an integration composes as `music.user`.
import { endpointNamespace, type tAppleMusicClient, type tEndpointNamespace } from "@open-music-sdk/core";
import * as library from "./library";
import * as ratings from "./ratings";
import * as resources from "./resources";

/**
 * Every function of this package by its name, each saying what it is for, as it does where it is declared.
 *
 * It is said twice because of how the package is published: its declarations are rolled into one file, where the
 * modules the functions are declared in become lists of names, with nothing of what was written above each
 * function. An interface keeps what is written above its members. So this is what `user(client)` is typed from, and
 * what lets an editor say of `music.user.getLibrarySong` what it says of `getLibrarySong`. A test holds the two to
 * the same names, the same types and the same words.
 */
export interface tUserFunctions {
  /**
   * The song with an id in the listener's library.
   *
   * @param id - The library song's id.
   * @param options - What to send beside the song.
   * @returns The song, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no song is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibrarySong: typeof resources.getLibrarySong;
  /**
   * The songs with the ids given in the listener's library.
   *
   * @param ids - The library songs' ids.
   * @param options - What to send beside the songs.
   * @returns The songs, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibrarySongs: typeof resources.getLibrarySongs;
  /**
   * Every song in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every song in the library, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listLibrarySongs: typeof resources.listLibrarySongs;
  /**
   * One relationship of a library song, such as its `albums`, a page at a time.
   *
   * @param id - The library song's id.
   * @param name - The relationship's name, such as its `albums`.
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything the relationship holds, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibrarySongRelationship: typeof resources.getLibrarySongRelationship;
  /**
   * The album with an id in the listener's library.
   *
   * @param id - The library album's id.
   * @param options - What to send beside the album.
   * @returns The album, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no album is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryAlbum: typeof resources.getLibraryAlbum;
  /**
   * The albums with the ids given in the listener's library.
   *
   * @param ids - The library albums' ids.
   * @param options - What to send beside the albums.
   * @returns The albums, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryAlbums: typeof resources.getLibraryAlbums;
  /**
   * Every album in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every album in the library, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listLibraryAlbums: typeof resources.listLibraryAlbums;
  /**
   * One relationship of a library album, such as its `tracks`, a page at a time.
   *
   * @param id - The library album's id.
   * @param name - The relationship's name, such as its `tracks`.
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything the relationship holds, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryAlbumRelationship: typeof resources.getLibraryAlbumRelationship;
  /**
   * The artist with an id in the listener's library.
   *
   * @param id - The library artist's id.
   * @param options - What to send beside the artist.
   * @returns The artist, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no artist is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryArtist: typeof resources.getLibraryArtist;
  /**
   * The artists with the ids given in the listener's library.
   *
   * @param ids - The library artists' ids.
   * @param options - What to send beside the artists.
   * @returns The artists, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryArtists: typeof resources.getLibraryArtists;
  /**
   * Every artist in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every artist in the library, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listLibraryArtists: typeof resources.listLibraryArtists;
  /**
   * One relationship of a library artist, such as their `albums`, a page at a time.
   *
   * @param id - The library artist's id.
   * @param name - The relationship's name, such as their `albums`.
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything the relationship holds, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryArtistRelationship: typeof resources.getLibraryArtistRelationship;
  /**
   * The music video with an id in the listener's library.
   *
   * @param id - The library music video's id.
   * @param options - What to send beside the music video.
   * @returns The music video, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no music video is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryMusicVideo: typeof resources.getLibraryMusicVideo;
  /**
   * The music videos with the ids given in the listener's library.
   *
   * @param ids - The library music videos' ids.
   * @param options - What to send beside the music videos.
   * @returns The music videos, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryMusicVideos: typeof resources.getLibraryMusicVideos;
  /**
   * Every music video in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every music video in the library, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listLibraryMusicVideos: typeof resources.listLibraryMusicVideos;
  /**
   * One relationship of a library music video, such as its `artists`, a page at a time.
   *
   * @param id - The library music video's id.
   * @param name - The relationship's name, such as its `artists`.
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything the relationship holds, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryMusicVideoRelationship: typeof resources.getLibraryMusicVideoRelationship;
  /**
   * The playlist with an id in the listener's library.
   *
   * @param id - The library playlist's id.
   * @param options - What to send beside the playlist.
   * @returns The playlist, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no playlist is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylist: typeof resources.getLibraryPlaylist;
  /**
   * The playlists with the ids given in the listener's library.
   *
   * @param ids - The library playlists' ids.
   * @param options - What to send beside the playlists.
   * @returns The playlists, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylists: typeof resources.getLibraryPlaylists;
  /**
   * Every playlist in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every playlist in the library, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listLibraryPlaylists: typeof resources.listLibraryPlaylists;
  /**
   * One relationship of a library playlist, such as its `tracks`, a page at a time.
   *
   * @param id - The library playlist's id.
   * @param name - The relationship's name, such as its `tracks`.
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything the relationship holds, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylistRelationship: typeof resources.getLibraryPlaylistRelationship;
  /**
   * Makes a playlist in the listener's library: `{ attributes: { name } }`, with its tracks and the folder to put it
   * in under `relationships`. Resolves to the answer that holds the new playlist. Bound, it gives the playlist, or
   * `undefined` if Apple's answer holds none: the playlist was made either way.
   *
   * @param playlist - The playlist to make: its name under `attributes`, and its tracks and the folder to put it in under `relationships`.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The new playlist, out of Apple's answer, or `undefined` when the answer holds none: it was made either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly createLibraryPlaylist: typeof resources.createLibraryPlaylist;
  /**
   * The playlist folder with an id in the listener's library.
   *
   * @param id - The library playlist folder's id.
   * @param options - What to send beside the playlist folder.
   * @returns The playlist folder, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no playlist folder is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylistFolder: typeof resources.getLibraryPlaylistFolder;
  /**
   * The playlist folders with the ids given in the listener's library.
   *
   * @param ids - The library playlist folders' ids.
   * @param options - What to send beside the playlist folders.
   * @returns The playlist folders, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylistFolders: typeof resources.getLibraryPlaylistFolders;
  /**
   * One relationship of a library playlist folder, such as its `children`, a page at a time.
   *
   * @param id - The library playlist folder's id.
   * @param name - The relationship's name, such as its `children`.
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything the relationship holds, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylistFolderRelationship: typeof resources.getLibraryPlaylistFolderRelationship;
  /**
   * Makes a playlist folder in the listener's library: `{ attributes: { name } }`, with the folder to put it in under
   * `relationships`. Resolves to the answer that holds the new folder. Bound, it gives the folder, or `undefined` if
   * Apple's answer holds none: the folder was made either way.
   *
   * @param folder - The folder to make: its name under `attributes`, and the folder to put it in under `relationships`.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The new folder, out of Apple's answer, or `undefined` when the answer holds none: it was made either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly createLibraryPlaylistFolder: typeof resources.createLibraryPlaylistFolder;
  /**
   * The recommendation with an id, of the ones made for the listener.
   *
   * @param id - The recommendation's id.
   * @param options - What to send beside the recommendation.
   * @returns The recommendation, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no recommendation is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getPersonalRecommendation: typeof resources.getPersonalRecommendation;
  /**
   * The recommendations with the ids given, of the ones made for the listener.
   *
   * @param ids - The recommendations' ids.
   * @param options - What to send beside the recommendations.
   * @returns The recommendations, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getPersonalRecommendations: typeof resources.getPersonalRecommendations;
  /**
   * Every recommendation made for the listener, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every recommendation made for the listener, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listPersonalRecommendations: typeof resources.listPersonalRecommendations;
  /**
   * One relationship of a recommendation, such as its `contents`, a page at a time.
   *
   * @param id - The recommendation's id.
   * @param name - The relationship's name, such as its `contents`.
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything the relationship holds, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getPersonalRecommendationRelationship: typeof resources.getPersonalRecommendationRelationship;
  /**
   * The listener's rating of the song with an id.
   *
   * @param id - The song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getSongRating: typeof ratings.getSongRating;
  /**
   * The listener's ratings of the songs with the ids given.
   *
   * @param ids - The songs' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getSongRatings: typeof ratings.getSongRatings;
  /**
   * Sets the listener's rating of the song with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The song's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setSongRating: typeof ratings.setSongRating;
  /**
   * Takes away the listener's rating of the song with an id.
   *
   * @param id - The song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteSongRating: typeof ratings.deleteSongRating;
  /**
   * The listener's rating of the album with an id.
   *
   * @param id - The album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getAlbumRating: typeof ratings.getAlbumRating;
  /**
   * The listener's ratings of the albums with the ids given.
   *
   * @param ids - The albums' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getAlbumRatings: typeof ratings.getAlbumRatings;
  /**
   * Sets the listener's rating of the album with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The album's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setAlbumRating: typeof ratings.setAlbumRating;
  /**
   * Takes away the listener's rating of the album with an id.
   *
   * @param id - The album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteAlbumRating: typeof ratings.deleteAlbumRating;
  /**
   * The listener's rating of the music video with an id.
   *
   * @param id - The music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getMusicVideoRating: typeof ratings.getMusicVideoRating;
  /**
   * The listener's ratings of the music videos with the ids given.
   *
   * @param ids - The music videos' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getMusicVideoRatings: typeof ratings.getMusicVideoRatings;
  /**
   * Sets the listener's rating of the music video with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The music video's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setMusicVideoRating: typeof ratings.setMusicVideoRating;
  /**
   * Takes away the listener's rating of the music video with an id.
   *
   * @param id - The music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteMusicVideoRating: typeof ratings.deleteMusicVideoRating;
  /**
   * The listener's rating of the playlist with an id.
   *
   * @param id - The playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getPlaylistRating: typeof ratings.getPlaylistRating;
  /**
   * The listener's ratings of the playlists with the ids given.
   *
   * @param ids - The playlists' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getPlaylistRatings: typeof ratings.getPlaylistRatings;
  /**
   * Sets the listener's rating of the playlist with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The playlist's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setPlaylistRating: typeof ratings.setPlaylistRating;
  /**
   * Takes away the listener's rating of the playlist with an id.
   *
   * @param id - The playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deletePlaylistRating: typeof ratings.deletePlaylistRating;
  /**
   * The listener's rating of the station with an id.
   *
   * @param id - The station's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getStationRating: typeof ratings.getStationRating;
  /**
   * The listener's ratings of the stations with the ids given.
   *
   * @param ids - The stations' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getStationRatings: typeof ratings.getStationRatings;
  /**
   * Sets the listener's rating of the station with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The station's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setStationRating: typeof ratings.setStationRating;
  /**
   * Takes away the listener's rating of the station with an id.
   *
   * @param id - The station's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteStationRating: typeof ratings.deleteStationRating;
  /**
   * The listener's rating of the library song with an id.
   *
   * @param id - The library song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibrarySongRating: typeof ratings.getLibrarySongRating;
  /**
   * The listener's ratings of the library songs with the ids given.
   *
   * @param ids - The library songs' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibrarySongRatings: typeof ratings.getLibrarySongRatings;
  /**
   * Sets the listener's rating of the library song with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library song's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setLibrarySongRating: typeof ratings.setLibrarySongRating;
  /**
   * Takes away the listener's rating of the library song with an id.
   *
   * @param id - The library song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteLibrarySongRating: typeof ratings.deleteLibrarySongRating;
  /**
   * The listener's rating of the library album with an id.
   *
   * @param id - The library album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryAlbumRating: typeof ratings.getLibraryAlbumRating;
  /**
   * The listener's ratings of the library albums with the ids given.
   *
   * @param ids - The library albums' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryAlbumRatings: typeof ratings.getLibraryAlbumRatings;
  /**
   * Sets the listener's rating of the library album with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library album's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setLibraryAlbumRating: typeof ratings.setLibraryAlbumRating;
  /**
   * Takes away the listener's rating of the library album with an id.
   *
   * @param id - The library album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteLibraryAlbumRating: typeof ratings.deleteLibraryAlbumRating;
  /**
   * The listener's rating of the library music video with an id.
   *
   * @param id - The library music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryMusicVideoRating: typeof ratings.getLibraryMusicVideoRating;
  /**
   * The listener's ratings of the library music videos with the ids given.
   *
   * @param ids - The library music videos' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryMusicVideoRatings: typeof ratings.getLibraryMusicVideoRatings;
  /**
   * Sets the listener's rating of the library music video with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library music video's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setLibraryMusicVideoRating: typeof ratings.setLibraryMusicVideoRating;
  /**
   * Takes away the listener's rating of the library music video with an id.
   *
   * @param id - The library music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteLibraryMusicVideoRating: typeof ratings.deleteLibraryMusicVideoRating;
  /**
   * The listener's rating of the library playlist with an id.
   *
   * @param id - The library playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no rating is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylistRating: typeof ratings.getLibraryPlaylistRating;
  /**
   * The listener's ratings of the library playlists with the ids given.
   *
   * @param ids - The library playlists' ids.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryPlaylistRatings: typeof ratings.getLibraryPlaylistRatings;
  /**
   * Sets the listener's rating of the library playlist with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library playlist's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating as set, out of Apple's answer, or `undefined` when the answer holds none: it was set either way.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly setLibraryPlaylistRating: typeof ratings.setLibraryPlaylistRating;
  /**
   * Takes away the listener's rating of the library playlist with an id.
   *
   * @param id - The library playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: `undefined` once Apple has taken the rating away.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly deleteLibraryPlaylistRating: typeof ratings.deleteLibraryPlaylistRating;
  /**
   * Searches the listener's library for a term, and resolves to the results by type, each one a first page. `limit`
   * and `offset` apply to every type asked for.
   *
   * @param term - What to look for, as the listener typed it.
   * @param options - The types to look for, which have to be given; how many of each to send and where to start; and what to send beside each.
   * @returns Apple's answer as it is, the results by type under `results`: it holds no one `data` to hand over in its place.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly searchLibrary: typeof library.searchLibrary;
  /**
   * Library resources of several types in one request, by their ids: `{ "library-songs": [...] }`. One type at least has to be given.
   *
   * @param ids - The ids by type of library resource, one type at least.
   * @param options - What to send beside the resources.
   * @returns The resources of every type asked for, out of Apple's answer: one list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getLibraryResources: typeof library.getLibraryResources;
  /**
   * Adds catalog resources to the listener's library, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards.
   *
   * @param ids - The ids of the catalog resources to add, by type, one type at least.
   * @param options - What else to send with the request, such as a `signal` to abort it with.
   * @returns Nothing: `undefined` once Apple has accepted the request, which is before the resources appear in the library.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly addToLibrary: typeof library.addToLibrary;
  /**
   * Adds resources to the listener's favorites, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards.
   *
   * @param ids - The ids of the resources to add, by type, one type at least.
   * @param options - What else to send with the request, such as a `signal` to abort it with.
   * @returns Nothing: `undefined` once Apple has accepted the request, which is before the resources appear among the favorites.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly addToFavorites: typeof library.addToFavorites;
  /**
   * Adds tracks to the end of a playlist in the listener's library: `[{ id, type: "songs" }]`. It resolves to nothing.
   *
   * @param id - The library playlist's id.
   * @param tracks - The tracks to add: each its id and its type, and nothing else of it is sent.
   * @param options - What else to send with the request, such as a `signal` to abort it with.
   * @returns Nothing: `undefined` once Apple has accepted the tracks.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly addLibraryPlaylistTracks: typeof library.addLibraryPlaylistTracks;
  /**
   * The folder every playlist and playlist folder of the listener's library is in, at the top: where to start going down from.
   *
   * @param options - What to send beside the folder.
   * @returns The root folder, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no folder is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getRootLibraryPlaylistFolder: typeof library.getRootLibraryPlaylistFolder;
  /**
   * What the listener added to their library lately, newest first, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything added lately, newest first, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listRecentlyAdded: typeof library.listRecentlyAdded;
  /**
   * What the listener plays most at present, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything played most at present, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listHeavyRotation: typeof library.listHeavyRotation;
  /**
   * What the listener played lately, newest first, a page at a time: the albums, playlists and stations, not the tracks in them.
   *
   * @param options - The types to keep to, and the rest: how many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Everything played lately, newest first, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listRecentlyPlayed: typeof library.listRecentlyPlayed;
  /**
   * The tracks the listener played lately, newest first, a page at a time.
   *
   * @param options - The types to keep to, and the rest: how many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every track played lately, newest first, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listRecentlyPlayedTracks: typeof library.listRecentlyPlayedTracks;
  /**
   * The radio stations the listener played lately, newest first, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside each, and the most pages a walk may ask for.
   * @returns Every station played lately, newest first, from every page: each page is asked for as the one before runs out, and none until the loop starts.
   * @throws TypeError if an argument is not what it should be: thrown as it is called, before any loop, and before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails as the loop asks for a page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly listRecentlyPlayedStations: typeof library.listRecentlyPlayedStations;
  /**
   * The listener's replay: a summary of what they played in each of the years given. The one year Apple takes at present is `"latest"`.
   *
   * @param values - The years, as Apple names them: `"latest"` is the one it takes at present.
   * @param options - The views to send with each summary, and what else to send beside it.
   * @returns The summaries, out of Apple's answer: a list, empty when it holds none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getMusicSummariesByYear: typeof library.getMusicSummariesByYear;
  /**
   * The listener's own station, which plays what Apple picks for them. It is kept in the catalog, and is the one
   * resource there that is asked for with the Music User Token.
   *
   * @param options - The storefront whose catalog the station is in, and what to send beside it.
   * @returns The station, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no station is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getPersonalStation: typeof library.getPersonalStation;
  /**
   * The storefront the listener's account is in: the one whose catalog they see.
   *
   * @param options - What to send beside the storefront.
   * @returns The storefront, out of Apple's answer.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails; `_tag` says which. An answer that holds no storefront is an `ApiError` with the status it came with.
   * @throws The reason `options.signal` aborted with, when it does.
   */
  readonly getUserStorefront: typeof library.getUserStorefront;
}

/**
 * A listener's side of Apple Music as one client sees it: each function of this package under its own name, taking
 * the same arguments without the client, and handing over what the answer holds. A `get` of one resource, a
 * `create` and a `set` give the resource, a `get` of several gives the list, and a `list` or a relationship gives
 * every item of every page as it is looped over. A search gives Apple's answer as it is, and what adds or deletes
 * gives nothing.
 */
export type tUser = tEndpointNamespace<tUserFunctions>;

/**
 * The listener's side for one client, which has to be a listener's: one made with a Music User Token. Each call makes
 * a new one, which cannot be changed.
 *
 * @param client - The listener's client, which every function of the namespace asks with.
 * @returns Every function of this package bound to the client, under its own name, frozen.
 * @throws TypeError if `client` is no client from `createClient`. A client that holds no Music User Token is taken, and each call is then refused by the client, before Apple is asked.
 */
export function user(client: tAppleMusicClient): tUser {
  // Gathered here and not beside the imports, so that code which never calls this carries none of the functions it did not import itself.
  return endpointNamespace("user", client, { ...resources, ...ratings, ...library });
}

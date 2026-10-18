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
   * @returns The song, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no song, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibrarySong: typeof resources.getLibrarySong;
  /**
   * The songs with the ids given in the listener's library.
   *
   * @param ids - The library songs' ids, 1 to 300 of them.
   * @param options - What to send beside the songs.
   * @returns The songs, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibrarySongs: typeof resources.getLibrarySongs;
  /**
   * Every song in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every song of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listLibrarySongs: typeof resources.listLibrarySongs;
  /**
   * One relationship of a library song, such as its `albums`, a page at a time.
   *
   * @param id - The library song's id.
   * @param name - The relationship's name, one of the library song's as the type has them; Apple says whether there is such a one.
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibrarySongRelationship: typeof resources.getLibrarySongRelationship;
  /**
   * The album with an id in the listener's library.
   *
   * @param id - The library album's id.
   * @param options - What to send beside the album.
   * @returns The album, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no album, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryAlbum: typeof resources.getLibraryAlbum;
  /**
   * The albums with the ids given in the listener's library.
   *
   * @param ids - The library albums' ids, 1 to 300 of them.
   * @param options - What to send beside the albums.
   * @returns The albums, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryAlbums: typeof resources.getLibraryAlbums;
  /**
   * Every album in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every album of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listLibraryAlbums: typeof resources.listLibraryAlbums;
  /**
   * One relationship of a library album, such as its `tracks`, a page at a time.
   *
   * @param id - The library album's id.
   * @param name - The relationship's name, one of the library album's as the type has them; Apple says whether there is such a one.
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryAlbumRelationship: typeof resources.getLibraryAlbumRelationship;
  /**
   * The artist with an id in the listener's library.
   *
   * @param id - The library artist's id.
   * @param options - What to send beside the artist.
   * @returns The artist, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no artist, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryArtist: typeof resources.getLibraryArtist;
  /**
   * The artists with the ids given in the listener's library.
   *
   * @param ids - The library artists' ids, 1 to 300 of them.
   * @param options - What to send beside the artists.
   * @returns The artists, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryArtists: typeof resources.getLibraryArtists;
  /**
   * Every artist in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every artist of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listLibraryArtists: typeof resources.listLibraryArtists;
  /**
   * One relationship of a library artist, such as their `albums`, a page at a time.
   *
   * @param id - The library artist's id.
   * @param name - The relationship's name, one of the library artist's as the type has them; Apple says whether there is such a one.
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryArtistRelationship: typeof resources.getLibraryArtistRelationship;
  /**
   * The music video with an id in the listener's library.
   *
   * @param id - The library music video's id.
   * @param options - What to send beside the music video.
   * @returns The music video, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no music video, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryMusicVideo: typeof resources.getLibraryMusicVideo;
  /**
   * The music videos with the ids given in the listener's library.
   *
   * @param ids - The library music videos' ids, 1 to 300 of them.
   * @param options - What to send beside the music videos.
   * @returns The music videos, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryMusicVideos: typeof resources.getLibraryMusicVideos;
  /**
   * Every music video in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every music video of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listLibraryMusicVideos: typeof resources.listLibraryMusicVideos;
  /**
   * One relationship of a library music video, such as its `artists`, a page at a time.
   *
   * @param id - The library music video's id.
   * @param name - The relationship's name, one of the library music video's as the type has them; Apple says whether there is such a one.
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryMusicVideoRelationship: typeof resources.getLibraryMusicVideoRelationship;
  /**
   * The playlist with an id in the listener's library.
   *
   * @param id - The library playlist's id.
   * @param options - What to send beside the playlist.
   * @returns The playlist, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no playlist, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylist: typeof resources.getLibraryPlaylist;
  /**
   * The playlists with the ids given in the listener's library.
   *
   * @param ids - The library playlists' ids, 1 to 300 of them.
   * @param options - What to send beside the playlists.
   * @returns The playlists, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylists: typeof resources.getLibraryPlaylists;
  /**
   * Every playlist in the listener's library, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every playlist of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listLibraryPlaylists: typeof resources.listLibraryPlaylists;
  /**
   * One relationship of a library playlist, such as its `tracks`, a page at a time.
   *
   * @param id - The library playlist's id.
   * @param name - The relationship's name, one of the library playlist's as the type has them; Apple says whether there is such a one.
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylistRelationship: typeof resources.getLibraryPlaylistRelationship;
  /**
   * Makes a playlist in the listener's library: `{ attributes: { name } }`, with its tracks and the folder to put it
   * in under `relationships`. Resolves to the answer that holds the new playlist. Bound, it gives the playlist, or
   * `undefined` if Apple's answer holds none: the playlist was made either way. The playlist has to be a plain object,
   * and still one once made into JSON. It is copied as the call is made and sent as it is: what it holds is Apple's to
   * judge, and nothing here limits its size, so limit it yourself if it comes from outside your app.
   *
   * @param playlist - The playlist to make: its name under `attributes`, and its tracks and the folder to put it in under `relationships`.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly createLibraryPlaylist: typeof resources.createLibraryPlaylist;
  /**
   * The playlist folder with an id in the listener's library.
   *
   * @param id - The library playlist folder's id.
   * @param options - What to send beside the playlist folder.
   * @returns The playlist folder, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no playlist folder, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylistFolder: typeof resources.getLibraryPlaylistFolder;
  /**
   * The playlist folders with the ids given in the listener's library.
   *
   * @param ids - The library playlist folders' ids, 1 to 300 of them.
   * @param options - What to send beside the playlist folders.
   * @returns The playlist folders, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylistFolders: typeof resources.getLibraryPlaylistFolders;
  /**
   * One relationship of a library playlist folder, such as its `children`, a page at a time.
   *
   * @param id - The library playlist folder's id.
   * @param name - The relationship's name, one of the library playlist folder's as the type has them; Apple says whether there is such a one.
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylistFolderRelationship: typeof resources.getLibraryPlaylistFolderRelationship;
  /**
   * Makes a playlist folder in the listener's library: `{ attributes: { name } }`, with the folder to put it in under
   * `relationships`. Resolves to the answer that holds the new folder. Bound, it gives the folder, or `undefined` if
   * Apple's answer holds none: the folder was made either way. The folder has to be a plain object, and still one once
   * made into JSON. It is copied as the call is made and sent as it is: what it holds is Apple's to judge, and nothing
   * here limits its size, so limit it yourself if it comes from outside your app.
   *
   * @param folder - The folder to make: its name under `attributes`, and the folder to put it in under `relationships`.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly createLibraryPlaylistFolder: typeof resources.createLibraryPlaylistFolder;
  /**
   * The recommendation with an id, of the ones made for the listener.
   *
   * @param id - The recommendation's id.
   * @param options - What to send beside the recommendation.
   * @returns The recommendation, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no recommendation, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPersonalRecommendation: typeof resources.getPersonalRecommendation;
  /**
   * The recommendations with the ids given, of the ones made for the listener.
   *
   * @param ids - The recommendations' ids, 1 to 300 of them.
   * @param options - What to send beside the recommendations.
   * @returns The recommendations, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPersonalRecommendations: typeof resources.getPersonalRecommendations;
  /**
   * Every recommendation made for the listener, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every recommendation of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listPersonalRecommendations: typeof resources.listPersonalRecommendations;
  /**
   * One relationship of a recommendation, such as its `contents`, a page at a time.
   *
   * @param id - The recommendation's id.
   * @param name - The relationship's name, one of the recommendation's as the type has them; Apple says whether there is such a one.
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPersonalRecommendationRelationship: typeof resources.getPersonalRecommendationRelationship;
  /**
   * The listener's rating of the song with an id. A song the listener never rated is answered 404, an `ApiError`, as it
   * was against the live API on 18 October 2026.
   *
   * @param id - The song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSongRating: typeof ratings.getSongRating;
  /**
   * The listener's ratings of the songs with the ids given. Songs the listener never rated are left out, as they were
   * against the live API on 18 October 2026.
   *
   * @param ids - The songs' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSongRatings: typeof ratings.getSongRatings;
  /**
   * Sets the listener's rating of the song with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The song's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setSongRating: typeof ratings.setSongRating;
  /**
   * Takes away the listener's rating of the song with an id.
   *
   * @param id - The song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteSongRating: typeof ratings.deleteSongRating;
  /**
   * The listener's rating of the album with an id.
   *
   * @param id - The album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbumRating: typeof ratings.getAlbumRating;
  /**
   * The listener's ratings of the albums with the ids given.
   *
   * @param ids - The albums' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbumRatings: typeof ratings.getAlbumRatings;
  /**
   * Sets the listener's rating of the album with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The album's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setAlbumRating: typeof ratings.setAlbumRating;
  /**
   * Takes away the listener's rating of the album with an id.
   *
   * @param id - The album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteAlbumRating: typeof ratings.deleteAlbumRating;
  /**
   * The listener's rating of the music video with an id.
   *
   * @param id - The music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideoRating: typeof ratings.getMusicVideoRating;
  /**
   * The listener's ratings of the music videos with the ids given.
   *
   * @param ids - The music videos' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideoRatings: typeof ratings.getMusicVideoRatings;
  /**
   * Sets the listener's rating of the music video with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The music video's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setMusicVideoRating: typeof ratings.setMusicVideoRating;
  /**
   * Takes away the listener's rating of the music video with an id.
   *
   * @param id - The music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteMusicVideoRating: typeof ratings.deleteMusicVideoRating;
  /**
   * The listener's rating of the playlist with an id.
   *
   * @param id - The playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPlaylistRating: typeof ratings.getPlaylistRating;
  /**
   * The listener's ratings of the playlists with the ids given.
   *
   * @param ids - The playlists' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPlaylistRatings: typeof ratings.getPlaylistRatings;
  /**
   * Sets the listener's rating of the playlist with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The playlist's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setPlaylistRating: typeof ratings.setPlaylistRating;
  /**
   * Takes away the listener's rating of the playlist with an id.
   *
   * @param id - The playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deletePlaylistRating: typeof ratings.deletePlaylistRating;
  /**
   * The listener's rating of the station with an id.
   *
   * @param id - The station's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStationRating: typeof ratings.getStationRating;
  /**
   * The listener's ratings of the stations with the ids given.
   *
   * @param ids - The stations' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStationRatings: typeof ratings.getStationRatings;
  /**
   * Sets the listener's rating of the station with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The station's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setStationRating: typeof ratings.setStationRating;
  /**
   * Takes away the listener's rating of the station with an id.
   *
   * @param id - The station's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteStationRating: typeof ratings.deleteStationRating;
  /**
   * The listener's rating of the library song with an id.
   *
   * @param id - The library song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibrarySongRating: typeof ratings.getLibrarySongRating;
  /**
   * The listener's ratings of the library songs with the ids given.
   *
   * @param ids - The library songs' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibrarySongRatings: typeof ratings.getLibrarySongRatings;
  /**
   * Sets the listener's rating of the library song with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library song's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setLibrarySongRating: typeof ratings.setLibrarySongRating;
  /**
   * Takes away the listener's rating of the library song with an id.
   *
   * @param id - The library song's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteLibrarySongRating: typeof ratings.deleteLibrarySongRating;
  /**
   * The listener's rating of the library album with an id.
   *
   * @param id - The library album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryAlbumRating: typeof ratings.getLibraryAlbumRating;
  /**
   * The listener's ratings of the library albums with the ids given.
   *
   * @param ids - The library albums' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryAlbumRatings: typeof ratings.getLibraryAlbumRatings;
  /**
   * Sets the listener's rating of the library album with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library album's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setLibraryAlbumRating: typeof ratings.setLibraryAlbumRating;
  /**
   * Takes away the listener's rating of the library album with an id.
   *
   * @param id - The library album's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteLibraryAlbumRating: typeof ratings.deleteLibraryAlbumRating;
  /**
   * The listener's rating of the library music video with an id.
   *
   * @param id - The library music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryMusicVideoRating: typeof ratings.getLibraryMusicVideoRating;
  /**
   * The listener's ratings of the library music videos with the ids given.
   *
   * @param ids - The library music videos' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryMusicVideoRatings: typeof ratings.getLibraryMusicVideoRatings;
  /**
   * Sets the listener's rating of the library music video with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library music video's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setLibraryMusicVideoRating: typeof ratings.setLibraryMusicVideoRating;
  /**
   * Takes away the listener's rating of the library music video with an id.
   *
   * @param id - The library music video's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteLibraryMusicVideoRating: typeof ratings.deleteLibraryMusicVideoRating;
  /**
   * The listener's rating of the library playlist with an id.
   *
   * @param id - The library playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The rating, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no rating, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylistRating: typeof ratings.getLibraryPlaylistRating;
  /**
   * The listener's ratings of the library playlists with the ids given.
   *
   * @param ids - The library playlists' ids, 1 to 300 of them.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns The ratings, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryPlaylistRatings: typeof ratings.getLibraryPlaylistRatings;
  /**
   * Sets the listener's rating of the library playlist with an id: 1 for a like, -1 for a dislike.
   *
   * @param id - The library playlist's id.
   * @param value - The rating: 1 for a like, -1 for a dislike.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns What Apple sent back of what was written, out of `data`, or `undefined` where it sent nothing.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly setLibraryPlaylistRating: typeof ratings.setLibraryPlaylistRating;
  /**
   * Takes away the listener's rating of the library playlist with an id.
   *
   * @param id - The library playlist's id.
   * @param options - The language to answer in, and what else to send with the request.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly deleteLibraryPlaylistRating: typeof ratings.deleteLibraryPlaylistRating;
  /**
   * Searches the listener's library for a term, and resolves to the results by type, each one a first page. `limit`
   * and `offset` apply to every type asked for. A `next` link of a search answers with results by type again, not with
   * a page, so `paginate` stops after the first page: to get more of one type, ask again with a larger `offset`.
   * Against the live API on 18 October 2026, the whole name of a song of three words or more found nothing, while
   * the first word of it found the song.
   *
   * @param term - What to search for, 1 to 256 characters.
   * @param options - The types to look for, which have to be given; how many of each to send and where to start; and what to send beside each.
   * @returns What Apple answered: the results by type under `results`, each a first page of its own.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly searchLibrary: typeof library.searchLibrary;
  /**
   * Library resources of several types in one request, by their ids: `{ "library-songs": [...] }`. One type at least has to be given.
   *
   * @param ids - Ids by type of library resource: 1 to 32 types with 1 to 300 ids between them; a type whose list is `undefined` is left out.
   * @param options - What to send beside the resources.
   * @returns The resources, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLibraryResources: typeof library.getLibraryResources;
  /**
   * Adds catalog resources to the listener's library, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards. Against the live API on 18 October 2026, a song, an album, a playlist and a music video each showed in the library within 4 seconds, and the playlist's songs did not go into the library with it.
   *
   * @param ids - The ids of the catalog resources to add, by type: 1 to 32 types with 1 to 300 ids between them; a type whose list is `undefined` is left out.
   * @param options - What else to send with the request, such as a `signal` to abort it with.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly addToLibrary: typeof library.addToLibrary;
  /**
   * Adds resources to the listener's favorites, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards. Against the live API on 18 October 2026, a song made a favorite had a rating of 1 at once, as a like does, and was put in the library too.
   *
   * @param ids - The ids of the resources to add, by type: 1 to 32 types with 1 to 300 ids between them; a type whose list is `undefined` is left out.
   * @param options - What else to send with the request, such as a `signal` to abort it with.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly addToFavorites: typeof library.addToFavorites;
  /**
   * Adds tracks to the end of a playlist in the listener's library: `[{ id, type: "songs" }]`. It resolves to nothing.
   *
   * @param id - The library playlist's id.
   * @param tracks - What to add, 1 to 300 of them, each by `id` and `type`; nothing else of a track is sent.
   * @param options - What else to send with the request, such as a `signal` to abort it with.
   * @returns Nothing: it resolves once Apple has accepted the write.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly addLibraryPlaylistTracks: typeof library.addLibraryPlaylistTracks;
  /**
   * The folder every playlist and playlist folder of the listener's library is in, at the top: where to start going down from.
   * Against the live API on 18 October 2026, a listener with no folder was answered with none: `data` was empty, and so
   * was `meta.filters.identity.playlistsroot`. The folder `p.playlistsroot` was answered `404` by its id, and its
   * `children` were the listener's playlists.
   *
   * @param options - What to send beside the folder.
   * @returns The root folder, out of `data`. A listener with no folder was answered with none, which this rejects.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no folder, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getRootLibraryPlaylistFolder: typeof library.getRootLibraryPlaylistFolder;
  /**
   * What the listener added to their library lately, newest first, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listRecentlyAdded: typeof library.listRecentlyAdded;
  /**
   * What the listener plays most at present, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listHeavyRotation: typeof library.listHeavyRotation;
  /**
   * What the listener played lately, newest first, a page at a time: the albums, playlists and stations, not the tracks in them.
   *
   * @param options - The types to keep to, how many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listRecentlyPlayed: typeof library.listRecentlyPlayed;
  /**
   * The tracks the listener played lately, newest first, a page at a time.
   *
   * @param options - The types to keep to, how many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every track of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listRecentlyPlayedTracks: typeof library.listRecentlyPlayedTracks;
  /**
   * The radio stations the listener played lately, newest first, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every station of every page, asking for each page as the one before runs out; `maxPages` says how many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listRecentlyPlayedStations: typeof library.listRecentlyPlayedStations;
  /**
   * The listener's replay: a summary of what they played in each of the years given. The one year Apple takes at present is `"latest"`.
   *
   * @param values - The years, 1 to 300 of them; `"latest"` is the one Apple takes at present.
   * @param options - The views to send with each summary, and what else to send beside it.
   * @returns The summaries, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicSummariesByYear: typeof library.getMusicSummariesByYear;
  /**
   * The listener's own station, which plays what Apple picks for them. It is kept in the catalog, and is the one
   * resource there that is asked for with the Music User Token.
   *
   * @param options - The storefront whose catalog the station is in, and what to send beside it.
   * @returns The station, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask in, or a schema finds issues, or if the answer holds no station, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPersonalStation: typeof library.getPersonalStation;
  /**
   * The storefront the listener's account is in: the one whose catalog they see.
   *
   * @param options - What to send beside the storefront.
   * @returns The storefront, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the answer holds no storefront, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
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

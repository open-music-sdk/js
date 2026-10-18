// Every function of this package bound to one client, for code that holds a client and wants what the answers
// hold. It is what an integration composes as `music.catalog`.
import { endpointNamespace, type tAppleMusicClient, type tEndpointNamespace } from "@open-music-sdk/core";
import * as discover from "./discover";
import * as resources from "./resources";

/**
 * Every function of this package by its name, each saying what it is for, as it does where it is declared.
 *
 * It is said twice because of how the package is published: its declarations are rolled into one file, where the
 * modules the functions are declared in become lists of names, with nothing of what was written above each
 * function. An interface keeps what is written above its members. So this is what `catalog(client)` is typed from,
 * and what lets an editor say of `music.catalog.getSong` what it says of `getSong`. A test holds the two to the
 * same names, the same types and the same words, with each argument said the same way; what a member says it
 * hands over, and throws, is the bound form's own.
 */
export interface tCatalogFunctions {
  /**
   * The song with an id.
   *
   * @param id - The song's id.
   * @param options - The storefront to ask in, and what to send beside the song.
   * @returns The song, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no song, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSong: typeof resources.getSong;
  /**
   * The songs with the ids given.
   *
   * @param ids - The songs' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the songs.
   * @returns The songs, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSongs: typeof resources.getSongs;
  /**
   * The songs with the ISRCs given. One ISRC may be that of more than one song.
   *
   * @param values - The ISRCs, 1 to 300 of them; one ISRC may be that of more than one song.
   * @param options - The storefront to ask in, and what to send beside the songs.
   * @returns The songs, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSongsByIsrc: typeof resources.getSongsByIsrc;
  /**
   * The songs in this storefront that are the equivalents of the songs with the ids given, which may be from another.
   *
   * @param values - The ids of the songs to find the equivalents of, 1 to 300 of them; they may be another
   *   storefront's.
   * @param options - The storefront to ask in, which is where the equivalents are looked for; what to leave out of
   *   them; and what to send beside them.
   * @returns The songs, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSongsByEquivalents: typeof resources.getSongsByEquivalents;
  /**
   * One relationship of a song, such as its `albums`, a page at a time. The `library` relationship needs the listener, and is not among the names.
   *
   * @param id - The song's id.
   * @param name - The relationship's name, one of the song's as the type has them; Apple says whether there is such a
   *   one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSongRelationship: typeof resources.getSongRelationship;
  /**
   * The album with an id.
   *
   * @param id - The album's id.
   * @param options - The storefront to ask in, the views to send with the album, and what else to send beside it.
   * @returns The album, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no album, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbum: typeof resources.getAlbum;
  /**
   * The albums with the ids given.
   *
   * @param ids - The albums' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the albums.
   * @returns The albums, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbums: typeof resources.getAlbums;
  /**
   * The albums with the UPCs given.
   *
   * @param values - The UPCs, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the albums.
   * @returns The albums, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbumsByUpc: typeof resources.getAlbumsByUpc;
  /**
   * The albums in this storefront that are the equivalents of the albums with the ids given, which may be from another.
   *
   * @param values - The ids of the albums to find the equivalents of, 1 to 300 of them; they may be another
   *   storefront's.
   * @param options - The storefront to ask in, which is where the equivalents are looked for; what to leave out of
   *   them; and what to send beside them.
   * @returns The albums, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbumsByEquivalents: typeof resources.getAlbumsByEquivalents;
  /**
   * One relationship of an album, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names.
   *
   * @param id - The album's id.
   * @param name - The relationship's name, one of the album's as the type has them; Apple says whether there is such a
   *   one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbumRelationship: typeof resources.getAlbumRelationship;
  /**
   * One view of an album, such as `other-versions`, a page at a time.
   *
   * @param id - The album's id.
   * @param name - The view's name, one of the album's as the type has them; Apple says whether there is such a one.
   * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
   *   where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most. The view's own attributes are not handed over.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAlbumView: typeof resources.getAlbumView;
  /**
   * The artist with an id.
   *
   * @param id - The artist's id.
   * @param options - The storefront to ask in, the views to send with the artist, and what else to send beside it.
   * @returns The artist, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no artist, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getArtist: typeof resources.getArtist;
  /**
   * The artists with the ids given.
   *
   * @param ids - The artists' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the artists.
   * @returns The artists, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getArtists: typeof resources.getArtists;
  /**
   * One relationship of an artist, such as their `albums`, a page at a time.
   *
   * @param id - The artist's id.
   * @param name - The relationship's name, one of the artist's as the type has them; Apple says whether there is such a
   *   one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getArtistRelationship: typeof resources.getArtistRelationship;
  /**
   * One view of an artist, such as `top-songs`, a page at a time.
   *
   * @param id - The artist's id.
   * @param name - The view's name, one of the artist's as the type has them; Apple says whether there is such a one.
   * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
   *   where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most. The view's own attributes are not handed over.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getArtistView: typeof resources.getArtistView;
  /**
   * The playlist with an id.
   *
   * @param id - The playlist's id.
   * @param options - The storefront to ask in, the views to send with the playlist, and what else to send beside it.
   * @returns The playlist, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no playlist, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPlaylist: typeof resources.getPlaylist;
  /**
   * The playlists with the ids given.
   *
   * @param ids - The playlists' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the playlists.
   * @returns The playlists, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPlaylists: typeof resources.getPlaylists;
  /**
   * The chart playlists of the storefronts with the ids given: each storefront's own charts, kept as playlists.
   *
   * @param values - The storefronts' ids, 1 to 300 of them; each one such as `"gb"`.
   * @param options - The storefront to ask in, and what to send beside the playlists.
   * @returns The playlists, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPlaylistsByStorefrontChart: typeof resources.getPlaylistsByStorefrontChart;
  /**
   * One relationship of a playlist, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names.
   *
   * @param id - The playlist's id.
   * @param name - The relationship's name, one of the playlist's as the type has them; Apple says whether there is such
   *   a one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPlaylistRelationship: typeof resources.getPlaylistRelationship;
  /**
   * One view of a playlist, such as `featured-artists`, a page at a time.
   *
   * @param id - The playlist's id.
   * @param name - The view's name, one of the playlist's as the type has them; Apple says whether there is such a one.
   * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
   *   where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most. The view's own attributes are not handed over.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getPlaylistView: typeof resources.getPlaylistView;
  /**
   * The music video with an id.
   *
   * @param id - The music video's id.
   * @param options - The storefront to ask in, the views to send with the music video, and what else to send beside it.
   * @returns The music video, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no music video, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideo: typeof resources.getMusicVideo;
  /**
   * The music videos with the ids given.
   *
   * @param ids - The music videos' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the music videos.
   * @returns The music videos, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideos: typeof resources.getMusicVideos;
  /**
   * The music videos with the ISRCs given. One ISRC may be that of more than one music video.
   *
   * @param values - The ISRCs, 1 to 300 of them; one ISRC may be that of more than one music video.
   * @param options - The storefront to ask in, and what to send beside the music videos.
   * @returns The music videos, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideosByIsrc: typeof resources.getMusicVideosByIsrc;
  /**
   * The music videos in this storefront that are the equivalents of the ones with the ids given, which may be from another.
   *
   * @param values - The ids of the music videos to find the equivalents of, 1 to 300 of them; they may be another
   *   storefront's.
   * @param options - The storefront to ask in, which is where the equivalents are looked for; what to leave out of
   *   them; and what to send beside them.
   * @returns The music videos, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideosByEquivalents: typeof resources.getMusicVideosByEquivalents;
  /**
   * One relationship of a music video, such as its `artists`, a page at a time. The `library` relationship needs the listener, and is not among the names.
   *
   * @param id - The music video's id.
   * @param name - The relationship's name, one of the music video's as the type has them; Apple says whether there is
   *   such a one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideoRelationship: typeof resources.getMusicVideoRelationship;
  /**
   * One view of a music video, such as `more-by-artist`, a page at a time.
   *
   * @param id - The music video's id.
   * @param name - The view's name, one of the music video's as the type has them; Apple says whether there is such a
   *   one.
   * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
   *   where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most. The view's own attributes are not handed over.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getMusicVideoView: typeof resources.getMusicVideoView;
  /**
   * The station with an id.
   *
   * @param id - The station's id.
   * @param options - The storefront to ask in, and what to send beside the station.
   * @returns The station, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no station, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStation: typeof resources.getStation;
  /**
   * The stations with the ids given.
   *
   * @param ids - The stations' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the stations.
   * @returns The stations, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStations: typeof resources.getStations;
  /**
   * One relationship of a station, such as its `radio-show`, a page at a time.
   *
   * @param id - The station's id.
   * @param name - The relationship's name, one of the station's as the type has them; Apple says whether there is such
   *   a one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStationRelationship: typeof resources.getStationRelationship;
  /**
   * The station genre with an id.
   *
   * @param id - The station genre's id.
   * @param options - The storefront to ask in, and what to send beside the station genre.
   * @returns The station genre, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no station genre, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStationGenre: typeof resources.getStationGenre;
  /**
   * The station genres with the ids given.
   *
   * @param ids - The station genres' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the station genres.
   * @returns The station genres, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStationGenres: typeof resources.getStationGenres;
  /**
   * Every station genre, a page at a time.
   *
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every station genre of every page, asking for each page as the one before runs out; `maxPages` says how
   *   many pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listStationGenres: typeof resources.listStationGenres;
  /**
   * One relationship of a station genre, such as its `stations`, a page at a time.
   *
   * @param id - The station genre's id.
   * @param name - The relationship's name, one of the station genre's as the type has them; Apple says whether there is
   *   such a one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStationGenreRelationship: typeof resources.getStationGenreRelationship;
  /**
   * The genre with an id.
   *
   * @param id - The genre's id.
   * @param options - The storefront to ask in, and what to send beside the genre.
   * @returns The genre, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no genre, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getGenre: typeof resources.getGenre;
  /**
   * The genres with the ids given.
   *
   * @param ids - The genres' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the genres.
   * @returns The genres, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getGenres: typeof resources.getGenres;
  /**
   * Every genre the charts are kept by, a page at a time.
   *
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every genre of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listGenres: typeof resources.listGenres;
  /**
   * The curator with an id.
   *
   * @param id - The curator's id.
   * @param options - The storefront to ask in, and what to send beside the curator.
   * @returns The curator, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no curator, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getCurator: typeof resources.getCurator;
  /**
   * The curators with the ids given.
   *
   * @param ids - The curators' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the curators.
   * @returns The curators, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getCurators: typeof resources.getCurators;
  /**
   * One relationship of a curator, such as their `playlists`, a page at a time.
   *
   * @param id - The curator's id.
   * @param name - The relationship's name, one of the curator's as the type has them; Apple says whether there is such
   *   a one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getCuratorRelationship: typeof resources.getCuratorRelationship;
  /**
   * The Apple curator with an id.
   *
   * @param id - The Apple curator's id.
   * @param options - The storefront to ask in, and what to send beside the Apple curator.
   * @returns The Apple curator, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no Apple curator, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAppleCurator: typeof resources.getAppleCurator;
  /**
   * The Apple curators with the ids given.
   *
   * @param ids - The Apple curators' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the Apple curators.
   * @returns The Apple curators, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAppleCurators: typeof resources.getAppleCurators;
  /**
   * One relationship of an Apple curator, such as their `playlists`, a page at a time.
   *
   * @param id - The Apple curator's id.
   * @param name - The relationship's name, one of the Apple curator's as the type has them; Apple says whether there is
   *   such a one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getAppleCuratorRelationship: typeof resources.getAppleCuratorRelationship;
  /**
   * The activity with an id.
   *
   * @param id - The activity's id.
   * @param options - The storefront to ask in, and what to send beside the activity.
   * @returns The activity, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no activity, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getActivity: typeof resources.getActivity;
  /**
   * The activities with the ids given.
   *
   * @param ids - The activities' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the activities.
   * @returns The activities, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getActivities: typeof resources.getActivities;
  /**
   * One relationship of an activity, such as its `playlists`, a page at a time.
   *
   * @param id - The activity's id.
   * @param name - The relationship's name, one of the activity's as the type has them; Apple says whether there is such
   *   a one.
   * @param options - The storefront to ask in, how many to send in one page, where to start, what to send beside them,
   *   and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getActivityRelationship: typeof resources.getActivityRelationship;
  /**
   * The record label with an id.
   *
   * @param id - The record label's id.
   * @param options - The storefront to ask in, the views to send with the record label, and what else to send beside
   *   it.
   * @returns The record label, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer holds no record label, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getRecordLabel: typeof resources.getRecordLabel;
  /**
   * The record labels with the ids given.
   *
   * @param ids - The record labels' ids, 1 to 300 of them.
   * @param options - The storefront to ask in, and what to send beside the record labels.
   * @returns The record labels, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getRecordLabels: typeof resources.getRecordLabels;
  /**
   * One view of a record label, such as `latest-releases`, a page at a time.
   *
   * @param id - The record label's id.
   * @param name - The view's name, one of the record label's as the type has them; Apple says whether there is such a
   *   one.
   * @param options - The storefront to ask in, whether to send the view's own attributes, how many to send in one page,
   *   where to start, what to send beside them, and the signal and schema of the request.
   * @returns Every item of every page, asking for each page as the one before runs out; `maxPages` says how many pages
   *   at most. The view's own attributes are not handed over.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if a page is no object or its `data` is there and is no list, which is an
   *   `ApiError`, each thrown as the loop asks for the page; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getRecordLabelView: typeof resources.getRecordLabelView;
  /**
   * The storefront with an id, such as `"gb"`.
   *
   * @param id - The storefront's id.
   * @param options - What to send beside the storefront.
   * @returns The storefront, out of `data`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the
   *   answer holds no storefront, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStorefront: typeof resources.getStorefront;
  /**
   * The storefronts with the ids given.
   *
   * @param ids - The storefronts' ids, 1 to 300 of them; each one such as `"gb"`.
   * @param options - What to send beside the storefronts.
   * @returns The storefronts, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if the
   *   answer is no object or its `data` is there and is no list, which is an `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getStorefronts: typeof resources.getStorefronts;
  /**
   * Every storefront, a page at a time.
   *
   * @param options - How many to send in one page, where to start, what to send beside them, and the signal and schema
   *   of the request.
   * @returns Every storefront of every page, asking for each page as the one before runs out; `maxPages` says how many
   *   pages at most.
   * @throws TypeError if an argument is not what it should be, thrown from the call itself, before a loop starts.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, or a schema finds issues, or if a page is
   *   no object or its `data` is there and is no list, which is an `ApiError`, each thrown as the loop asks for the page;
   *   `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly listStorefronts: typeof resources.listStorefronts;
  /**
   * Searches the catalog for a term, and resolves to the results by type, each one a first page. `limit` and
   * `offset` apply to every type asked for. A `next` link of a search answers with results by type again, not with a
   * page, so `paginate` stops after the first page: to get more of one type, ask again with a larger `offset`. The link
   * keeps the term and the types and leaves out `limit`, as it did against the live API on 18 October 2026.
   *
   * @param term - What to search for, 1 to 256 characters.
   * @param options - The types to look for, which have to be given; whether to send the best matches of any type; the
   *   storefront to ask in; and what to send beside the results.
   * @returns What Apple answered: the results by type under `results`, each a first page with a `next` of its own, and
   *   the best matches under `results.top` when they were asked for.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly searchCatalog: typeof discover.searchCatalog;
  /**
   * The terms a search might be for, given the start of one: what to offer as someone types.
   *
   * @param term - The start of a search, 1 to 256 characters.
   * @param options - The storefront to ask in, and what to send beside the terms.
   * @returns What Apple answered: the terms under `results.terms`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSearchHints: typeof discover.getSearchHints;
  /**
   * Suggestions for a search, given the start of one: terms to search for, resources that match, or both.
   *
   * @param term - The start of a search, 1 to 256 characters.
   * @param options - The kinds of suggestion to make, which have to be given; the types the top results may be; the
   *   storefront to ask in; and what to send beside the suggestions.
   * @returns What Apple answered: the suggestions under `results.suggestions`, each saying its `kind`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getSearchSuggestions: typeof discover.getSearchSuggestions;
  /**
   * The charts of a storefront, by type of resource, each one a first page. Each type is a list of charts, since one
   * type can have several. `limit` and `offset` apply to every chart. A `next` link of a chart answers with charts by
   * type again, not with a page, as it did against the live API on 18 October 2026, so `paginate` stops after the
   * first page: to get more of a chart, ask again with a larger `offset`.
   *
   * @param options - The types to chart, which have to be given; one chart by name; one genre by id; the city or global
   *   charts; the storefront to ask in; and what to send beside the charts.
   * @returns What Apple answered: the charts by type under `results`, each a first page with a `next` of its own.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getCharts: typeof discover.getCharts;
  /**
   * Resources of several types in one request, by their ids: `{ songs: [...], albums: [...] }`. One type at least has to be given.
   *
   * @param ids - The ids by type, such as `{ songs: ["1"], albums: ["2"] }`: 1 to 32 types with 1 to 300 ids between
   *   them; a type whose list is `undefined` is left out.
   * @param options - The storefront to ask in, and what to send beside the resources.
   * @returns The resources, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getCatalogResources: typeof discover.getCatalogResources;
  /**
   * The live radio stations of Apple Music, such as Apple Music 1.
   *
   * @param options - The storefront to ask in, and what to send beside the stations.
   * @returns The live stations, out of `data`: an empty list where Apple sends none.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues, or if the answer is no object or its `data` is there and is no list, which is an
   *   `ApiError`; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLiveRadioStations: typeof discover.getLiveRadioStations;
  /**
   * The language a storefront would answer in, given the ones a reader accepts, best first, such as
   * `["fr-CA", "fr", "en"]`: the tag to pass as `language` to the other functions.
   *
   * @param acceptLanguage - The languages a reader accepts, best first, as tags such as `"fr-CA"`, 1 to 300 of them.
   * @param options - The storefront to ask about, and what to send beside the tag.
   * @returns What Apple answered: the tag under `results.tag`.
   * @throws TypeError if an argument is not what it should be, before Apple is asked.
   * @throws AppleMusicError if Apple, the network, or a token provider fails, if the client has no storefront to ask
   *   in, or a schema finds issues; `_tag` says which.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  readonly getLanguageTag: typeof discover.getLanguageTag;
}

/**
 * The catalog as one client sees it: each function of this package under its own name, taking the same arguments
 * without the client, and handing over what the answer holds. A `get` of one resource gives the resource, a `get`
 * of several gives the list, and a `list`, a relationship or a view gives every item of every page as it is looped
 * over. Search, hints, suggestions, charts and the language tag give Apple's answer as it is.
 */
export type tCatalog = tEndpointNamespace<tCatalogFunctions>;

/**
 * The catalog for one client. Each call makes a new one, which cannot be changed.
 *
 * @param client - The client every function of the catalog asks with.
 * @returns Every function of this package bound to the client, under its own name, frozen.
 * @throws TypeError if `client` is no client from `createClient`, there and then.
 */
export function catalog(client: tAppleMusicClient): tCatalog {
  // Gathered here and not beside the imports, so that code which never calls this carries none of the functions it did not import itself.
  return endpointNamespace("catalog", client, { ...resources, ...discover });
}

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
  /** The song with an id in the listener's library. */
  readonly getLibrarySong: typeof resources.getLibrarySong;
  /** The songs with the ids given in the listener's library. */
  readonly getLibrarySongs: typeof resources.getLibrarySongs;
  /** Every song in the listener's library, a page at a time. */
  readonly listLibrarySongs: typeof resources.listLibrarySongs;
  /** One relationship of a library song, such as its `albums`, a page at a time. */
  readonly getLibrarySongRelationship: typeof resources.getLibrarySongRelationship;
  /** The album with an id in the listener's library. */
  readonly getLibraryAlbum: typeof resources.getLibraryAlbum;
  /** The albums with the ids given in the listener's library. */
  readonly getLibraryAlbums: typeof resources.getLibraryAlbums;
  /** Every album in the listener's library, a page at a time. */
  readonly listLibraryAlbums: typeof resources.listLibraryAlbums;
  /** One relationship of a library album, such as its `tracks`, a page at a time. */
  readonly getLibraryAlbumRelationship: typeof resources.getLibraryAlbumRelationship;
  /** The artist with an id in the listener's library. */
  readonly getLibraryArtist: typeof resources.getLibraryArtist;
  /** The artists with the ids given in the listener's library. */
  readonly getLibraryArtists: typeof resources.getLibraryArtists;
  /** Every artist in the listener's library, a page at a time. */
  readonly listLibraryArtists: typeof resources.listLibraryArtists;
  /** One relationship of a library artist, such as their `albums`, a page at a time. */
  readonly getLibraryArtistRelationship: typeof resources.getLibraryArtistRelationship;
  /** The music video with an id in the listener's library. */
  readonly getLibraryMusicVideo: typeof resources.getLibraryMusicVideo;
  /** The music videos with the ids given in the listener's library. */
  readonly getLibraryMusicVideos: typeof resources.getLibraryMusicVideos;
  /** Every music video in the listener's library, a page at a time. */
  readonly listLibraryMusicVideos: typeof resources.listLibraryMusicVideos;
  /** One relationship of a library music video, such as its `artists`, a page at a time. */
  readonly getLibraryMusicVideoRelationship: typeof resources.getLibraryMusicVideoRelationship;
  /** The playlist with an id in the listener's library. */
  readonly getLibraryPlaylist: typeof resources.getLibraryPlaylist;
  /** The playlists with the ids given in the listener's library. */
  readonly getLibraryPlaylists: typeof resources.getLibraryPlaylists;
  /** Every playlist in the listener's library, a page at a time. */
  readonly listLibraryPlaylists: typeof resources.listLibraryPlaylists;
  /** One relationship of a library playlist, such as its `tracks`, a page at a time. */
  readonly getLibraryPlaylistRelationship: typeof resources.getLibraryPlaylistRelationship;
  /**
   * Makes a playlist in the listener's library: `{ attributes: { name } }`, with its tracks and the folder to put it
   * in under `relationships`. Resolves to the answer that holds the new playlist.
   */
  readonly createLibraryPlaylist: typeof resources.createLibraryPlaylist;
  /** The playlist folder with an id in the listener's library. */
  readonly getLibraryPlaylistFolder: typeof resources.getLibraryPlaylistFolder;
  /** The playlist folders with the ids given in the listener's library. */
  readonly getLibraryPlaylistFolders: typeof resources.getLibraryPlaylistFolders;
  /** One relationship of a library playlist folder, such as its `children`, a page at a time. */
  readonly getLibraryPlaylistFolderRelationship: typeof resources.getLibraryPlaylistFolderRelationship;
  /**
   * Makes a playlist folder in the listener's library: `{ attributes: { name } }`, with the folder to put it in under
   * `relationships`. Resolves to the answer that holds the new folder.
   */
  readonly createLibraryPlaylistFolder: typeof resources.createLibraryPlaylistFolder;
  /** The recommendation with an id, of the ones made for the listener. */
  readonly getPersonalRecommendation: typeof resources.getPersonalRecommendation;
  /** The recommendations with the ids given, of the ones made for the listener. */
  readonly getPersonalRecommendations: typeof resources.getPersonalRecommendations;
  /** Every recommendation made for the listener, a page at a time. */
  readonly listPersonalRecommendations: typeof resources.listPersonalRecommendations;
  /** One relationship of a recommendation, such as its `contents`, a page at a time. */
  readonly getPersonalRecommendationRelationship: typeof resources.getPersonalRecommendationRelationship;
  /** The listener's rating of the song with an id. */
  readonly getSongRating: typeof ratings.getSongRating;
  /** The listener's ratings of the songs with the ids given. */
  readonly getSongRatings: typeof ratings.getSongRatings;
  /** Sets the listener's rating of the song with an id: 1 for a like, -1 for a dislike. */
  readonly setSongRating: typeof ratings.setSongRating;
  /** Takes away the listener's rating of the song with an id. */
  readonly deleteSongRating: typeof ratings.deleteSongRating;
  /** The listener's rating of the album with an id. */
  readonly getAlbumRating: typeof ratings.getAlbumRating;
  /** The listener's ratings of the albums with the ids given. */
  readonly getAlbumRatings: typeof ratings.getAlbumRatings;
  /** Sets the listener's rating of the album with an id: 1 for a like, -1 for a dislike. */
  readonly setAlbumRating: typeof ratings.setAlbumRating;
  /** Takes away the listener's rating of the album with an id. */
  readonly deleteAlbumRating: typeof ratings.deleteAlbumRating;
  /** The listener's rating of the music video with an id. */
  readonly getMusicVideoRating: typeof ratings.getMusicVideoRating;
  /** The listener's ratings of the music videos with the ids given. */
  readonly getMusicVideoRatings: typeof ratings.getMusicVideoRatings;
  /** Sets the listener's rating of the music video with an id: 1 for a like, -1 for a dislike. */
  readonly setMusicVideoRating: typeof ratings.setMusicVideoRating;
  /** Takes away the listener's rating of the music video with an id. */
  readonly deleteMusicVideoRating: typeof ratings.deleteMusicVideoRating;
  /** The listener's rating of the playlist with an id. */
  readonly getPlaylistRating: typeof ratings.getPlaylistRating;
  /** The listener's ratings of the playlists with the ids given. */
  readonly getPlaylistRatings: typeof ratings.getPlaylistRatings;
  /** Sets the listener's rating of the playlist with an id: 1 for a like, -1 for a dislike. */
  readonly setPlaylistRating: typeof ratings.setPlaylistRating;
  /** Takes away the listener's rating of the playlist with an id. */
  readonly deletePlaylistRating: typeof ratings.deletePlaylistRating;
  /** The listener's rating of the station with an id. */
  readonly getStationRating: typeof ratings.getStationRating;
  /** The listener's ratings of the stations with the ids given. */
  readonly getStationRatings: typeof ratings.getStationRatings;
  /** Sets the listener's rating of the station with an id: 1 for a like, -1 for a dislike. */
  readonly setStationRating: typeof ratings.setStationRating;
  /** Takes away the listener's rating of the station with an id. */
  readonly deleteStationRating: typeof ratings.deleteStationRating;
  /** The listener's rating of the library song with an id. */
  readonly getLibrarySongRating: typeof ratings.getLibrarySongRating;
  /** The listener's ratings of the library songs with the ids given. */
  readonly getLibrarySongRatings: typeof ratings.getLibrarySongRatings;
  /** Sets the listener's rating of the library song with an id: 1 for a like, -1 for a dislike. */
  readonly setLibrarySongRating: typeof ratings.setLibrarySongRating;
  /** Takes away the listener's rating of the library song with an id. */
  readonly deleteLibrarySongRating: typeof ratings.deleteLibrarySongRating;
  /** The listener's rating of the library album with an id. */
  readonly getLibraryAlbumRating: typeof ratings.getLibraryAlbumRating;
  /** The listener's ratings of the library albums with the ids given. */
  readonly getLibraryAlbumRatings: typeof ratings.getLibraryAlbumRatings;
  /** Sets the listener's rating of the library album with an id: 1 for a like, -1 for a dislike. */
  readonly setLibraryAlbumRating: typeof ratings.setLibraryAlbumRating;
  /** Takes away the listener's rating of the library album with an id. */
  readonly deleteLibraryAlbumRating: typeof ratings.deleteLibraryAlbumRating;
  /** The listener's rating of the library music video with an id. */
  readonly getLibraryMusicVideoRating: typeof ratings.getLibraryMusicVideoRating;
  /** The listener's ratings of the library music videos with the ids given. */
  readonly getLibraryMusicVideoRatings: typeof ratings.getLibraryMusicVideoRatings;
  /** Sets the listener's rating of the library music video with an id: 1 for a like, -1 for a dislike. */
  readonly setLibraryMusicVideoRating: typeof ratings.setLibraryMusicVideoRating;
  /** Takes away the listener's rating of the library music video with an id. */
  readonly deleteLibraryMusicVideoRating: typeof ratings.deleteLibraryMusicVideoRating;
  /** The listener's rating of the library playlist with an id. */
  readonly getLibraryPlaylistRating: typeof ratings.getLibraryPlaylistRating;
  /** The listener's ratings of the library playlists with the ids given. */
  readonly getLibraryPlaylistRatings: typeof ratings.getLibraryPlaylistRatings;
  /** Sets the listener's rating of the library playlist with an id: 1 for a like, -1 for a dislike. */
  readonly setLibraryPlaylistRating: typeof ratings.setLibraryPlaylistRating;
  /** Takes away the listener's rating of the library playlist with an id. */
  readonly deleteLibraryPlaylistRating: typeof ratings.deleteLibraryPlaylistRating;
  /**
   * Searches the listener's library for a term, and resolves to the results by type, each one a first page. `limit`
   * and `offset` apply to every type asked for.
   */
  readonly searchLibrary: typeof library.searchLibrary;
  /** Library resources of several types in one request, by their ids: `{ "library-songs": [...] }`. One type at least has to be given. */
  readonly getLibraryResources: typeof library.getLibraryResources;
  /** Adds catalog resources to the listener's library, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards. */
  readonly addToLibrary: typeof library.addToLibrary;
  /** Adds resources to the listener's favorites, by their ids: `{ songs: [...], albums: [...] }`. It resolves to nothing: Apple accepts the request and adds them afterwards. */
  readonly addToFavorites: typeof library.addToFavorites;
  /** Adds tracks to the end of a playlist in the listener's library: `[{ id, type: "songs" }]`. It resolves to nothing. */
  readonly addLibraryPlaylistTracks: typeof library.addLibraryPlaylistTracks;
  /** The folder every playlist and playlist folder of the listener's library is in, at the top: where to start going down from. */
  readonly getRootLibraryPlaylistFolder: typeof library.getRootLibraryPlaylistFolder;
  /** What the listener added to their library lately, newest first, a page at a time. */
  readonly listRecentlyAdded: typeof library.listRecentlyAdded;
  /** What the listener plays most at present, a page at a time. */
  readonly listHeavyRotation: typeof library.listHeavyRotation;
  /** What the listener played lately, newest first, a page at a time: the albums, playlists and stations, not the tracks in them. */
  readonly listRecentlyPlayed: typeof library.listRecentlyPlayed;
  /** The tracks the listener played lately, newest first, a page at a time. */
  readonly listRecentlyPlayedTracks: typeof library.listRecentlyPlayedTracks;
  /** The radio stations the listener played lately, newest first, a page at a time. */
  readonly listRecentlyPlayedStations: typeof library.listRecentlyPlayedStations;
  /** The listener's replay: a summary of what they played in each of the years given. The one year Apple takes at present is `"latest"`. */
  readonly getMusicSummariesByYear: typeof library.getMusicSummariesByYear;
  /**
   * The listener's own station, which plays what Apple picks for them. It is kept in the catalog, and is the one
   * resource there that is asked for with the Music User Token.
   */
  readonly getPersonalStation: typeof library.getPersonalStation;
  /** The storefront the listener's account is in: the one whose catalog they see. */
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

/** The listener's side for one client, which has to be a listener's: one made with a Music User Token. Each call makes a new one, which cannot be changed. */
export function user(client: tAppleMusicClient): tUser {
  // Gathered here and not beside the imports, so that code which never calls this carries none of the functions it did not import itself.
  return endpointNamespace("user", client, { ...resources, ...ratings, ...library });
}

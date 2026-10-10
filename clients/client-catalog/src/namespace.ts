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
 * same names, the same types and the same words.
 */
export interface tCatalogFunctions {
  /** The song with an id. */
  readonly getSong: typeof resources.getSong;
  /** The songs with the ids given. */
  readonly getSongs: typeof resources.getSongs;
  /** The songs with the ISRCs given. One ISRC may be that of more than one song. */
  readonly getSongsByIsrc: typeof resources.getSongsByIsrc;
  /** The songs in this storefront that are the equivalents of the songs with the ids given, which may be from another. */
  readonly getSongsByEquivalents: typeof resources.getSongsByEquivalents;
  /** One relationship of a song, such as its `albums`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
  readonly getSongRelationship: typeof resources.getSongRelationship;
  /** The album with an id. */
  readonly getAlbum: typeof resources.getAlbum;
  /** The albums with the ids given. */
  readonly getAlbums: typeof resources.getAlbums;
  /** The albums with the UPCs given. */
  readonly getAlbumsByUpc: typeof resources.getAlbumsByUpc;
  /** The albums in this storefront that are the equivalents of the albums with the ids given, which may be from another. */
  readonly getAlbumsByEquivalents: typeof resources.getAlbumsByEquivalents;
  /** One relationship of an album, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
  readonly getAlbumRelationship: typeof resources.getAlbumRelationship;
  /** One view of an album, such as `other-versions`, a page at a time. */
  readonly getAlbumView: typeof resources.getAlbumView;
  /** The artist with an id. */
  readonly getArtist: typeof resources.getArtist;
  /** The artists with the ids given. */
  readonly getArtists: typeof resources.getArtists;
  /** One relationship of an artist, such as their `albums`, a page at a time. */
  readonly getArtistRelationship: typeof resources.getArtistRelationship;
  /** One view of an artist, such as `top-songs`, a page at a time. */
  readonly getArtistView: typeof resources.getArtistView;
  /** The playlist with an id. */
  readonly getPlaylist: typeof resources.getPlaylist;
  /** The playlists with the ids given. */
  readonly getPlaylists: typeof resources.getPlaylists;
  /** The chart playlists of the storefronts with the ids given: each storefront's own charts, kept as playlists. */
  readonly getPlaylistsByStorefrontChart: typeof resources.getPlaylistsByStorefrontChart;
  /** One relationship of a playlist, such as its `tracks`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
  readonly getPlaylistRelationship: typeof resources.getPlaylistRelationship;
  /** One view of a playlist, such as `featured-artists`, a page at a time. */
  readonly getPlaylistView: typeof resources.getPlaylistView;
  /** The music video with an id. */
  readonly getMusicVideo: typeof resources.getMusicVideo;
  /** The music videos with the ids given. */
  readonly getMusicVideos: typeof resources.getMusicVideos;
  /** The music videos with the ISRCs given. One ISRC may be that of more than one music video. */
  readonly getMusicVideosByIsrc: typeof resources.getMusicVideosByIsrc;
  /** The music videos in this storefront that are the equivalents of the ones with the ids given, which may be from another. */
  readonly getMusicVideosByEquivalents: typeof resources.getMusicVideosByEquivalents;
  /** One relationship of a music video, such as its `artists`, a page at a time. The `library` relationship needs the listener, and is not among the names. */
  readonly getMusicVideoRelationship: typeof resources.getMusicVideoRelationship;
  /** One view of a music video, such as `more-by-artist`, a page at a time. */
  readonly getMusicVideoView: typeof resources.getMusicVideoView;
  /** The station with an id. */
  readonly getStation: typeof resources.getStation;
  /** The stations with the ids given. */
  readonly getStations: typeof resources.getStations;
  /** One relationship of a station, such as its `radio-show`, a page at a time. */
  readonly getStationRelationship: typeof resources.getStationRelationship;
  /** The station genre with an id. */
  readonly getStationGenre: typeof resources.getStationGenre;
  /** The station genres with the ids given. */
  readonly getStationGenres: typeof resources.getStationGenres;
  /** Every station genre, a page at a time. */
  readonly listStationGenres: typeof resources.listStationGenres;
  /** One relationship of a station genre, such as its `stations`, a page at a time. */
  readonly getStationGenreRelationship: typeof resources.getStationGenreRelationship;
  /** The genre with an id. */
  readonly getGenre: typeof resources.getGenre;
  /** The genres with the ids given. */
  readonly getGenres: typeof resources.getGenres;
  /** Every genre the charts are kept by, a page at a time. */
  readonly listGenres: typeof resources.listGenres;
  /** The curator with an id. */
  readonly getCurator: typeof resources.getCurator;
  /** The curators with the ids given. */
  readonly getCurators: typeof resources.getCurators;
  /** One relationship of a curator, such as their `playlists`, a page at a time. */
  readonly getCuratorRelationship: typeof resources.getCuratorRelationship;
  /** The Apple curator with an id. */
  readonly getAppleCurator: typeof resources.getAppleCurator;
  /** The Apple curators with the ids given. */
  readonly getAppleCurators: typeof resources.getAppleCurators;
  /** One relationship of an Apple curator, such as their `playlists`, a page at a time. */
  readonly getAppleCuratorRelationship: typeof resources.getAppleCuratorRelationship;
  /** The activity with an id. */
  readonly getActivity: typeof resources.getActivity;
  /** The activities with the ids given. */
  readonly getActivities: typeof resources.getActivities;
  /** One relationship of an activity, such as its `playlists`, a page at a time. */
  readonly getActivityRelationship: typeof resources.getActivityRelationship;
  /** The record label with an id. */
  readonly getRecordLabel: typeof resources.getRecordLabel;
  /** The record labels with the ids given. */
  readonly getRecordLabels: typeof resources.getRecordLabels;
  /** One view of a record label, such as `latest-releases`, a page at a time. */
  readonly getRecordLabelView: typeof resources.getRecordLabelView;
  /** The storefront with an id, such as `"gb"`. */
  readonly getStorefront: typeof resources.getStorefront;
  /** The storefronts with the ids given. */
  readonly getStorefronts: typeof resources.getStorefronts;
  /** Every storefront, a page at a time. */
  readonly listStorefronts: typeof resources.listStorefronts;
  /**
   * Searches the catalog for a term, and resolves to the results by type, each one a first page. `limit` and
   * `offset` apply to every type asked for.
   */
  readonly searchCatalog: typeof discover.searchCatalog;
  /** The terms a search might be for, given the start of one: what to offer as someone types. */
  readonly getSearchHints: typeof discover.getSearchHints;
  /** Suggestions for a search, given the start of one: terms to search for, resources that match, or both. */
  readonly getSearchSuggestions: typeof discover.getSearchSuggestions;
  /** The charts of a storefront, by type of resource, each one a first page. `limit` and `offset` apply to every chart. */
  readonly getCharts: typeof discover.getCharts;
  /** Resources of several types in one request, by their ids: `{ songs: [...], albums: [...] }`. One type at least has to be given. */
  readonly getCatalogResources: typeof discover.getCatalogResources;
  /** The live radio stations of Apple Music, such as Apple Music 1. */
  readonly getLiveRadioStations: typeof discover.getLiveRadioStations;
  /**
   * The language a storefront would answer in, given the ones a reader accepts, best first, such as
   * `["fr-CA", "fr", "en"]`: the tag to pass as `language` to the other functions.
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

/** The catalog for one client. Each call makes a new one, which cannot be changed. */
export function catalog(client: tAppleMusicClient): tCatalog {
  // Gathered here and not beside the imports, so that code which never calls this carries none of the functions it did not import itself.
  return endpointNamespace("catalog", client, { ...resources, ...discover });
}

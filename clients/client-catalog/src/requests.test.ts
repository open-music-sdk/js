import { readFileSync } from "node:fs";
import { createClient, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import type {
  tActivitiesResponse,
  tAlbumsResponse,
  tAppleCuratorsResponse,
  tArtistsResponse,
  tChartResponse,
  tCuratorsResponse,
  tGenresResponse,
  tLangageTagResponse,
  tMusicVideosResponse,
  tPlaylistsResponse,
  tRecordLabelsResponse,
  tResourceCollectionResponse,
  tSearchHintsResponse,
  tSearchResponse,
  tSearchSuggestionsResponse,
  tSongsResponse,
  tStationGenresResponse,
  tStationsResponse,
  tStorefrontsResponse,
} from "@open-music-sdk/types";
import { afterEach, describe, expect, test } from "vitest";
import * as api from "./index";

/** An endpoint as Apple documents it, from the description the types are generated from. */
interface tDocumented {
  readonly title: string;
  readonly method: string;
  readonly path: string;
  readonly pathParams: readonly { readonly name: string; readonly allowed?: readonly string[] }[];
  readonly queryParams: readonly { readonly name: string; readonly required: boolean; readonly allowed?: readonly string[] }[];
  readonly responses: readonly { readonly status: number; readonly type: { readonly name: string } }[];
}

const documented = (JSON.parse(readFileSync(new URL("../../../codegen/docc-ir/ir.json", import.meta.url), "utf8")) as { endpoints: tDocumented[] }).endpoints.map(
  // Apple's titles use a typographic apostrophe in some places and a plain one in others.
  (endpoint): tDocumented => ({ ...endpoint, title: endpoint.title.replace(/’/g, "'") }),
);

/** The endpoints under the catalog's paths that this package leaves to another, or to nobody, and why. */
const LEFT_OUT: Readonly<Record<string, string>> = {
  "Get the User's Personal Apple Music Station": "it is under the catalog's path and needs the listener, so it is client-user's getPersonalStation",
  "Placeholder Endpoint to Test Connectivity": "it names no resource, and is in neither package",
};
/** Whether an endpoint is the listener's, and so client-user's. */
const isListeners = (endpoint: tDocumented) => endpoint.path.startsWith("v1/me");

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/**
 * A client over a fetch that answers every request with one resource, and records every Request it saw. With
 * `next`, the first answer names it as its next page, as an answer that is not Apple's own might.
 */
function apple(options: Partial<tClientOptions> = {}, next?: string) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const res = new Response(JSON.stringify({ data: [{ id: "1", type: "songs" }], ...(next !== undefined && calls.length === 1 ? { next } : {}) }));
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", storefront: "us", fetch, retry: false, ...options }),
    calls,
    /** Each request as its method, path and query. */
    sent: () => calls.map((call) => `${call.method} ${new URL(call.url).pathname}${decodeURIComponent(new URL(call.url).search)}`),
  };
}

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

/** One function, the endpoint it is for, the answer that endpoint documents, a call with every option it documents, and the request the call has to send. */
interface tRow {
  readonly name: string;
  readonly title: string;
  readonly answer: string;
  readonly args: readonly unknown[];
  readonly sent: string;
}

/** A page that a function types by the name it was asked for: held here to being a page, and its names to the documentation further down. */
interface tNarrowedPage {
  readonly data: readonly unknown[];
}

/** Each answer Apple documents for the catalog, by the name its documentation gives it, as the generated type for it. */
/* eslint-disable @typescript-eslint/naming-convention -- the names are the documentation's own */
interface tAnswers {
  ActivitiesResponse: tActivitiesResponse;
  AlbumsResponse: tAlbumsResponse;
  AppleCuratorsResponse: tAppleCuratorsResponse;
  ArtistsResponse: tArtistsResponse;
  ChartResponse: tChartResponse;
  CuratorsResponse: tCuratorsResponse;
  GenresResponse: tGenresResponse;
  LangageTagResponse: tLangageTagResponse;
  MusicVideosResponse: tMusicVideosResponse;
  PlaylistsResponse: tPlaylistsResponse;
  RecordLabelsResponse: tRecordLabelsResponse;
  RelationshipResponse: tNarrowedPage;
  RelationshipViewResponse: tNarrowedPage;
  ResourceCollectionResponse: tResourceCollectionResponse;
  SearchHintsResponse: tSearchHintsResponse;
  SearchResponse: tSearchResponse;
  SearchSuggestionsResponse: tSearchSuggestionsResponse;
  SongsResponse: tSongsResponse;
  StationGenresResponse: tStationGenresResponse;
  StationsResponse: tStationsResponse;
  StorefrontsResponse: tStorefrontsResponse;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * What a row's request is written as: a string, when what its function resolves to is the type documented under
 * `Name`, each fitting where the other is wanted; and nothing a row can be written with, when it is not. So a row
 * whose function was declared with another answer's type does not compile. A narrowed page is typed by the name it
 * is asked for, and is held to the documentation by its names instead, further down.
 */
type tSentFor<Answer, Name extends keyof tAnswers> = [tAnswers[Name]] extends [tNarrowedPage] ? ([tNarrowedPage] extends [tAnswers[Name]] ? string : tIfSame<Answer, tAnswers[Name]>) : tIfSame<Answer, tAnswers[Name]>;
type tIfSame<A, B> = [A] extends [B] ? ([B] extends [A] ? string : never) : never;

const exported: [string, unknown][] = Object.entries(api);

/** A row, with its arguments and its answer held to the function's own types, and the function known by the name it is exported under. */
function row<A extends readonly unknown[], R, Name extends keyof tAnswers>(fn: (client: tAppleMusicClient, ...args: A) => Promise<R>, title: string, answer: Name, args: NoInfer<A>, sent: tSentFor<R, Name>): tRow {
  const name = exported.find(([, value]) => value === fn)?.[0];
  if (name === undefined) throw new Error(`the function for "${title}" is not exported`);
  return { name, title, answer, args, sent };
}

/** A list of every member of the union `All` and nothing else: one left out, or one that is not a member, does not compile. */
const every =
  <All extends string>() =>
  <const List extends readonly All[]>(...list: List & ([All] extends [List[number]] ? unknown : never)): readonly string[] =>
    list;

/** The name a relationship or a view function is asked with, and each value of an option of a function. */
type tNameOf<F> = F extends (client: tAppleMusicClient, id: string, name: infer Name, ...rest: never[]) => unknown ? Name & string : never;
type tOptionOf<F, Option extends string> = F extends (...args: infer A) => unknown ? tValueOf<NonNullable<A[number]>, Option> : never;
type tValueOf<Options, Option extends string> = Options extends Partial<Record<Option, infer Value>> ? (NonNullable<Value> extends readonly (infer Item)[] ? Item & string : NonNullable<Value> & string) : never;

const STORE = { storefront: "gb", language: "en-GB" } as const;
const ALL = { ...STORE, include: ["albums"], extend: ["artistUrl"] } as const;
const RELATED = { ...ALL, limit: 5 } as const;
const VIEW = { ...ALL, limit: 5, with: ["attributes"] } as const;
const PAGE = { ...ALL, limit: 5, offset: 10 } as const;
const Q = "l=en-GB&include=albums&extend=artistUrl";

const rows: tRow[] = [
  // Songs
  row(api.getSong, "Get a Catalog Song", "SongsResponse", ["1", ALL], `GET /v1/catalog/gb/songs/1?${Q}`),
  row(api.getSongs, "Get Multiple Catalog Songs by ID", "SongsResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/songs?${Q}&ids=1,2`),
  row(api.getSongsByIsrc, "Get Multiple Catalog Songs by ISRC", "SongsResponse", [["USUM71900001", "GBUM71900002"], ALL], `GET /v1/catalog/gb/songs?${Q}&filter[isrc]=USUM71900001,GBUM71900002`),
  row(api.getSongsByEquivalents, "Get Equivalent Catalog Songs by ID", "SongsResponse", [["1", "2"], { ...ALL, restrict: ["explicit"] }], `GET /v1/catalog/gb/songs?${Q}&restrict=explicit&filter[equivalents]=1,2`),
  row(api.getSongRelationship, "Get a Catalog Song's Relationship Directly by Name", "RelationshipResponse", ["1", "albums", RELATED], `GET /v1/catalog/gb/songs/1/albums?${Q}&limit=5`),
  // Albums
  row(api.getAlbum, "Get a Catalog Album", "AlbumsResponse", ["1", { ...ALL, views: ["appears-on", "other-versions"] }], `GET /v1/catalog/gb/albums/1?${Q}&views=appears-on,other-versions`),
  row(api.getAlbums, "Get Multiple Catalog Albums", "AlbumsResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/albums?${Q}&ids=1,2`),
  row(api.getAlbumsByUpc, "Get Multiple Catalog Albums by UPC", "AlbumsResponse", [["00602577427855"], ALL], `GET /v1/catalog/gb/albums?${Q}&filter[upc]=00602577427855`),
  row(api.getAlbumsByEquivalents, "Get Equivalent Catalog Albums by ID", "AlbumsResponse", [["1", "2"], { ...ALL, restrict: ["explicit"] }], `GET /v1/catalog/gb/albums?${Q}&restrict=explicit&filter[equivalents]=1,2`),
  row(api.getAlbumRelationship, "Get a Catalog Album's Relationship Directly by Name", "RelationshipResponse", ["1", "tracks", RELATED], `GET /v1/catalog/gb/albums/1/tracks?${Q}&limit=5`),
  row(api.getAlbumView, "Get a Catalog Album's Relationship View Directly by Name", "RelationshipViewResponse", ["1", "other-versions", VIEW], `GET /v1/catalog/gb/albums/1/view/other-versions?${Q}&limit=5&with=attributes`),
  // Artists
  row(api.getArtist, "Get a Catalog Artist", "ArtistsResponse", ["1", { ...ALL, views: ["top-songs"] }], `GET /v1/catalog/gb/artists/1?${Q}&views=top-songs`),
  row(api.getArtists, "Get Multiple Catalog Artists", "ArtistsResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/artists?${Q}&ids=1,2`),
  row(api.getArtistRelationship, "Get a Catalog Artist's Relationship Directly by Name", "RelationshipResponse", ["1", "albums", RELATED], `GET /v1/catalog/gb/artists/1/albums?${Q}&limit=5`),
  row(api.getArtistView, "Get a Catalog Artist's Relationship View Directly by Name", "RelationshipViewResponse", ["1", "top-songs", VIEW], `GET /v1/catalog/gb/artists/1/view/top-songs?${Q}&limit=5&with=attributes`),
  // Playlists
  row(api.getPlaylist, "Get a Catalog Playlist", "PlaylistsResponse", ["1", { ...ALL, views: ["featured-artists"] }], `GET /v1/catalog/gb/playlists/1?${Q}&views=featured-artists`),
  row(api.getPlaylists, "Get Multiple Catalog Playlists", "PlaylistsResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/playlists?${Q}&ids=1,2`),
  row(api.getPlaylistsByStorefrontChart, "Get Charts Playlists by Storefront Value", "PlaylistsResponse", [["gb", "fr"], ALL], `GET /v1/catalog/gb/playlists?${Q}&filter[storefront-chart]=gb,fr`),
  row(api.getPlaylistRelationship, "Get a Catalog Playlist's Relationship Directly by Name", "RelationshipResponse", ["1", "tracks", RELATED], `GET /v1/catalog/gb/playlists/1/tracks?${Q}&limit=5`),
  row(api.getPlaylistView, "Get a Catalog Playlist's Relationship View Directly by Name", "RelationshipViewResponse", ["1", "more-by-curator", VIEW], `GET /v1/catalog/gb/playlists/1/view/more-by-curator?${Q}&limit=5&with=attributes`),
  // Music videos
  row(api.getMusicVideo, "Get a Catalog Music Video", "MusicVideosResponse", ["1", { ...ALL, views: ["more-by-artist"] }], `GET /v1/catalog/gb/music-videos/1?${Q}&views=more-by-artist`),
  row(api.getMusicVideos, "Get Multiple Catalog Music Videos by ID", "MusicVideosResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/music-videos?${Q}&ids=1,2`),
  row(api.getMusicVideosByIsrc, "Get Multiple Catalog Music Videos by ISRC", "MusicVideosResponse", [["USUV71900001"], ALL], `GET /v1/catalog/gb/music-videos?${Q}&filter[isrc]=USUV71900001`),
  row(api.getMusicVideosByEquivalents, "Get Equivalent Catalog Music Videos by ID", "MusicVideosResponse", [["1", "2"], { ...ALL, restrict: ["explicit"] }], `GET /v1/catalog/gb/music-videos?${Q}&restrict=explicit&filter[equivalents]=1,2`),
  row(api.getMusicVideoRelationship, "Get a Catalog Music Video's Relationship Directly by Name", "RelationshipResponse", ["1", "artists", RELATED], `GET /v1/catalog/gb/music-videos/1/artists?${Q}&limit=5`),
  row(api.getMusicVideoView, "Get a Catalog Music Video's Relationship View Directly by Name", "RelationshipViewResponse", ["1", "more-in-genre", VIEW], `GET /v1/catalog/gb/music-videos/1/view/more-in-genre?${Q}&limit=5&with=attributes`),
  // Stations and their genres
  row(api.getStation, "Get a Catalog Station", "StationsResponse", ["ra.1", ALL], `GET /v1/catalog/gb/stations/ra.1?${Q}`),
  row(api.getStations, "Get Multiple Catalog Stations", "StationsResponse", [["ra.1", "ra.2"], ALL], `GET /v1/catalog/gb/stations?${Q}&ids=ra.1,ra.2`),
  row(api.getStationRelationship, "Get a Catalog Station's Relationship Directly by Name", "RelationshipResponse", ["ra.1", "radio-show", RELATED], `GET /v1/catalog/gb/stations/ra.1/radio-show?${Q}&limit=5`),
  row(api.getStationGenre, "Get a Station Genre", "StationGenresResponse", ["1", ALL], `GET /v1/catalog/gb/station-genres/1?${Q}`),
  row(api.getStationGenres, "Get Multiple Stations Genres", "StationGenresResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/station-genres?${Q}&ids=1,2`),
  row(api.listStationGenres, "Get All Station Genres", "StationGenresResponse", [PAGE], `GET /v1/catalog/gb/station-genres?${Q}&limit=5&offset=10`),
  row(api.getStationGenreRelationship, "Get a Station Genre's Relationship Directly by Name", "RelationshipResponse", ["1", "stations", RELATED], `GET /v1/catalog/gb/station-genres/1/stations?${Q}&limit=5`),
  // Genres
  row(api.getGenre, "Get a Catalog Genre", "GenresResponse", ["14", ALL], `GET /v1/catalog/gb/genres/14?${Q}`),
  row(api.getGenres, "Get Multiple Catalog Genres", "GenresResponse", [["14", "21"], ALL], `GET /v1/catalog/gb/genres?${Q}&ids=14,21`),
  row(api.listGenres, "Get Catalog Top Charts Genres", "GenresResponse", [PAGE], `GET /v1/catalog/gb/genres?${Q}&limit=5&offset=10`),
  // Curators, Apple curators and activities
  row(api.getCurator, "Get a Catalog Curator", "CuratorsResponse", ["1", ALL], `GET /v1/catalog/gb/curators/1?${Q}`),
  row(api.getCurators, "Get Multiple Catalog Curators", "CuratorsResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/curators?${Q}&ids=1,2`),
  row(api.getCuratorRelationship, "Get a Catalog Curator's Relationship Directly by Name", "RelationshipResponse", ["1", "playlists", RELATED], `GET /v1/catalog/gb/curators/1/playlists?${Q}&limit=5`),
  row(api.getAppleCurator, "Get a Catalog Apple Curator", "AppleCuratorsResponse", ["1", ALL], `GET /v1/catalog/gb/apple-curators/1?${Q}`),
  row(api.getAppleCurators, "Get Multiple Catalog Apple Curators", "AppleCuratorsResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/apple-curators?${Q}&ids=1,2`),
  row(api.getAppleCuratorRelationship, "Get a Catalog Apple Curator's Relationship Directly by Name", "RelationshipResponse", ["1", "playlists", RELATED], `GET /v1/catalog/gb/apple-curators/1/playlists?${Q}&limit=5`),
  row(api.getActivity, "Get a Catalog Activity", "ActivitiesResponse", ["1", ALL], `GET /v1/catalog/gb/activities/1?${Q}`),
  row(api.getActivities, "Get Multiple Catalog Activities", "ActivitiesResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/activities?${Q}&ids=1,2`),
  row(api.getActivityRelationship, "Get a Catalog Activity's Relationship Directly by Name", "RelationshipResponse", ["1", "playlists", RELATED], `GET /v1/catalog/gb/activities/1/playlists?${Q}&limit=5`),
  // Record labels
  row(api.getRecordLabel, "Get a Catalog Record Label", "RecordLabelsResponse", ["1", { ...ALL, views: ["latest-releases"] }], `GET /v1/catalog/gb/record-labels/1?${Q}&views=latest-releases`),
  row(api.getRecordLabels, "Get Multiple Record Labels", "RecordLabelsResponse", [["1", "2"], ALL], `GET /v1/catalog/gb/record-labels?${Q}&ids=1,2`),
  row(api.getRecordLabelView, "Get a Catalog Record Label's Relationship View Directly by Name", "RelationshipViewResponse", ["1", "top-releases", VIEW], `GET /v1/catalog/gb/record-labels/1/view/top-releases?${Q}&limit=5&with=attributes`),
  // Storefronts, which no storefront holds
  row(api.getStorefront, "Get a Storefront", "StorefrontsResponse", ["jp", { language: "en-GB", include: ["albums"], extend: ["artistUrl"] }], `GET /v1/storefronts/jp?${Q}`),
  row(api.getStorefronts, "Get Multiple Storefronts", "StorefrontsResponse", [["jp", "fr"], { language: "en-GB", include: ["albums"], extend: ["artistUrl"] }], `GET /v1/storefronts?${Q}&ids=jp,fr`),
  row(api.listStorefronts, "Get All Storefronts", "StorefrontsResponse", [{ language: "en-GB", include: ["albums"], extend: ["artistUrl"], limit: 5, offset: 10 }], `GET /v1/storefronts?${Q}&limit=5&offset=10`),
  // The ones that follow no pattern
  row(
    api.searchCatalog,
    "Search for Catalog Resources", "SearchResponse",
    ["james brown", { ...STORE, limit: 5, offset: 10, types: ["songs", "albums"], with: ["topResults"] }],
    "GET /v1/catalog/gb/search?l=en-GB&limit=5&offset=10&with=topResults&term=james+brown&types=songs,albums",
  ),
  row(api.getSearchHints, "Get Catalog Search Hints", "SearchHintsResponse", ["james br", { ...STORE, limit: 5 }], "GET /v1/catalog/gb/search/hints?l=en-GB&limit=5&term=james+br"),
  row(
    api.getSearchSuggestions,
    "Get Catalog Search Suggestions", "SearchSuggestionsResponse",
    ["james br", { ...STORE, limit: 5, kinds: ["terms", "topResults"], types: ["songs"] }],
    "GET /v1/catalog/gb/search/suggestions?l=en-GB&limit=5&types=songs&term=james+br&kinds=terms,topResults",
  ),
  row(
    api.getCharts,
    "Get Catalog Charts", "ChartResponse",
    [{ ...STORE, limit: 5, offset: 10, types: ["songs", "albums"], chart: "most-played", genre: "20", with: ["cityCharts"] }],
    "GET /v1/catalog/gb/charts?l=en-GB&limit=5&offset=10&chart=most-played&genre=20&with=cityCharts&types=songs,albums",
  ),
  row(
    api.getCatalogResources,
    "Get Multiple Catalog Resources Using Resource-Typed ID Parameters", "ResourceCollectionResponse",
    [
      {
        activities: ["1"],
        albums: ["2"],
        "apple-curators": ["3"],
        artists: ["4"],
        curators: ["5"],
        genres: ["6"],
        "music-videos": ["7"],
        playlists: ["8"],
        ratings: ["9"],
        "record-labels": ["10"],
        songs: ["11", "12"],
        "station-genres": ["13"],
        stations: ["14"],
      },
      ALL,
    ],
    `GET /v1/catalog/gb?${Q}&ids[activities]=1&ids[albums]=2&ids[apple-curators]=3&ids[artists]=4&ids[curators]=5&ids[genres]=6&ids[music-videos]=7&ids[playlists]=8&ids[ratings]=9&ids[record-labels]=10&ids[songs]=11,12&ids[station-genres]=13&ids[stations]=14`,
  ),
  row(api.getLiveRadioStations, "Get the Apple Music Live Radio Stations", "StationsResponse", [ALL], `GET /v1/catalog/gb/stations?${Q}&filter[featured]=apple-music-live-radio`),
  row(api.getLanguageTag, "Get the best supported language for a storefront", "LangageTagResponse", [["fr-CA", "fr", "en"], STORE], "GET /v1/language/gb/tag?l=en-GB&acceptLanguage=fr-CA,fr,en"),
];

/** Calls a row's function with a client. */
const call = (music: tAppleMusicClient, { name, args }: tRow) => (api as unknown as Record<string, (...args: unknown[]) => unknown>)[name]?.(music, ...args);

/** Calls a row's function as the namespace has it, and goes over whatever it gives, so that a walk asks for its first page. */
async function callBound(music: tAppleMusicClient, { name, args }: tRow): Promise<void> {
  const given = (api.catalog(music) as unknown as Record<string, (...args: unknown[]) => unknown>)[name]?.(...args);
  if (typeof (given as Partial<AsyncIterable<unknown>> | undefined)?.[Symbol.asyncIterator] !== "function") await given;
  else for await (const item of given as AsyncIterable<unknown>) expect(item).toBeDefined();
}

describe("each function sends the request Apple documents for its endpoint", () => {
  test.each(rows)("$name: $title", async (each) => {
    const { music, sent } = apple();
    await call(music, each);
    expect(sent()).toEqual([each.sent]);
  });

  test.each(rows)("$name, as the namespace has it, sends the same request", async (each) => {
    const { music, sent } = apple();
    await callBound(music, each);
    expect(sent()).toEqual([each.sent]);
  });
});

describe("what each row sends is what the endpoint's documentation says it takes", () => {
  const byTitle = new Map(documented.map((endpoint) => [endpoint.title, endpoint]));

  test("an endpoint is known by its title: no two share one", () => {
    expect(byTitle.size).toBe(documented.length);
  });

  test.each(rows)("$name: the method, the path, and every parameter documented, with none that is not", ({ title, sent }) => {
    const endpoint = byTitle.get(title);
    if (endpoint === undefined) throw new Error(`no endpoint is titled "${title}"`);
    const [method, target] = sent.split(" ");
    const url = new URL(target ?? "", "https://api.music.apple.com");
    expect(method).toBe(endpoint.method);
    // The path is the documented one with a value in each of its places, and where the documentation lists the values a place may hold, the value is one of them.
    const places = [...endpoint.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    const held = new RegExp(`^/${endpoint.path.replace(/\{\w+\}/g, "([^/]+)")}$`).exec(url.pathname);
    expect(held).not.toBeNull();
    places.forEach((place, index) => {
      const allowed = endpoint.pathParams.find((param) => param.name === place)?.allowed;
      if (allowed) expect(allowed).toContain(held?.[index + 1]);
    });
    expect([...url.searchParams.keys()].sort()).toEqual(endpoint.queryParams.map((param) => param.name).sort());
  });
});

describe("what each function resolves to, and what it may be asked for by name, is what the endpoint's documentation says", () => {
  const byTitle = new Map(documented.map((endpoint) => [endpoint.title, endpoint]));
  const endpointOf = (name: string) => byTitle.get(rows.find((each) => each.name === name)?.title ?? "");

  test.each(rows)("$name resolves to the answer its endpoint documents: the row would not compile if its type were another's", ({ title, answer }) => {
    expect(answer).toBe(byTitle.get(title)?.responses.find((response) => response.status >= 200 && response.status < 300)?.type.name);
  });

  /** The names each relationship function takes. The library relationship is documented for four of them and left out: it is the listener's. */
  const relationships: Readonly<Record<string, readonly string[]>> = {
    getSongRelationship: every<tNameOf<typeof api.getSongRelationship>>()("albums", "artists", "composers", "genres", "music-videos", "station"),
    getAlbumRelationship: every<tNameOf<typeof api.getAlbumRelationship>>()("artists", "genres", "record-labels", "tracks"),
    getArtistRelationship: every<tNameOf<typeof api.getArtistRelationship>>()("albums", "genres", "music-videos", "playlists", "station"),
    getPlaylistRelationship: every<tNameOf<typeof api.getPlaylistRelationship>>()("curator", "tracks"),
    getMusicVideoRelationship: every<tNameOf<typeof api.getMusicVideoRelationship>>()("albums", "artists", "genres", "songs"),
    getStationRelationship: every<tNameOf<typeof api.getStationRelationship>>()("radio-show"),
    getStationGenreRelationship: every<tNameOf<typeof api.getStationGenreRelationship>>()("stations"),
    getCuratorRelationship: every<tNameOf<typeof api.getCuratorRelationship>>()("playlists"),
    getAppleCuratorRelationship: every<tNameOf<typeof api.getAppleCuratorRelationship>>()("playlists"),
    getActivityRelationship: every<tNameOf<typeof api.getActivityRelationship>>()("playlists"),
  };
  const views: Readonly<Record<string, readonly string[]>> = {
    getAlbumView: every<tNameOf<typeof api.getAlbumView>>()("appears-on", "other-versions", "related-albums", "related-videos"),
    getArtistView: every<tNameOf<typeof api.getArtistView>>()(
      "appears-on-albums",
      "compilation-albums",
      "featured-albums",
      "featured-music-videos",
      "featured-playlists",
      "full-albums",
      "latest-release",
      "live-albums",
      "similar-artists",
      "singles",
      "top-music-videos",
      "top-songs",
    ),
    getPlaylistView: every<tNameOf<typeof api.getPlaylistView>>()("featured-artists", "more-by-curator"),
    getMusicVideoView: every<tNameOf<typeof api.getMusicVideoView>>()("more-by-artist", "more-in-genre"),
    getRecordLabelView: every<tNameOf<typeof api.getRecordLabelView>>()("latest-releases", "top-releases"),
  };
  const named = (name: string, place: string) => [...(endpointOf(name)?.pathParams.find((param) => param.name === place)?.allowed ?? [])].sort();

  test.each(Object.entries(relationships))("%s takes the relationships its endpoint documents, bar the listener's own", (name, names) => {
    expect([...names].sort()).toEqual(named(name, "relationship").filter((each) => each !== "library"));
  });

  test("the four relationship functions that leave the library relationship out are the four whose endpoints document one", () => {
    const withLibrary = Object.keys(relationships).filter((name) => named(name, "relationship").includes("library"));
    expect(withLibrary.sort()).toEqual(["getAlbumRelationship", "getMusicVideoRelationship", "getPlaylistRelationship", "getSongRelationship"]);
  });

  test.each(Object.entries(views))("%s takes the views its endpoint documents", (name, names) => {
    expect([...names].sort()).toEqual(named(name, "view"));
  });

  test("every relationship and view function is among them", () => {
    const narrowed = rows.filter((each) => each.answer === "RelationshipResponse" || each.answer === "RelationshipViewResponse").map((each) => each.name);
    expect([...Object.keys(relationships), ...Object.keys(views)].sort()).toEqual(narrowed.sort());
  });

  /** The values an option may hold, for each option whose values the documentation lists. */
  const options: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
    getAlbum: { views: every<tOptionOf<typeof api.getAlbum, "views">>()("appears-on", "other-versions", "related-albums", "related-videos") },
    getArtist: {
      views: every<tOptionOf<typeof api.getArtist, "views">>()(
        "appears-on-albums",
        "compilation-albums",
        "featured-albums",
        "featured-music-videos",
        "featured-playlists",
        "full-albums",
        "latest-release",
        "live-albums",
        "similar-artists",
        "singles",
        "top-music-videos",
        "top-songs",
      ),
    },
    getPlaylist: { views: every<tOptionOf<typeof api.getPlaylist, "views">>()("featured-artists", "more-by-curator") },
    getMusicVideo: { views: every<tOptionOf<typeof api.getMusicVideo, "views">>()("more-by-artist", "more-in-genre") },
    getRecordLabel: { views: every<tOptionOf<typeof api.getRecordLabel, "views">>()("latest-releases", "top-releases") },
    getSongsByEquivalents: { restrict: every<tOptionOf<typeof api.getSongsByEquivalents, "restrict">>()("explicit") },
    getAlbumsByEquivalents: { restrict: every<tOptionOf<typeof api.getAlbumsByEquivalents, "restrict">>()("explicit") },
    getMusicVideosByEquivalents: { restrict: every<tOptionOf<typeof api.getMusicVideosByEquivalents, "restrict">>()("explicit") },
    getAlbumView: { with: every<tOptionOf<typeof api.getAlbumView, "with">>()("attributes") },
    getArtistView: { with: every<tOptionOf<typeof api.getArtistView, "with">>()("attributes") },
    getPlaylistView: { with: every<tOptionOf<typeof api.getPlaylistView, "with">>()("attributes") },
    getMusicVideoView: { with: every<tOptionOf<typeof api.getMusicVideoView, "with">>()("attributes") },
    getRecordLabelView: { with: every<tOptionOf<typeof api.getRecordLabelView, "with">>()("attributes") },
    searchCatalog: {
      types: every<tOptionOf<typeof api.searchCatalog, "types">>()("activities", "albums", "apple-curators", "artists", "curators", "music-videos", "playlists", "record-labels", "songs", "stations"),
      with: every<tOptionOf<typeof api.searchCatalog, "with">>()("topResults"),
    },
    getSearchSuggestions: {
      kinds: every<tOptionOf<typeof api.getSearchSuggestions, "kinds">>()("terms", "topResults"),
      types: every<tOptionOf<typeof api.getSearchSuggestions, "types">>()("activities", "albums", "apple-curators", "artists", "curators", "music-videos", "playlists", "record-labels", "songs", "stations"),
    },
    getCharts: {
      types: every<tOptionOf<typeof api.getCharts, "types">>()("albums", "music-videos", "playlists", "songs"),
      with: every<tOptionOf<typeof api.getCharts, "with">>()("cityCharts", "dailyGlobalTopCharts"),
    },
  };
  const allowed = (name: string, option: string) => [...(endpointOf(name)?.queryParams.find((param) => param.name === option)?.allowed ?? [])].sort();

  test.each(Object.entries(options).flatMap(([name, each]) => Object.entries(each).map(([option, values]): [string, string, readonly string[]] => [name, option, values])))(
    "%s: the values its %s may hold are the ones its endpoint documents",
    (name, option, values) => {
      expect([...values].sort()).toEqual(allowed(name, option));
    },
  );

  test("no option whose values an endpoint lists is left out of the check, bar the ones written down with the reason", () => {
    /** Options typed more loosely than the documentation lists, and why. */
    const loose: Readonly<Record<string, string>> = { "getCharts chart": "the documentation lists most-played and says the others are the names an answer gives" };
    const listed = rows.flatMap((each) => (byTitle.get(each.title)?.queryParams ?? []).filter((param) => param.allowed !== undefined).map((param) => `${each.name} ${param.name}`));
    const checked = Object.entries(options).flatMap(([name, each]) => Object.keys(each).map((option) => `${name} ${option}`));
    const fixed = ["getLiveRadioStations filter[featured]"];
    expect([...checked, ...Object.keys(loose), ...fixed].sort()).toEqual(listed.sort());
  });

  test("the types of resource the catalog is asked for by id are the ones its endpoint documents a parameter for", () => {
    const types = every<keyof api.tCatalogIds>()("activities", "albums", "apple-curators", "artists", "curators", "genres", "music-videos", "playlists", "ratings", "record-labels", "songs", "station-genres", "stations");
    const parameters = (endpointOf("getCatalogResources")?.queryParams ?? []).flatMap((param) => /^ids\[(.+)\]$/.exec(param.name)?.[1] ?? []);
    expect([...types].sort()).toEqual(parameters.sort());
  });
});

describe("every endpoint of the catalog has one function, and every function one endpoint", () => {
  const titles = rows.map((each) => each.title);

  test("each endpoint Apple documents is one function's here, the listener's, or left out for a reason that is written down", () => {
    const unclaimed = documented.filter((endpoint) => !titles.includes(endpoint.title) && !isListeners(endpoint)).map((endpoint) => endpoint.title);
    expect(unclaimed.sort()).toEqual(Object.keys(LEFT_OUT).sort());
  });

  test("no endpoint is claimed twice, and none that is claimed is the listener's or left out", () => {
    expect(new Set(titles).size).toBe(titles.length);
    const claimed = documented.filter((endpoint) => titles.includes(endpoint.title));
    expect(claimed).toHaveLength(titles.length);
    expect(claimed.filter((endpoint) => isListeners(endpoint) || endpoint.title in LEFT_OUT)).toEqual([]);
  });

  test("each function the package exports has a row, and one only", () => {
    const functions = exported.filter(([, value]) => typeof (value as { bound?: unknown }).bound === "function").map(([name]) => name);
    expect(rows.map((each) => each.name).sort()).toEqual(functions.sort());
    expect(functions).toHaveLength(58);
  });
});

describe("the catalog is asked with the developer token alone", () => {
  test.each(rows)("$name sends no Music User Token, though the client holds a listener's", async (each) => {
    const { music, calls } = apple({ userToken: "listener" });
    await call(music, each);
    await callBound(music, each);
    expect(calls.map((request) => [request.headers.get("authorization"), request.headers.get("music-user-token")])).toEqual([
      ["Bearer dev", null],
      ["Bearer dev", null],
    ]);
  });

  describe("a next link that points at the listener's library takes a walk there, and the token stays behind", () => {
    const LIBRARY = "/v1/me/library/songs?limit=100";
    const paths = (calls: Request[]) => calls.map((request) => new URL(request.url).pathname);

    test.each(rows)("$name, as the namespace has it, sends no Music User Token to wherever its answer's next link points", async (each) => {
      const { music, calls } = apple({ userToken: "listener" }, LIBRARY);
      await callBound(music, each);
      expect(calls.map((request) => request.headers.get("music-user-token"))).toEqual(calls.map(() => null));
    });

    test("the check can tell: the eighteen that walk pages did follow that link, so it is not for want of a second request that none carried the token", async () => {
      const followed: string[] = [];
      for (const each of rows) {
        const { music, calls } = apple({ userToken: "listener" }, LIBRARY);
        await callBound(music, each);
        if (calls.length > 1) followed.push(each.name);
        expect(paths(calls).slice(1)).toEqual(calls.length > 1 ? ["/v1/me/library/songs"] : []);
      }
      expect(followed).toHaveLength(18);
    });

    test("the first page a function resolved to is walked from the same way when the walk is told so", async () => {
      const { music, calls } = apple({ userToken: "listener" }, LIBRARY);
      const page = await api.listGenres(music);
      for await (const item of music.paginate(page, { user: false })) expect(item).toBeDefined();
      expect([paths(calls), calls.map((request) => request.headers.get("music-user-token"))]).toEqual([
        ["/v1/catalog/us/genres", "/v1/me/library/songs"],
        [null, null],
      ]);
    });

    test("the check can tell: a walk that is not told so does carry the token there", async () => {
      const { music, calls } = apple({ userToken: "listener" }, LIBRARY);
      for await (const item of music.paginate("v1/catalog/us/genres")) expect(item).toBeDefined();
      expect(calls.map((request) => request.headers.get("music-user-token"))).toEqual([null, "listener"]);
    });
  });

  test("the check can tell: the same client does send the token to a path of the listener's", async () => {
    const { music, calls } = apple({ userToken: "listener" });
    await music.request("v1/me/library/songs");
    expect(calls.map((request) => request.headers.get("music-user-token"))).toEqual(["listener"]);
  });
});

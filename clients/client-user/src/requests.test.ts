import { readFileSync } from "node:fs";
import { createClient, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import type {
  tLibraryAlbumsResponse,
  tLibraryArtistsResponse,
  tLibraryMusicVideosResponse,
  tLibraryPlaylistFoldersResponse,
  tLibraryPlaylistsResponse,
  tLibrarySearchResponse,
  tLibrarySongsResponse,
  tMusicSummariesResponse,
  tPaginatedResourceCollectionResponse,
  tPersonalRecommendationResponse,
  tRatingsResponse,
  tResourceCollectionResponse,
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

/** The one endpoint outside /v1/me that is the listener's: it is under the catalog's path, and needs their token. */
const PERSONAL_STATION = "Get the User's Personal Apple Music Station";
/** Whether an endpoint is the listener's, and so this package's. */
const isListeners = (endpoint: tDocumented) => endpoint.path.startsWith("v1/me") || endpoint.title === PERSONAL_STATION;

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A listener's client over a fetch that answers every request with one resource, and records every Request it saw. */
function apple(options: Partial<tClientOptions> = {}) {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const res = new Response(JSON.stringify({ data: [{ id: "1", type: "library-songs" }] }));
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false, ...options }),
    calls,
    /** Each request as its method, path and query. */
    sent: () => calls.map((call) => `${call.method} ${new URL(call.url).pathname}${decodeURIComponent(new URL(call.url).search)}`),
    /** The body of each request, parsed, or undefined where there was none. */
    bodies: () => Promise.all(calls.map(async (call) => (call.body === null ? undefined : (JSON.parse(await call.text()) as unknown)))),
  };
}

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

/** One function, the endpoint it is for, the answer the function resolves to, a call with every option the endpoint documents, and the request the call has to send. */
interface tRow {
  readonly name: string;
  readonly title: string;
  readonly answer: string;
  readonly args: readonly unknown[];
  readonly sent: string;
  readonly body: unknown;
}

/** A page that a function types by the name it was asked for: held here to being a page, and its names to the documentation further down. */
interface tNarrowedPage {
  readonly data: readonly unknown[];
}

/** Each answer Apple documents for a listener's endpoints, by the name its documentation gives it, as the generated type for it. A success with no body is nothing. */
/* eslint-disable @typescript-eslint/naming-convention -- the names are the documentation's own */
interface tAnswers {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- what a function that resolves to nothing is typed as
  EmptyBodyResponse: void;
  LibraryAlbumsResponse: tLibraryAlbumsResponse;
  LibraryArtistsResponse: tLibraryArtistsResponse;
  LibraryMusicVideosResponse: tLibraryMusicVideosResponse;
  LibraryPlaylistFoldersResponse: tLibraryPlaylistFoldersResponse;
  LibraryPlaylistsResponse: tLibraryPlaylistsResponse;
  LibrarySearchResponse: tLibrarySearchResponse;
  LibrarySongsResponse: tLibrarySongsResponse;
  MusicSummariesResponse: tMusicSummariesResponse;
  PaginatedResourceCollectionResponse: tPaginatedResourceCollectionResponse;
  PersonalRecommendationResponse: tPersonalRecommendationResponse;
  RatingsResponse: tRatingsResponse;
  RelationshipResponse: tNarrowedPage;
  ResourceCollectionResponse: tResourceCollectionResponse;
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
function row<A extends readonly unknown[], R, Name extends keyof tAnswers>(
  fn: (client: tAppleMusicClient, ...args: A) => Promise<R>,
  title: string,
  answer: Name,
  args: NoInfer<A>,
  sent: tSentFor<R, Name>,
  body?: unknown,
): tRow {
  const name = exported.find(([, value]) => value === fn)?.[0];
  if (name === undefined) throw new Error(`the function for "${title}" is not exported`);
  return { name, title, answer, args, sent, body };
}

/** A list of every member of the union `All` and nothing else: one left out, or one that is not a member, does not compile. */
const every =
  <All extends string>() =>
  <const List extends readonly All[]>(...list: List & ([All] extends [List[number]] ? unknown : never)): readonly string[] =>
    list;

/** The name a relationship function is asked with, and each value of an option of a function. */
type tNameOf<F> = F extends (client: tAppleMusicClient, id: string, name: infer Name, ...rest: never[]) => unknown ? Name & string : never;
type tOptionOf<F, Option extends string> = F extends (...args: infer A) => unknown ? tValueOf<NonNullable<A[number]>, Option> : never;
type tValueOf<Options, Option extends string> = Options extends Partial<Record<Option, infer Value>> ? (NonNullable<Value> extends readonly (infer Item)[] ? Item & string : NonNullable<Value> & string) : never;

const L = { language: "en-GB" } as const;
const ALL = { ...L, include: ["albums"], extend: ["artistUrl"] } as const;
const RELATED = { ...ALL, limit: 5 } as const;
const PAGE = { ...ALL, limit: 5, offset: 10 } as const;
const Q = "l=en-GB&include=albums&extend=artistUrl";
const LIBRARY = "/v1/me/library";
const RATINGS = "/v1/me/ratings";
const LIKE = { type: "ratings", attributes: { value: 1 } };
const DISLIKE = { type: "ratings", attributes: { value: -1 } };

const playlist = { attributes: { name: "Road", description: "For the drive" }, relationships: { tracks: { data: [{ id: "1", type: "songs" as const }] }, parent: { data: [{ id: "p.root", type: "library-playlist-folders" as const }] } } };
const folder = { attributes: { name: "Trips" }, relationships: { parent: { data: [{ id: "p.root", type: "library-playlist-folders" as const }] } } };

const rows: tRow[] = [
  // Library songs
  row(api.getLibrarySong, "Get a Library Song", "LibrarySongsResponse", ["i.1", ALL], `GET ${LIBRARY}/songs/i.1?${Q}`),
  row(api.getLibrarySongs, "Get Multiple Library Songs", "LibrarySongsResponse", [["i.1", "i.2"], ALL], `GET ${LIBRARY}/songs?${Q}&ids=i.1,i.2`),
  row(api.listLibrarySongs, "Get All Library Songs", "LibrarySongsResponse", [PAGE], `GET ${LIBRARY}/songs?${Q}&limit=5&offset=10`),
  row(api.getLibrarySongRelationship, "Get a Library Song's Relationship Directly by Name", "RelationshipResponse", ["i.1", "albums", RELATED], `GET ${LIBRARY}/songs/i.1/albums?${Q}&limit=5`),
  // Library albums
  row(api.getLibraryAlbum, "Get a Library Album", "LibraryAlbumsResponse", ["l.1", ALL], `GET ${LIBRARY}/albums/l.1?${Q}`),
  row(api.getLibraryAlbums, "Get Multiple Library Albums", "LibraryAlbumsResponse", [["l.1", "l.2"], ALL], `GET ${LIBRARY}/albums?${Q}&ids=l.1,l.2`),
  row(api.listLibraryAlbums, "Get All Library Albums", "LibraryAlbumsResponse", [PAGE], `GET ${LIBRARY}/albums?${Q}&limit=5&offset=10`),
  row(api.getLibraryAlbumRelationship, "Get a Library Album's Relationship Directly by Name", "RelationshipResponse", ["l.1", "tracks", RELATED], `GET ${LIBRARY}/albums/l.1/tracks?${Q}&limit=5`),
  // Library artists
  row(api.getLibraryArtist, "Get a Library Artist", "LibraryArtistsResponse", ["r.1", ALL], `GET ${LIBRARY}/artists/r.1?${Q}`),
  row(api.getLibraryArtists, "Get Multiple Library Artists", "LibraryArtistsResponse", [["r.1", "r.2"], ALL], `GET ${LIBRARY}/artists?${Q}&ids=r.1,r.2`),
  row(api.listLibraryArtists, "Get All Library Artists", "LibraryArtistsResponse", [PAGE], `GET ${LIBRARY}/artists?${Q}&limit=5&offset=10`),
  row(api.getLibraryArtistRelationship, "Get a Library Artist's Relationship Directly by Name", "RelationshipResponse", ["r.1", "albums", RELATED], `GET ${LIBRARY}/artists/r.1/albums?${Q}&limit=5`),
  // Library music videos
  row(api.getLibraryMusicVideo, "Get a Library Music Video", "LibraryMusicVideosResponse", ["i.1", ALL], `GET ${LIBRARY}/music-videos/i.1?${Q}`),
  row(api.getLibraryMusicVideos, "Get Multiple Library Music Videos", "LibraryMusicVideosResponse", [["i.1", "i.2"], ALL], `GET ${LIBRARY}/music-videos?${Q}&ids=i.1,i.2`),
  row(api.listLibraryMusicVideos, "Get All Library Music Videos", "LibraryMusicVideosResponse", [PAGE], `GET ${LIBRARY}/music-videos?${Q}&limit=5&offset=10`),
  row(api.getLibraryMusicVideoRelationship, "Get a Library Music Video's Relationship Directly by Name", "RelationshipResponse", ["i.1", "artists", RELATED], `GET ${LIBRARY}/music-videos/i.1/artists?${Q}&limit=5`),
  // Library playlists
  row(api.getLibraryPlaylist, "Get a Library Playlist", "LibraryPlaylistsResponse", ["p.1", ALL], `GET ${LIBRARY}/playlists/p.1?${Q}`),
  row(api.getLibraryPlaylists, "Get Multiple Library Playlists", "LibraryPlaylistsResponse", [["p.1", "p.2"], ALL], `GET ${LIBRARY}/playlists?${Q}&ids=p.1,p.2`),
  row(api.listLibraryPlaylists, "Get All Library Playlists", "LibraryPlaylistsResponse", [PAGE], `GET ${LIBRARY}/playlists?${Q}&limit=5&offset=10`),
  row(api.getLibraryPlaylistRelationship, "Get a Library Playlist's Relationship Directly by Name", "RelationshipResponse", ["p.1", "tracks", RELATED], `GET ${LIBRARY}/playlists/p.1/tracks?${Q}&limit=5`),
  row(api.createLibraryPlaylist, "Create a New Library Playlist", "LibraryPlaylistsResponse", [playlist, L], `POST ${LIBRARY}/playlists?l=en-GB`, playlist),
  // Library playlist folders
  row(api.getLibraryPlaylistFolder, "Get a Library Playlist Folder", "LibraryPlaylistFoldersResponse", ["p.f1", ALL], `GET ${LIBRARY}/playlist-folders/p.f1?${Q}`),
  row(api.getLibraryPlaylistFolders, "Get Multiple Library Playlist Folders", "LibraryPlaylistFoldersResponse", [["p.f1", "p.f2"], ALL], `GET ${LIBRARY}/playlist-folders?${Q}&ids=p.f1,p.f2`),
  row(api.getLibraryPlaylistFolderRelationship, "Get a Library Playlist Folder's Relationship Directly by Name", "RelationshipResponse", ["p.f1", "children", RELATED], `GET ${LIBRARY}/playlist-folders/p.f1/children?${Q}&limit=5`),
  row(api.createLibraryPlaylistFolder, "Create a New Library Playlist Folder", "LibraryPlaylistFoldersResponse", [folder, L], `POST ${LIBRARY}/playlist-folders?l=en-GB`, folder),
  // Recommendations
  row(api.getPersonalRecommendation, "Get a Recommendation", "PersonalRecommendationResponse", ["6-27s5hU6azhJY", ALL], `GET /v1/me/recommendations/6-27s5hU6azhJY?${Q}`),
  row(api.getPersonalRecommendations, "Get Multiple Recommendations", "PersonalRecommendationResponse", [["1", "2"], ALL], `GET /v1/me/recommendations?${Q}&ids=1,2`),
  row(api.listPersonalRecommendations, "Get Default Recommendations", "PersonalRecommendationResponse", [PAGE], `GET /v1/me/recommendations?${Q}&limit=5&offset=10`),
  row(api.getPersonalRecommendationRelationship, "Get a Recommendation Relationship Directly by Name", "RelationshipResponse", ["1", "contents", RELATED], `GET /v1/me/recommendations/1/contents?${Q}&limit=5`),
  // Ratings of songs
  row(api.getSongRating, "Get a Personal Song Rating", "RatingsResponse", ["1", ALL], `GET ${RATINGS}/songs/1?${Q}`),
  row(api.getSongRatings, "Get Multiple Personal Song Ratings", "RatingsResponse", [["1", "2"], ALL], `GET ${RATINGS}/songs?${Q}&ids=1,2`),
  row(api.setSongRating, "Add a Personal Song Rating", "RatingsResponse", ["1", 1, L], `PUT ${RATINGS}/songs/1?l=en-GB`, LIKE),
  row(api.deleteSongRating, "Delete a Personal Song Rating", "EmptyBodyResponse", ["1", L], `DELETE ${RATINGS}/songs/1?l=en-GB`),
  // Ratings of albums
  row(api.getAlbumRating, "Get a Personal Album Rating", "RatingsResponse", ["1", ALL], `GET ${RATINGS}/albums/1?${Q}`),
  row(api.getAlbumRatings, "Get Multiple Personal Album Ratings", "RatingsResponse", [["1", "2"], ALL], `GET ${RATINGS}/albums?${Q}&ids=1,2`),
  row(api.setAlbumRating, "Add a Personal Album Rating", "RatingsResponse", ["1", -1, L], `PUT ${RATINGS}/albums/1?l=en-GB`, DISLIKE),
  row(api.deleteAlbumRating, "Delete a Personal Album Rating", "EmptyBodyResponse", ["1", L], `DELETE ${RATINGS}/albums/1?l=en-GB`),
  // Ratings of music videos
  row(api.getMusicVideoRating, "Get a Personal Music Video Rating", "RatingsResponse", ["1", ALL], `GET ${RATINGS}/music-videos/1?${Q}`),
  row(api.getMusicVideoRatings, "Get Multiple Personal Music Video Ratings", "RatingsResponse", [["1", "2"], ALL], `GET ${RATINGS}/music-videos?${Q}&ids=1,2`),
  row(api.setMusicVideoRating, "Add a Personal Music Video Rating", "RatingsResponse", ["1", 1, L], `PUT ${RATINGS}/music-videos/1?l=en-GB`, LIKE),
  row(api.deleteMusicVideoRating, "Delete a Personal Music Video Rating", "EmptyBodyResponse", ["1", L], `DELETE ${RATINGS}/music-videos/1?l=en-GB`),
  // Ratings of playlists
  row(api.getPlaylistRating, "Get a Personal Playlist Rating", "RatingsResponse", ["pl.1", ALL], `GET ${RATINGS}/playlists/pl.1?${Q}`),
  row(api.getPlaylistRatings, "Get Multiple Personal Playlist Ratings", "RatingsResponse", [["pl.1", "pl.2"], ALL], `GET ${RATINGS}/playlists?${Q}&ids=pl.1,pl.2`),
  row(api.setPlaylistRating, "Add a Personal Playlist Rating", "RatingsResponse", ["pl.1", -1, L], `PUT ${RATINGS}/playlists/pl.1?l=en-GB`, DISLIKE),
  row(api.deletePlaylistRating, "Delete a Personal Playlist Rating", "EmptyBodyResponse", ["pl.1", L], `DELETE ${RATINGS}/playlists/pl.1?l=en-GB`),
  // Ratings of stations
  row(api.getStationRating, "Get a Personal Station Rating", "RatingsResponse", ["ra.1", ALL], `GET ${RATINGS}/stations/ra.1?${Q}`),
  row(api.getStationRatings, "Get Multiple Personal Station Ratings", "RatingsResponse", [["ra.1", "ra.2"], ALL], `GET ${RATINGS}/stations?${Q}&ids=ra.1,ra.2`),
  row(api.setStationRating, "Add a Personal Station Rating", "RatingsResponse", ["ra.1", 1, L], `PUT ${RATINGS}/stations/ra.1?l=en-GB`, LIKE),
  row(api.deleteStationRating, "Delete a Personal Station Rating", "EmptyBodyResponse", ["ra.1", L], `DELETE ${RATINGS}/stations/ra.1?l=en-GB`),
  // Ratings of library songs
  row(api.getLibrarySongRating, "Get a Personal Library Song Rating", "RatingsResponse", ["i.1", ALL], `GET ${RATINGS}/library-songs/i.1?${Q}`),
  row(api.getLibrarySongRatings, "Get Multiple Personal Library Songs Ratings", "RatingsResponse", [["i.1", "i.2"], ALL], `GET ${RATINGS}/library-songs?${Q}&ids=i.1,i.2`),
  row(api.setLibrarySongRating, "Add a Personal Library Song Rating", "RatingsResponse", ["i.1", 1, L], `PUT ${RATINGS}/library-songs/i.1?l=en-GB`, LIKE),
  row(api.deleteLibrarySongRating, "Delete a Personal Library Song Rating", "EmptyBodyResponse", ["i.1", L], `DELETE ${RATINGS}/library-songs/i.1?l=en-GB`),
  // Ratings of library albums
  row(api.getLibraryAlbumRating, "Get a Personal Library Album Rating", "RatingsResponse", ["l.1", ALL], `GET ${RATINGS}/library-albums/l.1?${Q}`),
  row(api.getLibraryAlbumRatings, "Get Multiple Personal Library Album Ratings", "RatingsResponse", [["l.1", "l.2"], ALL], `GET ${RATINGS}/library-albums?${Q}&ids=l.1,l.2`),
  row(api.setLibraryAlbumRating, "Add a Personal Library Album Rating", "RatingsResponse", ["l.1", -1, L], `PUT ${RATINGS}/library-albums/l.1?l=en-GB`, DISLIKE),
  row(api.deleteLibraryAlbumRating, "Delete a Personal Library Album Rating", "EmptyBodyResponse", ["l.1", L], `DELETE ${RATINGS}/library-albums/l.1?l=en-GB`),
  // Ratings of library music videos
  row(api.getLibraryMusicVideoRating, "Get a Personal Library Music Video Rating", "RatingsResponse", ["i.1", ALL], `GET ${RATINGS}/library-music-videos/i.1?${Q}`),
  row(api.getLibraryMusicVideoRatings, "Get Multiple Personal Library Music Video Ratings", "RatingsResponse", [["i.1", "i.2"], ALL], `GET ${RATINGS}/library-music-videos?${Q}&ids=i.1,i.2`),
  row(api.setLibraryMusicVideoRating, "Add a Personal Library Music Video Rating", "RatingsResponse", ["i.1", 1, L], `PUT ${RATINGS}/library-music-videos/i.1?l=en-GB`, LIKE),
  row(api.deleteLibraryMusicVideoRating, "Delete a Personal Library Music Video Rating", "EmptyBodyResponse", ["i.1", L], `DELETE ${RATINGS}/library-music-videos/i.1?l=en-GB`),
  // Ratings of library playlists
  row(api.getLibraryPlaylistRating, "Get a Personal Library Playlist Rating", "RatingsResponse", ["p.1", ALL], `GET ${RATINGS}/library-playlists/p.1?${Q}`),
  row(api.getLibraryPlaylistRatings, "Get Multiple Personal Library Playlist Ratings", "RatingsResponse", [["p.1", "p.2"], ALL], `GET ${RATINGS}/library-playlists?${Q}&ids=p.1,p.2`),
  row(api.setLibraryPlaylistRating, "Add a Personal Library Playlist Rating", "RatingsResponse", ["p.1", -1, L], `PUT ${RATINGS}/library-playlists/p.1?l=en-GB`, DISLIKE),
  row(api.deleteLibraryPlaylistRating, "Delete a Personal Library Playlist Rating", "EmptyBodyResponse", ["p.1", L], `DELETE ${RATINGS}/library-playlists/p.1?l=en-GB`),
  // The ones that follow no pattern
  row(
    api.searchLibrary,
    "Search for Library Resources", "LibrarySearchResponse",
    ["james brown", { ...L, limit: 5, offset: 10, types: ["library-songs", "library-albums"] }],
    `GET ${LIBRARY}/search?l=en-GB&limit=5&offset=10&term=james+brown&types=library-songs,library-albums`,
  ),
  row(
    api.getLibraryResources,
    "Get Multiple Library Resources Using Resource-Typed ID Parameters", "ResourceCollectionResponse",
    [{ "library-albums": ["l.1"], "library-artists": ["r.1"], "library-music-videos": ["i.2"], "library-playlist-folders": ["p.f1"], "library-playlists": ["p.1"], "library-songs": ["i.1", "i.3"] }, ALL],
    `GET ${LIBRARY}?${Q}&ids[library-albums]=l.1&ids[library-artists]=r.1&ids[library-music-videos]=i.2&ids[library-playlist-folders]=p.f1&ids[library-playlists]=p.1&ids[library-songs]=i.1,i.3`,
  ),
  row(api.addToLibrary, "Add a Resource to a Library", "EmptyBodyResponse", [{ songs: ["1", "2"], albums: ["3"] }, L], `POST ${LIBRARY}?l=en-GB&ids[songs]=1,2&ids[albums]=3`),
  row(api.addToFavorites, "Add resource to favorites", "EmptyBodyResponse", [{ songs: ["1"], playlists: ["pl.1"] }, L], "POST /v1/me/favorites?l=en-GB&ids[songs]=1&ids[playlists]=pl.1"),
  row(
    api.addLibraryPlaylistTracks,
    "Add Tracks to a Library Playlist", "EmptyBodyResponse",
    [
      "p.1",
      [
        { id: "1", type: "songs" },
        { id: "i.2", type: "library-songs" },
      ],
      L,
    ],
    `POST ${LIBRARY}/playlists/p.1/tracks?l=en-GB`,
    {
      data: [
        { id: "1", type: "songs" },
        { id: "i.2", type: "library-songs" },
      ],
    },
  ),
  row(api.getRootLibraryPlaylistFolder, "Get Root Library Playlists Folder", "LibraryPlaylistFoldersResponse", [ALL], `GET ${LIBRARY}/playlist-folders?${Q}&filter[identity]=playlistsroot`),
  row(api.listRecentlyAdded, "Get Recently Added Resources", "ResourceCollectionResponse", [L], `GET ${LIBRARY}/recently-added?l=en-GB`),
  row(api.listHeavyRotation, "Get Heavy Rotation Content", "PaginatedResourceCollectionResponse", [PAGE], `GET /v1/me/history/heavy-rotation?${Q}&limit=5&offset=10`),
  row(api.listRecentlyPlayed, "Get Recently Played Resources", "PaginatedResourceCollectionResponse", [{ ...PAGE, types: ["albums", "playlists"] }], `GET /v1/me/recent/played?${Q}&limit=5&offset=10&types=albums,playlists`),
  row(api.listRecentlyPlayedTracks, "Get Recently Played Tracks", "PaginatedResourceCollectionResponse", [{ ...PAGE, types: ["songs", "library-songs"] }], `GET /v1/me/recent/played/tracks?${Q}&limit=5&offset=10&types=songs,library-songs`),
  row(api.listRecentlyPlayedStations, "Get Recently Played Stations", "PaginatedResourceCollectionResponse", [PAGE], `GET /v1/me/recent/radio-stations?${Q}&limit=5&offset=10`),
  row(api.getMusicSummariesByYear, "Get the user's replay data", "MusicSummariesResponse", [["latest"], { ...ALL, views: ["top-artists", "top-songs"] }], `GET /v1/me/music-summaries?${Q}&views=top-artists,top-songs&filter[year]=latest`),
  row(api.getPersonalStation, "Get the User's Personal Apple Music Station", "StationsResponse", [{ ...ALL, storefront: "gb" }], `GET /v1/catalog/gb/stations?${Q}&filter[identity]=personal`),
  row(api.getUserStorefront, "Get a User's Storefront", "StorefrontsResponse", [PAGE], `GET /v1/me/storefront?${Q}&limit=5&offset=10`),
];

/** Calls a row's function with a client. */
const call = (music: tAppleMusicClient, { name, args }: tRow) => (api as unknown as Record<string, (...args: unknown[]) => unknown>)[name]?.(music, ...args);

/** Calls a row's function as the namespace has it, and goes over whatever it gives, so that a walk asks for its first page. */
async function callBound(music: tAppleMusicClient, { name, args }: tRow): Promise<void> {
  const given = (api.user(music) as unknown as Record<string, (...args: unknown[]) => unknown>)[name]?.(...args);
  if (typeof (given as Partial<AsyncIterable<unknown>> | undefined)?.[Symbol.asyncIterator] !== "function") await given;
  else for await (const item of given as AsyncIterable<unknown>) expect(item).toBeDefined();
}

describe("each function sends the request Apple documents for its endpoint", () => {
  test.each(rows)("$name: $title", async (each) => {
    const { music, sent, bodies } = apple();
    await call(music, each);
    expect(sent()).toEqual([each.sent]);
    expect(await bodies()).toEqual([each.body]);
  });

  test.each(rows)("$name, as the namespace has it, sends the same request", async (each) => {
    const { music, sent, bodies } = apple();
    await callBound(music, each);
    expect(sent()).toEqual([each.sent]);
    expect(await bodies()).toEqual([each.body]);
  });

  test("a body is sent as JSON and said to be, and a request without one says nothing of the kind", async () => {
    const { music, calls } = apple();
    await api.setSongRating(music, "1", 1);
    await api.deleteSongRating(music, "1");
    expect(calls.map((request) => request.headers.get("content-type"))).toEqual(["application/json", null]);
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
    const names = endpoint.queryParams.map((param) => param.name);
    // Where the documentation has `ids` and says the type follows it, without listing the types, `ids[songs]` is that parameter.
    const documentedAs = (key: string) => (!names.includes(key) && /^ids\[[a-z-]+\]$/.test(key) ? "ids" : key);
    expect([...new Set([...url.searchParams.keys()].map(documentedAs))].sort()).toEqual([...names].sort());
  });
});

describe("what each function resolves to, and what it may be asked for by name, is what the endpoint's documentation says", () => {
  const byTitle = new Map(documented.map((endpoint) => [endpoint.title, endpoint]));
  const endpointOf = (name: string) => byTitle.get(rows.find((each) => each.name === name)?.title ?? "");
  /** The two functions that resolve to another type than their endpoint documents, what it documents, and why. */
  const typedOtherwise: Readonly<Record<string, readonly [documented: string, why: string]>> = {
    getUserStorefront: ["PaginatedResourceCollectionResponse", "the documentation says a collection of resources, and what it holds are storefronts"],
    addLibraryPlaylistTracks: ["LibraryPlaylistsTracksRelationshipResponse", "the documentation names an answer for a 204, which is a success with no body"],
  };

  test.each(rows)("$name resolves to the answer its endpoint documents: the row would not compile if its type were another's", ({ name, title, answer }) => {
    const success = byTitle.get(title)?.responses.find((response) => response.status >= 200 && response.status < 300)?.type.name;
    expect(typedOtherwise[name]?.[0] ?? answer).toBe(success);
    if (name in typedOtherwise) expect(answer).not.toBe(success);
  });

  const relationships: Readonly<Record<string, readonly string[]>> = {
    getLibrarySongRelationship: every<tNameOf<typeof api.getLibrarySongRelationship>>()("albums", "artists", "catalog"),
    getLibraryAlbumRelationship: every<tNameOf<typeof api.getLibraryAlbumRelationship>>()("artists", "catalog", "tracks"),
    getLibraryArtistRelationship: every<tNameOf<typeof api.getLibraryArtistRelationship>>()("albums", "catalog"),
    getLibraryMusicVideoRelationship: every<tNameOf<typeof api.getLibraryMusicVideoRelationship>>()("albums", "artists", "catalog"),
    getLibraryPlaylistRelationship: every<tNameOf<typeof api.getLibraryPlaylistRelationship>>()("catalog", "tracks"),
    getLibraryPlaylistFolderRelationship: every<tNameOf<typeof api.getLibraryPlaylistFolderRelationship>>()("children", "parent"),
    getPersonalRecommendationRelationship: every<tNameOf<typeof api.getPersonalRecommendationRelationship>>()("contents"),
  };

  test.each(Object.entries(relationships))("%s takes the relationships its endpoint documents", (name, names) => {
    expect([...names].sort()).toEqual([...(endpointOf(name)?.pathParams.find((param) => param.name === "relationship")?.allowed ?? [])].sort());
  });

  test("every relationship function is among them", () => {
    expect(Object.keys(relationships).sort()).toEqual(
      rows
        .filter((each) => each.answer === "RelationshipResponse")
        .map((each) => each.name)
        .sort(),
    );
  });

  /** The values an option may hold, for each option whose values the documentation lists. */
  const options: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
    searchLibrary: { types: every<tOptionOf<typeof api.searchLibrary, "types">>()("library-albums", "library-artists", "library-music-videos", "library-playlists", "library-songs") },
    listRecentlyPlayed: { types: every<tOptionOf<typeof api.listRecentlyPlayed, "types">>()("albums", "artists", "curators", "library-albums", "library-playlists", "playlists", "stations") },
    listRecentlyPlayedTracks: { types: every<tOptionOf<typeof api.listRecentlyPlayedTracks, "types">>()("library-music-videos", "library-songs", "music-videos", "songs") },
    getMusicSummariesByYear: { views: every<tOptionOf<typeof api.getMusicSummariesByYear, "views">>()("top-albums", "top-artists", "top-songs") },
  };

  test.each(Object.entries(options).flatMap(([name, each]) => Object.entries(each).map(([option, values]): [string, string, readonly string[]] => [name, option, values])))(
    "%s: the values its %s may hold are the ones its endpoint documents",
    (name, option, values) => {
      expect([...values].sort()).toEqual([...(endpointOf(name)?.queryParams.find((param) => param.name === option)?.allowed ?? [])].sort());
    },
  );

  test("no option whose values an endpoint lists is left out of the check, bar the ones a function sets itself", () => {
    const listed = rows.flatMap((each) => (byTitle.get(each.title)?.queryParams ?? []).filter((param) => param.allowed !== undefined).map((param) => `${each.name} ${param.name}`));
    const checked = Object.entries(options).flatMap(([name, each]) => Object.keys(each).map((option) => `${name} ${option}`));
    const fixed = ["getRootLibraryPlaylistFolder filter[identity]", "getPersonalStation filter[identity]"];
    expect([...checked, ...fixed].sort()).toEqual(listed.sort());
  });

  test("the types of resource the library is asked for by id are the ones its endpoint documents a parameter for", () => {
    const types = every<keyof api.tLibraryIds>()("library-albums", "library-artists", "library-music-videos", "library-playlist-folders", "library-playlists", "library-songs");
    const parameters = (endpointOf("getLibraryResources")?.queryParams ?? []).flatMap((param) => /^ids\[(.+)\]$/.exec(param.name)?.[1] ?? []);
    expect([...types].sort()).toEqual(parameters.sort());
  });

  test("a rating's value, and a track's type, are the ones the documentation gives their requests", () => {
    // The requests' bodies are not among the endpoints the documentation lists: they are generated types, which these are held to.
    const values: readonly (-1 | 1)[] = [1, -1] satisfies readonly api.tRatingValue[];
    const kinds = every<api.tPlaylistTrack["type"]>()("library-music-videos", "library-songs", "music-videos", "songs");
    expect([values.length, kinds.length]).toEqual([2, 4]);
  });
});

describe("every endpoint of the listener's has one function, and every function one endpoint", () => {
  const titles = rows.map((each) => each.title);

  test("each endpoint Apple documents is one function's here, or is not the listener's", () => {
    expect(documented.filter((endpoint) => isListeners(endpoint) && !titles.includes(endpoint.title)).map((endpoint) => endpoint.title)).toEqual([]);
  });

  test("no endpoint is claimed twice, and none that is claimed is another's", () => {
    expect(new Set(titles).size).toBe(titles.length);
    const claimed = documented.filter((endpoint) => titles.includes(endpoint.title));
    expect(claimed).toHaveLength(titles.length);
    expect(claimed.filter((endpoint) => !isListeners(endpoint))).toEqual([]);
  });

  test("each function the package exports has a row, and one only", () => {
    const functions = exported.filter(([, value]) => typeof (value as { bound?: unknown }).bound === "function").map(([name]) => name);
    expect(rows.map((each) => each.name).sort()).toEqual(functions.sort());
    expect(functions).toHaveLength(79);
  });
});

describe("the listener's side is asked with both tokens", () => {
  test.each(rows)("$name sends the developer token and the Music User Token", async (each) => {
    const { music, calls } = apple();
    await call(music, each);
    await callBound(music, each);
    expect(calls.map((request) => [request.headers.get("authorization"), request.headers.get("music-user-token")])).toEqual([
      ["Bearer dev", "listener"],
      ["Bearer dev", "listener"],
    ]);
  });

  test("the check can tell: the same client sends no Music User Token to a path of the catalog", async () => {
    const { music, calls } = apple();
    await music.request("v1/catalog/us/stations");
    expect(calls.map((request) => request.headers.get("music-user-token"))).toEqual([null]);
  });
});

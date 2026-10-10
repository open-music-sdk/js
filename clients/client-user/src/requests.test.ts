import { readFileSync } from "node:fs";
import { createClient, type tAppleMusicClient, type tClientOptions } from "@open-music-sdk/core";
import { afterEach, describe, expect, test } from "vitest";
import * as api from "./index";

/** An endpoint as Apple documents it, from the description the types are generated from. */
interface tDocumented {
  readonly title: string;
  readonly method: string;
  readonly path: string;
  readonly pathParams: readonly { readonly name: string; readonly allowed?: readonly string[] }[];
  readonly queryParams: readonly { readonly name: string; readonly required: boolean }[];
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

/** One function, the endpoint it is for, a call with every option that endpoint documents, and the request the call has to send. */
interface tRow {
  readonly name: string;
  readonly title: string;
  readonly args: readonly unknown[];
  readonly sent: string;
  readonly body: unknown;
}

const exported: [string, unknown][] = Object.entries(api);

/** A row, with its arguments held to the function's own types and the function known by the name it is exported under. */
function row<A extends readonly unknown[]>(fn: (client: tAppleMusicClient, ...args: A) => unknown, title: string, args: NoInfer<A>, sent: string, body?: unknown): tRow {
  const name = exported.find(([, value]) => value === fn)?.[0];
  if (name === undefined) throw new Error(`the function for "${title}" is not exported`);
  return { name, title, args, sent, body };
}

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
  row(api.getLibrarySong, "Get a Library Song", ["i.1", ALL], `GET ${LIBRARY}/songs/i.1?${Q}`),
  row(api.getLibrarySongs, "Get Multiple Library Songs", [["i.1", "i.2"], ALL], `GET ${LIBRARY}/songs?${Q}&ids=i.1,i.2`),
  row(api.listLibrarySongs, "Get All Library Songs", [PAGE], `GET ${LIBRARY}/songs?${Q}&limit=5&offset=10`),
  row(api.getLibrarySongRelationship, "Get a Library Song's Relationship Directly by Name", ["i.1", "albums", RELATED], `GET ${LIBRARY}/songs/i.1/albums?${Q}&limit=5`),
  // Library albums
  row(api.getLibraryAlbum, "Get a Library Album", ["l.1", ALL], `GET ${LIBRARY}/albums/l.1?${Q}`),
  row(api.getLibraryAlbums, "Get Multiple Library Albums", [["l.1", "l.2"], ALL], `GET ${LIBRARY}/albums?${Q}&ids=l.1,l.2`),
  row(api.listLibraryAlbums, "Get All Library Albums", [PAGE], `GET ${LIBRARY}/albums?${Q}&limit=5&offset=10`),
  row(api.getLibraryAlbumRelationship, "Get a Library Album's Relationship Directly by Name", ["l.1", "tracks", RELATED], `GET ${LIBRARY}/albums/l.1/tracks?${Q}&limit=5`),
  // Library artists
  row(api.getLibraryArtist, "Get a Library Artist", ["r.1", ALL], `GET ${LIBRARY}/artists/r.1?${Q}`),
  row(api.getLibraryArtists, "Get Multiple Library Artists", [["r.1", "r.2"], ALL], `GET ${LIBRARY}/artists?${Q}&ids=r.1,r.2`),
  row(api.listLibraryArtists, "Get All Library Artists", [PAGE], `GET ${LIBRARY}/artists?${Q}&limit=5&offset=10`),
  row(api.getLibraryArtistRelationship, "Get a Library Artist's Relationship Directly by Name", ["r.1", "albums", RELATED], `GET ${LIBRARY}/artists/r.1/albums?${Q}&limit=5`),
  // Library music videos
  row(api.getLibraryMusicVideo, "Get a Library Music Video", ["i.1", ALL], `GET ${LIBRARY}/music-videos/i.1?${Q}`),
  row(api.getLibraryMusicVideos, "Get Multiple Library Music Videos", [["i.1", "i.2"], ALL], `GET ${LIBRARY}/music-videos?${Q}&ids=i.1,i.2`),
  row(api.listLibraryMusicVideos, "Get All Library Music Videos", [PAGE], `GET ${LIBRARY}/music-videos?${Q}&limit=5&offset=10`),
  row(api.getLibraryMusicVideoRelationship, "Get a Library Music Video's Relationship Directly by Name", ["i.1", "artists", RELATED], `GET ${LIBRARY}/music-videos/i.1/artists?${Q}&limit=5`),
  // Library playlists
  row(api.getLibraryPlaylist, "Get a Library Playlist", ["p.1", ALL], `GET ${LIBRARY}/playlists/p.1?${Q}`),
  row(api.getLibraryPlaylists, "Get Multiple Library Playlists", [["p.1", "p.2"], ALL], `GET ${LIBRARY}/playlists?${Q}&ids=p.1,p.2`),
  row(api.listLibraryPlaylists, "Get All Library Playlists", [PAGE], `GET ${LIBRARY}/playlists?${Q}&limit=5&offset=10`),
  row(api.getLibraryPlaylistRelationship, "Get a Library Playlist's Relationship Directly by Name", ["p.1", "tracks", RELATED], `GET ${LIBRARY}/playlists/p.1/tracks?${Q}&limit=5`),
  row(api.createLibraryPlaylist, "Create a New Library Playlist", [playlist, L], `POST ${LIBRARY}/playlists?l=en-GB`, playlist),
  // Library playlist folders
  row(api.getLibraryPlaylistFolder, "Get a Library Playlist Folder", ["p.f1", ALL], `GET ${LIBRARY}/playlist-folders/p.f1?${Q}`),
  row(api.getLibraryPlaylistFolders, "Get Multiple Library Playlist Folders", [["p.f1", "p.f2"], ALL], `GET ${LIBRARY}/playlist-folders?${Q}&ids=p.f1,p.f2`),
  row(api.getLibraryPlaylistFolderRelationship, "Get a Library Playlist Folder's Relationship Directly by Name", ["p.f1", "children", RELATED], `GET ${LIBRARY}/playlist-folders/p.f1/children?${Q}&limit=5`),
  row(api.createLibraryPlaylistFolder, "Create a New Library Playlist Folder", [folder, L], `POST ${LIBRARY}/playlist-folders?l=en-GB`, folder),
  // Recommendations
  row(api.getPersonalRecommendation, "Get a Recommendation", ["6-27s5hU6azhJY", ALL], `GET /v1/me/recommendations/6-27s5hU6azhJY?${Q}`),
  row(api.getPersonalRecommendations, "Get Multiple Recommendations", [["1", "2"], ALL], `GET /v1/me/recommendations?${Q}&ids=1,2`),
  row(api.listPersonalRecommendations, "Get Default Recommendations", [PAGE], `GET /v1/me/recommendations?${Q}&limit=5&offset=10`),
  row(api.getPersonalRecommendationRelationship, "Get a Recommendation Relationship Directly by Name", ["1", "contents", RELATED], `GET /v1/me/recommendations/1/contents?${Q}&limit=5`),
  // Ratings of songs
  row(api.getSongRating, "Get a Personal Song Rating", ["1", ALL], `GET ${RATINGS}/songs/1?${Q}`),
  row(api.getSongRatings, "Get Multiple Personal Song Ratings", [["1", "2"], ALL], `GET ${RATINGS}/songs?${Q}&ids=1,2`),
  row(api.setSongRating, "Add a Personal Song Rating", ["1", 1, L], `PUT ${RATINGS}/songs/1?l=en-GB`, LIKE),
  row(api.deleteSongRating, "Delete a Personal Song Rating", ["1", L], `DELETE ${RATINGS}/songs/1?l=en-GB`),
  // Ratings of albums
  row(api.getAlbumRating, "Get a Personal Album Rating", ["1", ALL], `GET ${RATINGS}/albums/1?${Q}`),
  row(api.getAlbumRatings, "Get Multiple Personal Album Ratings", [["1", "2"], ALL], `GET ${RATINGS}/albums?${Q}&ids=1,2`),
  row(api.setAlbumRating, "Add a Personal Album Rating", ["1", -1, L], `PUT ${RATINGS}/albums/1?l=en-GB`, DISLIKE),
  row(api.deleteAlbumRating, "Delete a Personal Album Rating", ["1", L], `DELETE ${RATINGS}/albums/1?l=en-GB`),
  // Ratings of music videos
  row(api.getMusicVideoRating, "Get a Personal Music Video Rating", ["1", ALL], `GET ${RATINGS}/music-videos/1?${Q}`),
  row(api.getMusicVideoRatings, "Get Multiple Personal Music Video Ratings", [["1", "2"], ALL], `GET ${RATINGS}/music-videos?${Q}&ids=1,2`),
  row(api.setMusicVideoRating, "Add a Personal Music Video Rating", ["1", 1, L], `PUT ${RATINGS}/music-videos/1?l=en-GB`, LIKE),
  row(api.deleteMusicVideoRating, "Delete a Personal Music Video Rating", ["1", L], `DELETE ${RATINGS}/music-videos/1?l=en-GB`),
  // Ratings of playlists
  row(api.getPlaylistRating, "Get a Personal Playlist Rating", ["pl.1", ALL], `GET ${RATINGS}/playlists/pl.1?${Q}`),
  row(api.getPlaylistRatings, "Get Multiple Personal Playlist Ratings", [["pl.1", "pl.2"], ALL], `GET ${RATINGS}/playlists?${Q}&ids=pl.1,pl.2`),
  row(api.setPlaylistRating, "Add a Personal Playlist Rating", ["pl.1", -1, L], `PUT ${RATINGS}/playlists/pl.1?l=en-GB`, DISLIKE),
  row(api.deletePlaylistRating, "Delete a Personal Playlist Rating", ["pl.1", L], `DELETE ${RATINGS}/playlists/pl.1?l=en-GB`),
  // Ratings of stations
  row(api.getStationRating, "Get a Personal Station Rating", ["ra.1", ALL], `GET ${RATINGS}/stations/ra.1?${Q}`),
  row(api.getStationRatings, "Get Multiple Personal Station Ratings", [["ra.1", "ra.2"], ALL], `GET ${RATINGS}/stations?${Q}&ids=ra.1,ra.2`),
  row(api.setStationRating, "Add a Personal Station Rating", ["ra.1", 1, L], `PUT ${RATINGS}/stations/ra.1?l=en-GB`, LIKE),
  row(api.deleteStationRating, "Delete a Personal Station Rating", ["ra.1", L], `DELETE ${RATINGS}/stations/ra.1?l=en-GB`),
  // Ratings of library songs
  row(api.getLibrarySongRating, "Get a Personal Library Song Rating", ["i.1", ALL], `GET ${RATINGS}/library-songs/i.1?${Q}`),
  row(api.getLibrarySongRatings, "Get Multiple Personal Library Songs Ratings", [["i.1", "i.2"], ALL], `GET ${RATINGS}/library-songs?${Q}&ids=i.1,i.2`),
  row(api.setLibrarySongRating, "Add a Personal Library Song Rating", ["i.1", 1, L], `PUT ${RATINGS}/library-songs/i.1?l=en-GB`, LIKE),
  row(api.deleteLibrarySongRating, "Delete a Personal Library Song Rating", ["i.1", L], `DELETE ${RATINGS}/library-songs/i.1?l=en-GB`),
  // Ratings of library albums
  row(api.getLibraryAlbumRating, "Get a Personal Library Album Rating", ["l.1", ALL], `GET ${RATINGS}/library-albums/l.1?${Q}`),
  row(api.getLibraryAlbumRatings, "Get Multiple Personal Library Album Ratings", [["l.1", "l.2"], ALL], `GET ${RATINGS}/library-albums?${Q}&ids=l.1,l.2`),
  row(api.setLibraryAlbumRating, "Add a Personal Library Album Rating", ["l.1", -1, L], `PUT ${RATINGS}/library-albums/l.1?l=en-GB`, DISLIKE),
  row(api.deleteLibraryAlbumRating, "Delete a Personal Library Album Rating", ["l.1", L], `DELETE ${RATINGS}/library-albums/l.1?l=en-GB`),
  // Ratings of library music videos
  row(api.getLibraryMusicVideoRating, "Get a Personal Library Music Video Rating", ["i.1", ALL], `GET ${RATINGS}/library-music-videos/i.1?${Q}`),
  row(api.getLibraryMusicVideoRatings, "Get Multiple Personal Library Music Video Ratings", [["i.1", "i.2"], ALL], `GET ${RATINGS}/library-music-videos?${Q}&ids=i.1,i.2`),
  row(api.setLibraryMusicVideoRating, "Add a Personal Library Music Video Rating", ["i.1", 1, L], `PUT ${RATINGS}/library-music-videos/i.1?l=en-GB`, LIKE),
  row(api.deleteLibraryMusicVideoRating, "Delete a Personal Library Music Video Rating", ["i.1", L], `DELETE ${RATINGS}/library-music-videos/i.1?l=en-GB`),
  // Ratings of library playlists
  row(api.getLibraryPlaylistRating, "Get a Personal Library Playlist Rating", ["p.1", ALL], `GET ${RATINGS}/library-playlists/p.1?${Q}`),
  row(api.getLibraryPlaylistRatings, "Get Multiple Personal Library Playlist Ratings", [["p.1", "p.2"], ALL], `GET ${RATINGS}/library-playlists?${Q}&ids=p.1,p.2`),
  row(api.setLibraryPlaylistRating, "Add a Personal Library Playlist Rating", ["p.1", -1, L], `PUT ${RATINGS}/library-playlists/p.1?l=en-GB`, DISLIKE),
  row(api.deleteLibraryPlaylistRating, "Delete a Personal Library Playlist Rating", ["p.1", L], `DELETE ${RATINGS}/library-playlists/p.1?l=en-GB`),
  // The ones that follow no pattern
  row(
    api.searchLibrary,
    "Search for Library Resources",
    ["james brown", { ...L, limit: 5, offset: 10, types: ["library-songs", "library-albums"] }],
    `GET ${LIBRARY}/search?l=en-GB&limit=5&offset=10&term=james+brown&types=library-songs,library-albums`,
  ),
  row(
    api.getLibraryResources,
    "Get Multiple Library Resources Using Resource-Typed ID Parameters",
    [{ "library-albums": ["l.1"], "library-artists": ["r.1"], "library-music-videos": ["i.2"], "library-playlist-folders": ["p.f1"], "library-playlists": ["p.1"], "library-songs": ["i.1", "i.3"] }, ALL],
    `GET ${LIBRARY}?${Q}&ids[library-albums]=l.1&ids[library-artists]=r.1&ids[library-music-videos]=i.2&ids[library-playlist-folders]=p.f1&ids[library-playlists]=p.1&ids[library-songs]=i.1,i.3`,
  ),
  row(api.addToLibrary, "Add a Resource to a Library", [{ songs: ["1", "2"], albums: ["3"] }, L], `POST ${LIBRARY}?l=en-GB&ids[songs]=1,2&ids[albums]=3`),
  row(api.addToFavorites, "Add resource to favorites", [{ songs: ["1"], playlists: ["pl.1"] }, L], "POST /v1/me/favorites?l=en-GB&ids[songs]=1&ids[playlists]=pl.1"),
  row(
    api.addLibraryPlaylistTracks,
    "Add Tracks to a Library Playlist",
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
  row(api.getRootLibraryPlaylistFolder, "Get Root Library Playlists Folder", [ALL], `GET ${LIBRARY}/playlist-folders?${Q}&filter[identity]=playlistsroot`),
  row(api.listRecentlyAdded, "Get Recently Added Resources", [L], `GET ${LIBRARY}/recently-added?l=en-GB`),
  row(api.listHeavyRotation, "Get Heavy Rotation Content", [PAGE], `GET /v1/me/history/heavy-rotation?${Q}&limit=5&offset=10`),
  row(api.listRecentlyPlayed, "Get Recently Played Resources", [{ ...PAGE, types: ["albums", "playlists"] }], `GET /v1/me/recent/played?${Q}&limit=5&offset=10&types=albums,playlists`),
  row(api.listRecentlyPlayedTracks, "Get Recently Played Tracks", [{ ...PAGE, types: ["songs", "library-songs"] }], `GET /v1/me/recent/played/tracks?${Q}&limit=5&offset=10&types=songs,library-songs`),
  row(api.listRecentlyPlayedStations, "Get Recently Played Stations", [PAGE], `GET /v1/me/recent/radio-stations?${Q}&limit=5&offset=10`),
  row(api.getMusicSummariesByYear, "Get the user's replay data", [["latest"], { ...ALL, views: ["top-artists", "top-songs"] }], `GET /v1/me/music-summaries?${Q}&views=top-artists,top-songs&filter[year]=latest`),
  row(api.getPersonalStation, "Get the User's Personal Apple Music Station", [{ ...ALL, storefront: "gb" }], `GET /v1/catalog/gb/stations?${Q}&filter[identity]=personal`),
  row(api.getUserStorefront, "Get a User's Storefront", [PAGE], `GET /v1/me/storefront?${Q}&limit=5&offset=10`),
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

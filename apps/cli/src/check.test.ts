import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppleMusicError, createRateLimiter, schemas } from "@open-music-sdk/server";
import { CHECKS, PACE, brief, whereOf } from "./check";
import { ROWS } from "./check-sweep";
import { FileUserTokenStore } from "./files";
import { main } from "./main";

// The pace a run keeps is the limiter's to keep, and is held to by one test below: elsewhere every request is let
// through at once, so that a run of a few hundred against the fake takes no real seconds.
const acquire = vi.fn(() => Promise.resolve());
vi.mock("@open-music-sdk/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("@open-music-sdk/server")>()), createRateLimiter: vi.fn(() => ({ acquire })) }));

const TEAM = "DEF123GHIJ";
const KEY_ID = "ABC123DEFG";
const TOKEN = "Ag-music-user-token-from-apple";
const MADE_UP = "open-music-sdk-check-not-a-token";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const LF = String.fromCharCode(10);

type tType = "songs" | "albums" | "playlists" | "music-videos";
interface tTrack {
  readonly catalogId: string;
  readonly isrc: string | undefined;
}
interface tPlaylist {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tracks: tTrack[];
  /** When, by the clock, the playlist answers by its id, when it is listed, and when the tracks last added show. */
  readonly readableAt: number;
  readonly listedAt: number;
  shownAt: number;
  /** How many of its tracks show. */
  shown: number;
}

/** A playlist the listener had before the run, there in every way. */
const had = (id: string, tracks: tTrack[], name = id): tPlaylist => ({ id, name, description: "", tracks, readableAt: 0, listedAt: 0, shownAt: 0, shown: tracks.length });

type tSchema = schemas.tSchema<unknown>;
type tBody = Record<string, unknown>;

/** What fills what a validator says is missing or wrong: from its message alone, which only ever says what it expected. */
function fill(message: string): unknown {
  if (message === "required") return null;
  const expected = message.slice("expected ".length);
  const scalars: Record<string, unknown> = { string: "x", number: 1, boolean: false, object: {}, array: [null] };
  return expected in scalars ? structuredClone(scalars[expected]) : JSON.parse(expected.split(" | ")[0] ?? "null");
}

/**
 * `start` made into what `schema` takes, by putting in what its issues say is missing or wrong until it has none: so
 * every answer of the fake is one the real validators pass, whatever of it a test sets.
 */
function valid(schema: tSchema, start: unknown): tBody {
  let value = structuredClone(start);
  for (let round = 0; round < 60; round++) {
    const { issues } = schema["~standard"].validate(value);
    if (issues === undefined) return value as tBody;
    for (const { path = [], message } of issues) {
      if (path.length === 0) {
        value = fill(message);
        continue;
      }
      const parent = path.slice(0, -1).reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], value) as Record<string | number, unknown>;
      parent[path.at(-1) ?? ""] = fill(message);
    }
  }
  throw new Error(`the fake could not make a valid answer of ${JSON.stringify(start)}`);
}

const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const pascal = (s: string) => camel(s).replace(/^\w/, (c) => c.toUpperCase());
const singular = (s: string) => s.replace(/ies$/, "y").replace(/s$/, "");
/** The generated validator of this name, as the fake picks one by the path it answers. */
function shape(name: string): tSchema {
  const found = (schemas as unknown as Record<string, tSchema | undefined>)[name];
  if (found === undefined) throw new Error(`the fake has no validator ${name}`);
  return found;
}
const templates = new Map<string, tBody>();
/** A resource of a type, valid, with its id and the attributes given. */
function item(type: string, id: string, attributes: Record<string, unknown> = {}): tBody {
  const name = camel(singular(type));
  let template = templates.get(name);
  if (template === undefined) templates.set(name, (template = valid(shape(name), { type })));
  return valid(shape(name), { ...template, id, attributes: { ...(template.attributes as tBody | undefined), ...attributes } });
}
/** A relationship's or a view's page, with one resource of the type it holds, and a next page where it is the first. */
const pageOf = (validator: string, url: URL, extra: tBody = {}) => valid(shape(validator), { data: [null], ...extra, ...(url.searchParams.has("offset") ? {} : { next: `${url.pathname}?offset=1` }) });

const catalogItem = (type: tType, id: string, attributes: Record<string, unknown> = {}) =>
  item(type, id, { name: `Name of ${id}`, artistName: `Artist of ${id}`, url: `https://music.apple.com/gb/x/${id}`, artwork: { url: `https://is1-ssl.mzstatic.com/${id}/{w}x{h}bb.jpg`, width: 1000, height: 1000 }, ...attributes });
const chartSong = (n: number) =>
  catalogItem("songs", `s${String(n)}`, { isrc: `GBAAA26000${String(n).padStart(2, "0")}`, previews: [{ url: `https://audio-ssl.itunes.apple.com/clip/${String(n)}.m4a` }] });

/** The fake Apple: what it holds, and how it answers, which each test changes. */
let apple: {
  songs: Record<string, unknown>[];
  albums: Record<string, unknown>[];
  playlists: Record<string, unknown>[];
  videos: Record<string, unknown>[];
  /** How a chart's and a search's next link answer, and whether there is one; and the chart's link itself. */
  chartNext: "by type" | "page" | "neither" | "none";
  chartNextLink: string;
  /** Albums whose tracks are music videos alone. */
  songless: Set<string>;
  searchNext: "by type" | "page" | "neither" | "none";
  /** Whether songs by ISRC come with a next page: never, always, or only when a limit asks for fewer. */
  isrcNext: "never" | "always" | "paged" | "limit refused";
  rated: Map<string, number>;
  /** What the ratings of songs none of which is rated answer, and what one song never rated answers. */
  noneRated: "empty" | "404";
  unrated: "404" | "empty";
  recent: { played: number; tracks: number; without: "same" | "empty" | 400; withTypes?: 400 };
  /** What is in the listener's library, as `type/id`. */
  library: Set<string>;
  addStatus: Partial<Record<tType, number>>;
  /** How long Apple takes to answer an addition of each type, in milliseconds. */
  addDelay: Partial<Record<tType, number>>;
  /** Whether a favorite becomes a rating of 1, and goes into the library. */
  favoriteRates: boolean;
  favoriteInLibrary: boolean;
  listener: tPlaylist[];
  nextKeepsInclude: boolean;
  /** Whether a playlist asked for with include=tracks carries them, and whether include=catalog gives tracks their song. */
  includeTracks: boolean;
  includeCatalog: boolean;
  /** Whether include=catalog is honoured on the first page of a playlist's tracks alone, however a later one is asked for. */
  catalogOnFirstPageOnly: boolean;
  /** Whether the answer to a new playlist holds it, and what its description comes back as. */
  madeWithId: boolean;
  descriptionBack: (sent: string) => string;
  lag: { readable: number; listed: number; tracks: number };
  /** The most tracks one append takes; whether the first one's answer is lost, and its tracks land all the same; and how many of what is added Apple drops. */
  appendMost: number;
  appendLost: false | "landed" | "not landed";
  dropTracks: number;
  /** The catalog id a track added by `id` is held under. */
  heldAs: (id: string) => string;
  playlistSongsInLibrary: boolean;
  /** Whether a catalog playlist added to the library puts its songs there too. */
  catalogPlaylistSongsInLibrary: boolean;
  madeUpToken: 401 | 403 | 200;
  /** A path that fails with this status, whatever it is. */
  failing: Record<string, number>;
  /** The listener's playlist folders, in the root folder, and those a run made. */
  folders: { readonly id: string; readonly name: string }[];
  /** Whether an album counts as in the library once one song of it is. */
  partlyHeldCounts: boolean;
  /** What Apple's image server sends for each extension asked for: its Content-Type, or a status it fails with. */
  images: Record<string, string | number>;
  /** A body answered as it is for a GET of this path, with its query or without: what a test makes differ from the types. */
  answers: Record<string, unknown>;
  /** How ratings are set and taken away: refused, never shown, left out of a batch, kept or refused once taken away, and whether a library copy's is its catalog item's too. */
  rating: { refuse?: number; hidden?: boolean; batchLeavesOut?: boolean; deleteStays?: boolean; deleteFails?: number; linked?: boolean; setsSilently?: boolean };
  /** Whether a song added to the library is rated as it goes in, and whether what is added never shows there. */
  ratedOnAdd: boolean;
  addedUnseen: boolean;
  /** How a folder is made: refused, with no folder in the answer, or never shown. */
  folder: { refuse?: number; withId: boolean; unseen: boolean };
};
let asked: Request[] = [];
const responses: Response[] = [];
let dir: string;
let stdout: string;
let stderr: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omsdk-check-"));
  apple = {
    songs: Array.from({ length: 30 }, (_, i) => chartSong(i + 1)),
    albums: Array.from({ length: 30 }, (_, i) => catalogItem("albums", `a${String(i + 1)}`, { upc: `0000000000${String(i + 1).padStart(2, "0")}` })),
    // A playlist is by its curator, not an artist.
    playlists: ["pl.chart1", "pl.chart2"].map((id) => item("playlists", id, { name: `Name of ${id}`, curatorName: `Curator of ${id}`, url: `https://music.apple.com/gb/x/${id}`, artwork: { url: "https://is1-ssl.mzstatic.com/{w}x{h}.jpg", width: 1000, height: 1000 } })),
    videos: [catalogItem("music-videos", "mv1", { isrc: "GBAAA2690001" })],
    chartNext: "by type",
    chartNextLink: "/v1/catalog/gb/charts?chart=most-played&types=songs&limit=50&offset=50",
    songless: new Set(),
    searchNext: "by type",
    isrcNext: "never",
    rated: new Map([["s1", 1]]),
    noneRated: "empty",
    unrated: "404",
    recent: { played: 3, tracks: 5, without: "same" },
    library: new Set(),
    addStatus: {},
    addDelay: {},
    favoriteRates: true,
    favoriteInLibrary: false,
    listener: [
      had("p.short", tracksOf(4), "Short"),
      had("p.long", tracksOf(150), "Long"),
    ],
    nextKeepsInclude: true,
    includeTracks: true,
    includeCatalog: true,
    catalogOnFirstPageOnly: false,
    madeWithId: true,
    descriptionBack: (sent) => sent,
    lag: { readable: 0, listed: 0, tracks: 0 },
    appendMost: 300,
    appendLost: false,
    dropTracks: 0,
    heldAs: (id) => id,
    playlistSongsInLibrary: true,
    catalogPlaylistSongsInLibrary: false,
    madeUpToken: 401,
    failing: {},
    folders: [{ id: "p.folder", name: "Folder" }],
    partlyHeldCounts: false,
    images: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" },
    answers: {},
    rating: {},
    ratedOnAdd: false,
    addedUnseen: false,
    folder: { withId: true, unseen: false },
  };
  asked = [];
  stdout = "";
  stderr = "";
  vi.stubEnv("APPLE_MUSIC_PRIVATE_KEY", PEM);
  vi.stubEnv("APPLE_MUSIC_TEAM_ID", TEAM);
  vi.stubEnv("APPLE_MUSIC_KEY_ID", KEY_ID);
  vi.stubEnv("LOCALAPPDATA", dir);
  vi.stubEnv("XDG_CONFIG_HOME", dir);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((stderr += String(chunk)), true));
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => answer(new Request(input, init)));
  await new FileUserTokenStore(join(dir, "open-music-sdk", "user-token.json")).set("default", TOKEN);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
  for (const res of responses.splice(0)) if (res.body !== null) expect(res.bodyUsed).toBe(true);
});

/** The songs of a catalog playlist, by id. */
const songsOfPlaylist = (id: string) => [`${id}s1`, `${id}s2`, `${id}s3`];

function tracksOf(n: number): tTrack[] {
  return Array.from({ length: n }, (_, i) => ({ catalogId: `c${String(i + 1)}`, isrc: `GBBBB26${String(i + 1).padStart(5, "0")}` }));
}

const json = (body: unknown, status = 200) => {
  const res = Response.json(body, { status });
  responses.push(res);
  return res;
};
const refuse = (status: number) => json({ errors: [{ id: "e", status: String(status), code: `${String(status)}01`, title: "Refused", detail: "detail with p.secret in it" }] }, status);
const nothing = (status: number) => new Response(null, { status });

/** A page of a playlist's tracks, as Apple gives one: a hundred at a time, each with its catalog song when asked for. */
function tracksPage(playlist: tPlaylist, url: URL) {
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const catalog = apple.includeCatalog && (offset === 0 || !apple.catalogOnFirstPageOnly) && url.searchParams.get("include")?.split(",").includes("catalog") === true;
  const tracks = playlist.tracks.slice(0, playlist.shown);
  if (tracks.length === 0) return refuse(404);
  // A track with no catalog id, such as one the listener uploaded, has no catalog song either.
  const page = tracks.slice(offset, offset + 100).map((track, i) => ({
    id: `i.${playlist.id}.${String(offset + i)}`,
    type: "library-songs",
    attributes: { name: "Listener's song", playParams: track.catalogId === "" ? {} : { catalogId: track.catalogId } },
    // One no longer in the storefront keeps its catalog id, and has no catalog song to give.
    ...(catalog && track.catalogId !== "" && !track.catalogId.startsWith("gone") ? { relationships: { catalog: { data: [{ id: track.catalogId, type: "songs", attributes: { isrc: track.isrc } }] } } } : {}),
  }));
  const more = offset + 100 < tracks.length;
  return json(
    valid(shape("libraryPlaylistRelationshipsLibraryPlaylistTracksRelationship"), {
      data: page,
      ...(more ? { next: `/v1/me/library/playlists/${playlist.id}/tracks?offset=${String(offset + 100)}${apple.nextKeepsInclude && catalog ? "&include=catalog" : ""}` } : {}),
    }),
  );
}

const asPlaylist = (playlist: tPlaylist, tracks: boolean) =>
  valid(shape("libraryPlaylist"), {
    id: playlist.id,
    type: "library-playlists",
    attributes: { name: playlist.name, description: { standard: playlist.description }, canEdit: true },
    ...(tracks ? { relationships: { tracks: { data: apple.includeTracks ? playlist.tracks.slice(0, Math.min(playlist.shown, 100)).map((_, i) => ({ id: `i.${String(i)}`, type: "library-songs" })) : [] } } } : {}),
  });

/** The id the root playlist folder goes by, as Apple's documentation has it. */
const ROOT = "p.playlistsroot";

/** The resources a request asks for by id, one for each, typed by `type`. */
const byIds = (type: string, ids: string | null) => (ids ?? "").split(",").filter((id) => id !== "").map((id) => item(type, id));

/**
 * What the fake answers for the paths the sweep asks that no handler above answers: a resource, several by their ids,
 * one a filter finds, a list's page, a relationship's page or a view's, each of the type the path names and valid by
 * the validator of it.
 */
async function anything(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const query = url.searchParams;
  const catalog = /^\/v1\/catalog\/gb(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
  const library = /^\/v1\/me\/library\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
  const recommendation = /^\/v1\/me\/recommendations(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
  const storefront = /^\/v1\/storefronts(?:\/([^/]+))?$/.exec(path);
  const resources = (type: string, id: string | undefined, rel: string | undefined, view: string | undefined) => {
    const named = camel(singular(type));
    if (rel === "view" && view !== undefined) return json(pageOf(`${named}Views${pascal(singular(type))}${pascal(view)}View`, url, { attributes: {} }));
    if (rel !== undefined) return json(pageOf(`${named}Relationships${pascal(singular(type))}${pascal(rel)}Relationship`, url));
    const collection = shape(`${camel(type)}Response`);
    if (id !== undefined) return json(valid(collection, { data: [item(type, id)] }));
    if (query.has("ids")) return json(valid(collection, { data: byIds(type, query.get("ids")) }));
    if ([...query.keys()].some((key) => key.startsWith("filter["))) return json(valid(collection, { data: [item(type, `${type}.f`)] }));
    // A list: its first page, with a next page. What is the listener's has an id as theirs have, which the report never shows.
    const offset = query.has("offset");
    const theirs = path.startsWith("/v1/me/") ? "i." : "";
    return json(valid(collection, { data: [item(type, `${theirs}${type}.${offset ? "2" : "1"}`)], ...(offset ? {} : { next: `${path}?offset=1` }) }));
  };
  if (path === "/v1/catalog/gb/search/hints") return json(valid(schemas.searchHintsResponse, { results: { terms: ["x"] } }));
  if (path === "/v1/catalog/gb/search/suggestions") return json(valid(schemas.searchSuggestionsResponse, { results: { suggestions: [null] } }));
  if (path === "/v1/language/gb/tag") return json(valid(schemas.langageTagResponse, { results: { tag: "en-GB" } }));
  if (catalog && catalog[1] === undefined) {
    const data = [...query].flatMap(([key, ids]) => byIds(/^ids\[(.+)\]$/.exec(key)?.[1] ?? "", ids));
    return json(valid(schemas.resourceCollectionResponse, { data }));
  }
  if (catalog) return resources(catalog[1] ?? "", catalog[2], catalog[3], catalog[4]);
  if (storefront) return storefront[1] === undefined ? resources("storefronts", undefined, undefined, undefined) : resources("storefronts", storefront[1], undefined, undefined);
  if (path === "/v1/me/library" && req.method === "GET") return json(valid(schemas.resourceCollectionResponse, { data: [...query].flatMap(([key, ids]) => byIds(/^ids\[(.+)\]$/.exec(key)?.[1] ?? "", ids)) }));
  if (path === "/v1/me/library/search") return json(valid(schemas.librarySearchResponse, { results: Object.fromEntries((query.get("types") ?? "").split(",").map((type) => [type, { data: [item(type, `i.${type}`)] }])) }));
  if (path === "/v1/me/library/recently-added") return json(valid(schemas.resourceCollectionResponse, { data: [item("library-albums", "l.recent")] }));
  if (path === "/v1/me/history/heavy-rotation" || path === "/v1/me/recent/radio-stations")
    return json(valid(schemas.paginatedResourceCollectionResponse, { data: [item("albums", "a.heavy")], ...(query.has("offset") ? {} : { next: `${path}?offset=1` }) }));
  if (path === "/v1/me/music-summaries") return json(valid(schemas.musicSummariesResponse, { data: [null] }));
  if (recommendation) return resources("personal-recommendation", recommendation[1], recommendation[2], undefined);
  if (library?.[1] === "playlist-folders") {
    const [, , id, rel] = library;
    const folder = (one: { readonly id: string; readonly name: string }) => item("library-playlist-folders", one.id, { name: one.name });
    if (req.method === "POST") {
      if (apple.folder.refuse !== undefined) return refuse(apple.folder.refuse);
      const { attributes } = (await req.json()) as { attributes: { name: string } };
      const one = { id: `p.f${String(apple.folders.length)}`, name: attributes.name };
      if (!apple.folder.unseen) apple.folders.push(one);
      return json(valid(schemas.libraryPlaylistFoldersResponse, { data: apple.folder.withId ? [folder(one)] : [] }), 201);
    }
    const named = (one: string) => (one === ROOT ? { id: ROOT, name: "Playlists" } : apple.folders.find((each) => each.id === one));
    if (id === undefined && query.has("ids"))
      return json(valid(schemas.libraryPlaylistFoldersResponse, { data: (query.get("ids") ?? "").split(",").map(named).filter((one) => one !== undefined).map(folder) }));
    if (id === undefined) return query.get("filter[identity]") === "playlistsroot" ? json(valid(schemas.libraryPlaylistFoldersResponse, { data: [folder({ id: ROOT, name: "Playlists" })] })) : refuse(404);
    const known = named(id);
    if (known === undefined) return refuse(404);
    if (rel === undefined) return json(valid(schemas.libraryPlaylistFoldersResponse, { data: [folder(known)] }));
    if (rel === "parent") return id === ROOT ? refuse(404) : json(valid(shape("libraryPlaylistFolderRelationshipsLibraryPlaylistFolderParentRelationship"), { data: [folder({ id: ROOT, name: "Playlists" })] }));
    if (id !== ROOT) return refuse(404);
    // The root's children, a page at a time: the listener's first playlist, then the folders, the newest last.
    const children = [...apple.listener.slice(0, 1).map((playlist) => asPlaylist(playlist, false)), ...apple.folders.map(folder)];
    const [from, size] = [Number(query.get("offset") ?? "0"), Number(query.get("limit") ?? "25")];
    const more = from + size < children.length;
    return json(
      valid(shape("libraryPlaylistFolderRelationshipsLibraryPlaylistFolderChildrenRelationship"), {
        data: children.slice(from, from + size),
        ...(more ? { next: `${path}?offset=${String(from + size)}&limit=${String(size)}` } : {}),
      }),
    );
  }
  // The listener's playlists are the handlers' above, but for their relationships other than their tracks.
  if (library && (library[1] !== "playlists" || (library[3] !== undefined && library[3] !== "tracks"))) return resources(`library-${library[1] ?? ""}`, library[2], library[3], undefined);
  return refuse(404);
}

async function answer(req: Request): Promise<Response> {
  asked.push(req);
  const url = new URL(req.url);
  const path = url.pathname;
  const query = url.searchParams;
  const method = req.method;
  const failing = apple.failing[path];
  if (failing !== undefined) return refuse(failing);
  const fixed = method === "GET" ? (apple.answers[path + url.search] ?? apple.answers[path]) : undefined;
  if (fixed !== undefined) return json(fixed);
  // Apple's image server, which answers for artwork by the extension a URL asks for.
  if (url.hostname.endsWith("mzstatic.com")) {
    const sent = apple.images[path.split(".").at(-1) ?? ""] ?? 404;
    return typeof sent === "number" ? new Response(null, { status: sent }) : new Response("image", { headers: { "content-type": sent } });
  }
  if (path === "/v1/test") return nothing(200);
  if (path === "/v1/me/storefront") {
    if (req.headers.get("music-user-token") === MADE_UP) return apple.madeUpToken === 200 ? json({ data: [{ id: "gb" }] }) : refuse(apple.madeUpToken);
    return json(valid(schemas.storefrontsResponse, { data: [item("storefronts", "gb")] }));
  }
  if (path === "/v1/catalog/gb/charts") {
    if (url.search === new URL(apple.chartNextLink, url).search)
      return json(apple.chartNext === "page" ? { data: apple.songs.slice(1, 2) } : apple.chartNext === "neither" ? {} : { results: { songs: [{ chart: "most-played", data: apple.songs.slice(1, 2) }] } });
    const chart = (data: unknown[], next?: string) => [{ chart: "most-played", name: "Top", data, ...(next === undefined ? {} : { next }) }];
    // The questions' charts as the test made them, artwork taken away and all; the sweep's, which it asks with a genre, valid.
    const body = {
      results: {
        songs: chart(apple.songs, apple.chartNext === "none" ? undefined : apple.chartNextLink),
        albums: chart(apple.albums),
        playlists: chart(apple.playlists),
        "music-videos": chart(apple.videos),
      },
    };
    return json(query.has("genre") ? valid(schemas.chartResponse, body) : body);
  }
  if (path === "/v1/catalog/gb/search") {
    const types = (query.get("types") ?? "songs").split(",");
    // The songs of the name searched for, as a search finds them; the first chart song for a term no song is called.
    const term = query.get("term") ?? "";
    const named = apple.songs.filter((song) => term.includes(String((song.attributes as tBody).name)));
    const songs = { data: named.length > 0 ? named.slice(0, 1) : apple.songs.slice(0, 1), ...(apple.searchNext === "none" ? {} : { next: "/v1/catalog/gb/search?offset=1&term=love&types=songs" }) };
    const first = (type: string) => (type === "songs" ? songs : { data: [item(type, `${type}.s`)] });
    if (!query.has("offset")) return json(valid(schemas.searchResponse, { results: Object.fromEntries(types.map((type) => [type, first(type)])) }));
    return json(apple.searchNext === "page" ? { data: apple.songs.slice(1, 2) } : apple.searchNext === "neither" ? {} : { results: { songs: { data: apple.songs.slice(1, 2) } } });
  }
  if (path === "/v1/catalog/gb/songs" && query.has("filter[isrc]")) {
    const isrcs = query.get("filter[isrc]")?.split(",") ?? [];
    const limited = query.has("limit");
    if (limited && apple.isrcNext === "limit refused") return refuse(400);
    const next = apple.isrcNext === "always" || (limited && apple.isrcNext === "paged");
    return json({ data: apple.songs.filter((song) => isrcs.includes((song.attributes as { isrc: string }).isrc)), ...(next ? { next: "/v1/catalog/gb/songs?filter[isrc]=x&offset=1" } : {}) });
  }
  const albumTracks = /^\/v1\/catalog\/gb\/albums\/([^/]+)\/tracks$/.exec(path);
  if (albumTracks) {
    const album = albumTracks[1] ?? "";
    // Twelve songs that play, one not yet out, which has no playParams, and a music video.
    const songs = apple.songless.has(album) ? [] : Array.from({ length: 12 }, (_, i) => catalogItem("songs", `${album}t${String(i + 1)}`, { playParams: { id: `${album}t${String(i + 1)}`, kind: "song" } }));
    return json(valid(shape("albumRelationshipsAlbumTracksRelationship"), { data: [...songs, catalogItem("songs", `${album}soon`), catalogItem("music-videos", `${album}v`)] }));
  }
  const playlistTracks = /^\/v1\/catalog\/gb\/playlists\/([^/]+)\/tracks$/.exec(path);
  if (playlistTracks)
    return json(valid(shape("playlistRelationshipsPlaylistTracksRelationship"), { data: [catalogItem("music-videos", `${playlistTracks[1] ?? ""}v`), ...songsOfPlaylist(playlistTracks[1] ?? "").map((id) => catalogItem("songs", id))] }));
  // A song's album is one of its own, which no chart holds: `s1al` for s1.
  const songAlbums = /^\/v1\/catalog\/gb\/songs\/([^/]+)\/albums$/.exec(path);
  if (songAlbums) return json(valid(shape("songRelationshipsSongAlbumsRelationship"), { data: [catalogItem("albums", `${songAlbums[1] ?? ""}al`)] }));
  const inLibrary = /^\/v1\/catalog\/gb\/([^/]+)\/([^/]+)\/library$/.exec(path);
  if (inLibrary) {
    const [, type = "", id = ""] = inLibrary;
    if (!apple.library.has(`${type}/${id}`)) return refuse(404);
    return json(valid(shape(`${camel(singular(type))}Relationships${pascal(singular(type))}LibraryRelationship`), { data: [item(`library-${type}`, `l.${id}`)] }));
  }
  // The listener's ratings, of every type: a song's by its id, as the tests set them, any other's by its type too.
  const rating = /^\/v1\/me\/ratings\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (rating) {
    const [, type = "", one] = rating;
    const key = (id: string) => (type === "songs" ? id : `${type}/${id}`);
    const rated = (id: string) => item("ratings", id, { value: apple.rated.get(key(id)) });
    if (one === undefined) {
      const ids = query.get("ids")?.split(",") ?? [];
      const data = apple.rating.batchLeavesOut === true ? [] : ids.filter((id) => apple.rated.has(key(id))).map(rated);
      return data.length === 0 && apple.noneRated === "404" ? refuse(404) : json(valid(schemas.ratingsResponse, { data }));
    }
    if (method === "PUT") {
      if (apple.rating.refuse !== undefined) return refuse(apple.rating.refuse);
      const { attributes } = (await req.json()) as { attributes: { value: number } };
      apple.rated.set(key(one), attributes.value);
      // A library copy's id is `l.` and its catalog item's.
      if (apple.rating.linked === true && type.startsWith("library-")) apple.rated.set(type === "library-songs" ? one.slice(2) : `${type.slice(8)}/${one.slice(2)}`, attributes.value);
      return apple.rating.setsSilently === true ? nothing(204) : json(valid(schemas.ratingsResponse, { data: [rated(one)] }));
    }
    if (method === "DELETE") {
      if (apple.rating.deleteFails !== undefined) return refuse(apple.rating.deleteFails);
      if (apple.rating.deleteStays !== true) apple.rated.delete(key(one));
      return nothing(204);
    }
    if (apple.rated.has(key(one)) && apple.rating.hidden !== true) return json(valid(schemas.ratingsResponse, { data: [rated(one)] }));
    return apple.unrated === "404" ? refuse(404) : json({ data: [] });
  }
  if (path === "/v1/me/recent/played" || path === "/v1/me/recent/played/tracks") {
    const n = path.endsWith("tracks") ? apple.recent.tracks : apple.recent.played;
    if (!query.has("types") && apple.recent.without === 400) return refuse(400);
    if (query.has("types") && apple.recent.withTypes !== undefined) return refuse(apple.recent.withTypes);
    return json(valid(schemas.paginatedResourceCollectionResponse, { data: Array.from({ length: !query.has("types") && apple.recent.without === "empty" ? 0 : n }, (_, i) => item("albums", `r${String(i)}`)) }));
  }
  if (path === "/v1/me/library" && method === "POST") {
    for (const [key, ids] of query) {
      const type = /^ids\[(.+)\]$/.exec(key)?.[1] as tType;
      const status = apple.addStatus[type];
      if (status !== undefined) return refuse(status);
      const delay = apple.addDelay[type];
      if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
      for (const id of ids.split(",")) {
        if (apple.ratedOnAdd && type === "songs") apple.rated.set(id, 1);
        if (apple.addedUnseen) continue;
        apple.library.add(`${type}/${id}`);
        if (type === "playlists" && apple.catalogPlaylistSongsInLibrary) for (const song of songsOfPlaylist(id)) apple.library.add(`songs/${song}`);
        if (type === "songs" && apple.partlyHeldCounts) apple.library.add(`albums/${id}al`);
      }
    }
    return nothing(202);
  }
  if (path === "/v1/me/favorites" && method === "POST") {
    for (const id of query.get("ids[songs]")?.split(",") ?? []) {
      if (apple.favoriteRates) apple.rated.set(id, 1);
      if (apple.favoriteInLibrary) apple.library.add(`songs/${id}`);
    }
    return nothing(202);
  }
  if (path === "/v1/me/library/playlists") {
    if (method === "POST") {
      const { attributes } = (await req.json()) as { attributes: { name: string; description: string } };
      const made: tPlaylist = {
        id: `p.made${String(apple.listener.length)}`,
        name: attributes.name,
        description: apple.descriptionBack(attributes.description),
        tracks: [],
        readableAt: Date.now() + apple.lag.readable * 1000,
        listedAt: Date.now() + apple.lag.listed * 1000,
        shownAt: 0,
        shown: 0,
      };
      apple.listener.push(made);
      return json({ data: apple.madeWithId ? [asPlaylist(made, false)] : [] }, 201);
    }
    const offset = Number(query.get("offset") ?? "0");
    const limit = Number(query.get("limit") ?? "25");
    const listed = apple.listener.filter((playlist) => Date.now() >= playlist.listedAt);
    return json({ data: listed.slice(offset, offset + limit).map((playlist) => asPlaylist(playlist, false)), ...(offset + limit < listed.length ? { next: `/v1/me/library/playlists?offset=${String(offset + limit)}&limit=${String(limit)}` } : {}) });
  }
  const playlistPath = /^\/v1\/me\/library\/playlists\/([^/]+)(\/tracks)?$/.exec(path);
  const playlist = apple.listener.find((each) => each.id === playlistPath?.[1]);
  if (playlistPath && playlist) {
    if (playlistPath[2] === undefined) return Date.now() < playlist.readableAt ? refuse(404) : json({ data: [asPlaylist(playlist, query.get("include") === "tracks")] });
    if (method === "POST") {
      const { data } = (await req.json()) as { data: { id: string }[] };
      if (data.length > apple.appendMost) return refuse(400);
      const lost = apple.appendLost;
      apple.appendLost = false;
      if (lost !== "not landed") {
        playlist.tracks.push(...data.slice(apple.dropTracks).map(({ id }) => ({ catalogId: apple.heldAs(id), isrc: `ISRC${id}` })));
        playlist.shownAt = Date.now() + apple.lag.tracks * 1000;
        if (apple.playlistSongsInLibrary) for (const { id } of data) apple.library.add(`songs/${id}`);
      }
      if (lost !== false) throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
      return nothing(204);
    }
    if (Date.now() >= playlist.shownAt) playlist.shown = playlist.tracks.length;
    return tracksPage(playlist, url);
  }
  return anything(req, url);
}

/** The lines on stdout of one check, without their marks' colors. */
const linesOf = (id: string) => stdout.split(LF).filter((line) => line.slice(2).startsWith(`${id}: `));
const marksOf = (id: string) => linesOf(id).map((line) => line.charAt(0));
const posts = () => asked.filter((req) => req.method !== "GET").map((req) => new URL(req.url).pathname);
const READS = CHECKS.filter((each) => !each.writes).map((each) => each.id);
const WRITES = CHECKS.filter((each) => each.writes).map((each) => each.id);

describe("brief: what Apple failed with, from its tag, status and code alone", () => {
  const timeout = new AppleMusicError("NetworkError", "GET /v1/me/library/playlists/p.secret: aborted", { cause: new DOMException("timed out", "TimeoutError") });
  test.each([
    ["a request the CLI's limit cut off, which a read tries twice", timeout, "Apple did not answer, each try given 30 seconds"],
    ["no answer at all", new AppleMusicError("NetworkError", "GET /v1/me/library/playlists/p.secret: fetch failed"), "Apple could not be reached"],
    ["a rate limit", new AppleMusicError("RateLimited", "GET /p.secret: 429", { status: 429 }), "Apple is limiting requests for this key (429)"],
    ["the developer token refused", new AppleMusicError("DeveloperTokenInvalid", "GET /p.secret: 401", { status: 401 }), "Apple refused the developer token (401)"],
    ["no developer token to ask with", new AppleMusicError("DeveloperTokenUnavailable", "the minter failed on p.secret"), "Apple could not be asked"],
    ["no Music User Token to ask with, which is no refusal: nothing was sent", new AppleMusicError("UserTokenInvalid", "/v1/me/p.secret needs a Music User Token"), "Apple could not be asked"],
    ["a success the SDK found wanting", new AppleMusicError("ApiError", "getSongRating: Apple answered with no resource", { status: 200 }), "Apple answered 200, with what the SDK could not read"],
    ["an answer without a code", new AppleMusicError("ApiError", "GET /p.secret: 503", { status: 503 }), "Apple answered 503"],
    ["an answer with Apple's code",new AppleMusicError("ApiError", "GET /p.secret: 500", { status: 500, errors: [{ id: "e", status: "500", code: "50000", title: "Oops" }] }), "Apple answered 500, code 50000"],
  ])("%s", (_what, error, words) => {
    expect(brief(error)).toBe(words);
  });
});

describe("whereOf: which request failed, with no id of the listener's in it", () => {
  test.each([
    ["a path, its ids left out", new AppleMusicError("ApiError", "500 /v1/me/library/playlists/p.AbC123/tracks: Oops (detail)", { status: 500 }), "/v1/me/library/playlists/{id}/tracks"],
    ["a catalog path, its storefront kept", new AppleMusicError("NetworkError", "GET /v1/catalog/gb/songs/1440833098/library: fetch failed"), "/v1/catalog/gb/songs/{id}/library"],
    ["the function that found the answer wanting", new AppleMusicError("ApiError", "getSongRating: Apple answered with no resource", { status: 200 }), "getSongRating"],
    ["that it names none, where the error names neither", new AppleMusicError("UserTokenInvalid", "No storefront configured and no Music User Token to resolve one from"), "a request it does not name"],
  ])("%s", (_what, error, where) => {
    expect(whereOf(error)).toBe(where);
  });
});

describe("which checks run: by name, in the list's order, and the write checks only with --write", () => {
  test("with none named, every check that reads runs, none that writes, and stderr says --write adds them", async () => {
    expect(await main(["check", "--no-color"])).toBe(0);
    for (const id of READS) expect(linesOf(id).length, id).toBeGreaterThan(0);
    for (const id of WRITES) expect(linesOf(id), id).toEqual([]);
    expect(posts()).toEqual([]);
    expect(stderr).toContain("What writes to your library is left out; --write adds it.");
  });

  test("named checks run alone, in the list's order whatever the order named, and each once", async () => {
    expect(await main(["check", "rating-unset", "search-next", "rating-unset", "--no-color"])).toBe(0);
    const ran = stdout
      .split(LF)
      .map((line) => /^. ([\w-]+): /.exec(line)?.[1])
      .filter((id) => id !== undefined && CHECKS.some((each) => each.id === id));
    expect([...new Set(ran)]).toEqual(["search-next", "rating-unset"]);
    expect(asked.some((req) => new URL(req.url).pathname.startsWith("/v1/me/recent"))).toBe(false);
    expect(stderr).not.toContain("--write adds it");
  });

  test("a name that is not there is a mistake in how the CLI was run, which says where every name is listed, and Apple is not asked", async () => {
    expect(await main(["check", "nothing-like-it"])).toBe(2);
    expect(stderr).toContain("There is no check 'nothing-like-it'. 'open-music-sdk help check' lists every one.");
    expect(asked).toEqual([]);
  });

  test("a token pasted where a check's name goes is not repeated", async () => {
    expect(await main(["check", TOKEN])).toBe(2);
    expect(stderr).not.toContain(TOKEN);
  });

  test.each(WRITES)("%s writes to the library, so without --write it is refused before Apple is asked", async (id) => {
    expect(await main(["check", id])).toBe(2);
    expect(stderr).toContain(`${id} writes to your library, and runs only with --write.`);
    expect(asked).toEqual([]);
  });

  test("--write with none named runs every question, package by package, the reads of each before its writes, and says first what they leave", async () => {
    expect(await main(["check", "--write", "--no-color"])).toBe(0);
    const order = stdout
      .split(LF)
      .map((line) => /^. ([\w-]+): /.exec(line)?.[1])
      .filter((id): id is string => id !== undefined && CHECKS.some((each) => each.id === id));
    expect([...new Set(order)]).toEqual([
      "search-next",
      "charts-next",
      "isrc-next",
      "recently-played-types",
      "rating-unset",
      "add-to-library",
      "add-to-favorites",
      "playlist-include",
      "playlist-include-tracks",
      "resolve-misses",
      "playlist",
      "artwork-placeholders",
      "artwork-formats",
      "preview-hosts",
      "user-token-refused",
    ]);
    const warning = stderr.indexOf("--write: what is added stays");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(stderr.indexOf("Asking: add-to-library"));
    expect(stderr).toContain(
      "--write: what is added stays, since Apple's API has no way to take it out of the library again: up to four things added to it, an album's songs with it, one song made a favorite, a playlist of up to 300 songs, which may put them in the library too, an empty playlist to rate and a playlist folder. A dislike is set on 9 things you had not rated, and taken away again. The steps to remove the rest are printed at the end.",
    );
  });

  test.each([
    ["setSongRating", "--write: A dislike is set on 1 thing you had not rated, and taken away again."],
    ["setLibrarySongRating", "--write: what is added stays, since Apple's API has no way to take it out of the library again: 1 thing added to it to rate. A dislike is set on 1 thing you had not rated, and taken away again. The steps to remove the rest are printed at the end."],
    ["createLibraryPlaylistFolder", "--write: what is added stays, since Apple's API has no way to take it out of the library again: a playlist folder. The steps to remove the rest are printed at the end."],
  ])("what %s alone writes is all that is said before it runs", async (id, words) => {
    await main(["check", id, "--write", "--no-color"]);
    expect(stderr.split(LF).filter((line) => line.startsWith("--write:"))).toEqual([words]);
  });

  test("help lists every check by name, and marks those that write", async () => {
    expect(await main(["help", "check"])).toBe(0);
    for (const each of CHECKS) expect(stdout.split(LF).find((line) => line.trim().startsWith(`${each.id} `))?.endsWith("(--write)"), each.id).toBe(each.writes);
    expect(stdout).toContain("--write");
  });
});

describe("the limit on each request", () => {
  test("a request Apple never answers is given up on at the CLI's limit, each try of it, and the check is ✗, the run going on", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // Each limit is asked for at 30 seconds and handed out unexpired, so that only the search runs its own out: cut
    // short for every request, it ran out on a slow machine for doctor's too, which are answered.
    const limits: AbortController[] = [];
    const asked30 = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      if (ms !== 30_000) return timeout(ms);
      const limit = new AbortController();
      limits.push(limit);
      return limit.signal;
    });
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname !== "/v1/catalog/gb/search") return real(req);
      asked.push(req);
      const pending = new Promise<Response>((_resolve, reject) => {
        req.signal.addEventListener("abort", () => {
          reject(req.signal.reason as Error);
        });
      });
      // The run asks for a request's limit just before handing it to fetch, so the last one is this request's.
      limits.at(-1)?.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      return pending;
    });
    expect(await main(["check", "search-next", "isrc-next", "--no-color"])).toBe(1);
    expect(linesOf("search-next")).toEqual(["✗ search-next: Apple did not answer, each try given 30 seconds (at /v1/catalog/gb/search), so this was not answered."]);
    // A read is tried twice, each with a limit of its own.
    expect(asked.filter((req) => new URL(req.url).pathname === "/v1/catalog/gb/search")).toHaveLength(2);
    expect(asked30).toHaveBeenCalledWith(30_000);
    expect(marksOf("isrc-next")).toEqual(["✓"]);
  });
});

describe("the owner's two rules for a run that writes, over a whole run", () => {
  test("every write that may have been carried out is in the cleanup, and nothing the listener had before is", async () => {
    // What the listener had: a song, an album, a playlist, a track of another album, and ratings of every type.
    apple.library = new Set(["songs/s1", "albums/a1", "playlists/pl.chart2", "songs/a3t1"]);
    apple.rated.set("s2", 1);
    apple.rated.set("albums/a2", -1);
    apple.rated.set("playlists/pl.chart1", 1);
    apple.catalogPlaylistSongsInLibrary = true;
    const before = new Map(apple.rated);
    await main(["check", "--write", "--no-color"]);
    const steps = cleanupOf();
    const pathOf = (req: Request) => new URL(req.url).pathname;

    // Every rating set was of something not rated before, and was taken away again: what is rated now is what was
    // before, and the favorite, which is a step of its own.
    const sets = asked.filter((req) => req.method === "PUT").map(pathOf);
    expect(sets.length).toBeGreaterThan(0);
    for (const path of sets) {
      const [, type = "", id = ""] = /^\/v1\/me\/ratings\/([^/]+)\/([^/]+)$/.exec(path) ?? [];
      expect(before.has(type === "songs" ? id : `${type}/${id}`), path).toBe(false);
      expect(asked.some((req) => req.method === "DELETE" && pathOf(req) === path), path).toBe(true);
    }
    const favorites = asked.filter((req) => req.method === "POST" && pathOf(req) === "/v1/me/favorites").flatMap((req) => new URL(req.url).searchParams.get("ids[songs]")?.split(",") ?? []);
    expect([...apple.rated.keys()].filter((key) => !favorites.includes(key))).toEqual([...before.keys()]);
    expect(steps).not.toContain("Take away the dislike");
    // The folder made is a step, and no album or playlist of which the listener held a track is one.
    expect(asked.some((req) => req.method === "POST" && pathOf(req) === "/v1/me/library/playlist-folders")).toBe(true);
    expect(steps).toContain("Delete the playlist folder named");
    expect(steps).not.toContain('"Name of a3"');
    // What the steps link to, by the id each link ends in: a song's own page, or the page Apple gave the rest.
    const linked = new Set(Array.from(steps.matchAll(/https:\/\/music\.apple\.com\/gb\/(?:x|song)\/([\w.-]+)/g), (m) => m[1]));

    // Every addition and every favorite, by the link of what was sent.
    for (const req of asked.filter((each) => each.method === "POST" && ["/v1/me/library", "/v1/me/favorites"].includes(new URL(each.url).pathname)))
      for (const ids of new URL(req.url).searchParams.values()) for (const id of ids.split(",")) expect(linked.has(id), id).toBe(true);
    // Every playlist made, by its name, and the album of every song added to one.
    const made = apple.listener.filter((playlist) => playlist.id.startsWith("p.made"));
    expect(made.length).toBeGreaterThan(0);
    for (const playlist of made) {
      expect(steps).toContain(`Delete every playlist named "${playlist.name}"`);
      for (const track of playlist.tracks) expect(linked.has(/^(a\d+)t/.exec(track.catalogId)?.[1] ?? "none"), track.catalogId).toBe(true);
    }
    // What was in the library before the run is nowhere in the steps, and a song rated before it is no favorite to undo.
    for (const id of ["s1", "a1", "pl.chart2"]) expect(linked.has(id), id).toBe(false);
    expect(steps).toMatch(/Undo the favorite on/);
    expect(steps).not.toMatch(/Undo the favorite on [^\n]*\/song\/s2\b/);
  });
});

describe("the pace of a run: the key is likely the app's too, and Apple counts its limit by the key", () => {
  test("every request after doctor's two waits on a limiter of ten at once and ten a second", async () => {
    acquire.mockClear();
    expect(await main(["check", "search-next", "isrc-next", "--no-color"])).toBe(0);
    expect(PACE).toEqual({ capacity: 10, refillPerSecond: 10 });
    expect(vi.mocked(createRateLimiter)).toHaveBeenCalledWith(PACE);
    // Doctor's two questions, and validateUserToken's, are asked before the run's own client is made.
    const own = asked.filter((req) => !["/v1/test", "/v1/me/storefront"].includes(new URL(req.url).pathname));
    expect(acquire.mock.calls.length).toBe(own.length);
  });

  test("the listener's playlists are walked to the thousandth at most, each time a new one is looked for", async () => {
    apple.listener.push(...Array.from({ length: 2000 }, (_, i) => had(`p.n${String(i)}`, [])));
    await finish(["check", "playlist", "--write", "--no-color"]);
    const lists = asked.filter((req) => req.method === "GET" && new URL(req.url).pathname === "/v1/me/library/playlists");
    expect(lists.length).toBeGreaterThan(10);
    expect(lists.every((req) => Number(new URL(req.url).searchParams.get("offset") ?? "0") < 1000)).toBe(true);
  });
});

describe("what a run prints first: what it ran on, then doctor's two questions", () => {
  test("the CLI's version, Node's and the system's, then the key and the token, before any check", async () => {
    expect(await main(["check", "search-next", "--no-color"])).toBe(0);
    const lines = stdout.split(LF);
    expect(lines[0]).toMatch(new RegExp(`^open-music-sdk \\d+\\.\\d+\\.\\d+ · Node ${process.versions.node} · ${process.platform} ${process.arch}$`));
    expect(lines[1]).toMatch(/^✓ Key: /);
    expect(lines[2]).toMatch(/^✓ Music User Token: Apple takes it, for storefront gb\.$/);
  });

  test("a key Apple refuses ends the run: exit 1, and no check is asked", async () => {
    apple.failing["/v1/test"] = 401;
    expect(await main(["check", "--no-color"])).toBe(1);
    expect(asked.map((req) => new URL(req.url).pathname)).toEqual(["/v1/test"]);
    for (const id of READS) expect(linesOf(id)).toEqual([]);
  });

  test("no token kept ends the run too, before Apple is asked anything but the key", async () => {
    await new FileUserTokenStore(join(dir, "open-music-sdk", "user-token.json")).delete("default");
    expect(await main(["check", "--no-color"])).toBe(1);
    expect(stdout).toContain("none is kept");
  });
});

describe("marks and the exit status", () => {
  test("a check where Apple differs is ≠, and the run exits 1 though every other check is ✓", async () => {
    apple.searchNext = "page";
    expect(await main(["check", "search-next", "rating-unset", "--no-color"])).toBe(1);
    expect(marksOf("search-next")[0]).toBe("≠");
    expect(marksOf("rating-unset")).not.toContain("≠");
  });

  test("a check Apple fails is ✗, worded from the status and the code alone, the rest still run, and the run exits 1", async () => {
    apple.failing["/v1/catalog/gb/search"] = 503;
    expect(await finish(["check", "search-next", "isrc-next", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(linesOf("search-next")).toEqual(["✗ search-next: Apple answered 503, code 50301 (at /v1/catalog/gb/search), so this was not answered."]);
    expect(marksOf("isrc-next")).toEqual(["✓"]);
    expect(stdout).not.toContain("detail with");
  });

  test("what check did not expect fails that check alone: ✗ on stdout without what was thrown, which goes to stderr, and the next check is still asked", async () => {
    // A next link that leaves Apple's origin, which core refuses with a TypeError before anything is sent.
    apple.chartNextLink = "https://elsewhere.example/v1/catalog/gb/charts?offset=50";
    expect(await main(["check", "charts-next", "isrc-next", "--no-color"])).toBe(1);
    expect(linesOf("charts-next")).toEqual(["✗ charts-next: something went wrong that check did not expect, so this was not answered. This is a bug: please report it, with what stderr says."]);
    expect(stdout).not.toContain("elsewhere");
    expect(stderr).toContain("TypeError");
    expect(stderr).toContain("elsewhere.example");
    expect(marksOf("isrc-next")).toEqual(["✓"]);
  });

  test("the charts a failed check could not get are asked for again by the next check that needs them", async () => {
    let once = true;
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (once && new URL(req.url).pathname === "/v1/catalog/gb/charts") {
        once = false;
        asked.push(req);
        return Promise.resolve(refuse(400));
      }
      return real(req);
    });
    expect(await main(["check", "isrc-next", "preview-hosts", "--no-color"])).toBe(1);
    expect(marksOf("isrc-next")).toEqual(["✗"]);
    expect(marksOf("preview-hosts")).toEqual(["·", "✓"]);
  });

  test("no token and nothing of the key is printed anywhere, and nothing is asked of any host but Apple's API and its image server, which is sent no token", async () => {
    apple.failing["/v1/me/library/playlists/p.long/tracks"] = 500;
    await finish(["check", "--write", "--no-color"], ["setTimeout", "clearTimeout"]);
    const printed = stdout + stderr;
    expect(printed).not.toContain(TOKEN);
    // A developer token is a JWT, and the key's body is base64 between its PEM lines.
    expect(printed).not.toMatch(/eyJ[\w-]{8,}\.eyJ[\w-]{8,}/);
    for (const line of PEM.split(LF).filter((each) => each !== "" && !each.startsWith("-----"))) expect(printed).not.toContain(line);
    const hosts = new Set(asked.map((req) => new URL(req.url).hostname));
    for (const host of hosts) expect(host === "api.music.apple.com" || host.endsWith(".mzstatic.com"), host).toBe(true);
    for (const req of asked.filter((each) => new URL(each.url).hostname.endsWith(".mzstatic.com"))) {
      expect(req.headers.get("authorization")).toBeNull();
      expect(req.headers.get("music-user-token")).toBeNull();
    }
    // The API is sent both tokens: the test would hold nothing if it were sent neither.
    expect(asked.some((req) => req.headers.get("music-user-token") === TOKEN && req.headers.get("authorization")?.startsWith("Bearer eyJ") === true)).toBe(true);
  });

  test("what is printed holds no token, no id of the listener's library, and nothing of Apple's error details", async () => {
    apple.failing["/v1/me/library/playlists/p.long/tracks"] = 500;
    await finish(["check", "--write", "--no-color"], ["setTimeout", "clearTimeout"]);
    expect(stdout).not.toContain(TOKEN);
    expect(stdout).not.toMatch(/\b[pil]\.\w/);
    expect(stdout).not.toContain("detail with");
    expect(stdout).not.toContain("Listener's song");
  });

  test("the report on stdout says nothing of what is in the library: not what was picked for not being there, nor how many of the listener's things there are", async () => {
    apple.library.add("songs/s1");
    apple.library.add("albums/a1");
    await main(["check", "--write", "--no-color"]);
    // What the write checks picked is named in the cleanup, on stderr, and nowhere on stdout.
    expect(cleanupOf()).toContain("Name of s2");
    expect(stdout).not.toContain("Name of");
    expect(stdout).not.toContain("To undo");
    // Counts of the listener's own things: their plays, their ratings, their playlists and how long one is. The
    // counts that are left are of what check itself sent.
    expect(stdout.split(LF).filter((line) => /\b\d+ (tracks?|ratings?|playlists?|items?)\b/.test(line) && !line.startsWith("· playlist: ") && !line.includes("0 ratings"))).toEqual([]);
  });
});

describe("recently-played-types: whether recently played needs types", () => {
  test.each([
    ["answered without them as with them, so optional, as client-user has it", "same", ["✓", "✓"]],
    ["refused without them, so required", 400, ["≠", "≠"]],
    ["empty without them and not with them, so a call without them gets nothing", "empty", ["≠", "≠"]],
  ] as const)("%s", async (_what, without, marks) => {
    apple.recent.without = without;
    expect(await main(["check", "recently-played-types", "--no-color"])).toBe(marks[0] === "✓" ? 0 : 1);
    expect(marksOf("recently-played-types")).toEqual(marks);
  });

  test("a failure that is no refusal, such as a 5xx, fails the check rather than answering it", async () => {
    apple.failing["/v1/me/recent/played"] = 503;
    expect(await finish(["check", "recently-played-types", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(marksOf("recently-played-types")).toEqual(["✗"]);
  });

  test("a type client-user lists that Apple refuses is ≠ of its own, and the tracks are still asked about", async () => {
    apple.recent.withTypes = 400;
    expect(await main(["check", "recently-played-types", "--no-color"])).toBe(1);
    expect(linesOf("recently-played-types")).toEqual([
      "≠ recently-played-types: listRecentlyPlayed with every type client-user lists: Apple answered 400, code 40001. client-user offers a type Apple does not take.",
      "≠ recently-played-types: listRecentlyPlayedTracks with every type client-user lists: Apple answered 400, code 40001. client-user offers a type Apple does not take.",
    ]);
  });

  test("nothing played lately is a question this account cannot answer", async () => {
    apple.recent = { played: 0, tracks: 0, without: "same" };
    expect(await main(["check", "recently-played-types", "--no-color"])).toBe(0);
    expect(marksOf("recently-played-types")).toEqual(["-", "-"]);
  });
});

describe("search-next and charts-next: what a next link answers with", () => {
  test.each([
    ["by type, as client-catalog says", "by type", "✓"],
    ["with a page, which paginate could walk", "page", "≠"],
    ["with neither", "neither", "≠"],
  ] as const)("a search's next link answers %s", async (_what, shape, mark) => {
    apple.searchNext = shape;
    await main(["check", "search-next", "--no-color"]);
    expect(marksOf("search-next")).toEqual([mark, "·"]);
    // The link above keeps term and types, and leaves out the limit.
    expect(linesOf("search-next")[1]).toBe("· search-next: its next link drops limit, and keeps term, types.");
  });

  test("a search with no next page is not asked about", async () => {
    apple.searchNext = "none";
    expect(await main(["check", "search-next", "--no-color"])).toBe(0);
    expect(marksOf("search-next")).toEqual(["-"]);
  });

  test.each([
    ["by type", "by type, as the charts did, so paginate cannot walk it"],
    ["page", "with a page, which paginate can walk"],
  ] as const)("a chart's next link answering %s is reported, not judged: client-catalog says nothing of it", async (shape, words) => {
    apple.chartNext = shape;
    expect(await main(["check", "charts-next", "--no-color"])).toBe(0);
    expect(linesOf("charts-next")).toEqual([`· charts-next: a chart's next link answers ${words}; its next link keeps types, limit.`]);
  });

  test("a chart's next link answering neither, and keeping none of the query, is reported as it is", async () => {
    apple.chartNext = "neither";
    apple.chartNextLink = "/v1/catalog/gb/charts";
    await main(["check", "charts-next", "--no-color"]);
    expect(linesOf("charts-next")).toEqual(["· charts-next: a chart's next link answers with neither a page nor charts by type; its next link drops types, limit, and keeps none of what was sent."]);
  });

  test("a chart with no next page is not asked about", async () => {
    apple.chartNext = "none";
    await main(["check", "charts-next", "--no-color"]);
    expect(marksOf("charts-next")).toEqual(["-"]);
  });
});

describe("isrc-next: whether songs looked up by ISRC come in pages, since resolve reads one", () => {
  test.each([
    ["no next page, even asked for one a page", "never", "✓"],
    ["a limit refused, which is no paging either", "limit refused", "✓"],
    ["a next page at once", "always", "≠"],
    ["a next page once asked for one a page", "paged", "≠"],
  ] as const)("%s", async (_what, isrcNext, mark) => {
    apple.isrcNext = isrcNext;
    await main(["check", "isrc-next", "--no-color"]);
    expect(marksOf("isrc-next")).toEqual([mark]);
    expect(linesOf("isrc-next")[0]).toContain("25 songs for 25 ISRCs");
  });

  test("charts with fewer than two ISRCs are not asked about, and a song whose id could leave its segment is passed over", async () => {
    apple.songs = [chartSong(1), { ...chartSong(2), id: "s/2" }];
    await main(["check", "isrc-next", "--no-color"]);
    expect(marksOf("isrc-next")).toEqual(["-"]);
  });

  test("the second lookup failing with a 5xx, not a refusal, fails the check", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).searchParams.get("limit") === "1" && req.url.includes("isrc")) {
        asked.push(req);
        return Promise.resolve(refuse(500));
      }
      return real(req);
    });
    expect(await finish(["check", "isrc-next", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(marksOf("isrc-next")).toEqual(["✗"]);
  });
});

describe("rating-unset: what Apple answers for a rating never set, asked of one song the listener never rated, so that nothing is said of what they rated", () => {
  test("one never rated is answered 404 alone, and with nothing among several", async () => {
    expect(await main(["check", "rating-unset", "--no-color"])).toBe(0);
    expect(linesOf("rating-unset")).toEqual([
      "· rating-unset: the rating of a song never rated: Apple answered 404, which getSongRating rejects as an ApiError of status 404.",
      "· rating-unset: the ratings of songs none of which is rated, asked for as several: Apple answered 200 with 0 ratings, which getSongRatings resolves to as it is.",
    ]);
    // s1 is rated, so s2 is the one asked about, alone and as one of several.
    expect(asked.filter((req) => new URL(req.url).pathname === "/v1/me/ratings/songs").map((req) => new URL(req.url).searchParams.get("ids"))).toEqual(["s2"]);
  });

  test("an empty answer for one never rated is what the bound function rejects as an ApiError of status 200", async () => {
    apple.unrated = "empty";
    await main(["check", "rating-unset", "--no-color"]);
    expect(linesOf("rating-unset")[0]).toBe("· rating-unset: the rating of a song never rated: Apple answered 200 with 0 ratings. music.user.getSongRating rejects an answer with none as an ApiError of status 200.");
  });

  test.each(["/v1/me/ratings/songs", "/v1/me/ratings/songs/s1"])("a failure other than a 404 for %s fails the check", async (path) => {
    apple.failing[path] = 400;
    expect(await main(["check", "rating-unset", "--no-color"])).toBe(1);
    expect(marksOf("rating-unset").at(-1)).toBe("✗");
  });

  test("charts with no songs are not asked about", async () => {
    apple.songs = [];
    await main(["check", "rating-unset", "--no-color"]);
    expect(linesOf("rating-unset")).toEqual(["- rating-unset: the charts held no songs"]);
  });

  test("a 404 for the ratings of songs none of them rated is ≠: getSongRatings is documented to resolve to an empty list", async () => {
    apple.noneRated = "404";
    expect(await main(["check", "rating-unset", "--no-color"])).toBe(1);
    expect(marksOf("rating-unset")).toEqual(["·", "≠"]);
  });

  test("every chart song rated already is not asked about, and stdout says nothing of it, which stderr does", async () => {
    for (const song of apple.songs) apple.rated.set(song.id as string, 1);
    await main(["check", "rating-unset", "--no-color"]);
    expect(linesOf("rating-unset")).toEqual(["- rating-unset: not asked, since nothing could be picked to ask it of (stderr says why)"]);
    expect(stderr).toContain("  rating-unset: every one of the chart's first 25 songs is rated.");
  });
});

describe("playlist-include: a long playlist's tracks, as lib-playlists' read reads them", () => {
  test("the next link keeps include=catalog, and the tracks on both pages carry their catalog song and its ISRC", async () => {
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(0);
    expect(linesOf("playlist-include")).toEqual([
      "· playlist-include: a long playlist's page 1 of tracks, with include=catalog: all with their catalog song, all of those with its ISRC, and all with playParams.catalogId.",
      "· playlist-include: a long playlist's page 2 of tracks, with include=catalog: all with their catalog song, all of those with its ISRC, and all with playParams.catalogId.",
      "· playlist-include: the next link keeps include=catalog, which read puts back.",
      "✓ playlist-include: the tracks on both pages carry their catalog song and its ISRC, as lib-playlists' read takes them.",
    ]);
  });

  test("a next link that drops include=catalog, as Apple's do, is asked with it put back, as read asks, and its tracks keep their ISRCs", async () => {
    apple.nextKeepsInclude = false;
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(0);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "✓"]);
    expect(linesOf("playlist-include")[2]).toBe("· playlist-include: the next link drops include=catalog, which read puts back.");
    expect(asked.some((req) => req.url.includes("offset=100") && new URL(req.url).searchParams.get("include") === "catalog")).toBe(true);
  });

  test("no catalog song past the first page, with include=catalog asked for again, is ≠: read loses the ISRCs there", async () => {
    apple.catalogOnFirstPageOnly = true;
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(1);
    expect(linesOf("playlist-include")[3]).toBe(
      "≠ playlist-include: past the first page, no track comes with its catalog song, though include=catalog is asked for again. lib-playlists' read takes the ISRC from there, so an export loses it after the first page.",
    );
  });

  test("include=catalog that gives no track its song is ≠ on the first page already", async () => {
    apple.includeCatalog = false;
    await main(["check", "playlist-include", "--no-color"]);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "≠"]);
    expect(linesOf("playlist-include")[3]).toContain("gave no track on the first page its catalog song");
  });

  test("tracks past the first page that are none of them in the catalog say nothing of the link", async () => {
    apple.listener[1]?.tracks.splice(100, 50, ...Array.from({ length: 50 }, () => ({ catalogId: "", isrc: undefined })));
    await main(["check", "playlist-include", "--no-color"]);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "-"]);
  });

  test("tracks no longer in the storefront, with a catalog id and no catalog song, are no finding on either page", async () => {
    const long = apple.listener[1];
    for (const i of [3, 120, 140]) if (long?.tracks[i]) long.tracks[i] = { catalogId: `gone${String(i)}`, isrc: undefined };
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(0);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "✓"]);
    expect(linesOf("playlist-include")[0]).toContain("some with their catalog song, all of those with its ISRC, and all with playParams.catalogId");
  });

  test("catalog songs that come without their ISRC are ≠, on the first page as on the second", async () => {
    const long = apple.listener[1];
    if (long?.tracks[5]) long.tracks[5] = { catalogId: "c6", isrc: undefined };
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(1);
    expect(linesOf("playlist-include")[3]).toBe("≠ playlist-include: catalog songs come without their ISRC. lib-playlists' read takes the ISRC from there, so an export loses it for them.");
  });

  test("a first page with no track in the catalog says nothing of include=catalog", async () => {
    const long = apple.listener[1];
    long?.tracks.splice(0, 100, ...Array.from({ length: 100 }, () => ({ catalogId: "", isrc: undefined })));
    await main(["check", "playlist-include", "--no-color"]);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "-"]);
  });

  test("a playlist's tracks Apple fails to answer for, other than a 404, fail the check", async () => {
    apple.failing["/v1/me/library/playlists/p.short/tracks"] = 403;
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(1);
    // The playlist's id is the listener's, and is left out of the path the line names.
    expect(linesOf("playlist-include")).toEqual(["✗ playlist-include: Apple refused the Music User Token (403, code 40301) (at /v1/me/library/playlists/{id}/tracks), so this was not answered."]);
  });

  test("a library with no playlist of more than a page of tracks is not asked about, and an empty one is passed over", async () => {
    apple.listener = [had("p.empty", [])];
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(0);
    expect(linesOf("playlist-include")).toEqual(["- playlist-include: no playlist of the first 25 in the library has more than a page of tracks"]);
  });
});

describe("playlist-include-tracks: what read checks a 404 for a playlist's tracks against", () => {
  test("a playlist with tracks, asked for with include=tracks, carries them", async () => {
    expect(await main(["check", "playlist-include-tracks", "--no-color"])).toBe(0);
    expect(linesOf("playlist-include-tracks")).toEqual(["✓ playlist-include-tracks: a playlist asked for with include=tracks carries its first tracks, which read checks a 404 for its tracks against."]);
  });

  test("include=tracks that carries none is ≠: read would take a 404 for the tracks for a playlist with none", async () => {
    apple.includeTracks = false;
    expect(await main(["check", "playlist-include-tracks", "--no-color"])).toBe(1);
    expect(marksOf("playlist-include-tracks")).toEqual(["≠"]);
  });

  test("an empty playlist is passed over for one with tracks", async () => {
    apple.listener = [had("p.empty", []), had("p.short", tracksOf(4))];
    await main(["check", "playlist-include-tracks", "--no-color"]);
    expect(marksOf("playlist-include-tracks")).toEqual(["✓"]);
  });

  test("a library of empty playlists is not asked about", async () => {
    apple.listener = [had("p.empty", [])];
    await main(["check", "playlist-include-tracks", "--no-color"]);
    expect(linesOf("playlist-include-tracks")).toEqual(["- playlist-include-tracks: no playlist of the first 25 in the library has tracks"]);
  });

  test("a playlist's tracks failing other than with a 404 fail the check", async () => {
    apple.failing["/v1/me/library/playlists/p.short/tracks"] = 500;
    expect(await finish(["check", "playlist-include-tracks", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(marksOf("playlist-include-tracks")).toEqual(["✗"]);
  });
});

describe("user-token-refused: what Apple answers for a Music User Token it never gave", () => {
  test.each([401, 403] as const)("answered %i, and validateUserToken calls it UserTokenInvalid", async (status) => {
    apple.madeUpToken = status;
    expect(await main(["check", "user-token-refused", "--no-color"])).toBe(0);
    expect(linesOf("user-token-refused")).toEqual([
      `· user-token-refused: a Music User Token Apple never gave is answered ${String(status)}.`,
      "✓ user-token-refused: validateUserToken rejects it as UserTokenInvalid, as user-token has it.",
    ]);
  });

  test("answered 200, as if it were a token, is ≠", async () => {
    apple.madeUpToken = 200;
    expect(await main(["check", "user-token-refused", "--no-color"])).toBe(1);
    expect(marksOf("user-token-refused")).toEqual(["≠"]);
  });

  test("a 401 for the made-up token that /v1/test then shares is the developer token's, and is ≠", async () => {
    // Apple refusing the key as well, after doctor's question: validateUserToken hands on that refusal.
    let tests = 0;
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname === "/v1/test" && ++tests > 1) {
        asked.push(req);
        return Promise.resolve(refuse(401));
      }
      return real(req);
    });
    expect(await main(["check", "user-token-refused", "--no-color"])).toBe(1);
    expect(linesOf("user-token-refused")[1]).toBe(
      "≠ user-token-refused: validateUserToken rejects it as DeveloperTokenInvalid: Apple refused the developer token (401, code 40101). user-token has a refused Music User Token as UserTokenInvalid.",
    );
  });

  test("a made-up token Apple refuses at first and then takes is ≠ for validateUserToken", async () => {
    let storefronts = 0;
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.headers.get("music-user-token") === MADE_UP && ++storefronts > 1) {
        asked.push(req);
        return Promise.resolve(json({ data: [{ id: "gb", type: "storefronts" }] }));
      }
      return real(req);
    });
    expect(await main(["check", "user-token-refused", "--no-color"])).toBe(1);
    expect(linesOf("user-token-refused")[1]).toBe("≠ user-token-refused: validateUserToken took a Music User Token Apple never gave.");
  });

  test("a 500 for the made-up token says nothing of the token: the check is ✗, not an answer", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.headers.get("music-user-token") === MADE_UP) return Promise.resolve(refuse(500));
      return real(req);
    });
    expect(await finish(["check", "user-token-refused", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(linesOf("user-token-refused")).toEqual(["✗ user-token-refused: Apple answered 500, code 50001 (at /v1/me/storefront), so this was not answered."]);
  });

  test("validateUserToken failing in a way that is no refusal leaves its question unanswered: ✗, not ≠", async () => {
    let storefronts = 0;
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      // The first ask with the made-up token is refused; validateUserToken's own then finds Apple failing.
      if (req.headers.get("music-user-token") === MADE_UP && ++storefronts > 1) return Promise.resolve(refuse(503));
      return real(req);
    });
    expect(await finish(["check", "user-token-refused", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(marksOf("user-token-refused")).toEqual(["·", "✗"]);
  });

  test("no answer for the made-up token is no answer to report: the check is ✗", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.headers.get("music-user-token") === MADE_UP) return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    expect(await finish(["check", "user-token-refused", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(linesOf("user-token-refused")).toEqual(["✗ user-token-refused: Apple could not be reached (at /v1/me/storefront), so this was not answered."]);
  });
});

describe("preview-hosts and artwork-placeholders: read from the charts", () => {
  test("the hosts of the clips are reported, and clips on a subdomain of itunes.apple.com are what the player's docs say to allow", async () => {
    (apple.songs[0]?.attributes as Record<string, unknown>).previews = [];
    expect(await main(["check", "preview-hosts", "--no-color"])).toBe(0);
    expect(linesOf("preview-hosts")).toEqual([
      "· preview-hosts: 29 of 30 chart songs have a preview, served from audio-ssl.itunes.apple.com (29).",
      '✓ preview-hosts: every one is one that hosts: ["itunes.apple.com"] allows, as lib-preview-player\'s docs have it.',
    ]);
  });

  test("a clip the player's hosts would refuse is ≠, held to core's own check: another host, no https, or no URL at all", async () => {
    const previews = (n: number, url: string) => ((apple.songs[n]?.attributes as Record<string, unknown>).previews = [{ url }]);
    previews(0, "http://audio-ssl.itunes.apple.com/1.m4a");
    previews(1, "https://clips.example/2.m4a");
    previews(2, "not a url");
    expect(await main(["check", "preview-hosts", "--no-color"])).toBe(1);
    expect(linesOf("preview-hosts")[1]).toBe(
      '≠ preview-hosts: 3 previews not allowed by hosts: ["itunes.apple.com"], which lib-preview-player\'s docs name as the host to allow: audio-ssl.itunes.apple.com (1), clips.example (1), no host (1).',
    );
  });

  test("songs with no clip at all are not asked about", async () => {
    for (const song of apple.songs) delete (song.attributes as Record<string, unknown>).previews;
    await main(["check", "preview-hosts", "--no-color"]);
    expect(marksOf("preview-hosts")).toEqual(["-"]);
  });

  test("templates util-artwork itself fills, on mzstatic.com, are ✓, with how many hold each placeholder, a URL parser's form among them", async () => {
    (apple.albums[0]?.attributes as Record<string, unknown>).artwork = { url: "https://is1-ssl.mzstatic.com/a/{w}x{h}{c}.{f}" };
    (apple.albums[1]?.attributes as Record<string, unknown>).artwork = { url: "https://is2-ssl.mzstatic.com/a/%7Bw%7Dx%7Bh%7Dbb.jpg" };
    expect(await main(["check", "artwork-placeholders", "--no-color"])).toBe(0);
    expect(linesOf("artwork-placeholders")).toEqual([
      "· artwork-placeholders: of 63 artwork templates, these hold {w} (63), {h} (63), {c} (1), {f} (1).",
      "✓ artwork-placeholders: util-artwork fills every one, and each is on mzstatic.com, as its docs have it.",
    ]);
  });

  test("a placeholder util-artwork leaves in the URL it gives is ≠", async () => {
    (apple.videos[0]?.attributes as Record<string, unknown>).artwork = { url: "https://is1-ssl.mzstatic.com/v/{w}x{h}{q}.jpg" };
    expect(await main(["check", "artwork-placeholders", "--no-color"])).toBe(1);
    expect(linesOf("artwork-placeholders")[1]).toMatch(/^≠ artwork-placeholders: util-artwork could not fill 1 template of 63, held to hosts: \["mzstatic\.com"\]\. The first: a placeholder left in https:\/\/is1-ssl\.mzstatic\.com\/v\/\S*\{q\}\.jpg$/);
  });

  test("artwork on another host than the docs name is ≠, as util-artwork refuses it", async () => {
    (apple.songs[0]?.attributes as Record<string, unknown>).artwork = { url: "https://images.example/{w}x{h}bb.jpg" };
    expect(await main(["check", "artwork-placeholders", "--no-color"])).toBe(1);
    expect(linesOf("artwork-placeholders")[1]).toBe(
      '≠ artwork-placeholders: util-artwork could not fill 1 template of 63, held to hosts: ["mzstatic.com"]. The first: artwork: the artwork\'s url is not https on one of the hosts allowed',
    );
  });

  test("templates with no placeholder, and resources with no artwork, are counted as they are", async () => {
    for (const each of [...apple.songs, ...apple.albums, ...apple.playlists, ...apple.videos]) delete (each.attributes as Record<string, unknown>).artwork;
    (apple.albums[0]?.attributes as Record<string, unknown>).artwork = { url: "https://is1-ssl.mzstatic.com/a/fixed.jpg" };
    await main(["check", "artwork-placeholders", "--no-color"]);
    expect(linesOf("artwork-placeholders")[0]).toBe("· artwork-placeholders: of 1 artwork template, none holds a placeholder.");
  });

  test("nothing in the charts with artwork is not asked about", async () => {
    for (const each of [...apple.songs, ...apple.albums, ...apple.playlists, ...apple.videos]) delete (each.attributes as Record<string, unknown>).artwork;
    await main(["check", "artwork-placeholders", "--no-color"]);
    expect(marksOf("artwork-placeholders")).toEqual(["-"]);
  });
});

/** The steps of the cleanup, after its heading. */
const cleanupOf = () => stderr.slice(stderr.indexOf("To undo what check left"));

/**
 * Runs `argv` under fake timers, a second of them at a time, until it is done: between steps the event loop is let
 * turn, since reading the token file is real I/O, which no fake timer brings on.
 */
async function finish(argv: string[], toFake: ("setTimeout" | "clearTimeout" | "Date")[] = ["setTimeout", "clearTimeout", "Date"]): Promise<number> {
  vi.useFakeTimers({ toFake });
  const running = main(argv);
  const state = { done: false };
  void running.finally(() => {
    state.done = true;
  });
  while (!state.done) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(1000);
  }
  return running;
}

describe("add-to-library and add-to-favorites", () => {
  test("one of each type, none of them in the library before, is added once, and each is in the cleanup with its link", async () => {
    apple.library.add("songs/s1");
    expect(await main(["check", "add-to-library", "--write", "--no-color"])).toBe(0);
    expect(linesOf("add-to-library")).toEqual([
      "· add-to-library: addToLibrary took songs, albums, playlists, music-videos.",
      "· add-to-library: each showed in the library after: songs, 0 seconds; albums, 0 seconds; playlists, 0 seconds; music-videos, 0 seconds.",
      "· add-to-library: the album of the song added does not count as in the library, though one song of it is there.",
      "· add-to-library: adding the playlist had not put its songs in the library when check looked.",
    ]);
    expect(posts()).toEqual(["/v1/me/library", "/v1/me/library", "/v1/me/library", "/v1/me/library"]);
    const steps = cleanupOf();
    // s1 was the listener's already, so s2 was added, and only what was added is to be deleted. A song is linked to
    // its own page, where Delete from Library takes out the song alone, not to its album's, which Apple gives it.
    expect(steps).toContain('- the song "Name of s2" by Artist of s2: https://music.apple.com/gb/song/s2');
    expect(steps).not.toContain("Name of s1");
    expect(steps).toContain('- the album "Name of a1" by Artist of a1, with its songs: https://music.apple.com/gb/x/a1');
    expect(steps).toContain("Delete these from your library: open each, and choose Delete from Library from the … menu on the page it opens.");
    // The playlist's songs were not seen in the library, but may show up there.
    expect(steps).toContain('If adding the playlist "Name of pl.chart1" by Curator of pl.chart1 put its songs in your library, delete them: open https://music.apple.com/gb/x/pl.chart1');
  });

  test("a catalog playlist that put its songs in the library says so, and the cleanup says to delete them", async () => {
    apple.catalogPlaylistSongsInLibrary = true;
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(linesOf("add-to-library").at(-1)).toBe("· add-to-library: adding the playlist put its songs in the library too.");
    expect(cleanupOf()).toContain(
      'Adding the playlist "Name of pl.chart1" by Curator of pl.chart1 put its songs in your library as well. Delete them: open https://music.apple.com/gb/x/pl.chart1, and choose Delete from Library from the … menu of each song on that page. None of them was in your library before.',
    );
  });

  test("a catalog playlist one of whose songs the listener holds is not the one added, so deleting its songs takes nothing of theirs", async () => {
    apple.library.add("songs/pl.chart1s2");
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).not.toContain('"Name of pl.chart1"');
    expect(cleanupOf()).toContain('- the playlist "Name of pl.chart2" by Curator of pl.chart2: https://music.apple.com/gb/x/pl.chart2');
  });

  test("a catalog playlist of more than a page of tracks is passed over, since what of it the listener holds is not read whole", async () => {
    apple.answers["/v1/catalog/gb/playlists/pl.chart1/tracks"] = { data: [item("songs", "u1")], next: "/v1/catalog/gb/playlists/pl.chart1/tracks?offset=100" };
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).not.toContain('"Name of pl.chart1"');
    expect(cleanupOf()).toContain('"Name of pl.chart2"');
  });

  test("a catalog playlist whose tracks Apple answers 404 for holds none of the listener's, and may be added", async () => {
    apple.failing["/v1/catalog/gb/playlists/pl.chart1/tracks"] = 404;
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).toContain('- the playlist "Name of pl.chart1" by Curator of pl.chart1');
  });

  test("a playlist is named by its curator, and a resource with no name, artist or link by its id, to be searched for", async () => {
    apple.videos = [{ id: "mv9", type: "music-videos", attributes: {} }];
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).toContain('- the playlist "Name of pl.chart1" by Curator of pl.chart1: https://music.apple.com/gb/x/pl.chart1');
    expect(cleanupOf()).toContain('- the music video "mv9": search for it in the Music app');
  });

  test("a type the charts hold none of is passed over, and every type refused leaves nothing to wait for or undo", async () => {
    apple.videos = [];
    apple.addStatus = { songs: 400, albums: 400, playlists: 400 };
    expect(await main(["check", "add-to-library", "--write", "--no-color"])).toBe(0);
    expect(linesOf("add-to-library")).toEqual(["· add-to-library: addToLibrary took none of them; songs: Apple answered 400, code 40001; albums: Apple answered 400, code 40001; playlists: Apple answered 400, code 40001."]);
    expect(stderr).not.toContain("To undo");
  });

  test("whether a resource is in the library failing, other than with a 404, fails the check before anything is written", async () => {
    apple.failing["/v1/catalog/gb/songs/s1/library"] = 403;
    expect(await main(["check", "add-to-library", "--write", "--no-color"])).toBe(1);
    expect(marksOf("add-to-library")).toEqual(["✗"]);
    expect(posts()).toEqual([]);
  });

  test("a link is offered only when it is an https address of Apple Music, and a name loses what would turn how it reads", async () => {
    const override = String.fromCharCode(0x202e);
    // A song's link is its own page, made from its id, whatever its url holds. The one song is one never rated, as a song added is.
    apple.rated.clear();
    apple.songs = [catalogItem("songs", "s1", { name: `Hit${override}lanigiro`, url: "javascript:alert(1)" })];
    apple.albums = [catalogItem("albums", "a1", { url: "https://music.apple.com.evil.example/gb/album/1" })];
    apple.playlists = [catalogItem("playlists", "pl.1", { url: "http://music.apple.com/gb/playlist/1" })];
    apple.videos = [catalogItem("music-videos", "mv1", { url: "javascript:alert(1)" })];
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).toContain('- the song "Hitlanigiro" by Artist of s1: https://music.apple.com/gb/song/s1');
    expect(cleanupOf()).toContain('- the album "Name of a1" by Artist of a1, with its songs: search for it in the Music app');
    expect(cleanupOf()).toContain('- the playlist "Name of pl.1" by Artist of pl.1: search for it in the Music app');
    expect(cleanupOf()).toContain('- the music video "Name of mv1" by Artist of mv1: search for it in the Music app');
    expect(cleanupOf()).not.toContain("javascript:");
  });

  test.each([".", ".."])("a chart id of %s, which a URL reads as a step in the path, is passed over and never asked about", async (id) => {
    apple.songs = [{ ...chartSong(1), id }, chartSong(2)];
    await main(["check", "add-to-library", "--write", "--no-color"]);
    const paths = asked.map((req) => new URL(req.url).pathname);
    // Where `songs/./library` and `songs/../library` would have gone.
    expect(paths).not.toContain("/v1/catalog/gb/songs/library");
    expect(paths).not.toContain("/v1/catalog/gb/library");
    expect(paths).toContain("/v1/catalog/gb/songs/s2/library");
  });

  test("each type's wait to show is counted from when Apple took it, not from when the last type was taken", async () => {
    apple.addDelay.albums = 3000;
    expect(await finish(["check", "add-to-library", "--write", "--no-color"])).toBe(0);
    // The song was taken three seconds before the album, and showed at the first look, made once all four were taken.
    expect(linesOf("add-to-library")[1]).toBe("· add-to-library: each showed in the library after: songs, 3 seconds; albums, 0 seconds; playlists, 0 seconds; music-videos, 0 seconds.");
  });

  test("a type Apple refuses is reported, and is not in the cleanup, since nothing was added", async () => {
    apple.addStatus.playlists = 400;
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(linesOf("add-to-library")[0]).toBe("· add-to-library: addToLibrary took songs, albums, music-videos; playlists: Apple answered 400, code 40001.");
    expect(cleanupOf()).not.toContain("pl.chart1");
  });

  test("a type whose first five in the charts are all in the library already is not added", async () => {
    apple.videos = [catalogItem("music-videos", "mv1")];
    apple.library.add("music-videos/mv1");
    await main(["check", "add-to-library", "--write", "--no-color"]);
    // stdout says nothing of why: that the chart's first five are in the library says what is in it, which stderr says.
    expect(linesOf("add-to-library")[0]).toContain("music-videos not asked (stderr says why)");
    expect(stderr).toContain("  add-to-library: none of the chart's first five music-videos could be picked: each was in your library, or rated, or held something of yours.");
  });

  test("an addition whose answer was lost is in the cleanup as one that may not be there, and the check is ✗", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "POST") return Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }));
      return real(req);
    });
    expect(await main(["check", "add-to-library", "--write", "--no-color"])).toBe(1);
    expect(linesOf("add-to-library")).toEqual(["✗ add-to-library: Apple could not be reached (at /v1/me/library), so this was not answered."]);
    // s1 is rated, so s2 was the song sent.
    expect(cleanupOf()).toContain("Name of s2\" by Artist of s2: https://music.apple.com/gb/song/s2 (Apple's answer was lost, so it may not be there)");
  });

  test("a favorite that shows as a rating, made of a song neither in the library nor rated, is undone in the cleanup", async () => {
    apple.library.add("songs/s2");
    expect(await main(["check", "add-to-favorites", "--write", "--no-color"])).toBe(0);
    expect(linesOf("add-to-favorites")).toEqual(["· add-to-favorites: addToFavorites took a song, which had a rating of 1 after 0 seconds.", "· add-to-favorites: the song made a favorite was not in the library when check looked."]);
    // s1 is rated and s2 in the library, so s3.
    // Not seen in the library, but it may show up there later.
    expect(cleanupOf()).toContain(
      'Undo the favorite on the song "Name of s3" by Artist of s3: open https://music.apple.com/gb/song/s3, and choose Undo Favorite from the … menu on its page. If it shows up in your library, choose Delete from Library from the same menu as well.',
    );
    expect(cleanupOf()).not.toContain("Delete these from your library");
  });

  test("a favorite that is no rating is said so after a minute, and one put in the library is deleted from it too", async () => {
    apple.favoriteRates = false;
    apple.favoriteInLibrary = true;
    expect(await finish(["check", "add-to-favorites", "--write", "--no-color"])).toBe(0);
    expect(linesOf("add-to-favorites")).toEqual(["· add-to-favorites: addToFavorites took a song, which had no rating a minute later: a favorite is not a rating.", "· add-to-favorites: the song made a favorite was put in the library too."]);
    expect(cleanupOf()).toContain(
      'Undo the favorite on the song "Name of s2" by Artist of s2: open https://music.apple.com/gb/song/s2, and choose Undo Favorite from the … menu on its page. It went into your library as well: choose Delete from Library from the same menu.',
    );
  });

  test("a favorite whose answer was lost may have been made, and is undone in the steps as one that may not be there", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "POST") return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    expect(await main(["check", "add-to-favorites", "--write", "--no-color"])).toBe(1);
    expect(cleanupOf()).toMatch(/Undo the favorite on the song "Name of s2".*\(Apple's answer was lost, so it may not be there\)/);
  });

  test("a favorite Apple refuses leaves nothing to undo, and the check is ✗", async () => {
    apple.failing["/v1/me/favorites"] = 400;
    expect(await main(["check", "add-to-favorites", "--write", "--no-color"])).toBe(1);
    expect(marksOf("add-to-favorites")).toEqual(["✗"]);
    expect(stderr).not.toContain("To undo");
  });

  test("ten chart songs each in the library or rated already are not asked about, and nothing is written", async () => {
    for (const song of apple.songs.slice(0, 10)) apple.library.add(`songs/${song.id as string}`);
    await main(["check", "add-to-favorites", "--write", "--no-color"]);
    expect(marksOf("add-to-favorites")).toEqual(["-"]);
    expect(posts()).toEqual([]);
    expect(stderr).not.toContain("To undo");
  });
});

describe("playlist: one made, given songs, read back, and applied again", () => {
  test("Apple keeps it as lib-playlists assumes: ✓ throughout, apply adds nothing, and the cleanup names the playlist and the albums", async () => {
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    const lines = linesOf("playlist").map((line) => line.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/, "<time>"));
    expect(lines).toEqual([
      "· playlist: the answer to making a playlist held the playlist, with its id.",
      "· playlist: the new playlist could be read by its id after 0 seconds, and was among the library's playlists after 0 seconds; apply's settle waits about 9 seconds.",
      "✓ playlist: its name and description came back as they were sent, which apply finds a playlist by.",
      "· playlist: its tracks, while it had none: Apple answered 404, code 40401.",
      "✓ playlist: lib-playlists' read takes it for a playlist with no tracks.",
      "· playlist: one request took 300 tracks.",
      "· playlist: the 300 tracks showed after 0 seconds; apply's settle waits about 9 seconds.",
      "✓ playlist: read gives back the catalog id each track was added by, in order, which plan goes by.",
      "· playlist: adding songs to the playlist put them in the library too.",
      "✓ playlist: apply with the same plan found the playlist, added nothing, and saw it whole.",
    ]);
    // One playlist made, one append: apply wrote nothing.
    expect(posts()).toEqual(["/v1/me/library/playlists", "/v1/me/library/playlists/p.made2/tracks"]);
    const steps = cleanupOf();
    expect(steps).toMatch(/1\. Delete every playlist named "open-music-sdk check \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC": open each from your playlists/);
    expect(steps).toContain("2. The playlist's songs went into your library as well.");
    // Twelve songs an album, so 300 songs from 25 albums; a1 to a25.
    expect(steps).toContain('- the album "Name of a25" by Artist of a25, with its songs');
    expect(steps).not.toContain("Name of a26");
  });

  test("albums in the library already give no songs, so none of the listener's is in the cleanup", async () => {
    apple.library.add("albums/a1");
    await main(["check", "playlist", "--write", "--no-color"]);
    expect(cleanupOf()).not.toContain('"Name of a1"');
    expect(cleanupOf()).toContain('"Name of a26"');
  });

  test("songs a playlist did not put in the library are named as albums to delete only if they show up", async () => {
    apple.playlistSongsInLibrary = false;
    await main(["check", "playlist", "--write", "--no-color"]);
    expect(linesOf("playlist")).toContain("· playlist: adding songs to the playlist had not put them in the library when check looked.");
    expect(cleanupOf()).toContain("If the playlist's songs show up in your library, delete the albums they are from");
  });

  test.each([
    ["changed", "Changed by Apple", '"Changed by Apple"'],
    ["dropped", "", '"none"'],
  ])("a description that comes back %s is ≠, and apply is not run, since it would make another playlist", async (_how, back, said) => {
    apple.descriptionBack = () => back;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist")).toContain(`≠ playlist: its description came back as ${said}. apply finds a playlist by its name and description, so a run by this plan would make another.`);
    expect(marksOf("playlist").at(-1)).toBe("-");
    expect(posts()).toHaveLength(2);
  });

  test("tracks held under another catalog id are ≠, and apply is not run, since it would add them again", async () => {
    apple.heldAs = (id) => `other-${id}`;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist")).toContain("≠ playlist: 300 tracks of 300 came back under another catalog id, or none, or in another place. plan goes by the catalog id, so apply would add them again.");
    expect(posts()).toHaveLength(2);
  });

  test("300 tracks refused in one request and 100 taken, which is safe to send after a refusal, is ≠: it was the size", async () => {
    apple.appendMost = 100;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist")).toContain("≠ playlist: one request of 300 tracks: Apple answered 400, code 40001; one of 100 was taken. lib-playlists' apply sends 300 to a request by default.");
    expect(linesOf("playlist")).toContain("· playlist: the 100 tracks showed after 0 seconds; apply's settle waits about 9 seconds.");
  });

  test("100 refused as well is no finding of size, since a track Apple will not take would have both refused: ✗", async () => {
    apple.appendMost = 50;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist").at(-1)).toBe(
      "✗ playlist: one request of 300 tracks: Apple answered 400, code 40001; and one of 100: Apple answered 400, code 40001. Neither was taken, so how many tracks one request takes is not answered.",
    );
  });

  test("after 300 refused and 100 taken, the albums to delete are those of the 100 alone", async () => {
    apple.appendMost = 100;
    await main(["check", "playlist", "--write", "--no-color"]);
    // Twelve songs an album: the first 100 come from a1 to a9.
    expect(cleanupOf()).toContain('"Name of a9"');
    expect(cleanupOf()).not.toContain('"Name of a10"');
  });

  test("100 sent after 300 were refused, whose answer is lost, may have landed: their albums are in the steps, and the check is ✗", async () => {
    apple.appendMost = 100;
    apple.appendLost = "landed";
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(marksOf("playlist").at(-1)).toBe("✗");
    expect(cleanupOf()).toContain('"Name of a9"');
    expect(cleanupOf()).not.toContain('"Name of a10"');
  });

  test("a song on two chart albums is added once", async () => {
    apple.albums = [catalogItem("albums", "a1"), catalogItem("albums", "a1")];
    await main(["check", "playlist", "--write", "--no-color"]);
    expect(linesOf("playlist")).toContain("· playlist: one request took 12 tracks.");
  });

  test("tracks refused at both sizes leave no albums to delete, since nothing was added", async () => {
    apple.appendMost = 50;
    await main(["check", "playlist", "--write", "--no-color"]);
    expect(cleanupOf()).toContain("Delete every playlist named");
    expect(cleanupOf()).not.toContain("albums they are from");
  });

  test("a playlist Apple refuses to make leaves nothing to undo", async () => {
    apple.failing["/v1/me/library/playlists"] = 400;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(marksOf("playlist")).toEqual(["✗"]);
    expect(stderr).not.toContain("To undo");
  });

  test("fewer than 100 tracks refused is ✗ at once, with nothing smaller to try", async () => {
    apple.albums = apple.albums.slice(0, 5);
    apple.appendMost = 50;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist").at(-1)).toBe("✗ playlist: one request of 60 tracks: Apple answered 400, code 40001, so how many tracks one request takes is not answered.");
  });

  test("songs that cannot be played, such as one not yet out, are not added", async () => {
    await main(["check", "playlist", "--write", "--no-color"]);
    const made = apple.listener.find((playlist) => playlist.id === "p.made2");
    expect(made?.tracks).toHaveLength(300);
    expect(made?.tracks.some((track) => track.catalogId.endsWith("soon"))).toBe(false);
  });

  test("some of the tracks added showing within a minute and not the rest is said as it is, and nothing more asked", async () => {
    apple.dropTracks = 1;
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist").at(-1)).toBe("· playlist: 299 of the 300 tracks added showed within a minute: Apple may have taken some and not the others.");
  });

  test("an append whose answer was lost and whose tracks never show was most likely not carried out, which is no finding", async () => {
    apple.appendLost = "not landed";
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist").at(-1)).toBe("· playlist: none of the tracks whose answer was lost showed within a minute, so they were most likely not added.");
  });

  test("a playlist that cannot be read by its id within a minute is not asked what it answers empty, since a 404 then is its lag", async () => {
    apple.lag.readable = 1000;
    await finish(["check", "playlist", "--write", "--no-color"]);
    expect(linesOf("playlist")).toContain("- playlist: the playlist could not be read by its id within a minute, so what an empty one answers is not seen");
    expect(linesOf("playlist").some((line) => line.includes("while it had none"))).toBe(false);
  });

  test("an append whose answer was lost is read back, not sent again", async () => {
    apple.appendLost = "landed";
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist")).toContain("· playlist: the answer to adding 300 tracks: Apple could not be reached; whether they were added is read back.");
    expect(posts().filter((path) => path.endsWith("/tracks"))).toHaveLength(1);
  });

  test("how long each step takes to show is counted by the clock, a read a second", async () => {
    apple.lag = { readable: 2, listed: 3, tracks: 6 };
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist")).toContain("· playlist: the new playlist could be read by its id after 2 seconds, and was among the library's playlists after 3 seconds; apply's settle waits about 9 seconds.");
    expect(linesOf("playlist")).toContain("· playlist: the 300 tracks showed after 6 seconds; apply's settle waits about 9 seconds.");
    // Said once a wait begins, on stderr, so that its quiet is not taken for a hang.
    for (const what of ["the new playlist to be read by its id", "the new playlist to be among the library's", "the tracks added to show in the playlist"])
      expect(stderr.split(`Waiting for ${what}, a minute at most…`)).toHaveLength(2);
  });

  test("what shows at the first read is not waited for, and nothing is said of waiting", async () => {
    await main(["check", "playlist", "--write", "--no-color"]);
    expect(stderr).not.toContain("Waiting for");
  });

  test("tracks that do not show within a minute are ≠, and the rest is not asked", async () => {
    apple.lag.tracks = 1000;
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist").at(-1)).toBe("≠ playlist: none of the 300 tracks added showed within a minute; apply's settle waits about 9 seconds.");
    expect(cleanupOf()).toContain("Delete every playlist named");
  });

  test("a playlist that reads by the id Apple gave as another, and is not listed by that id, is given nothing: it may be the listener's", async () => {
    apple.answers["/v1/me/library/playlists/p.made2"] = { data: [asPlaylist(had("p.made2", [], "Theirs"), false)] };
    apple.lag.listed = 1000;
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist").at(-1)).toBe("≠ playlist: the playlist read by the id Apple gave has another name, and the one made was not among the library's by that id, so nothing is added to it.");
    expect(posts()).toEqual(["/v1/me/library/playlists"]);
  });

  test("an answer that holds no playlist is found among the listener's playlists by its name", async () => {
    apple.madeWithId = false;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist").slice(0, 2)).toEqual([
      "· playlist: the answer to making a playlist held no playlist, so apply has to find it by its name and description.",
      // Read by the id the listing gave.
      "· playlist: the new playlist could be read by its id after 0 seconds, and was among the library's playlists after 0 seconds; apply's settle waits about 9 seconds.",
    ]);
  });

  test("one with no id that is never listed cannot be asked more of, and is still in the cleanup", async () => {
    apple.madeWithId = false;
    apple.lag.listed = 1000;
    await finish(["check", "playlist", "--write", "--no-color"]);
    expect(marksOf("playlist").at(-1)).toBe("-");
    expect(cleanupOf()).toContain("Delete every playlist named");
  });

  test("apply that makes another playlist is ≠, and both are in the cleanup", async () => {
    // Listed under its name for check, but not for apply: as if Apple listed it late.
    let lists = 0;
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname === "/v1/me/library/playlists" && req.method === "GET" && ++lists > 1) {
        asked.push(req);
        return Promise.resolve(json({ data: [] }));
      }
      return real(req);
    });
    expect(await finish(["check", "playlist", "--write", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    // Nor does apply find the playlist it made among the library's, which stay empty here, so it cannot say it saw it.
    expect(linesOf("playlist").at(-1)).toBe("≠ playlist: apply with the same plan resolved to created true, appended 300, verified false, where it should have found the playlist and added nothing.");
    // One step for every playlist of the name, the one apply made too, whether or not apply lived to say so.
    expect(cleanupOf().match(/Delete every playlist named/g)).toHaveLength(1);
    expect(apple.listener.filter((playlist) => playlist.name.startsWith("open-music-sdk check"))).toHaveLength(2);
  });

  test("a playlist that is never listed is ≠, since apply would make another every time, and the rest is still asked by its id", async () => {
    apple.lag.listed = 1000;
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist")).toContain("≠ playlist: the playlist was not among the library's playlists within a minute. apply's settle waits about 9 seconds, so apply would make another every time it ran.");
    expect(linesOf("playlist")).toContain("· playlist: one request took 300 tracks.");
    expect(marksOf("playlist").at(-1)).toBe("-");
  });

  test("read rejecting the new playlist while it has no tracks is ≠, since apply could not fill one it made", async () => {
    apple.failing["/v1/me/library/playlists/p.made2/tracks"] = 400;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist")).toContain("· playlist: its tracks, while it had none: Apple answered 400, code 40001.");
    expect(linesOf("playlist")).toContain(
      "≠ playlist: lib-playlists' read rejects a playlist with no tracks: Apple answered 400, code 40001. apply reads a playlist before it adds to it, so it cannot fill one it made.",
    );
  });

  test("its tracks failing with a 5xx while it has none fail the check", async () => {
    apple.failing["/v1/me/library/playlists/p.made2/tracks"] = 500;
    expect(await finish(["check", "playlist", "--write", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(marksOf("playlist").at(-1)).toBe("✗");
    expect(cleanupOf()).toContain("Delete every playlist named");
  });

  test("albums that are all in the library, or hold no songs, give none to add, and the playlist alone is to be deleted", async () => {
    for (const album of apple.albums.slice(1)) apple.library.add(`albums/${album.id as string}`);
    apple.songless.add("a1");
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist").at(-1)).toBe("- playlist: not asked, since nothing could be picked to ask it of (stderr says why)");
    expect(stderr).toContain("  playlist: no chart album's songs could be picked to add: you held each album, or something of it, or it had none to play.");
    expect(cleanupOf()).not.toContain("albums they are from");
  });

  test("making the playlist with its answer lost leaves one that may be there, and the check is ✗", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "POST") return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(marksOf("playlist")).toEqual(["✗"]);
    expect(cleanupOf()).toMatch(/Delete every playlist named "open-music-sdk check .* UTC": open each from your playlists, and choose Delete from Library from the … menu on its page\. \(Apple's answer was lost, so it may not be there\)/);
  });

  test("Ctrl+C while a request is under way stops it too, and the cleanup is printed", async () => {
    const before = new Set(process.listeners("SIGINT"));
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      // The listener's playlists never answer, until the request is aborted.
      if (new URL(req.url).pathname === "/v1/me/library/playlists" && req.method === "GET")
        return new Promise<Response>((_resolve, reject) => {
          req.signal.addEventListener("abort", () => {
            reject(req.signal.reason as Error);
          });
        });
      return real(req);
    });
    const running = main(["check", "playlist", "--write", "--no-color"]);
    await vi.waitFor(() => {
      expect(stderr).toContain("Asking: playlist");
      expect(asked.some((req) => req.method === "GET" && new URL(req.url).pathname.startsWith("/v1/me/library/playlists/"))).toBe(true);
    });
    process.listeners("SIGINT").find((listener) => !before.has(listener))?.("SIGINT");
    expect(await running).toBe(130);
    expect(cleanupOf()).toContain("Delete every playlist named");
  });
  test.each(["SIGINT", "SIGTERM"] as const)("%s stops it, pressed once or twice: exit 130, and the cleanup is printed for what was written so far", async (signal) => {
    apple.lag.listed = 1000;
    const before = new Set(process.listeners(signal));
    const running = main(["check", "playlist", "--write", "--no-color"]);
    // While it waits for the playlist to be listed.
    await vi.waitFor(() => {
      expect(stdout).toContain("held the playlist");
    });
    const added = process.listeners(signal).filter((listener) => !before.has(listener));
    expect(added).toHaveLength(1);
    // A second press before the steps are printed is let go by, not left to end the process with them unprinted.
    added[0]?.(signal);
    added[0]?.(signal);
    expect(process.listeners(signal)).toHaveLength(before.size + 1);
    expect(await running).toBe(130);
    expect(stderr).toContain("Stopped.");
    expect(process.listeners(signal)).toHaveLength(before.size);
    expect(cleanupOf()).toContain("Delete every playlist named");
  });
});

const pathsOf = (requests: readonly Request[]) => requests.map((req) => new URL(req.url).pathname);
/** The lines of the sweep's rows for one function, its names' among them. */
const rowsOf = (fn: string) => stdout.split(LF).filter((line) => line.slice(2).startsWith(`${fn}: `) || line.slice(2).startsWith(`${fn}:`));

describe("the sweep: every function of client-catalog and client-user, each answer held to its generated type", () => {
  test("a read run asks every function that reads, and every name of one, and none that writes: no rating and no folder", async () => {
    expect(await main(["check", "--no-color"])).toBe(0);
    for (const { fn, entry } of ROWS) expect(rowsOf(fn).length > 0, fn).toBe(entry.kind === "row");
    expect(asked.filter((req) => req.method !== "GET")).toEqual([]);
    // The one rating a read run asks for is rating-unset's, of the chart's songs.
    expect(pathsOf(asked).filter((path) => path.startsWith("/v1/me/ratings/") && !path.startsWith("/v1/me/ratings/songs"))).toEqual([]);
    expect(stdout.split(LF).filter((line) => line.startsWith("Asked "))).toEqual(["Asked 96 functions and 12 checks: 106 ✓, 0 ≠, 0 ✗, 0 -, 12 ·."]);
    expect(stdout).not.toContain("Differences from the types");
  });

  test("each package is a heading, the rows of its functions under it, then its questions", async () => {
    await main(["check", "--no-color"]);
    const headings = stdout.split(LF).filter((line) => /^[a-z-]+$/.test(line));
    expect(headings).toEqual(["client-catalog", "client-user", "lib-playlists", "util-artwork", "lib-preview-player", "user-token"]);
    const catalog = stdout.slice(stdout.indexOf(`${LF}client-catalog${LF}`), stdout.indexOf(`${LF}client-user${LF}`));
    expect(catalog.indexOf("getLanguageTag: ")).toBeLessThan(catalog.indexOf("search-next: "));
  });

  test("an answer that differs from its type is ≠: the resource's type, the field below it, and what the type expected; and each way it differs is listed once at the end, with every function that met it", async () => {
    const song = item("songs", "s1");
    (song.attributes as tBody).name = 7;
    apple.answers["/v1/catalog/gb/songs/s1"] = { data: [song] };
    apple.answers["/v1/catalog/gb/songs"] = { data: [song] };
    expect(await main(["check", "getSong", "getSongs", "--no-color"])).toBe(1);
    expect(rowsOf("getSong")).toEqual(["≠ getSong: types: songs attributes.name: expected string."]);
    expect(rowsOf("getSongs")).toEqual(["≠ getSongs: types: songs attributes.name: expected string."]);
    expect(stdout.slice(stdout.indexOf("Differences from the types"))).toBe(["Differences from the types (1):", "  songs attributes.name: expected string", "    getSong, getSongs", ""].join(LF));
  });

  test("more than three ways are said as the first three and how many more; a type Apple names that no answer documents is a resource; and what differs outside any resource names none", async () => {
    apple.answers["/v1/catalog/gb/songs/s1"] = { data: [{ id: "s1", type: "songs", attributes: {} }] };
    apple.answers["/v1/catalog/gb/albums/a1"] = { data: [{ ...item("albums", "a1"), type: "mystery" }] };
    apple.answers["/v1/catalog/gb/playlists/pl.chart1"] = { data: "none", also: item("playlists", "pl.chart1") };
    expect(await main(["check", "getSong", "getAlbum", "getPlaylist", "--no-color"])).toBe(1);
    expect(rowsOf("getSong")[0]).toMatch(/^≠ getSong: types: songs [\w.]+: required; songs [\w.]+: required; songs [\w.]+: required \(and \d+ more\)\.$/);
    expect(rowsOf("getAlbum")).toEqual(['≠ getAlbum: types: resource type: expected "albums".']);
    expect(rowsOf("getPlaylist")).toEqual(["≠ getPlaylist: types: data: expected array."]);
  });

  test("a function with names gives one ✓ line for those that held, and a line of its own for each that did not", async () => {
    apple.answers["/v1/catalog/gb/artists/x/view/top-songs"] = { data: [{ id: "s1", type: "songs" }], attributes: {} };
    expect(await main(["check", "getArtistView", "--no-color"])).toBe(1);
    const lines = rowsOf("getArtistView");
    expect(lines[0]).toBe("✓ getArtistView: 11 of 12 views as the types have them.");
    // The view's own attributes are in no resource, and the song's href is in the song.
    expect(lines.slice(1)).toEqual(["≠ getArtistView:top-songs: types: attributes.title: required; songs href: required."]);
  });

  test("a view whose page 1 comes without the attributes asked for is ≠: the type leaves them optional, since Apple sends them only when asked", async () => {
    apple.answers["/v1/catalog/gb/artists/x/view/top-songs"] = { data: [item("songs", "s1")] };
    expect(await main(["check", "getArtistView:top-songs", "--no-color"])).toBe(1);
    expect(rowsOf("getArtistView")).toEqual(['≠ getArtistView:top-songs: Apple sent no attributes on page 1, though they were asked for with with: ["attributes"].']);
  });

  test("one name of a function is asked alone by function:name, its next page too", async () => {
    expect(await main(["check", "getArtistView:top-songs", "--no-color"])).toBe(0);
    expect(stdout.split(LF).filter((line) => /^. get/.test(line))).toEqual(["✓ getArtistView:top-songs: as the types have it, and page 2 too, by its next link, which carries offset."]);
    expect(pathsOf(asked).filter((path) => path.includes("/view/"))).toEqual(["/v1/catalog/gb/artists/x/view/top-songs", "/v1/catalog/gb/artists/x/view/top-songs"]);
  });

  test.each(["getArtistView:nothing", "getSong:albums", "addToLibrary:albums", "nothing:at-all"])("%s is not a name: exit 2, before Apple is asked", async (name) => {
    expect(await main(["check", name])).toBe(2);
    expect(stderr).toContain(`There is no check '${name}'`);
    expect(asked).toEqual([]);
  });

  test("a package named is its functions and its questions, and no other package's", async () => {
    expect(await main(["check", "client-catalog", "--no-color"])).toBe(0);
    expect(rowsOf("getSong")).toHaveLength(1);
    expect(marksOf("search-next")).not.toEqual([]);
    expect(rowsOf("getLibrarySong")).toEqual([]);
    expect(marksOf("recently-played-types")).toEqual([]);
    expect(stdout).not.toContain(`${LF}client-user${LF}`);
  });

  test("a package named without --write runs its reads alone, and says nothing of a mistake", async () => {
    expect(await main(["check", "client-user", "--no-color"])).toBe(0);
    expect(rowsOf("getLibrarySong")).toHaveLength(1);
    expect(marksOf("recently-played-types")).not.toEqual([]);
    expect(marksOf("add-to-library")).toEqual([]);
    expect(marksOf("setSongRating")).toEqual([]);
    expect(asked.filter((req) => req.method !== "GET")).toEqual([]);
  });

  test("a package named with --write runs its writes too: its questions that write, and its round trips", async () => {
    expect(await main(["check", "client-user", "--write", "--no-color"])).toBe(0);
    expect(marksOf("add-to-library")).not.toEqual([]);
    for (const id of ["setSongRating", "setLibraryPlaylistRating", "createLibraryPlaylistFolder"]) expect(marksOf(id), id).toContain("✓");
    expect(marksOf("playlist")).toEqual([]);
  });

  test.each([
    ["addToLibrary", "add-to-library"],
    ["getSongRating", "setSongRating"],
    ["deleteLibraryAlbumRating", "setLibraryAlbumRating"],
    ["createLibraryPlaylistFolder", "createLibraryPlaylistFolder"],
  ])("%s runs %s, which writes, so without --write it is refused before Apple is asked", async (fn, to) => {
    expect(await main(["check", fn])).toBe(2);
    expect(stderr).toContain(`${to} writes to your library, and runs only with --write.`);
    expect(asked).toEqual([]);
  });

  test("a function a check asks runs that check alone, with --write", async () => {
    expect(await main(["check", "deleteSongRating", "--write", "--no-color"])).toBe(0);
    expect(marksOf("setSongRating")).toEqual(["✓"]);
    expect(marksOf("add-to-library")).toEqual([]);
    expect(stdout).not.toMatch(/^. get/m);
  });

  test("a 404 is asked again with the next of five, and five 404s are -, not ✗: Apple holds none here", async () => {
    for (const n of [1, 2, 3, 4, 5]) apple.failing[`/v1/catalog/gb/songs/s${String(n)}/composers`] = 404;
    expect(await main(["check", "getSongRelationship:composers", "--no-color"])).toBe(0);
    expect(rowsOf("getSongRelationship")).toEqual(["- getSongRelationship:composers: Apple held none here: it answered 404, or with nothing, for each one asked, so its shape was not seen."]);
    expect(pathsOf(asked).filter((path) => path.endsWith("/composers"))).toHaveLength(5);
  });

  test("an answer of resources of any type holds each to its own type's validator: an album in what was played is held to an album's", async () => {
    const album = item("albums", "r0");
    (album.attributes as tBody).name = 7;
    apple.answers["/v1/me/recent/played"] = { data: [album, { id: "x", type: "no-such-type" }] };
    expect(await main(["check", "listRecentlyPlayed", "--no-color"])).toBe(1);
    expect(rowsOf("listRecentlyPlayed")).toEqual(["≠ listRecentlyPlayed: types: albums attributes.name: expected string."]);
  });

  test("a function asked by an id Apple gave in another answer, answered 404 for it, is ≠ at once: the request the SDK made may be wrong", async () => {
    apple.failing["/v1/catalog/gb/songs/s1"] = 404;
    expect(await main(["check", "getSong", "--no-color"])).toBe(1);
    expect(rowsOf("getSong")).toEqual(["≠ getSong: Apple answered 404 for what it gave the ids of in another answer."]);
    expect(pathsOf(asked).filter((path) => /^\/v1\/catalog\/gb\/songs\/s\d+$/.test(path))).toEqual(["/v1/catalog/gb/songs/s1"]);
  });

  test("what there always is, such as the genres, answered with nothing is ≠", async () => {
    apple.answers["/v1/catalog/gb/genres"] = { data: [] };
    expect(await main(["check", "listGenres", "--no-color"])).toBe(1);
    expect(rowsOf("listGenres")).toEqual(["≠ listGenres: Apple answered with nothing for the genres."]);
  });

  test("an answer with nothing in it is no ✓: the next is asked, and the first that holds something is held to the type", async () => {
    for (const n of [1, 2, 3]) apple.answers[`/v1/catalog/gb/songs/s${String(n)}/composers`] = { data: [] };
    expect(await main(["check", "getSongRelationship:composers", "--no-color"])).toBe(0);
    expect(marksOf("getSongRelationship:composers")).toEqual(["✓"]);
    expect(pathsOf(asked).filter((path) => path.endsWith("/composers"))).toEqual(["/v1/catalog/gb/songs/s1/composers", "/v1/catalog/gb/songs/s2/composers", "/v1/catalog/gb/songs/s3/composers", "/v1/catalog/gb/songs/s4/composers", "/v1/catalog/gb/songs/s4/composers"]);
  });

  test("a function Apple fails is ✗, naming the request, and the rows after it are still asked", async () => {
    apple.failing["/v1/me/history/heavy-rotation"] = 500;
    expect(await finish(["check", "listHeavyRotation", "listRecentlyAdded", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(rowsOf("listHeavyRotation")).toEqual(["✗ listHeavyRotation: Apple answered 500, code 50001 (at /v1/me/history/heavy-rotation), so this was not answered."]);
    expect(marksOf("listRecentlyAdded")).toEqual(["✓"]);
  });

  test("what the sweep did not expect is ✗ on stdout without what was thrown, which goes to stderr", async () => {
    // A next link that leaves Apple's origin, which core refuses with a TypeError before anything is sent.
    apple.answers["/v1/catalog/gb/genres"] = valid(schemas.genresResponse, { data: [item("genres", "g1")], next: "https://elsewhere.example/v1/catalog/gb/genres?offset=1" });
    expect(await main(["check", "listGenres", "--no-color"])).toBe(1);
    expect(rowsOf("listGenres")).toEqual(["✗ listGenres: something went wrong that check did not expect, so this was not answered. This is a bug: please report it, with what stderr says."]);
    expect(stdout).not.toContain("elsewhere");
    expect(stderr).toContain("elsewhere.example");
  });

  test("a page 2 that differs where page 1 does not is put down to its next link, and is no difference of the types'", async () => {
    const genre = item("genres", "g2");
    (genre.attributes as tBody).name = 7;
    apple.answers["/v1/catalog/gb/genres?offset=1"] = { data: [genre] };
    expect(await main(["check", "listGenres", "--no-color"])).toBe(1);
    expect(rowsOf("listGenres")).toEqual([
      "≠ listGenres: page 1 is as the types have it, and page 2, by its next link, which carries offset, is not: genres attributes.name: expected string. The link may leave out what page 1 was asked with, and core's paginate sends it as Apple gave it.",
    ]);
    expect(stdout).not.toContain("Differences from the types");
  });

  test("a function the run found nothing to ask with is -, and stderr says what was not found", async () => {
    for (const album of apple.albums) delete (album.attributes as tBody).upc;
    expect(await main(["check", "getAlbumsByUpc", "--no-color"])).toBe(0);
    expect(rowsOf("getAlbumsByUpc")).toEqual(["- getAlbumsByUpc: not asked, since there was nothing to ask it with (stderr says why)"]);
    expect(stderr).toContain("  getAlbumsByUpc: no UPC of a chart album was found to ask it with.");
  });

  test("record labels, curators and activities the charts lead to none of are found by a search of their own", async () => {
    for (const album of apple.albums.slice(0, 5)) apple.failing[`/v1/catalog/gb/albums/${String(album.id)}/record-labels`] = 404;
    for (const playlist of apple.playlists) apple.failing[`/v1/catalog/gb/playlists/${String(playlist.id)}/curator`] = 404;
    expect(await main(["check", "getRecordLabel", "getCurator", "getAppleCurator", "getActivity", "--no-color"])).toBe(0);
    for (const type of ["record-labels", "curators", "apple-curators", "activities"]) {
      expect(asked.some((req) => new URL(req.url).pathname === "/v1/catalog/gb/search" && new URL(req.url).searchParams.get("types") === type), type).toBe(true);
      expect(pathsOf(asked), type).toContain(`/v1/catalog/gb/${type}/${type}.s`);
    }
  });

  test("a curator the chart's playlists lead to is asked by its type, and the other type is searched for", async () => {
    for (const playlist of apple.playlists) apple.answers[`/v1/catalog/gb/playlists/${String(playlist.id)}/curator`] = { data: [item("apple-curators", "ac1")] };
    expect(await main(["check", "getAppleCurator", "getCurator", "--no-color"])).toBe(0);
    expect(pathsOf(asked)).toContain("/v1/catalog/gb/apple-curators/ac1");
    expect(pathsOf(asked)).toContain("/v1/catalog/gb/curators/curators.s");
  });

  test("live radio stations that answer none are found by a search", async () => {
    apple.answers["/v1/catalog/gb/stations?filter%5Bfeatured%5D=apple-music-live-radio"] = { data: [] };
    expect(await main(["check", "getStation", "--no-color"])).toBe(0);
    expect(pathsOf(asked)).toContain("/v1/catalog/gb/stations/stations.s");
  });

  test("a storefront with no language of its own, a root folder holding no folder and an empty library are not asked about where they lead", async () => {
    const storefront = item("storefronts", "gb");
    delete (storefront.attributes as tBody).defaultLanguageTag;
    apple.answers["/v1/storefronts/gb"] = { data: [storefront] };
    apple.folders = [];
    apple.answers["/v1/me/library/songs"] = { data: [] };
    expect(await main(["check", "getLanguageTag", "getSong", "getLibraryPlaylistFolderRelationship", "searchLibrary", "--no-color"])).toBe(0);
    expect(marksOf("getLanguageTag")).toEqual(["-"]);
    expect(asked.find((req) => new URL(req.url).pathname === "/v1/catalog/gb/songs/s1")?.url).not.toContain("l=");
    expect(rowsOf("getLibraryPlaylistFolderRelationship")).toEqual([
      "✓ getLibraryPlaylistFolderRelationship: 1 of 2 relationships as the types have them.",
      "- getLibraryPlaylistFolderRelationship:parent: not asked, since there was nothing to ask it with (stderr says why)",
    ]);
    expect(stderr).toContain("getLibraryPlaylistFolderRelationship:parent: no playlist folder in your library was found to ask it with.");
    expect(marksOf("searchLibrary")).toEqual(["-"]);
  });

  test("a root folder Apple answers none for by its identity is ≠, since there always is one, and the root its children were found under is asked for them", async () => {
    apple.answers["/v1/me/library/playlist-folders?filter%5Bidentity%5D=playlistsroot"] = { data: [] };
    expect(await main(["check", "getLibraryPlaylistFolderRelationship", "getRootLibraryPlaylistFolder", "--no-color"])).toBe(1);
    expect(rowsOf("getRootLibraryPlaylistFolder")).toEqual(["≠ getRootLibraryPlaylistFolder: Apple answered with nothing for the listener's root folder."]);
    expect(rowsOf("getLibraryPlaylistFolderRelationship")).toEqual(["✓ getLibraryPlaylistFolderRelationship: 2 of 2 relationships as the types have them."]);
    expect(pathsOf(asked)).toContain("/v1/me/library/playlist-folders/p.playlistsroot/children");
  });

  test("a folder is read by its id as one in the root, before the root itself, which may be a 404 by its id", async () => {
    expect(await main(["check", "getLibraryPlaylistFolder", "getLibraryPlaylistFolders", "--no-color"])).toBe(0);
    expect(pathsOf(asked)).toContain("/v1/me/library/playlist-folders/p.folder");
    expect(asked.find((req) => new URL(req.url).searchParams.has("ids") && new URL(req.url).pathname === "/v1/me/library/playlist-folders")?.url).toContain("ids=p.folder%2Cp.playlistsroot");
  });

  test("a read run's report says nothing of the listener's library: no id, no name and no search term, only whether each answer held to its type", async () => {
    apple.answers["/v1/me/library/songs?limit=5"] = { data: [item("library-songs", "i.s1", { name: "Theirs alone" })] };
    await main(["check", "--no-color"]);
    // The library is searched for the first word of a song's name, as a whole name of several words found nothing.
    expect(asked.some((req) => new URL(req.url).pathname === "/v1/me/library/search" && new URL(req.url).searchParams.get("term") === "Theirs")).toBe(true);
    expect(stdout).not.toContain("Theirs");
    expect(stdout).not.toMatch(/\b[pil]\.\w/);
    expect(stdout).not.toMatch(/library-\w+\.\d/);
  });

  test("Ctrl+C while the sweep is under way stops it: exit 130, and nothing left unhandled", async () => {
    const before = new Set(process.listeners("SIGINT"));
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname === "/v1/catalog/gb/genres") {
        asked.push(req);
        return new Promise<Response>((_resolve, reject) => {
          req.signal.addEventListener("abort", () => {
            reject(req.signal.reason as Error);
          });
        });
      }
      return real(req);
    });
    const running = main(["check", "client-catalog", "--no-color"]);
    await vi.waitFor(() => {
      expect(pathsOf(asked)).toContain("/v1/catalog/gb/genres");
    });
    process.listeners("SIGINT").find((listener) => !before.has(listener))?.("SIGINT");
    expect(await running).toBe(130);
    expect(stderr).toContain("Stopped.");
  });

  test("help lists every function by its package, the round trips, the functions a question asks, and the packages", async () => {
    expect(await main(["help", "check"])).toBe(0);
    for (const { fn, entry } of ROWS) {
      expect(stdout, fn).toContain(entry.kind === "row" && entry.names === undefined ? `${fn},` : fn);
      // Each name of a function too, as it is named: getArtistView (appears-on-albums, …, top-songs).
      if (entry.kind === "row" && entry.names !== undefined) for (const name of entry.names) expect(stdout, `${fn}:${name}`).toMatch(new RegExp(`[( ]${name}[,)]`));
    }
    expect(stdout).toMatch(/getArtistView\s+\(appears-on-albums,/);
    expect(stdout).toContain("addToLibrary (add-to-library),");
    expect(stdout).toContain("Packages, each its functions and its questions: client-catalog, client-user, lib-playlists, util-artwork, lib-preview-player, user-token.");
  });
});

describe("rating round trips: a dislike set on what the listener had not rated, read back, and taken away again", () => {
  test("each type's is ✓ when Apple keeps it as client-user has it, and nothing is left to undo", async () => {
    expect(await main(["check", "setSongRating", "setStationRating", "setLibraryPlaylistRating", "--write", "--no-color"])).toBe(0);
    for (const id of ["setSongRating", "setStationRating", "setLibraryPlaylistRating"])
      expect(linesOf(id), id).toEqual([`✓ ${id}: a rating of -1 was set, and read back alone and in a batch after 0 seconds, and was gone after 0 seconds once taken away, as client-user has it.`]);
    expect(stderr).not.toContain("Take away the dislike");
    // Only what check set was set, and it is gone again.
    expect([...apple.rated.keys()]).toEqual(["s1"]);
  });

  test("a catalog item is picked only when it is neither rated nor in the library", async () => {
    apple.rated.set("s2", -1);
    apple.library.add("songs/s3");
    await main(["check", "setSongRating", "--write", "--no-color"]);
    expect(asked.filter((req) => req.method === "PUT").map((req) => new URL(req.url).pathname)).toEqual(["/v1/me/ratings/songs/s4"]);
  });

  test("a rating Apple answers in a shape not foreseen is still a rating, so nothing the listener rated is rated over or made a favorite", async () => {
    apple.answers["/v1/me/ratings/songs/s2"] = { data: [{ id: "s2", type: "ratings", attributes: {} }] };
    await main(["check", "setSongRating", "add-to-favorites", "--write", "--no-color"]);
    // s1 is rated, s2 answered with a rating of no value, and s3 made the favorite first, so s4 is rated.
    expect(asked.filter((req) => req.method === "PUT").map((req) => new URL(req.url).pathname)).toEqual(["/v1/me/ratings/songs/s4"]);
    expect(asked.filter((req) => req.method === "POST" && new URL(req.url).pathname === "/v1/me/favorites").map((req) => new URL(req.url).searchParams.get("ids[songs]"))).toEqual(["s3"]);
  });

  test("a rating whose taking away is answered 404 is no rating left for the steps", async () => {
    apple.rating.deleteFails = 404;
    await main(["check", "setSongRating", "--write", "--no-color"]);
    expect(stderr).toContain("Taking away the ratings check set…");
    expect(stderr).not.toContain("Take away the dislike");
  });

  test("none of the first five to be picked is -, and nothing is set", async () => {
    for (const song of apple.songs.slice(0, 5)) apple.rated.set(String(song.id), 1);
    await main(["check", "setSongRating", "--write", "--no-color"]);
    expect(linesOf("setSongRating")).toEqual(["- setSongRating: not asked, since nothing could be picked to ask it of (stderr says why)"]);
    expect(stderr).toContain("  setSongRating: none of the first five could be picked: each was rated, or in your library.");
  });

  test("a station is never in a library, so one is passed over for being rated alone", async () => {
    apple.rated.set("stations/stations.f", 1);
    await main(["check", "setStationRating", "--write", "--no-color"]);
    expect(stderr).toContain("  setStationRating: none of the first five could be picked: each was rated.");
    expect(asked.filter((req) => req.method === "PUT")).toEqual([]);
  });

  test("a rating Apple refuses to set is ✗, and leaves nothing to undo", async () => {
    apple.rating.refuse = 400;
    expect(await main(["check", "setAlbumRating", "--write", "--no-color"])).toBe(1);
    expect(linesOf("setAlbumRating")).toEqual(["✗ setAlbumRating: Apple refused a rating of -1: Apple answered 400, code 40001 (at /v1/me/ratings/albums/{id})."]);
    expect(asked.filter((req) => req.method === "DELETE")).toEqual([]);
    expect(stderr).not.toContain("To undo");
  });

  test("a rating that never shows, and is left out of a batch, is ≠, each way said", async () => {
    apple.rating = { hidden: true, batchLeavesOut: true };
    expect(await finish(["check", "setSongRating", "--write", "--no-color"])).toBe(1);
    expect(linesOf("setSongRating")).toEqual(["≠ setSongRating: a rating of -1 was set, but it did not show within a minute; a batch of its ratings left it out."]);
  });

  test("a rating still there a minute after it was taken away is ≠, and the run takes it away again as it ends", async () => {
    apple.rating = { deleteStays: true };
    expect(await finish(["check", "setSongRating", "--write", "--no-color"])).toBe(1);
    expect(linesOf("setSongRating")).toEqual(["≠ setSongRating: a rating of -1 was set, but it was still there a minute after it was taken away."]);
    expect(stderr).toContain("Taking away the ratings check set…");
    expect(asked.filter((req) => req.method === "DELETE")).toHaveLength(2);
  });

  test("a rating read back as something else is ≠, and what Apple answered that differs from the types is a line of its own", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      // Once set, the rating reads back as a like, with an href that is no string.
      if (req.method === "GET" && apple.rated.has("s2") && new URL(req.url).pathname === "/v1/me/ratings/songs/s2") {
        asked.push(req);
        return Promise.resolve(json({ data: [{ ...item("ratings", "s2", { value: 1 }), href: 7 }] }));
      }
      return real(req);
    });
    expect(await main(["check", "setSongRating", "--write", "--no-color"])).toBe(1);
    expect(linesOf("setSongRating")).toEqual(["≠ setSongRating: types: ratings href: expected string.", "≠ setSongRating: a rating of -1 was set, but it was read back as 1."]);
    // A round trip's differences from the types are in the run's list of them, as the rows' are.
    expect(stdout.slice(stdout.indexOf("Differences from the types"))).toBe(["Differences from the types (1):", "  ratings href: expected string", "    setSongRating", ""].join(LF));
  });

  test("a rating the run could not take away is taken away when the run ends, and one that cannot be is a step of the cleanup", async () => {
    apple.rating.deleteFails = 500;
    expect(await finish(["check", "setSongRating", "--write", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(marksOf("setSongRating")).toEqual(["✗"]);
    expect(stderr).toContain("Taking away the ratings check set…");
    expect(asked.filter((req) => req.method === "DELETE").length).toBeGreaterThan(1);
    expect(cleanupOf()).toContain('Take away the dislike check set on each of these, which it could not take away itself: open each, and take it away from the … menu on its page.');
    expect(cleanupOf()).toContain('- the song "Name of s2" by Artist of s2: https://music.apple.com/gb/song/s2');
  });

  test("Ctrl+C after a rating is set takes it away through the API before the run ends", async () => {
    const before = new Set(process.listeners("SIGINT"));
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      // The rating set is never read back, until the request is aborted.
      if (req.method === "GET" && apple.rated.has("s2") && new URL(req.url).pathname === "/v1/me/ratings/songs/s2")
        return new Promise<Response>((_resolve, reject) => {
          req.signal.addEventListener("abort", () => {
            reject(req.signal.reason as Error);
          });
        });
      return real(req);
    });
    const running = main(["check", "setSongRating", "--write", "--no-color"]);
    await vi.waitFor(() => {
      expect(apple.rated.get("s2")).toBe(-1);
    });
    process.listeners("SIGINT").find((listener) => !before.has(listener))?.("SIGINT");
    expect(await running).toBe(130);
    expect(apple.rated.has("s2")).toBe(false);
    expect(stderr).not.toContain("Take away the dislike");
  });

  test("a library copy is one check added, which is rated, read back and taken away, and its catalog item is looked at too", async () => {
    expect(await main(["check", "setLibrarySongRating", "--write", "--no-color"])).toBe(0);
    expect(linesOf("setLibrarySongRating")).toEqual([
      "✓ setLibrarySongRating: a rating of -1 was set, and read back alone and in a batch after 0 seconds, and was gone after 0 seconds once taken away, as client-user has it.",
      "· setLibrarySongRating: the catalog item it is a copy of did not take the rating.",
    ]);
    // s1 is rated, so s2 was added, and its copy rated.
    expect(asked.filter((req) => req.method === "PUT").map((req) => new URL(req.url).pathname)).toEqual(["/v1/me/ratings/library-songs/l.s2"]);
    expect(cleanupOf()).toContain('- the song "Name of s2" by Artist of s2: https://music.apple.com/gb/song/s2');
  });

  test("a catalog item that takes the copy's rating, and keeps it, has it taken away by the run, since it had none before", async () => {
    apple.rating.linked = true;
    expect(await main(["check", "setLibraryAlbumRating", "--write", "--no-color"])).toBe(0);
    expect(linesOf("setLibraryAlbumRating")[1]).toBe("· setLibraryAlbumRating: the catalog item it is a copy of took the rating too, and kept it once the copy's was taken away.");
    expect([...apple.rated.keys()]).toEqual(["s1"]);
  });

  test("a copy whose catalog item is rated by the time it is asked about is not rated, so nothing of the listener's goes with it", async () => {
    apple.ratedOnAdd = true;
    expect(await main(["check", "setLibrarySongRating", "--write", "--no-color"])).toBe(0);
    expect(linesOf("setLibrarySongRating")).toEqual(["- setLibrarySongRating: the catalog item of what check added is rated, so its copy is not: a rating of the one may be the other's"]);
    expect(asked.filter((req) => req.method === "PUT")).toEqual([]);
  });

  test.each([
    ["the charts hold no song to add", () => (apple.songs = []), "not asked, since nothing could be picked to ask it of (stderr says why)"],
    ["Apple refuses to add one", () => (apple.addStatus.songs = 400), "Apple refused to add one to your library: Apple answered 400, code 40001"],
    ["what was added never shows", () => (apple.addedUnseen = true), "the songs added did not show in your library within a minute"],
  ])("a library copy is not rated when %s: -", async (_what, arrange, words) => {
    arrange();
    await finish(["check", "setLibrarySongRating", "--write", "--no-color"]);
    expect(linesOf("setLibrarySongRating")).toEqual([`- setLibrarySongRating: ${words}`]);
  });

  test.each([
    ["holds no playlist in its answer", () => (apple.madeWithId = false), "the answer to making a playlist held none to rate"],
    ["cannot be read by its id within a minute", () => (apple.lag.readable = 1000), "the playlist made could not be read by its id within a minute"],
  ])("the playlist made to rate that %s is not rated: -", async (_what, arrange, words) => {
    arrange();
    await finish(["check", "setLibraryPlaylistRating", "--write", "--no-color"]);
    expect(linesOf("setLibraryPlaylistRating")).toEqual([`- setLibraryPlaylistRating: ${words}`]);
    expect(cleanupOf()).toMatch(/Delete every playlist named "open-music-sdk check .* UTC \(for a rating\)"/);
  });

  test("a playlist made to rate that reads by its id as another is not rated: nothing is written to what may be the listener's", async () => {
    apple.answers["/v1/me/library/playlists/p.made2"] = { data: [asPlaylist(had("p.made2", [], "Theirs"), false)] };
    await main(["check", "setLibraryPlaylistRating", "--write", "--no-color"]);
    expect(linesOf("setLibraryPlaylistRating")).toEqual(["- setLibraryPlaylistRating: the playlist read by the id Apple gave has another name, so it is not rated"]);
    expect(asked.filter((req) => req.method === "PUT")).toEqual([]);
  });

  test("a playlist made to rate whose making Apple refuses leaves nothing to undo, and the round trip is ✗", async () => {
    apple.failing["/v1/me/library/playlists"] = 400;
    expect(await main(["check", "setLibraryPlaylistRating", "--write", "--no-color"])).toBe(1);
    expect(marksOf("setLibraryPlaylistRating")).toEqual(["✗"]);
    expect(stderr).not.toContain("To undo");
  });
});

describe("createLibraryPlaylistFolder: a folder made, read back, and its parent asked for", () => {
  test("one made in the root, read by its id and among the root's children, with the root for its parent, is ✓, and the cleanup says to delete it", async () => {
    expect(await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(0);
    expect(linesOf("createLibraryPlaylistFolder")).toEqual(["✓ createLibraryPlaylistFolder: a folder was made, could be read by its id after 0 seconds, was among the root folder's children after 0 seconds, and has the root for its parent."]);
    expect(cleanupOf()).toMatch(/1\. Delete the playlist folder named "open-music-sdk check .* UTC": it is among your playlists in the Music app on a Mac, iPhone or iPad/);
  });

  test("a folder made in a root of more than a page of children is looked for on every page", async () => {
    apple.folders.push(...Array.from({ length: 150 }, (_, i) => ({ id: `p.had${String(i)}`, name: `Had ${String(i)}` })));
    expect(await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(0);
    expect(marksOf("createLibraryPlaylistFolder")).toEqual(["✓"]);
    expect(asked.some((req) => new URL(req.url).pathname.endsWith("/children") && new URL(req.url).searchParams.get("offset") === "100")).toBe(true);
  });

  test("a folder that shows among the root's children late is waited for, a walk at a time", async () => {
    let walks = 0;
    const real = answer;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const res = await real(req);
      if (!new URL(req.url).pathname.endsWith("/p.playlistsroot/children") || ++walks > 3) return res;
      // The first three walks of the root find the folder not yet there.
      const body = (await res.json()) as { data: tBody[] };
      return Response.json({ ...body, data: body.data.filter((child) => child.id !== "p.f1") });
    });
    expect(await finish(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(0);
    expect(linesOf("createLibraryPlaylistFolder")[0]).toMatch(/was among the root folder's children after [1-9]\d* seconds?/);
  });

  test("a folder Apple refuses to make is ✗, and leaves nothing to undo", async () => {
    apple.folder.refuse = 400;
    expect(await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(1);
    expect(linesOf("createLibraryPlaylistFolder")).toEqual(["✗ createLibraryPlaylistFolder: Apple refused to make a playlist folder: Apple answered 400, code 40001 (at /v1/me/library/playlist-folders)."]);
    expect(stderr).not.toContain("To undo");
  });

  test("an answer that holds no folder cannot be asked more of, and the folder is still in the cleanup", async () => {
    apple.folder.withId = false;
    await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"]);
    expect(linesOf("createLibraryPlaylistFolder")).toEqual(["- createLibraryPlaylistFolder: the answer to making a playlist folder held none, so nothing more can be asked of it"]);
    expect(cleanupOf()).toContain("Delete the playlist folder named");
  });

  test("a folder that never shows is ≠, each way said", async () => {
    apple.folder.unseen = true;
    expect(await finish(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(1);
    expect(linesOf("createLibraryPlaylistFolder")).toEqual(["≠ createLibraryPlaylistFolder: a folder was made, but it could not be read by its id within a minute; it was not among the root folder's children within a minute."]);
  });

  test("a folder whose making is answered unlike its type is ≠ for that, as a line of its own", async () => {
    const folder = item("library-playlist-folders", "p.f1", { name: "made" });
    (folder.attributes as tBody).name = 7;
    apple.answers["/v1/me/library/playlist-folders/p.f1"] = { data: [folder] };
    expect(await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(1);
    expect(linesOf("createLibraryPlaylistFolder")).toEqual([
      "≠ createLibraryPlaylistFolder: types: library-playlist-folders attributes.name: expected string.",
      "✓ createLibraryPlaylistFolder: a folder was made, could be read by its id after 0 seconds, was among the root folder's children after 0 seconds, and has the root for its parent.",
    ]);
  });

  test("a folder whose parent is not the root is ≠", async () => {
    apple.answers["/v1/me/library/playlist-folders/p.f1/parent"] = { data: [item("library-playlist-folders", "p.folder", { name: "Folder" })] };
    expect(await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(1);
    expect(linesOf("createLibraryPlaylistFolder")).toEqual(["≠ createLibraryPlaylistFolder: a folder was made, but its parent was not the root folder."]);
  });
});

describe("a 429 stops the run: the key is likely the app's too, and a run that went on would keep it limited for the app's listeners", () => {
  test("the first 429 stops everything under way at once: exit 1, saying why, with nothing more asked of Apple", async () => {
    apple.failing["/v1/catalog/gb/genres"] = 429;
    expect(await main(["check", "client-catalog", "--no-color"])).toBe(1);
    expect(stderr).toContain("Error: Apple is limiting requests for this key, so check stopped rather than keep it limited for your app's listeners too. Try again later.");
    // The 429 is not tried again, though core tries a read again after one, and no question is asked after it.
    const genres = asked.filter((req) => new URL(req.url).pathname === "/v1/catalog/gb/genres").map((req) => req.url);
    expect(new Set(genres).size).toBe(genres.length);
    expect(stderr).not.toContain("Asking: search-next");
  });

  test("a 429 while a rating is set still takes the rating away through the API, and the cleanup is printed", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "GET" && apple.rated.has("s2") && new URL(req.url).pathname === "/v1/me/ratings/songs/s2") {
        asked.push(req);
        return Promise.resolve(refuse(429));
      }
      return real(req);
    });
    expect(await main(["check", "setSongRating", "--write", "--no-color"])).toBe(1);
    expect(stderr).toContain("Apple is limiting requests for this key");
    expect(apple.rated.has("s2")).toBe(false);
  });

  test("a poll for the new playlist among a large library waits a second for each page it walked before the next", async () => {
    apple.listener.push(...Array.from({ length: 250 }, (_, i) => had(`p.n${String(i)}`, [])));
    apple.lag.listed = 12;
    await finish(["check", "playlist", "--write", "--no-color"]);
    // Three pages a walk, a walk every three seconds for the twelve seconds it takes to be listed: a walk a second
    // would have made 39 for the poll alone, before apply's own.
    const lists = asked.filter((req) => req.method === "GET" && new URL(req.url).pathname === "/v1/me/library/playlists");
    expect(lists.length).toBeLessThan(13 * 3);
    expect(linesOf("playlist")).toContain("· playlist: the new playlist could be read by its id after 0 seconds, and was among the library's playlists after 12 seconds; apply's settle waits about 9 seconds.");
  });
});

describe("an album is added, or its songs, only when the listener holds none of its tracks: deleting it takes every track with it", () => {
  test("an album one of whose songs the listener holds is not the one added", async () => {
    apple.library.add("songs/a1t3");
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).not.toContain('"Name of a1"');
    expect(cleanupOf()).toContain('- the album "Name of a2" by Artist of a2, with its songs');
  });

  test("an album one of whose music videos the listener holds gives the playlist no songs, and is not among the albums to delete", async () => {
    apple.library.add("music-videos/a1v");
    await main(["check", "playlist", "--write", "--no-color"]);
    expect(cleanupOf()).not.toContain('"Name of a1"');
    expect(cleanupOf()).toContain('"Name of a26"');
  });

  test("an album whose tracks Apple answers 404 for has none of them held", async () => {
    apple.failing["/v1/catalog/gb/albums/a1/tracks"] = 404;
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).toContain('- the album "Name of a1" by Artist of a1, with its songs');
  });

  test("a track with no id, or of no type a library holds, is none the listener holds", async () => {
    apple.answers["/v1/catalog/gb/albums/a1/tracks"] = { data: [{ type: "songs" }, { id: "x1", type: "stations" }] };
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(cleanupOf()).toContain('- the album "Name of a1" by Artist of a1, with its songs');
  });
});

describe("add-to-library, as the sweep's own additions are made", () => {
  test("an album counts as in the library once one song of it is, or does not, and either is said", async () => {
    apple.partlyHeldCounts = true;
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(linesOf("add-to-library")).toContain("· add-to-library: the album of the song added counts as in the library, with that one song of it there.");
  });

  test("a song whose album is in the library already is not the one added, so what the album counts as is the song's doing alone", async () => {
    apple.rated.clear();
    apple.library.add("albums/s1al");
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(asked.filter((req) => req.method === "POST").map((req) => new URL(req.url).searchParams.get("ids[songs]"))).toContain("s2");
  });

  test("no song whose album was not held already is no song added, and nothing is said of the album", async () => {
    apple.rated.clear();
    for (const n of [1, 2, 3, 4, 5]) apple.library.add(`albums/s${String(n)}al`);
    await main(["check", "add-to-library", "--write", "--no-color"]);
    expect(linesOf("add-to-library")[0]).toContain("songs not asked (stderr says why)");
    expect(linesOf("add-to-library").some((line) => line.includes("album of the song"))).toBe(false);
  });

  test("the first library relationship of a type that differs from its type is ≠, once", async () => {
    // s1 is the listener's, its copy answered unlike the type; s2 is not, and is added.
    apple.rated.clear();
    apple.library.add("songs/s1");
    apple.answers["/v1/catalog/gb/songs/s1/library"] = { data: [{ id: "l.s1", type: "library-songs" }] };
    expect(await main(["check", "add-to-library", "--write", "--no-color"])).toBe(1);
    expect(linesOf("add-to-library").filter((line) => line.startsWith("≠"))).toEqual([expect.stringMatching(/^≠ add-to-library: the songs library relationship, which check asks by hand: types: library-songs \w+: required/)]);
  });
});

describe("artwork-formats and resolve-misses", () => {
  test("a format Apple's image server sends as another, or not at all, is ≠, naming each", async () => {
    apple.images.webp = "image/jpeg";
    apple.images.heic = 404;
    expect(await main(["check", "artwork-formats", "--no-color"])).toBe(1);
    expect(linesOf("artwork-formats")).toEqual([
      "· artwork-formats: one chart artwork, at 100 pixels in each format util-artwork offers: jpg, 200 image/jpeg; jpeg, 200 image/jpeg; png, 200 image/png; webp, 200 image/jpeg; heic, 404 no content type; heif, 200 image/heif.",
      "≠ artwork-formats: Apple's image server does not send webp, heic as asked, though util-artwork's FORMATS offers them.",
    ]);
  });

  test("an image server that does not answer is said so for each format", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).hostname.endsWith("mzstatic.com")) return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    expect(await main(["check", "artwork-formats", "--no-color"])).toBe(1);
    expect(linesOf("artwork-formats")[0]).toContain("jpg, no answer; jpeg, no answer");
    expect(linesOf("artwork-formats")[1]).toBe("≠ artwork-formats: Apple's image server does not send jpg, jpeg, png, webp, heic, heif as asked, though util-artwork's FORMATS offers them.");
  });

  test("the image server is asked with redirects refused, and with no token, so a URL on its host goes nowhere else", async () => {
    await main(["check", "artwork-formats", "--no-color"]);
    const images = asked.filter((req) => new URL(req.url).hostname.endsWith("mzstatic.com"));
    expect(images).toHaveLength(6);
    for (const req of images) {
      expect(req.redirect).toBe("error");
      expect(req.headers.get("authorization")).toBeNull();
      expect(req.headers.get("music-user-token")).toBeNull();
    }
  });

  test("one format alone sent wrong is said as it", async () => {
    apple.images.png = 500;
    await main(["check", "artwork-formats", "--no-color"]);
    expect(linesOf("artwork-formats")[1]).toBe("≠ artwork-formats: Apple's image server does not send png as asked, though util-artwork's FORMATS offers it.");
  });

  test("charts with no artwork are not asked about", async () => {
    for (const each of [...apple.songs, ...apple.albums, ...apple.playlists, ...apple.videos]) delete (each.attributes as tBody).artwork;
    await main(["check", "artwork-formats", "--no-color"]);
    expect(linesOf("artwork-formats")).toEqual(["- artwork-formats: nothing in the charts had artwork"]);
  });

  test("resolve, given the chart's songs by name, artist and album, reports how many it found and missed", async () => {
    await main(["check", "resolve-misses", "--no-color"]);
    expect(linesOf("resolve-misses")).toEqual([expect.stringMatching(/^· resolve-misses: resolve, given the name, artist and album of 30 chart songs and no ISRC, found \d+, \d+ of them the very song, and missed \d+\.$/)]);
  });

  test("charts with no song by an artist are not asked about", async () => {
    apple.songs = [];
    await main(["check", "resolve-misses", "--no-color"]);
    expect(linesOf("resolve-misses")).toEqual(["- resolve-misses: the charts held no song with an artist"]);
  });

  test("Ctrl+C while an image is asked for stops the question: exit 130", async () => {
    const before = new Set(process.listeners("SIGINT"));
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (!new URL(req.url).hostname.endsWith("mzstatic.com")) return real(req);
      asked.push(req);
      return new Promise<Response>((_resolve, reject) => {
        req.signal.addEventListener("abort", () => {
          reject(req.signal.reason as Error);
        });
      });
    });
    const running = main(["check", "artwork-formats", "--no-color"]);
    await vi.waitFor(() => {
      expect(asked.some((req) => new URL(req.url).hostname.endsWith("mzstatic.com"))).toBe(true);
    });
    process.listeners("SIGINT").find((listener) => !before.has(listener))?.("SIGINT");
    expect(await running).toBe(130);
  });
});

describe("what the sweep and its round trips say when Apple answers otherwise", () => {
  test("a field inside a list of a resource is said with [] for the list, and an answer that is no object at all is the answer", async () => {
    const song = item("songs", "s1");
    (song.attributes as tBody).previews = [{ url: 7 }];
    apple.answers["/v1/catalog/gb/songs/s1"] = { data: [song] };
    apple.answers["/v1/catalog/gb/albums/a1"] = [item("albums", "a1")];
    expect(await main(["check", "getSong", "getAlbum", "--no-color"])).toBe(1);
    expect(rowsOf("getSong")).toEqual(["≠ getSong: types: songs attributes.previews[].url: expected string."]);
    expect(rowsOf("getAlbum")).toEqual(["≠ getAlbum: types: the answer: expected object."]);
  });

  test("a next link that carries no query says so, and a page 2 with nothing in it is no difference", async () => {
    apple.answers["/v1/catalog/gb/genres"] = valid(schemas.genresResponse, { data: [item("genres", "g1")], next: "/v1/catalog/gb/genres/more" });
    apple.answers["/v1/catalog/gb/station-genres?offset=1"] = { data: [] };
    expect(await main(["check", "listGenres", "listStationGenres", "--no-color"])).toBe(0);
    expect(rowsOf("listGenres")).toEqual(["✓ listGenres: as the types have it, and page 2 too, by its next link, which carries nothing."]);
    expect(rowsOf("listStationGenres")).toEqual(["✓ listStationGenres: as the types have it; page 2, by its next link, which carries offset, held nothing."]);
  });

  test("a language tag Apple does not give is nothing seen: -", async () => {
    apple.answers["/v1/language/gb/tag"] = { results: {} };
    expect(await main(["check", "getLanguageTag", "--no-color"])).toBe(0);
    expect(marksOf("getLanguageTag")).toEqual(["-"]);
  });

  test("a song in the library with no name is no term to search the library for", async () => {
    apple.answers["/v1/me/library/songs?limit=5"] = { data: [{ id: "i.1", type: "library-songs", attributes: {} }] };
    expect(await main(["check", "searchLibrary", "--no-color"])).toBe(0);
    expect(marksOf("searchLibrary")).toEqual(["-"]);
  });

  test.each([
    ["the artists of a chart song", "/v1/catalog/gb/songs/s1/artists", "getArtist", "/v1/catalog/gb/songs/{id}/artists"],
    ["the curator of a chart playlist", "/v1/catalog/gb/playlists/pl.chart1/curator", "getCurator", "/v1/catalog/gb/playlists/{id}/curator"],
  ])("Apple failing for %s, other than with a 404, fails the rows that need it: ✗, naming that request", async (_what, path, fn, where) => {
    apple.failing[path] = 500;
    expect(await finish(["check", fn, "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(rowsOf(fn)).toEqual([`✗ ${fn}: Apple answered 500, code 50001 (at ${where}), so this was not answered.`]);
  });

  test("a rating set whose answer is lost is ✗, taken away all the same as the run ends, and not left for the steps", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "PUT") return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    expect(await main(["check", "setSongRating", "--write", "--no-color"])).toBe(1);
    expect(marksOf("setSongRating")).toEqual(["✗"]);
    expect(asked.filter((req) => req.method === "DELETE").map((req) => new URL(req.url).pathname)).toEqual(["/v1/me/ratings/songs/s2"]);
    expect(stderr).not.toContain("Take away the dislike");
  });

  test("a rating whose answer was lost and which cannot be taken away is a step, as one that may not be there", async () => {
    apple.rating.deleteFails = 500;
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "PUT") return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    await finish(["check", "setSongRating", "--write", "--no-color"], ["setTimeout", "clearTimeout"]);
    expect(cleanupOf()).toContain("- the song \"Name of s2\" by Artist of s2: https://music.apple.com/gb/song/s2 (Apple's answer was lost, so it may not be there)");
  });

  test("a rating set with no answer to hold to its type is read back all the same, and a batch Apple answers 404 is one that left it out", async () => {
    apple.rating.setsSilently = true;
    apple.rating.batchLeavesOut = true;
    apple.noneRated = "404";
    expect(await main(["check", "setSongRating", "--write", "--no-color"])).toBe(1);
    expect(linesOf("setSongRating")).toEqual(["≠ setSongRating: a rating of -1 was set, but a batch of its ratings left it out."]);
  });

  test("a playlist to rate whose making is answered with Apple failing stays in the steps as one that may be there", async () => {
    apple.failing["/v1/me/library/playlists"] = 500;
    expect(await finish(["check", "setLibraryPlaylistRating", "--write", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(cleanupOf()).toMatch(/Delete every playlist named "open-music-sdk check .* UTC \(for a rating\)".*\(Apple's answer was lost, so it may not be there\)/);
  });

  test("a folder whose making is answered with nothing may have been made: ✗, and in the steps as one that may be there", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "POST") return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    expect(await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(1);
    expect(marksOf("createLibraryPlaylistFolder")).toEqual(["✗"]);
    expect(cleanupOf()).toMatch(/Delete the playlist folder named .*\(Apple's answer was lost, so it may not be there\)/);
  });

  test("with no root folder answered for by its identity, a folder made is looked for under the root its children were found under", async () => {
    apple.answers["/v1/me/library/playlist-folders?filter%5Bidentity%5D=playlistsroot"] = { data: [] };
    expect(await main(["check", "createLibraryPlaylistFolder", "--write", "--no-color"])).toBe(0);
    expect(marksOf("createLibraryPlaylistFolder")).toEqual(["✓"]);
  });

  test("a playlist whose making is answered unlike its type is ≠ for that, and the question goes on", async () => {
    const real = answer;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const res = await real(req);
      if (req.method !== "POST" || new URL(req.url).pathname !== "/v1/me/library/playlists") return res;
      const body = (await res.json()) as { data: tBody[] };
      for (const playlist of body.data) (playlist.attributes as tBody).name = 7;
      return Response.json(body, { status: 201 });
    });
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist")).toContain("≠ playlist: createLibraryPlaylist's answer: types: library-playlists attributes.name: expected string.");
    expect(marksOf("playlist").at(-1)).toBe("✓");
  });
});

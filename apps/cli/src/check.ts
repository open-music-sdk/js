// `check`: what the SDK takes on trust about Apple's API, asked of the live API through the SDK's own functions,
// each answer printed as what Apple did, worded to go into the docs' "Differences from Apple's documentation" as it
// is. A check is run by its name too, so that one question can be asked again, or asked for in an issue. The checks
// that write to the listener's library run only with --write, and a run that wrote ends with how to undo it.
import manifest from "../package.json" with { type: "json" };
import {
  addLibraryPlaylistTracks,
  addToFavorites,
  addToLibrary,
  createLibraryPlaylist,
  createServerClient,
  getAlbumRelationship,
  getCharts,
  getLibraryPlaylist,
  getLibraryPlaylistRelationship,
  getSongRating,
  getSongRatings,
  getSongsByIsrc,
  isAppleMusicError,
  listLibraryPlaylists,
  listRecentlyPlayed,
  listRecentlyPlayedTracks,
  searchCatalog,
  validateUserToken,
  type AppleMusicError,
  type tMusic,
} from "@open-music-sdk/server";
import { isOnHost } from "@open-music-sdk/core";
import { NAME, TIMEOUT_MS, examine, out, paint, say, type tContext, type tFlags } from "./commands";
import { CliError, printable, usage } from "./files";

/**
 * What a line says of Apple: it did what the SDK assumes; it did not; what it did, for a question the SDK assumes no
 * answer to; the question could not be asked of this account; or Apple failed, and the question was not answered.
 */
export type tMark = "same" | "differs" | "report" | "skipped" | "failed";

const MARKS: Readonly<Record<tMark, readonly [string, Parameters<typeof paint>[1] | undefined]>> = {
  same: ["✓", "green"],
  differs: ["≠", "yellow"],
  report: ["·", undefined],
  skipped: ["-", "dim"],
  failed: ["✗", "red"],
};

/** A catalog resource from the charts, as much of it as a check uses and as a cleanup step names it by. */
interface tItem {
  readonly type: "songs" | "albums" | "playlists" | "music-videos";
  readonly id: string;
  readonly name: string;
  readonly by: string | undefined;
  readonly url: string | undefined;
  readonly attributes: unknown;
}

/** A write that was sent, and whether Apple's answer said it was carried out: one whose answer was lost may have been. */
interface tWritten<T> {
  readonly what: T;
  sure: boolean;
}

/** What the write checks left in the library, for the steps that undo it. */
interface tLeft {
  readonly playlists: tWritten<string>[];
  readonly library: tWritten<tItem>[];
  readonly favorites: tWritten<tItem>[];
  /** The albums a playlist's songs were taken from, and whether the songs were seen in the library once added. */
  playlistSongs: { readonly albums: readonly tItem[]; seen: boolean } | undefined;
}

/** The charts, once for every check that takes its resources from them. */
interface tCharts {
  readonly songs: readonly tItem[];
  readonly albums: readonly tItem[];
  readonly playlists: readonly tItem[];
  readonly musicVideos: readonly tItem[];
  /** The `next` of the first chart of songs. */
  readonly songsNext: string | undefined;
}

/** What a check is run with. */
interface tRun {
  /** The listener's client: the kept token, their storefront, and the CLI's limit on each request. */
  readonly music: tMusic;
  readonly storefront: string;
  /** Ctrl+C. */
  readonly signal: AbortSignal;
  readonly charts: () => Promise<tCharts>;
  readonly left: tLeft;
  /** Prints a line for this check. */
  readonly line: (mark: tMark, text: string) => void;
}

interface tCheck {
  readonly id: string;
  /** One line for the help. */
  readonly about: string;
  readonly writes: boolean;
  readonly run: (run: tRun) => Promise<void>;
}

const ORIGIN = "https://api.music.apple.com";
/** How long a poll waits for a write to show: a read a second, by the clock, for this long at most. */
const POLL_MS = 60_000;
/** How long `apply`'s `settle` waits by default: five reads, the first at once and a second between each. */
const SETTLE_S = 4;
/** The most tracks one request takes, as the client's function and lib-playlists' `chunk` allow. */
const MOST_TRACKS = 300;

// What Apple's answers hold is read as it comes, with nothing taken on trust.
const at = (value: unknown, ...keys: readonly (string | number)[]): unknown =>
  keys.reduce<unknown>((v, k) => (typeof v === "object" && v !== null && Object.hasOwn(v, k) ? (v as Record<string | number, unknown>)[k] : undefined), value);
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
/** An id as Apple's are, and nothing that could be read as more than one segment of a path: no `.` or `..`, which a URL reads as "here" and "one up". */
const idOf = (value: unknown): string | undefined => {
  const id = at(value, "id");
  return typeof id === "string" && /^(?!\.{1,2}$)[\w.-]{1,64}$/.test(id) ? id : undefined;
};
const defined = <T>(value: T | undefined): value is T => value !== undefined;
const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;
const refused = (e: unknown): e is AppleMusicError => isAppleMusicError(e, "ApiError") && e.status !== undefined && e.status >= 400 && e.status < 500;

// What a check catches, it catches through one of these, and anything else is thrown on: Ctrl+C, and a bug.
/** `e`, an answer of Apple's or a failure to get one. */
function apples(e: unknown): AppleMusicError {
  if (isAppleMusicError(e)) return e;
  throw e;
}
/** `e`, Apple's refusal of a request, which then did nothing. */
function refusal(e: unknown): AppleMusicError {
  if (refused(e)) return e;
  throw e;
}
/** Nothing, for Apple's 404. */
function notFound(e: unknown): void {
  if (!(isAppleMusicError(e, "ApiError") && e.status === 404)) throw e;
}

/**
 * What went wrong in asking Apple, from its tag and status alone: the error's message holds the path it asked,
 * which for a listener's things holds the ids of their library.
 */
export function brief(e: AppleMusicError): string {
  const timedOut = e.cause instanceof DOMException && e.cause.name === "TimeoutError";
  if (timedOut) return `Apple did not answer within ${String(TIMEOUT_MS / 1000)} seconds`;
  const code = text(e.errors?.[0]?.code);
  const status = e.status === undefined ? "" : ` (${String(e.status)}${code === undefined ? "" : `, code ${printable(code)}`})`;
  switch (e._tag) {
    case "NetworkError":
      return "Apple could not be reached";
    case "RateLimited":
      return `Apple is limiting requests for this key${status}`;
    case "DeveloperTokenInvalid":
      return `Apple refused the developer token${status}`;
    case "UserTokenInvalid":
      return `Apple refused the Music User Token${status}`;
    default:
      return e.status === undefined ? "Apple could not be asked" : `Apple answered ${String(e.status)}${code === undefined ? "" : `, code ${printable(code)}`}`;
  }
}

/** Waits `ms`, or rejects with the reason `signal` aborts with. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });

/**
 * Asks `shown` once a second, by the clock, until it is true or a minute has gone: resolves to the whole seconds it
 * took, or undefined. A read Apple fails is taken as not shown yet, as `apply`'s own reads take one.
 */
async function seconds(run: tRun, shown: () => Promise<boolean>): Promise<number | undefined> {
  const start = Date.now();
  for (;;) {
    let yes = false;
    try {
      yes = await shown();
    } catch (e) {
      apples(e);
    }
    if (yes) return Math.round((Date.now() - start) / 1000);
    if (Date.now() - start >= POLL_MS) return undefined;
    await pause(1000, run.signal);
  }
}
const took = (s: number | undefined) => (s === undefined ? "more than a minute" : plural(s, "second"));

/** The resources of a chart, those with an id. */
function itemsOf(type: tItem["type"], data: unknown): tItem[] {
  return list(data).flatMap((resource) => {
    const id = idOf(resource);
    if (id === undefined) return [];
    const attributes = at(resource, "attributes");
    return [{ type, id, attributes, name: text(at(attributes, "name")) ?? id, by: text(at(attributes, "artistName")) ?? text(at(attributes, "curatorName")), url: text(at(attributes, "url")) }];
  });
}

/**
 * Whether a catalog resource is in the listener's library: its `library` relationship, which needs their token and
 * which no client function asks for, so the path is put together here, each segment encoded as core's are.
 */
async function inLibrary(run: tRun, { type, id }: Pick<tItem, "type" | "id">): Promise<boolean> {
  try {
    const path = `v1/catalog/${encodeURIComponent(run.storefront)}/${type}/${encodeURIComponent(id)}/library`;
    return list(at(await run.music.request(path, { user: true, signal: run.signal }), "data")).length > 0;
  } catch (e) {
    notFound(e);
    return false;
  }
}

/** The first of `items`, of the first five, that is not in the library: what a write may add and the cleanup take away again. */
async function notInLibrary(run: tRun, items: readonly tItem[]): Promise<tItem | undefined> {
  for (const item of items.slice(0, 5)) if (!(await inLibrary(run, item))) return item;
  return undefined;
}

/** The listener's rating of a song, or undefined for none. */
async function ratingOf(run: tRun, id: string): Promise<unknown> {
  try {
    return at(list(at(await getSongRating(run.music, id, { signal: run.signal }), "data"))[0], "attributes", "value");
  } catch (e) {
    notFound(e);
    return undefined;
  }
}

/** Whether an answer that followed a `next` link is by type, as a search's is, or a page, as a collection's is. */
function shapeOf(body: unknown): "by type" | "page" | "neither" {
  if (Array.isArray(at(body, "data"))) return "page";
  return typeof at(body, "results") === "object" && at(body, "results") !== null ? "by type" : "neither";
}

/** Which of the query's names a `next` link kept, as a line. */
function kept(next: string, names: readonly string[]): string {
  const query = new URL(next, ORIGIN).searchParams;
  const dropped = names.filter((name) => !query.has(name));
  return dropped.length === 0 ? `its next link keeps ${names.join(", ")}` : `its next link drops ${dropped.join(", ")}, and keeps ${names.filter((name) => query.has(name)).join(", ") || "none of what was sent"}`;
}

async function recentlyPlayedTypes(run: tRun): Promise<void> {
  const { music, signal } = run;
  const asks = [
    { fn: "listRecentlyPlayed", without: () => listRecentlyPlayed(music, { signal }), with: () => listRecentlyPlayed(music, { types: ["albums", "playlists", "stations", "library-albums", "library-playlists"], signal }) },
    { fn: "listRecentlyPlayedTracks", without: () => listRecentlyPlayedTracks(music, { signal }), with: () => listRecentlyPlayedTracks(music, { types: ["songs", "music-videos", "library-songs", "library-music-videos"], signal }) },
  ];
  for (const ask of asks) {
    let without: number;
    try {
      without = list(at(await ask.without(), "data")).length;
    } catch (e) {
      run.line("differs", `${ask.fn} without types: ${brief(refusal(e))}. client-user leaves types optional; Apple needs it.`);
      continue;
    }
    const withTypes = list(at(await ask.with(), "data")).length;
    if (without === 0 && withTypes === 0) run.line("skipped", `${ask.fn}: nothing was played lately, asked with types or without`);
    else if (without === 0) run.line("differs", `${ask.fn} without types: Apple answered with nothing, and with them with ${String(withTypes)}. client-user leaves types optional, so a call without them gets nothing.`);
    else run.line("same", `${ask.fn} without types: Apple answered with ${String(without)}, and with them with ${String(withTypes)}. types is optional, as client-user has it.`);
  }
}

async function searchNext(run: tRun): Promise<void> {
  const body = await searchCatalog(run.music, "love", { types: ["songs"], limit: 1, signal: run.signal });
  const next = text(at(body, "results", "songs", "next"));
  if (next === undefined) { run.line("skipped", "a search for love, a song a page, named no next page"); return; }
  const shape = shapeOf(await run.music.request(next, { user: false, signal: run.signal }));
  if (shape === "by type") run.line("same", "a search's next link answers by type, as the search did, so paginate stops after the first page, as client-catalog says.");
  else run.line("differs", `a search's next link answers ${shape === "page" ? "with a page, which paginate could walk" : "with neither a page nor results by type"}. client-catalog says it answers by type, and that paginate stops after the first page.`);
  run.line("report", `${kept(next, ["term", "types", "limit"])}.`);
}

async function chartsNext(run: tRun): Promise<void> {
  const next = (await run.charts()).songsNext;
  if (next === undefined) { run.line("skipped", "the first chart of songs, 50 a page, named no next page"); return; }
  const shape = shapeOf(await run.music.request(next, { user: false, signal: run.signal }));
  run.line("report", `a chart's next link answers ${shape === "by type" ? "by type, as the charts did, so paginate cannot walk it" : shape === "page" ? "with a page, which paginate can walk" : "with neither a page nor charts by type"}; ${kept(next, ["types", "limit"])}.`);
}

async function isrcNext(run: tRun): Promise<void> {
  const isrcs = [...new Set((await run.charts()).songs.map((song) => text(at(song.attributes, "isrc"))).filter(defined))].slice(0, 25);
  if (isrcs.length < 2) { run.line("skipped", "the chart of songs held fewer than two ISRCs"); return; }
  const first = await getSongsByIsrc(run.music, isrcs, { signal: run.signal });
  const found = `${plural(list(at(first, "data")).length, "song")} for ${plural(isrcs.length, "ISRC")}`;
  if (text(at(first, "next")) !== undefined) {
    run.line("differs", `${found}, and a next page. lib-playlists' resolve reads the first page alone, so it misses the songs after it.`);
    return;
  }
  let paged: unknown;
  try {
    paged = await getSongsByIsrc(run.music, isrcs, { limit: 1, signal: run.signal });
  } catch (e) {
    run.line("same", `${found}, with no next page; asked for one a page, ${brief(refusal(e))}. resolve reads one page, which is all there is.`);
    return;
  }
  if (text(at(paged, "next")) !== undefined) run.line("differs", `${found} in one page; asked for one a page, Apple named a next page. So the lookup pages, and resolve, which reads the first page alone, misses songs once more come back than a page holds.`);
  else run.line("same", `${found}, with no next page, even asked for one a page. resolve reads one page, which is all there is.`);
}

async function ratingUnset(run: tRun): Promise<void> {
  const songs = (await run.charts()).songs.slice(0, 25);
  if (songs.length === 0) { run.line("skipped", "the charts held no songs"); return; }
  let rated: string[];
  try {
    rated = list(at(await getSongRatings(run.music, songs.map((song) => song.id), { signal: run.signal }), "data"))
      .map(idOf)
      .filter(defined);
    run.line("report", `the ratings of ${plural(songs.length, "chart song")}: Apple answered with ${plural(rated.length, "rating")}, and left out the songs with none.`);
  } catch (e) {
    notFound(e);
    rated = [];
    run.line("differs", `the ratings of ${plural(songs.length, "chart song")}, none of them rated: Apple answered 404. getSongRatings rejects, where client-user says it resolves to an empty list.`);
  }
  const unrated = songs.find((song) => !rated.includes(song.id));
  if (unrated === undefined) {
    run.line("skipped", "every one of the chart's songs is rated");
    return;
  }
  try {
    const body = await getSongRating(run.music, unrated.id, { signal: run.signal });
    run.line("report", `the rating of a song never rated: Apple answered 200 with ${plural(list(at(body, "data")).length, "rating")}. music.user.getSongRating rejects an answer with none as an ApiError of status 200.`);
  } catch (e) {
    notFound(e);
    run.line("report", "the rating of a song never rated: Apple answered 404, which getSongRating rejects as an ApiError of status 404.");
  }
}

/** How many of a page's tracks carry their catalog song, how many of those its ISRC, and how many a catalog id under `playParams`. */
function catalogOf(page: unknown) {
  const tracks = list(at(page, "data"));
  const songs = tracks.map((track) => list(at(track, "relationships", "catalog", "data"))[0]).filter(defined);
  return {
    tracks: tracks.length,
    catalog: songs.length,
    isrc: songs.filter((song) => text(at(song, "attributes", "isrc")) !== undefined).length,
    catalogId: tracks.filter((track) => text(at(track, "attributes", "playParams", "catalogId")) !== undefined).length,
  };
}

async function playlistInclude(run: tRun): Promise<void> {
  const { music, signal } = run;
  const playlists = list(at(await listLibraryPlaylists(music, { limit: 25, signal }), "data"));
  for (const id of playlists.map(idOf).filter(defined)) {
    let first: unknown;
    try {
      first = await getLibraryPlaylistRelationship(music, id, "tracks", { include: ["catalog"], signal });
    } catch (e) {
      notFound(e);
      continue;
    }
    const next = text(at(first, "next"));
    if (next === undefined) continue;

    // Read as lib-playlists' `read` reads it: the first page by the client's function, the rest by the links.
    const second = await music.request(next, { signal });
    const keeps = new URL(next, ORIGIN).searchParams.get("include")?.split(",").includes("catalog") === true;
    const [a, b] = [catalogOf(first), catalogOf(second)];
    for (const [n, page] of [
      [1, a],
      [2, b],
    ] as const)
      run.line("report", `a long playlist's page ${String(n)} of tracks, with include=catalog: ${plural(page.tracks, "track")}, ${String(page.catalog)} with their catalog song, ${String(page.isrc)} of those with its ISRC, and ${String(page.catalogId)} with playParams.catalogId.`);
    run.line("report", `the next link ${keeps ? "keeps" : "drops"} include=catalog.`);
    if (a.catalog === 0) run.line("differs", "include=catalog gave no track on the first page its catalog song. lib-playlists' read takes the ISRC from there, so an export holds none.");
    else if (b.catalog === 0 && b.catalogId === 0) run.line("skipped", "no track on the second page is in the catalog, so whether the next link keeps the catalog songs is not seen");
    else if (b.catalog < b.catalogId || b.isrc < b.catalog) run.line("differs", "past the first page, tracks come without their catalog song or its ISRC. lib-playlists' read takes the ISRC from there, so an export loses it after the first page.");
    else run.line("same", "the tracks past the first page carry their catalog song and its ISRC, as lib-playlists' read takes them.");

    const tracks = list(at(list(at(await getLibraryPlaylist(music, id, { include: ["tracks"], signal }), "data"))[0], "relationships", "tracks", "data")).length;
    if (tracks > 0) run.line("same", `the playlist asked for with include=tracks carries its first ${plural(tracks, "track")}, which read checks a 404 for its tracks against.`);
    else run.line("differs", "the playlist asked for with include=tracks carries none of its tracks. read checks a 404 for a playlist's tracks against them, so it would take such a 404 for a playlist with none, and apply would add everything again.");
    return;
  }
  run.line("skipped", `none of the first ${plural(playlists.length, "playlist")} in the library has more than a page of tracks`);
}

async function userTokenRefused(run: tRun): Promise<void> {
  // Shaped like no token Apple gives, so it cannot be one.
  const madeUp = "open-music-sdk-check-not-a-token";
  try {
    await run.music.as(madeUp).request("v1/me/storefront", { signal: run.signal });
    run.line("differs", "a Music User Token Apple never gave was answered 200, as if it were one.");
    return;
  } catch (e) {
    // With no status there was no answer, and so nothing to report: the check is not answered.
    if (apples(e).status === undefined) throw e;
    run.line("report", `a Music User Token Apple never gave is answered ${String(apples(e).status)}.`);
  }
  try {
    await validateUserToken(run.music, madeUp, { signal: run.signal });
    run.line("differs", "validateUserToken took a Music User Token Apple never gave.");
  } catch (e) {
    const failure = apples(e);
    if (failure._tag === "UserTokenInvalid") run.line("same", "validateUserToken rejects it as UserTokenInvalid, as user-token has it.");
    else run.line("differs", `validateUserToken rejects it as ${failure._tag}: ${brief(failure)}. user-token has a refused Music User Token as UserTokenInvalid.`);
  }
}

async function previewHosts(run: tRun): Promise<void> {
  const { songs } = await run.charts();
  const urls = songs.map((song) => text(at(list(at(song.attributes, "previews"))[0], "url"))).filter(defined);
  if (urls.length === 0) { run.line("skipped", "no chart song had a preview"); return; }
  const hosts = new Map<string, number>();
  let insecure = 0;
  for (const url of urls) {
    const parsed = URL.parse(url);
    if (parsed?.protocol !== "https:") insecure++;
    if (parsed !== null) hosts.set(parsed.host, (hosts.get(parsed.host) ?? 0) + 1);
  }
  const from = [...hosts].map(([host, n]) => `${printable(host)} (${String(n)})`).join(", ");
  run.line(insecure === 0 ? "report" : "differs", `${String(urls.length)} of ${plural(songs.length, "chart song")} have a preview, served from ${from || "no host"}${insecure === 0 ? "" : `; ${String(insecure)} not over https, which the preview player refuses`}.`);
}

async function artworkPlaceholders(run: tRun): Promise<void> {
  const charts = await run.charts();
  const templates = [...charts.songs, ...charts.albums, ...charts.playlists, ...charts.musicVideos].map((item) => text(at(item.attributes, "artwork", "url"))).filter(defined);
  if (templates.length === 0) { run.line("skipped", "nothing in the charts had artwork"); return; }
  const seen = new Map<string, number>();
  for (const template of templates) for (const name of new Set(Array.from(template.matchAll(/\{([^{}]*)\}/g), (m) => String(m[1])))) seen.set(name, (seen.get(name) ?? 0) + 1);
  const held = [...seen].map(([name, n]) => `{${printable(name)}} (${String(n)})`).join(", ");
  const unknown = [...seen.keys()].filter((name) => !["w", "h", "f", "c"].includes(name));
  if (unknown.length === 0) run.line("same", `of ${plural(templates.length, "artwork template")}, ${held ? `these hold ${held}` : "none holds a placeholder"}: util-artwork fills each of them.`);
  else run.line("differs", `of ${plural(templates.length, "artwork template")}, these hold ${held}. util-artwork fills {w}, {h}, {f} and {c}, and leaves ${unknown.map((name) => `{${printable(name)}}`).join(", ")} as it is, so the URL does not work.`);
}

async function addToLibraryCheck(run: tRun): Promise<void> {
  const charts = await run.charts();
  const taken: tItem[] = [];
  const answered: string[] = [];
  for (const items of [charts.songs, charts.albums, charts.playlists, charts.musicVideos]) {
    const item = await notInLibrary(run, items);
    if (item === undefined) {
      if (items[0] !== undefined) answered.push(`${items[0].type} not asked, since the first five in the charts are in the library already`);
      continue;
    }
    const left = { what: item, sure: false };
    run.left.library.push(left);
    try {
      await addToLibrary(run.music, { [item.type]: [item.id] }, { signal: run.signal });
    } catch (e) {
      answered.push(`${item.type}: ${brief(refusal(e))}`);
      // Refused, so not added: there is nothing to undo.
      run.left.library.splice(run.left.library.indexOf(left), 1);
      continue;
    }
    left.sure = true;
    taken.push(item);
  }
  run.line("report", `addToLibrary took ${taken.map((item) => item.type).join(", ") || "none of them"}${answered.length === 0 ? "" : `; ${answered.join("; ")}`}.`);
  if (taken.length === 0) return;
  // Each by itself, at once, so one that never shows does not keep the others waiting.
  const shown = await Promise.all(taken.map((item) => seconds(run, () => inLibrary(run, item))));
  run.line("report", `each showed in the library after: ${taken.map((item, i) => `${item.type}, ${took(shown[i])}`).join("; ")}.`);
}

async function addToFavoritesCheck(run: tRun): Promise<void> {
  // A song neither in the library nor rated, so the steps that undo the favorite take away nothing the listener had.
  let song: tItem | undefined;
  for (const candidate of (await run.charts()).songs.slice(0, 10)) {
    if (!(await inLibrary(run, candidate)) && (await ratingOf(run, candidate.id)) === undefined) {
      song = candidate;
      break;
    }
  }
  if (song === undefined) { run.line("skipped", "each of the first ten chart songs is in the library or rated already"); return; }
  const left = { what: song, sure: false };
  run.left.favorites.push(left);
  await addToFavorites(run.music, { songs: [song.id] }, { signal: run.signal });
  left.sure = true;
  const item = song;
  let value: unknown;
  const after = await seconds(run, async () => (value = await ratingOf(run, item.id)) !== undefined);
  run.line("report", after === undefined ? "addToFavorites took a song, which had no rating a minute later: a favorite is not a rating." : `addToFavorites took a song, which had a rating of ${printable(String(value))} after ${took(after)}.`);
  if (await inLibrary(run, item)) {
    run.left.library.push({ what: item, sure: true });
    run.line("report", "the song made a favorite was put in the library too.");
  } else run.line("report", "the song made a favorite was not in the library when check looked.");
}

/** A playlist of the listener's with this name, from all the pages of their playlists. */
async function listed(run: tRun, name: string): Promise<unknown> {
  for await (const playlist of run.music.user.listLibraryPlaylists({ limit: 100, signal: run.signal })) if (text(at(playlist, "attributes", "name")) === name) return playlist;
  return undefined;
}

/** Up to `MOST_TRACKS` songs from the charts' albums that are not in the library, and the albums they are from. */
async function albumSongs(run: tRun): Promise<{ readonly ids: readonly string[]; readonly albums: readonly tItem[] }> {
  const ids = new Set<string>();
  const albums: tItem[] = [];
  for (const album of (await run.charts()).albums) {
    if (ids.size >= MOST_TRACKS) break;
    if (await inLibrary(run, album)) continue;
    const songs = list(at(await getAlbumRelationship(run.music, album.id, "tracks", { signal: run.signal }), "data")).filter((track) => at(track, "type") === "songs");
    const before = ids.size;
    for (const id of songs.map(idOf).filter(defined)) ids.add(id);
    if (ids.size > before) albums.push(album);
  }
  return { ids: [...ids].slice(0, MOST_TRACKS), albums };
}

async function playlistCheck(run: tRun): Promise<void> {
  const { music, signal } = run;
  const name = `${NAME} check ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`;
  const description = `Made by ${NAME} check, to see how Apple keeps a playlist. Safe to delete.`;

  const made = { what: name, sure: false };
  run.left.playlists.push(made);
  const answer = await createLibraryPlaylist(music, { attributes: { name, description } }, { signal });
  made.sure = true;
  let id = idOf(list(at(answer, "data"))[0]);
  run.line("report", id === undefined ? "the answer to making a playlist held no playlist, so apply has to find it by its name and description." : "the answer to making a playlist held the playlist, with its id.");

  // By its id first, which `read` asks for, then among the listener's playlists, where `apply` looks for it.
  const timings: string[] = [];
  if (id !== undefined) {
    const known = id;
    timings.push(`could be read by its id after ${took(await seconds(run, async () => (await getLibraryPlaylist(music, known, { signal }), true)))}`);
  }
  let found: unknown;
  timings.push(`was among the library's playlists after ${took(await seconds(run, async () => (found = await listed(run, name)) !== undefined))}`);
  run.line("report", `the new playlist ${timings.join(", and ")}; apply's settle waits about ${String(SETTLE_S)} seconds.`);
  id ??= idOf(found);
  if (id === undefined) { run.line("skipped", "the playlist neither came back with an id nor showed among the library's playlists, so nothing more can be asked of it"); return; }
  const asSent = found !== undefined && text(at(found, "attributes", "name")) === name && text(at(found, "attributes", "description", "standard")) === description;
  if (found === undefined) run.line("skipped", "the playlist was not listed within a minute, so whether its name and description come back as sent is not seen");
  else if (asSent) run.line("same", "its name and description came back as they were sent, which apply finds a playlist by.");
  else run.line("differs", `its description came back as "${printable(text(at(found, "attributes", "description", "standard")) ?? "none")}". apply finds a playlist by its name and description, so a run by this plan would make another.`);

  // What an empty playlist's tracks answer, and what `read` makes of it.
  try {
    run.line("report", `its tracks, while it had none: Apple answered with ${plural(list(at(await getLibraryPlaylistRelationship(music, id, "tracks", { signal }), "data")).length, "track")}.`);
  } catch (e) {
    run.line("report", `its tracks, while it had none: ${brief(refusal(e))}.`);
  }
  try {
    await music.playlists.read(id, { signal });
    run.line("same", "lib-playlists' read takes it for a playlist with no tracks.");
  } catch (e) {
    run.line("differs", `lib-playlists' read rejects a playlist with no tracks: ${brief(apples(e))}. apply reads a playlist before it adds to it, so it cannot fill one it made.`);
  }

  const { ids, albums } = await albumSongs(run);
  const [firstSong] = ids;
  if (firstSong === undefined) {
    run.line("skipped", "no chart album that is not in the library had songs to add");
    return;
  }
  run.left.playlistSongs = { albums, seen: false };
  let tracks = ids.map((song) => ({ id: song, type: "songs" as const }));
  try {
    await addLibraryPlaylistTracks(music, id, tracks, { signal });
    run.line("report", `one request took ${plural(tracks.length, "track")}.`);
  } catch (e) {
    if (refused(e)) {
      // Refused, so nothing was added, and a smaller request is safe to send.
      run.line("differs", `one request of ${plural(tracks.length, "track")}: ${brief(e)}. lib-playlists lets chunk be ${String(MOST_TRACKS)}.`);
      tracks = tracks.slice(0, 100);
      await addLibraryPlaylistTracks(music, id, tracks, { signal });
      run.line("report", `one request of ${plural(tracks.length, "track")} was taken.`);
    } else {
      // The answer was lost: the tracks may be there, which the reads below show, and they are not sent again.
      run.line("report", `the answer to adding ${plural(tracks.length, "track")}: ${brief(apples(e))}; whether they were added is read back.`);
    }
  }

  const playlistId = id;
  let held: readonly (string | undefined)[] = [];
  const settled = await seconds(run, async () => (held = (await music.playlists.read(playlistId, { signal })).tracks.map((track) => track.catalogId)).length >= tracks.length);
  if (settled === undefined) { run.line("differs", `${plural(held.length, "track")} of the ${String(tracks.length)} added showed within a minute; apply's settle waits about ${String(SETTLE_S)} seconds.`); return; }
  run.line("report", `the ${plural(tracks.length, "track")} showed after ${took(settled)}; apply's settle waits about ${String(SETTLE_S)} seconds.`);
  const sent = tracks.map((track) => track.id);
  const other = sent.filter((song, i) => held[i] !== song).length;
  if (other === 0 && held.length === sent.length) run.line("same", "read gives back the catalog id each track was added by, in order, which plan goes by.");
  else run.line("differs", `${plural(other, "track")} of ${String(sent.length)} came back under another catalog id, or none, or in another place. plan goes by the catalog id, so apply would add them again.`);

  const seen = await inLibrary(run, { type: "songs", id: firstSong });
  run.left.playlistSongs = { albums, seen };
  run.line("report", seen ? "adding songs to the playlist put them in the library too." : "adding songs to the playlist had not put them in the library when check looked.");

  if (!asSent || other > 0 || held.length !== sent.length) {
    run.line("skipped", "apply was not run with the same plan: it finds the playlist by its name and description and goes by catalog ids, and one of them did not hold, so it would make another playlist or add every track again");
    return;
  }
  const result = await music.playlists.apply(music.playlists.plan({ name, description }, tracks), { signal });
  if (result.created) run.left.playlists.push({ what: name, sure: true });
  if (!result.created && result.appended === 0 && result.verified) run.line("same", "apply with the same plan found the playlist, added nothing, and saw it whole.");
  else run.line("differs", `apply with the same plan resolved to created ${String(result.created)}, appended ${String(result.appended)}, verified ${String(result.verified)}, where it should have found the playlist and added nothing.`);
}

/** Every check, in the order a run asks them. Their names are for the command line and for issues, so they stay. */
export const CHECKS: readonly tCheck[] = [
  { id: "recently-played-types", about: "Whether recently played needs types, as Apple's documentation says", writes: false, run: recentlyPlayedTypes },
  { id: "search-next", about: "What a search's next link answers with", writes: false, run: searchNext },
  { id: "charts-next", about: "What a chart's next link answers with", writes: false, run: chartsNext },
  { id: "isrc-next", about: "Whether songs looked up by ISRC come in pages", writes: false, run: isrcNext },
  { id: "rating-unset", about: "What Apple answers for a rating never set", writes: false, run: ratingUnset },
  { id: "playlist-include", about: "Whether a long playlist's tracks keep their catalog songs and ISRCs past the first page", writes: false, run: playlistInclude },
  { id: "user-token-refused", about: "What Apple answers for a Music User Token it never gave", writes: false, run: userTokenRefused },
  { id: "preview-hosts", about: "Which hosts serve the preview clips", writes: false, run: previewHosts },
  { id: "artwork-placeholders", about: "Which placeholders artwork templates hold", writes: false, run: artworkPlaceholders },
  { id: "add-to-library", about: "Which types the library takes, and how soon they show", writes: true, run: addToLibraryCheck },
  { id: "add-to-favorites", about: "Whether a song made a favorite gets a rating or goes into the library", writes: true, run: addToFavoritesCheck },
  { id: "playlist", about: "A playlist made, given 300 songs, read back, and applied again", writes: true, run: playlistCheck },
];

/** The checks named, in the order a run asks them, or every one `write` allows when none is named. */
function chosen(names: readonly string[], write: boolean): readonly tCheck[] {
  for (const name of names) {
    const found = CHECKS.find((each) => each.id === name);
    // A name is repeated only when it looks like one: what was typed may be a token pasted in the wrong place.
    if (found === undefined) throw usage(`There is no check${/^[a-z][\w-]{0,31}$/.test(name) ? ` '${name}'` : ""}. The checks are ${CHECKS.map((each) => each.id).join(", ")}.`);
    if (found.writes && !write) throw usage(`${name} writes to your library, and runs only with --write.`);
  }
  return CHECKS.filter((each) => (names.length === 0 ? write || !each.writes : names.includes(each.id)));
}

/** A catalog resource as a cleanup step names it, with the link that opens it in Apple Music, where Apple gave one. */
const label = (item: tItem) => {
  const word = { songs: "song", albums: "album", playlists: "playlist", "music-videos": "music video" }[item.type];
  return `the ${word} "${printable(item.name)}"${item.by === undefined ? "" : ` by ${printable(item.by)}`}${item.type === "albums" ? ", with its songs" : ""}`;
};
/** Apple's link to a resource, offered to open only when it is an https address of Apple Music's own: it came in an answer, and the person is told to follow it. */
const link = ({ url }: tItem) => (url !== undefined && isOnHost(url, ["music.apple.com"]) ? printable(url) : "search for it in the Music app");
const UNSURE = " (Apple's answer was lost, so it may not be there)";
const unsure = (written: tWritten<unknown>) => (written.sure ? "" : UNSURE);
const DELETE = "and choose Delete from Library from its … menu";

/** The steps that undo what the write checks left, on stdout, numbered; nothing when they left nothing. */
function cleanup(left: tLeft): void {
  const steps: { readonly step: string; readonly items?: readonly string[] }[] = [];
  const playlists = new Map<string, tWritten<string>[]>();
  for (const playlist of left.playlists) playlists.set(playlist.what, [...(playlists.get(playlist.what) ?? []), playlist]);
  for (const [name, made] of playlists) {
    const all = made.length > 1 ? `, all ${String(made.length)} of that name` : "";
    steps.push({ step: `Delete the playlist "${printable(name)}"${all}: find it in Playlists, ${DELETE}.${made.every((each) => !each.sure) ? UNSURE : ""}` });
  }
  if (left.library.length > 0) steps.push({ step: `Delete these from your library: open each, ${DELETE}.`, items: left.library.map((each) => `${label(each.what)}: ${link(each.what)}${unsure(each)}`) });
  for (const favorite of left.favorites) steps.push({ step: `Undo the favorite on ${label(favorite.what)}: open ${link(favorite.what)}, and choose Undo Favorite from its … menu.${unsure(favorite)}` });
  const songs = left.playlistSongs;
  if (songs !== undefined)
    steps.push({
      step: songs.seen
        ? `The playlist's songs went into your library as well. Delete the albums they are from: open each, ${DELETE}.`
        : `If the playlist's songs show up in your library, delete the albums they are from: open each, ${DELETE}. None of these albums was in your library before.`,
      items: songs.albums.map((album) => `${label(album)}: ${link(album)}`),
    });
  if (steps.length === 0) return;
  out("");
  out("To undo what check left in your library, which Apple's API cannot delete, use the Music app on any device signed in to this Apple Account:");
  steps.forEach(({ step, items = [] }, i) => {
    out(`  ${String(i + 1)}. ${step}`);
    for (const item of items) out(`     - ${item}`);
  });
}

/** What the run is made from, for an issue: the CLI's version, Node's and the system's. */
const header = () => `${NAME} ${manifest.version} · Node ${process.versions.node} · ${process.platform} ${process.arch}`;

/**
 * Asks the live API what the SDK takes on trust, check by check, and prints for each what Apple did. Named checks are
 * asked alone; with none named, every read-only one, and the write checks too with --write.
 *
 * @throws CliError with exit status 2 for a check that is not there, or one that writes without --write; with 130 for Ctrl+C.
 */
export async function check(flags: tFlags, ctx: tContext, names: readonly string[]): Promise<number> {
  const checks = chosen(names, flags.write === true);
  out(header());
  const examined = await examine(flags, ctx);
  if (examined === undefined) return 1;
  const { key, token, storefront } = examined;

  // The CLI's limit is on each request, so that a function that makes many, such as apply, is not cut off whole.
  const timed = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return fetch(req, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
  };
  const music = createServerClient({ pem: key.pem, teamId: key.teamId, keyId: key.keyId, userToken: token, storefront, fetch: timed });

  const stop = new AbortController();
  const interrupt = () => {
    stop.abort(new CliError("Stopped.", 130));
  };
  process.once("SIGINT", interrupt);
  let charts: Promise<tCharts> | undefined;
  const left: tLeft = { playlists: [], library: [], favorites: [], playlistSongs: undefined };
  const marks = new Set<tMark>();
  try {
    if (names.length === 0 && flags.write !== true) say("The checks that write to your library are left out; --write adds them.");
    if (checks.some((each) => each.writes)) say("--write: what these checks add stays in your library, since Apple's API can delete none of it. The steps to remove it are printed at the end.");
    for (const each of checks) {
      const line = (mark: tMark, words: string) => {
        marks.add(mark);
        const [sign, format] = MARKS[mark];
        out(`${format === undefined ? sign : paint(ctx, format, sign, process.stdout)} ${each.id}: ${words}`);
      };
      say(`Asking: ${each.id}…`);
      try {
        await each.run({
          music,
          storefront,
          signal: stop.signal,
          left,
          line,
          charts: () =>
            (charts ??= getCharts(music, { types: ["songs", "albums", "playlists", "music-videos"], limit: 50, signal: stop.signal }).then(
              (body) => {
                const first = (type: string) => list(at(body, "results", type))[0];
                return {
                  songs: itemsOf("songs", at(first("songs"), "data")),
                  albums: itemsOf("albums", at(first("albums"), "data")),
                  playlists: itemsOf("playlists", at(first("playlists"), "data")),
                  musicVideos: itemsOf("music-videos", at(first("music-videos"), "data")),
                  songsNext: text(at(first("songs"), "next")),
                };
              },
              (e: unknown) => {
                // Asked for again by the next check that needs them, rather than failing it too.
                charts = undefined;
                throw e;
              },
            )),
        });
      } catch (e) {
        // Ctrl+C is thrown on: core hands on the reason the signal aborted with, as it is.
        line("failed", `${brief(apples(e))}, so this was not answered.`);
      }
    }
  } finally {
    process.off("SIGINT", interrupt);
    cleanup(left);
  }
  return marks.has("differs") || marks.has("failed") ? 1 : 0;
}

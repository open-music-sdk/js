// What `check`'s questions and its sweep share: what a line says, what a run holds, how Apple's answers are read,
// what a failure is called, how a write is waited on, and what a run adds to the library, made once whichever check
// asks for it first.
import {
  addToLibrary,
  createLibraryPlaylist,
  getAlbumRating,
  getAlbumRelationship,
  getMusicVideoRating,
  getPlaylistRelationship,
  getSongRating,
  getSongRelationship,
  isAppleMusicError,
  schemas,
  type AppleMusicError,
  type tMusic,
} from "@open-music-sdk/server";
import { sleep } from "@open-music-sdk/core";
import { TIMEOUT_MS, say } from "./commands";
import { printable } from "./files";

/**
 * What a line says of Apple: it did what the SDK assumes; it did not; what it did, for a question the SDK assumes no
 * answer to; the question could not be asked of this account; or Apple failed, and the question was not answered.
 */
export type tMark = "same" | "differs" | "report" | "skipped" | "failed";

/** A catalog resource from the charts, as much of it as a check uses and as a cleanup step names it by. */
export interface tItem {
  readonly type: "songs" | "albums" | "playlists" | "music-videos" | "stations";
  readonly id: string;
  readonly name: string;
  readonly by: string | undefined;
  readonly url: string | undefined;
  readonly attributes: unknown;
}

/** A write that was sent, and whether Apple's answer said it was carried out: one whose answer was lost may have been. */
export interface tWritten<T> {
  readonly what: T;
  sure: boolean;
}

/** A rating a run set, with what takes it away again, which the run calls itself when it ends with the rating left. */
export interface tRated {
  readonly what: tItem;
  /** Takes the rating away, through the API. */
  readonly undo: () => Promise<unknown>;
  sure: boolean;
}

/** What the write checks left in the library, for the steps that undo it. */
export interface tLeft {
  /** By name: `apply` may make a second of the same name, and fail before it says so. */
  readonly playlists: tWritten<string>[];
  readonly library: tWritten<tItem>[];
  /** Each favorite, and whether it was seen in the library afterwards, where it is deleted from too. */
  readonly favorites: (tWritten<tItem> & { inLibrary: boolean })[];
  /** Catalog playlists added to the library, and whether their songs were seen there as well. */
  readonly playlistsSongs: { readonly playlist: tItem; readonly seen: boolean }[];
  /** The albums a playlist's songs were taken from, and whether the songs were seen in the library once added. */
  playlistSongs: { readonly albums: readonly tItem[]; seen: boolean } | undefined;
  /** The ratings set and not yet taken away again. */
  readonly ratings: tRated[];
  /** Playlist folders, by name: Apple's API cannot delete one. */
  readonly folders: tWritten<string>[];
}

/** The charts, once for every check that takes its resources from them. */
export interface tCharts {
  readonly songs: readonly tItem[];
  readonly albums: readonly tItem[];
  readonly playlists: readonly tItem[];
  readonly musicVideos: readonly tItem[];
  /** The `next` of the first chart of songs. */
  readonly songsNext: string | undefined;
}

/** What a check is run with. */
export interface tRun {
  /** The check's name, as its lines begin. */
  readonly id: string;
  /** The listener's client: the kept token, their storefront, and the CLI's limit on each request. */
  readonly music: tMusic;
  readonly storefront: string;
  /** Ctrl+C. */
  readonly signal: AbortSignal;
  readonly charts: () => Promise<tCharts>;
  readonly left: tLeft;
  /** Prints a line for this check, with how what Apple answered differs from its type, for the run's list of those. */
  readonly line: (mark: tMark, text: string, diffs?: readonly tDiff[]) => void;
  /** What the run's checks make once and share, by a name of its own: what it added, and what it found to ask with. */
  readonly memo: Map<string, Promise<unknown>>;
  /** The name the run's playlists and folder are given, which tells the listener when they were made. */
  readonly name: string;
  /** `fetch`, with the CLI's limit on each request, for what is asked of a server other than the API's. */
  readonly fetch: typeof fetch;
}

export const ORIGIN = "https://api.music.apple.com";
/** How long a poll waits for a write to show: a read a second, by the clock, for this long at most. */
export const POLL_MS = 60_000;
/** How long `apply`'s `settle` waits by default: ten reads, the first at once and a second between each. */
export const SETTLE_S = 9;
/** The most tracks one request takes, as the client's function and lib-playlists' `chunk` allow. */
export const MOST_TRACKS = 300;
/** How fast a run asks Apple: ten requests at once, then ten a second. Apple does not say what a key may make. */
export const PACE = { capacity: 10, refillPerSecond: 10 } as const;

// What Apple's answers hold is read as it comes, with nothing taken on trust.
export const at = (value: unknown, ...keys: readonly (string | number)[]): unknown =>
  keys.reduce<unknown>((v, k) => (typeof v === "object" && v !== null && Object.hasOwn(v, k) ? (v as Record<string | number, unknown>)[k] : undefined), value);
export const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
export const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
/** An id as Apple's are, and nothing that could be read as more than one segment of a path: no `.` or `..`, which a URL reads as "here" and "one up". */
export const idOf = (value: unknown): string | undefined => {
  const id = at(value, "id");
  return typeof id === "string" && /^(?!\.{1,2}$)[\w.-]{1,64}$/.test(id) ? id : undefined;
};
export const defined = <T>(value: T | undefined): value is T => value !== undefined;
export const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;
/** How many of a listener's tracks, said without the count, which would say how long their playlist is. */
export const share = (n: number, of: number) => (n === of ? "all" : n === 0 ? "none" : "some");
export const refused = (e: unknown): e is AppleMusicError => isAppleMusicError(e, "ApiError") && e.status !== undefined && e.status >= 400 && e.status < 500;
export const isNotFound = (e: unknown): boolean => isAppleMusicError(e, "ApiError") && e.status === 404;

// What a check catches, it catches through one of these, and anything else is thrown on: Ctrl+C, and a bug.
/** `e`, an answer of Apple's or a failure to get one. */
export function apples(e: unknown): AppleMusicError {
  if (isAppleMusicError(e)) return e;
  throw e;
}
/** `e`, Apple's refusal of a request, which then did nothing. */
export function refusal(e: unknown): AppleMusicError {
  if (refused(e)) return e;
  throw e;
}
/** `e`, Apple's refusal of a token: a 4xx of any tag but a rate limit, which says nothing of the token. */
export function tokenRefusal(e: unknown): AppleMusicError {
  if (isAppleMusicError(e) && e._tag !== "RateLimited" && e.status !== undefined && e.status >= 400 && e.status < 500) return e;
  throw e;
}
/** Nothing, for Apple's 404. */
export function notFound(e: unknown): void {
  if (!isNotFound(e)) throw e;
}

/** What stdout says of something not asked for a reason that would say what the listener holds or rated. */
export const NOT_PICKED = "not asked, since nothing could be picked to ask it of (stderr says why)";
/**
 * Says on stderr, to the person, why nothing could be picked, and gives what stdout says instead: the charts are
 * public, so "none of the first five could be picked" would tell a reader of the report that the listener holds or
 * rated those five.
 */
export function unpicked(run: Pick<tRun, "id">, why: string): string {
  say(`  ${run.id}: ${why}.`);
  return NOT_PICKED;
}

/** What the run makes once and shares: made by the first check to ask for it, and the same promise for the rest. */
export function once<T>(run: Pick<tRun, "memo">, key: string, make: () => Promise<T>): Promise<T> {
  let made = run.memo.get(key) as Promise<T> | undefined;
  if (made === undefined) {
    made = make();
    run.memo.set(key, made);
  }
  return made;
}

/**
 * What went wrong in asking Apple, from its tag and status alone: the error's message holds the path it asked,
 * which for a listener's things holds the ids of their library.
 */
export function brief(e: AppleMusicError): string {
  // A read is tried again after a timeout, so the wait was longer than one try's.
  if (e.cause instanceof DOMException && e.cause.name === "TimeoutError") return `Apple did not answer, each try given ${String(TIMEOUT_MS / 1000)} seconds`;
  if (e._tag === "NetworkError") return "Apple could not be reached";
  // With no status there was no answer, as when there was no token to ask with: nothing was refused.
  if (e.status === undefined) return "Apple could not be asked";
  const code = text(e.errors?.[0]?.code);
  const status = `${String(e.status)}${code === undefined ? "" : `, code ${printable(code)}`}`;
  switch (e._tag) {
    case "RateLimited":
      return `Apple is limiting requests for this key (${status})`;
    case "DeveloperTokenInvalid":
      return `Apple refused the developer token (${status})`;
    case "UserTokenInvalid":
      return `Apple refused the Music User Token (${status})`;
    default:
      // A success the SDK found wanting, such as an answer with no resource in it.
      return e.status < 300 ? `Apple answered ${status}, with what the SDK could not read` : `Apple answered ${status}`;
  }
}

/**
 * Which request failed, from the error's own words: its path with every id in it left out, such as
 * `/v1/me/library/playlists/{id}/tracks`, since a library's ids are the listener's; or else the function that found
 * the answer wanting, such as `getSongRating`; or, where the error names neither, that it does not.
 */
export function whereOf(e: AppleMusicError): string {
  const path = /\/v1\/[^\s:?]*/.exec(e.message)?.[0];
  if (path !== undefined) {
    // What names a collection is small letters and hyphens; anything else after `/v1` is an id.
    const [, , ...segments] = path.split("/");
    return ["/v1", ...segments.map((segment) => (/^[a-z-]*$/.test(segment) ? segment : "{id}"))].join("/");
  }
  return /^([a-z][A-Za-z]*): /.exec(e.message)?.[1] ?? "a request it does not name";
}

/** The types of resource Apple's answers name, which alone are printed of the `type` an answer holds. */
const TYPES = new Set([
  "activities",
  "albums",
  "apple-curators",
  "artists",
  "curators",
  "genres",
  "library-albums",
  "library-artists",
  "library-music-videos",
  "library-playlist-folders",
  "library-playlists",
  "library-songs",
  "music-summaries",
  "music-videos",
  "personal-recommendation",
  "playlists",
  "ratings",
  "record-labels",
  "songs",
  "station-genres",
  "stations",
  "storefronts",
]);

/** A resource: an object with an id and a type, wherever it is in an answer. */
const isResource = (value: unknown) => typeof at(value, "id") === "string" && typeof at(value, "type") === "string";

/** How many resources an answer holds, at any depth: what a check of its shape saw of it. */
export function resourcesIn(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  return (isResource(value) ? 1 : 0) + Object.values(value).reduce<number>((n, each) => n + resourcesIn(each), 0);
}

/**
 * One way an answer differs from its type: the type of the resource nearest above it, as Apple named it and only
 * when it is one Apple names; the field below that resource, its indexes left out; and what the type expected. A
 * validator's message only ever says what was expected, never what was there.
 */
export interface tDiff {
  readonly type: string | undefined;
  readonly field: string;
  readonly message: string;
}

/** How an answer differs from what `schema` takes it to be, each way once. */
export function diffsOf(schema: schemas.tSchema<unknown>, body: unknown): readonly tDiff[] {
  const { issues } = schema["~standard"].validate(body);
  if (issues === undefined) return [];
  const diffs = new Map<string, tDiff>();
  for (const { path = [], message } of issues) {
    let type: string | undefined;
    let from = 0;
    let node = body;
    path.forEach((key, i) => {
      if (isResource(node)) {
        const named = String(at(node, "type"));
        type = TYPES.has(named) ? named : "resource";
        from = i;
      }
      node = at(node, key);
    });
    const field = path.slice(from).reduce<string>((s, key) => (typeof key === "number" ? `${s}[]` : s === "" ? key : `${s}.${key}`), "");
    const diff = { type, field: printable(field), message: printable(message) };
    diffs.set(JSON.stringify(diff), diff);
  }
  return [...diffs.values()];
}

/** A difference, as a line says it: `songs attributes.previews[].hlsUrl: required`. */
export const said = ({ type, field, message }: tDiff) => `${type === undefined ? "" : `${type} `}${field === "" ? "the answer" : field}: ${message}`;
/** The first three differences, and how many more there are. */
export const someOf = (diffs: readonly tDiff[]) => `${diffs.slice(0, 3).map(said).join("; ")}${diffs.length > 3 ? ` (and ${String(diffs.length - 3)} more)` : ""}`;

/**
 * Asks `shown` once a second, by the clock, until it is true or a minute has gone since `start`, which is when the
 * write it waits on was taken: resolves to the whole seconds since then, or undefined. A read Apple fails is taken as not shown yet, as `apply`'s own reads take one. Once the first
 * read finds nothing, stderr says what is waited for, so that a minute's quiet is not taken for a hang.
 */
export async function seconds(run: Pick<tRun, "signal">, what: string, shown: () => Promise<boolean>, start = Date.now(), pause = () => 1000): Promise<number | undefined> {
  for (let tries = 1; ; tries++) {
    let yes = false;
    try {
      yes = await shown();
    } catch (e) {
      apples(e);
    }
    // Whole seconds gone: what shows at the first read is 0 however long that read took.
    if (yes) return Math.floor((Date.now() - start) / 1000);
    if (Date.now() - start >= POLL_MS) return undefined;
    if (tries === 1) say(`  Waiting for ${what}, a minute at most…`);
    await sleep(pause(), run.signal);
  }
}
export const took = (s: number | undefined) => (s === undefined ? "more than a minute" : plural(s, "second"));

/**
 * The resources of a chart, those with an id, each with the page that opens it in Apple Music. A song's own `url` is
 * its album's page, where Delete from Library takes the whole album out, as it did on 18 October 2026: a song gets the
 * page of its own, which `/song/<id>` leads to.
 */
export function itemsOf(type: tItem["type"], data: unknown, storefront: string): tItem[] {
  return list(data).flatMap((resource) => {
    const id = idOf(resource);
    if (id === undefined) return [];
    const attributes = at(resource, "attributes");
    const url = type === "songs" ? `https://music.apple.com/${encodeURIComponent(storefront)}/song/${id}` : text(at(attributes, "url"));
    return [{ type, id, attributes, name: text(at(attributes, "name")) ?? id, by: text(at(attributes, "artistName")) ?? text(at(attributes, "curatorName")), url }];
  });
}

/** What a catalog resource's `library` relationship is, as the generated types have it, by the type it is asked of. */
const LIBRARY_SHAPES: Readonly<Partial<Record<tItem["type"], schemas.tSchema<unknown>>>> = {
  songs: schemas.songRelationshipsSongLibraryRelationship,
  albums: schemas.albumRelationshipsAlbumLibraryRelationship,
  playlists: schemas.playlistRelationshipsPlaylistLibraryRelationship,
  "music-videos": schemas.musicVideoRelationshipsMusicVideoLibraryRelationship,
};

/**
 * The library's id for a catalog resource the listener holds, or undefined for one they do not: its `library`
 * relationship, which needs their token and which no client function asks for, so the path is put together here,
 * each segment encoded as core's are. Against the live API on 18 October 2026 it answered 404 for each of a run's
 * picks, none of which the listener had, and with the listener's copy once one was added. What it answers for an
 * album of which they hold some songs alone, `add-to-library` asks. The first answer of each type with a copy in it is
 * held to its generated type too, and a difference is a line of the check that asked.
 */
export async function libraryIdOf(run: tRun, { type, id }: Pick<tItem, "type" | "id">): Promise<string | undefined> {
  let body: unknown;
  try {
    const path = `v1/catalog/${encodeURIComponent(run.storefront)}/${type}/${encodeURIComponent(id)}/library`;
    body = await run.music.request(path, { user: true, signal: run.signal });
  } catch (e) {
    notFound(e);
    return undefined;
  }
  const copy = idOf(list(at(body, "data"))[0]);
  const shape = LIBRARY_SHAPES[type];
  if (copy !== undefined && shape !== undefined && !run.memo.has(`library shape ${type}`)) {
    run.memo.set(`library shape ${type}`, Promise.resolve());
    const diffs = diffsOf(shape, body);
    if (diffs.length > 0) run.line("differs", `the ${type} library relationship, which check asks by hand: types: ${someOf(diffs)}.`, diffs);
  }
  return copy;
}
/** Whether a catalog resource is in the listener's library. */
export const inLibrary = async (run: tRun, item: Pick<tItem, "type" | "id">): Promise<boolean> => (await libraryIdOf(run, item)) !== undefined;

/** The listener's rating of a song, or undefined for none. */
export async function ratingOf(run: tRun, id: string): Promise<unknown> {
  try {
    return at(list(at(await getSongRating(run.music, id, { signal: run.signal }), "data"))[0], "attributes", "value");
  } catch (e) {
    notFound(e);
    return undefined;
  }
}

/**
 * A playlist of the listener's with this name, from the pages of their playlists, and how many pages that took. A
 * walk is held to the first thousand playlists, and a poll that walked some pages waits a second for each before the
 * next, so that a large library is walked at about a page a second rather than at the run's whole pace.
 */
export async function listed(run: tRun, name: string): Promise<{ readonly playlist: unknown; readonly pages: number }> {
  let seen = 0;
  for await (const playlist of run.music.user.listLibraryPlaylists({ limit: 100, maxPages: 10, signal: run.signal })) {
    seen += 1;
    if (text(at(playlist, "attributes", "name")) === name) return { playlist, pages: Math.ceil(seen / 100) };
  }
  return { playlist: undefined, pages: Math.max(1, Math.ceil(seen / 100)) };
}

/** What `addToLibrary` takes, one of each of which a run adds. */
export type tAddedType = "songs" | "albums" | "playlists" | "music-videos";

/** A catalog resource a run added to the library, when Apple took it, and for a song, the album it is from. */
export interface tAdded {
  readonly item: tItem;
  readonly at: number;
  /** A song's album, which was not in the library before the song was added. */
  readonly album?: string | undefined;
}

/** How a type an addition may be of is rated: by its id, a 404 for one never rated. */
const RATINGS: Readonly<Record<tAddedType, typeof getSongRating | undefined>> = { songs: getSongRating, albums: getAlbumRating, "music-videos": getMusicVideoRating, playlists: undefined };

/** Whether the listener has rated a catalog resource: a rating set on its library copy may be its rating too, and must take nothing of theirs. */
export async function rated(run: tRun, type: tAddedType, id: string): Promise<boolean> {
  const get = RATINGS[type];
  if (get === undefined) return false;
  try {
    return list(at(await get(run.music, id, { signal: run.signal }), "data")).length > 0;
  } catch (e) {
    notFound(e);
    return false;
  }
}

/** The tracks of a catalog album, songs and music videos: what deleting the album from the library takes with it. */
export async function tracksOf(run: tRun, album: string): Promise<readonly unknown[]> {
  try {
    // ponytail: the first page alone, a hundred tracks; an album of more is rare, and its later tracks go unchecked.
    return list(at(await getAlbumRelationship(run.music, album, "tracks", { signal: run.signal }), "data"));
  } catch (e) {
    notFound(e);
    return [];
  }
}

/**
 * Whether the listener holds any of these tracks: an album they hold in part may not count as held, and deleting it
 * from the library, as a cleanup step would, takes their tracks with it.
 */
export async function anyHeld(run: tRun, tracks: readonly unknown[]): Promise<boolean> {
  for (const track of tracks) {
    const id = idOf(track);
    const type = at(track, "type");
    if (id !== undefined && (type === "songs" || type === "music-videos") && (await inLibrary(run, { type, id }))) return true;
  }
  return false;
}

/**
 * Whether a catalog playlist may be added: one page of tracks, none of which the listener holds. Adding it may put
 * its songs in the library, and the cleanup then says to delete every song on its page.
 */
async function songsUnheld(run: tRun, playlist: string): Promise<boolean> {
  let page: unknown;
  try {
    page = await getPlaylistRelationship(run.music, playlist, "tracks", { signal: run.signal });
  } catch (e) {
    notFound(e);
    return true;
  }
  // ponytail: a playlist of more than a page is passed over, rather than every page of it read.
  return text(at(page, "next")) === undefined && !(await anyHeld(run, list(at(page, "data"))));
}

/**
 * The first of the first five that is neither in the library nor rated; for an album, none of whose tracks is either;
 * and for a playlist, none of whose songs is.
 */
async function unheld(run: tRun, type: tAddedType, items: readonly tItem[]): Promise<tItem | undefined> {
  for (const item of items.slice(0, 5)) {
    if ((await inLibrary(run, item)) || (await rated(run, type, item.id))) continue;
    if (type === "albums" && (await anyHeld(run, await tracksOf(run, item.id)))) continue;
    if (type === "playlists" && !(await songsUnheld(run, item.id))) continue;
    return item;
  }
  return undefined;
}

/** A song neither in the library nor rated, of the first five, whose album is not in the library either, and that album's id. */
async function songToAdd(run: tRun, songs: readonly tItem[]): Promise<{ readonly item: tItem; readonly album: string } | undefined> {
  for (const item of songs.slice(0, 5)) {
    if ((await inLibrary(run, item)) || (await rated(run, "songs", item.id))) continue;
    const album = idOf(list(at(await getSongRelationship(run.music, item.id, "albums", { signal: run.signal }), "data"))[0]);
    if (album !== undefined && !(await inLibrary(run, { type: "albums", id: album }))) return { item, album };
  }
  return undefined;
}

/**
 * The resource of a type the run adds to the library, once whichever check asks first: one the listener did not
 * have and has not rated, recorded before it is sent, so that the cleanup names it whatever the answer, and a rating
 * of its copy takes nothing of theirs. A song's album is not added as the album, so that what the album counts as
 * once the song is in is the song's doing alone. Resolves to what was added; to
 * Apple's refusal, which added nothing; or to undefined, when none of the chart's could be picked. An answer that was
 * lost is thrown, and the addition stays in the cleanup as one that may be there.
 */
export function added(run: tRun, type: tAddedType): Promise<tAdded | { readonly refused: string } | undefined> {
  return once(run, `added ${type}`, async () => {
    const charts = await run.charts();
    const items = { songs: charts.songs, albums: charts.albums, playlists: charts.playlists, "music-videos": charts.musicVideos }[type];
    // The song is picked whatever is added, by reads alone, so that no other addition is its album.
    const song = await once(run, "song to add", () => songToAdd(run, charts.songs));
    const other = type === "songs" ? undefined : await unheld(run, type, items.filter((item) => item.id !== song?.album));
    const picked = type === "songs" ? song : other === undefined ? undefined : { item: other, album: undefined };
    if (picked === undefined) return undefined;
    const left = { what: picked.item, sure: false };
    run.left.library.push(left);
    try {
      await addToLibrary(run.music, { [type]: [picked.item.id] }, { signal: run.signal });
    } catch (e) {
      const why = brief(refusal(e));
      // Refused, so not added: there is nothing to undo.
      run.left.library.splice(run.left.library.indexOf(left), 1);
      return { refused: why };
    }
    left.sure = true;
    return { item: picked.item, at: Date.now(), album: picked.album };
  });
}

/** When something the run added showed in the library, timed from when Apple took it, and the library's id for it. */
export function shown(run: tRun, { item, at: when }: tAdded): Promise<{ readonly after: number | undefined; readonly id: string | undefined }> {
  return once(run, `shown ${item.type} ${item.id}`, async () => {
    let id: string | undefined;
    const after = await seconds(run, `the ${item.type} added to show in the library`, async () => (id = await libraryIdOf(run, item)) !== undefined, when);
    return { after, id };
  });
}

/** An empty playlist of the run's own, made once, for what is asked of a library playlist: its id, or undefined when Apple's answer held none. */
export function ownPlaylist(run: tRun): Promise<string | undefined> {
  return once(run, "own playlist", async () => {
    const name = `${run.name} (for a rating)`;
    const made = { what: name, sure: false };
    run.left.playlists.push(made);
    let answer: unknown;
    try {
      answer = await createLibraryPlaylist(run.music, { attributes: { name, description: "Made by open-music-sdk check, to see how Apple keeps a rating. Safe to delete." } }, { signal: run.signal });
    } catch (e) {
      if (refused(e)) run.left.playlists.splice(run.left.playlists.indexOf(made), 1);
      throw e;
    }
    made.sure = true;
    return idOf(list(at(answer, "data"))[0]);
  });
}

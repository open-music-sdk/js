// `check`'s questions: what the SDK takes on trust about how Apple behaves, each asked through the SDK's own
// functions and answered as what Apple did, worded to go into the docs' "Differences from Apple's documentation" as it
// is. Their names are for the command line and for issues, so they stay.
import {
  FORMATS,
  addLibraryPlaylistTracks,
  addToFavorites,
  artworkUrl,
  createLibraryPlaylist,
  getLibraryPlaylist,
  getLibraryPlaylistRelationship,
  getPlaylistRelationship,
  getSongRating,
  getSongRatings,
  getSongsByIsrc,
  listLibraryPlaylists,
  listRecentlyPlayed,
  listRecentlyPlayedTracks,
  schemas,
  searchCatalog,
  validateUserToken,
} from "@open-music-sdk/server";
import { isOnHost } from "@open-music-sdk/core";
import {
  MOST_TRACKS,
  ORIGIN,
  SETTLE_S,
  added,
  anyHeld,
  apples,
  at,
  brief,
  defined,
  diffsOf,
  idOf,
  inLibrary,
  list,
  listed,
  notFound,
  plural,
  ratingOf,
  rated,
  refusal,
  refused,
  seconds,
  share,
  shown,
  someOf,
  text,
  took,
  tracksOf,
  unpicked,
  tokenRefusal,
  type tAdded,
  type tItem,
  type tRun,
} from "./check-ask";
import { printable } from "./files";

/** The packages a run reports on, in the order it does, each named as it is published. */
export const PACKAGES = ["client-catalog", "client-user", "lib-playlists", "util-artwork", "lib-preview-player", "user-token"] as const;
export type tPackage = (typeof PACKAGES)[number];

export interface tCheck {
  readonly id: string;
  /** One line for the help. */
  readonly about: string;
  /** The package whose assumption it asks about. */
  readonly pkg: tPackage;
  readonly writes: boolean;
  readonly run: (run: tRun) => Promise<void>;
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
    let withTypes: number;
    try {
      withTypes = list(at(await ask.with(), "data")).length;
    } catch (e) {
      // A finding of its own: the types client-user offers are not all ones Apple takes.
      run.line("differs", `${ask.fn} with every type client-user lists: ${brief(refusal(e))}. client-user offers a type Apple does not take.`);
      continue;
    }
    if (without === 0 && withTypes === 0) run.line("skipped", `${ask.fn}: nothing was played lately, asked with types or without`);
    else if (without === 0) run.line("differs", `${ask.fn} without types: Apple answered with nothing, though with them it answered with what was played. client-user leaves types optional, so a call without them gets nothing.`);
    else run.line("same", `${ask.fn} without types: Apple answered with what was played, as it did with them. types is optional, as client-user has it.`);
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

/**
 * What a rating never set answers, alone and as one of several: of one chart song the listener never rated, found by
 * asking for each in turn, so that no line says what they rated of the others.
 */
async function ratingUnset(run: tRun): Promise<void> {
  const songs = (await run.charts()).songs.slice(0, 25);
  if (songs.length === 0) { run.line("skipped", "the charts held no songs"); return; }
  let unrated: { readonly id: string; readonly answered: string } | undefined;
  for (const song of songs) {
    try {
      const body = await getSongRating(run.music, song.id, { signal: run.signal });
      if (list(at(body, "data")).length > 0) continue;
      unrated = { id: song.id, answered: "200 with 0 ratings. music.user.getSongRating rejects an answer with none as an ApiError of status 200." };
    } catch (e) {
      notFound(e);
      unrated = { id: song.id, answered: "404, which getSongRating rejects as an ApiError of status 404." };
    }
    break;
  }
  if (unrated === undefined) {
    run.line("skipped", unpicked(run, `every one of the chart's first ${plural(songs.length, "song")} is rated`));
    return;
  }
  run.line("report", `the rating of a song never rated: Apple answered ${unrated.answered}`);
  try {
    const body = await getSongRatings(run.music, [unrated.id], { signal: run.signal });
    run.line("report", `the ratings of songs none of which is rated, asked for as several: Apple answered 200 with ${plural(list(at(body, "data")).length, "rating")}, which getSongRatings resolves to as it is.`);
  } catch (e) {
    notFound(e);
    run.line("differs", "the ratings of songs none of which is rated, asked for as several: Apple answered 404. getSongRatings rejects, where client-user says it resolves to an empty list.");
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

    // Read as lib-playlists' `read` reads it: the first page by the client's function, the rest by the links, with
    // include=catalog put back, which the link of a playlist's tracks was seen to leave out on 18 October 2026.
    const second = await music.request(next, { signal, params: { include: ["catalog"] } });
    const keeps = new URL(next, ORIGIN).searchParams.get("include")?.split(",").includes("catalog") === true;
    const [a, b] = [catalogOf(first), catalogOf(second)];
    for (const [n, page] of [
      [1, a],
      [2, b],
    ] as const)
      run.line("report", `a long playlist's page ${String(n)} of tracks, with include=catalog: ${share(page.catalog, page.tracks)} with their catalog song, ${share(page.isrc, page.catalog)} of those with its ISRC, and ${share(page.catalogId, page.tracks)} with playParams.catalogId.`);
    run.line("report", `the next link ${keeps ? "keeps" : "drops"} include=catalog, which read puts back.`);
    // Judged page by page on whether include=catalog was honoured at all, and whether the songs it gave carry their
    // ISRC: a track no longer in the storefront has a catalog id and no catalog song on any page, and is no finding.
    if (a.catalog === 0 && a.catalogId === 0) run.line("skipped", "no track on the first page is in the catalog, so what include=catalog gives is not seen");
    else if (a.catalog === 0) run.line("differs", "include=catalog gave no track on the first page its catalog song. lib-playlists' read takes the ISRC from there, so an export holds none.");
    else if (b.catalog === 0 && b.catalogId === 0) run.line("skipped", "no track on the second page is in the catalog, so whether the next link keeps the catalog songs is not seen");
    else if (b.catalog === 0) run.line("differs", "past the first page, no track comes with its catalog song, though include=catalog is asked for again. lib-playlists' read takes the ISRC from there, so an export loses it after the first page.");
    else if (a.isrc < a.catalog || b.isrc < b.catalog) run.line("differs", "catalog songs come without their ISRC. lib-playlists' read takes the ISRC from there, so an export loses it for them.");
    else run.line("same", "the tracks on both pages carry their catalog song and its ISRC, as lib-playlists' read takes them.");
    return;
  }
  run.line("skipped", "no playlist of the first 25 in the library has more than a page of tracks");
}

async function playlistIncludeTracks(run: tRun): Promise<void> {
  const { music, signal } = run;
  // Any playlist with tracks: lib-playlists' read asks for one this way when its tracks answer 404.
  for (const id of list(at(await listLibraryPlaylists(music, { limit: 25, signal }), "data")).map(idOf).filter(defined)) {
    try {
      await getLibraryPlaylistRelationship(music, id, "tracks", { signal });
    } catch (e) {
      notFound(e);
      continue;
    }
    const tracks = list(at(list(at(await getLibraryPlaylist(music, id, { include: ["tracks"], signal }), "data"))[0], "relationships", "tracks", "data")).length;
    if (tracks > 0) run.line("same", "a playlist asked for with include=tracks carries its first tracks, which read checks a 404 for its tracks against.");
    else run.line("differs", "a playlist asked for with include=tracks carries none of its tracks. read checks a 404 for a playlist's tracks against them, so it would take such a 404 for a playlist with none, and apply would add everything again.");
    return;
  }
  run.line("skipped", "no playlist of the first 25 in the library has tracks");
}

async function userTokenRefused(run: tRun): Promise<void> {
  // Shaped like no token Apple gives, so it cannot be one.
  const madeUp = "open-music-sdk-check-not-a-token";
  try {
    await run.music.as(madeUp).request("v1/me/storefront", { signal: run.signal });
    run.line("differs", "a Music User Token Apple never gave was answered 200, as if it were one.");
    return;
  } catch (e) {
    // Only a refusal is an answer to report: no answer, a rate limit or Apple's own failure leaves it unanswered.
    run.line("report", `a Music User Token Apple never gave is answered ${String(tokenRefusal(e).status)}.`);
  }
  try {
    await validateUserToken(run.music, madeUp, { signal: run.signal });
    run.line("differs", "validateUserToken took a Music User Token Apple never gave.");
  } catch (e) {
    const failure = tokenRefusal(e);
    if (failure._tag === "UserTokenInvalid") run.line("same", "validateUserToken rejects it as UserTokenInvalid, as user-token has it.");
    else run.line("differs", `validateUserToken rejects it as ${failure._tag}: ${brief(failure)}. user-token has a refused Music User Token as UserTokenInvalid.`);
  }
}

/** The host lib-preview-player's docs name as the one to allow, a guess from clips seen on a subdomain of it. */
const PREVIEW_HOST = "itunes.apple.com";
/** Where util-artwork's docs say Apple serves catalog artwork. */
const ARTWORK_HOST = "mzstatic.com";

/** Each host, with how many of `urls` it serves, from the URL parser a browser reads them with. */
function hostsIn(urls: readonly string[]): string {
  const hosts = new Map<string, number>();
  for (const url of urls) {
    const host = URL.parse(url)?.host ?? "no host";
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  return [...hosts].map(([host, n]) => `${printable(host)} (${String(n)})`).join(", ");
}

async function previewHosts(run: tRun): Promise<void> {
  const { songs } = await run.charts();
  const urls = songs.map((song) => text(at(list(at(song.attributes, "previews"))[0], "url"))).filter(defined);
  if (urls.length === 0) {
    run.line("skipped", "no chart song had a preview");
    return;
  }
  run.line("report", `${String(urls.length)} of ${plural(songs.length, "chart song")} have a preview, served from ${hostsIn(urls)}.`);
  // As the player holds a clip to its `hosts`, with core's own check: https, the host or one under it, no port.
  const elsewhere = urls.filter((url) => !isOnHost(url, [PREVIEW_HOST]));
  if (elsewhere.length === 0) run.line("same", `every one is one that hosts: ["${PREVIEW_HOST}"] allows, as lib-preview-player's docs have it.`);
  else run.line("differs", `${plural(elsewhere.length, "preview")} not allowed by hosts: ["${PREVIEW_HOST}"], which lib-preview-player's docs name as the host to allow: ${hostsIn(elsewhere)}.`);
}

/** The charts' artwork, the templates with a URL. */
async function artworksOf(run: tRun): Promise<readonly unknown[]> {
  const charts = await run.charts();
  return [...charts.songs, ...charts.albums, ...charts.playlists, ...charts.musicVideos].map((item) => at(item.attributes, "artwork")).filter((artwork) => text(at(artwork, "url")) !== undefined);
}

async function artworkPlaceholders(run: tRun): Promise<void> {
  const artworks = await artworksOf(run);
  if (artworks.length === 0) {
    run.line("skipped", "nothing in the charts had artwork");
    return;
  }
  // Which placeholders the templates hold, as Apple sent them or as a URL parser left them.
  const seen = new Map<string, number>();
  for (const artwork of artworks) {
    const template = String(at(artwork, "url")).replaceAll("%7B", "{").replaceAll("%7D", "}");
    for (const name of new Set(Array.from(template.matchAll(/\{([^{}]*)\}/g), (m) => String(m[1])))) seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  run.line("report", `of ${plural(artworks.length, "artwork template")}, ${seen.size === 0 ? "none holds a placeholder" : `these hold ${[...seen].map(([name, n]) => `{${printable(name)}} (${String(n)})`).join(", ")}`}.`);
  // Each filled in by util-artwork itself, held to the host its docs name: a URL it gives with a brace left in it, or
  // one it refuses, is a template it does not know how to fill.
  const failed: string[] = [];
  for (const artwork of artworks) {
    try {
      const url = artworkUrl(artwork as Parameters<typeof artworkUrl>[0], 100, { hosts: [ARTWORK_HOST] });
      if (/[{}]|%7B|%7D/i.test(url)) failed.push(`a placeholder left in ${printable(url)}`);
    } catch (e) {
      // A TypeError, saying what it refused, as util-artwork's are.
      failed.push(printable((e as Error).message));
    }
  }
  const [first] = failed;
  if (first === undefined) run.line("same", `util-artwork fills every one, and each is on ${ARTWORK_HOST}, as its docs have it.`);
  else run.line("differs", `util-artwork could not fill ${plural(failed.length, "template")} of ${String(artworks.length)}, held to hosts: ["${ARTWORK_HOST}"]. The first: ${first}`);
}

/** What a server answering for an image says it sent, by its Content-Type: `image/webp`, or what else it was. */
const kindOf = (res: Response) => printable(res.headers.get("content-type")?.split(";")[0]?.trim() ?? "no content type");

async function artworkFormats(run: tRun): Promise<void> {
  const [artwork] = await artworksOf(run);
  if (artwork === undefined) {
    run.line("skipped", "nothing in the charts had artwork");
    return;
  }
  // Asked of Apple's image server as a page would ask it, with no token: it is not the API.
  const answers: string[] = [];
  const wrong: string[] = [];
  for (const format of FORMATS) {
    const url = artworkUrl(artwork as Parameters<typeof artworkUrl>[0], 100, { format, hosts: [ARTWORK_HOST] });
    let res: Response;
    try {
      res = await run.fetch(url, { signal: run.signal });
    } catch (e) {
      if (run.signal.aborted) throw e;
      answers.push(`${format}, no answer`);
      wrong.push(format);
      continue;
    }
    await res.body?.cancel();
    const kind = kindOf(res);
    answers.push(`${format}, ${String(res.status)} ${kind}`);
    // jpeg is jpg by another name; heic and heif are one family.
    const expected = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/hei", heif: "image/hei" }[format];
    if (!res.ok || !kind.startsWith(expected)) wrong.push(format);
  }
  run.line("report", `one chart artwork, at 100 pixels in each format util-artwork offers: ${answers.join("; ")}.`);
  if (wrong.length === 0) run.line("same", "Apple's image server sends each one, in the format asked for, as util-artwork's FORMATS has it.");
  else run.line("differs", `Apple's image server does not send ${wrong.join(", ")} as asked, though util-artwork's FORMATS offers ${wrong.length === 1 ? "it" : "them"}.`);
}

async function resolveMisses(run: tRun): Promise<void> {
  const songs = (await run.charts()).songs.filter((song) => song.by !== undefined);
  if (songs.length === 0) {
    run.line("skipped", "the charts held no song with an artist");
    return;
  }
  // As an import from another service would describe each: what it is called, who by, and on which album; no ISRC.
  const descriptions = songs.map((song) => ({ name: song.name, artistName: song.by, albumName: text(at(song.attributes, "albumName")) }));
  const { tracks, skipped } = await run.music.playlists.resolve(descriptions, { signal: run.signal });
  const found = new Set(tracks.map(idOf));
  const same = songs.filter((song, i) => !skipped.some((each) => each.index === i) && found.has(song.id)).length;
  run.line(
    "report",
    `resolve, given the name, artist and album of ${plural(songs.length, "chart song")} and no ISRC, found ${String(tracks.length)}, ${String(same)} of them the very song, and missed ${String(skipped.length)}.`,
  );
}

async function addToLibraryCheck(run: tRun): Promise<void> {
  const taken: tAdded[] = [];
  const answered: string[] = [];
  const charts = await run.charts();
  for (const type of ["songs", "albums", "playlists", "music-videos"] as const) {
    // A type the charts hold none of is passed over.
    if ({ songs: charts.songs, albums: charts.albums, playlists: charts.playlists, "music-videos": charts.musicVideos }[type].length === 0) continue;
    const addition = await added(run, type);
    if (addition === undefined) {
      unpicked(run, `none of the chart's first five ${type} could be picked: each was in your library, or rated, or held something of yours`);
      answered.push(`${type} not asked (stderr says why)`);
    }
    else if ("refused" in addition) answered.push(`${type}: ${addition.refused}`);
    else taken.push(addition);
  }
  run.line("report", `addToLibrary took ${taken.map(({ item }) => item.type).join(", ") || "none of them"}${answered.length === 0 ? "" : `; ${answered.join("; ")}`}.`);
  if (taken.length === 0) return;
  // Each by itself, at once, so one that never shows does not keep the others waiting.
  const times = await Promise.all(taken.map((each) => shown(run, each)));
  run.line("report", `each showed in the library after: ${taken.map(({ item }, i) => `${item.type}, ${took(times[i]?.after)}`).join("; ")}.`);

  // Whether an album counts as in the library once one song of it is: the song was picked from an album not in it
  // before, so the answer is the song's alone. If it does not, an album the listener holds some songs of passes for
  // one they do not have, and a cleanup step that deletes such an album would take their songs with it.
  const song = taken.find(({ item }) => item.type === "songs");
  if (song?.album !== undefined && times[taken.indexOf(song)]?.after !== undefined) {
    const counts = await inLibrary(run, { type: "albums", id: song.album });
    run.line("report", counts ? "the album of the song added counts as in the library, with that one song of it there." : "the album of the song added does not count as in the library, though one song of it is there.");
  }

  // A catalog playlist added may put its songs in the library too, as the Music app's setting for one has it: whether
  // it did is read off its first song, and the steps say what to undo either way.
  for (const { item: playlist } of taken.filter(({ item }) => item.type === "playlists")) {
    const first = idOf(list(at(await getPlaylistRelationship(run.music, playlist.id, "tracks", { signal: run.signal }), "data")).find((track) => at(track, "type") === "songs"));
    const seen = first !== undefined && (await inLibrary(run, { type: "songs", id: first }));
    run.left.playlistsSongs.push({ playlist, seen });
    run.line("report", seen ? "adding the playlist put its songs in the library too." : "adding the playlist had not put its songs in the library when check looked.");
  }
}

async function addToFavoritesCheck(run: tRun): Promise<void> {
  // A song neither in the library nor rated, so the steps that undo the favorite take away nothing the listener had.
  let song: tItem | undefined;
  for (const candidate of (await run.charts()).songs.slice(0, 10)) {
    if (!(await inLibrary(run, candidate)) && !(await rated(run, "songs", candidate.id))) {
      song = candidate;
      break;
    }
  }
  if (song === undefined) {
    run.line("skipped", unpicked(run, "none of the chart's first ten songs could be picked: each was in your library or rated"));
    return;
  }
  const left = { what: song, sure: false, inLibrary: false };
  run.left.favorites.push(left);
  try {
    await addToFavorites(run.music, { songs: [song.id] }, { signal: run.signal });
  } catch (e) {
    // Refused, so nothing to undo; any other failure may have been carried out, and stays in the steps.
    if (refused(e)) run.left.favorites.splice(run.left.favorites.indexOf(left), 1);
    throw e;
  }
  left.sure = true;
  const item = song;
  let value: unknown;
  const after = await seconds(run, "the favorite to show as a rating", async () => (value = await ratingOf(run, item.id)) !== undefined);
  run.line("report", after === undefined ? "addToFavorites took a song, which had no rating a minute later: a favorite is not a rating." : `addToFavorites took a song, which had a rating of ${printable(String(value))} after ${took(after)}.`);
  // Looked at once: one that shows up later is in the steps as one that may.
  left.inLibrary = await inLibrary(run, item);
  run.line("report", left.inLibrary ? "the song made a favorite was put in the library too." : "the song made a favorite was not in the library when check looked.");
}

/** A song to add to the playlist, and the chart album it is from, which the cleanup names. */
interface tAlbumSong {
  readonly id: string;
  readonly album: tItem;
}

/**
 * Up to `MOST_TRACKS` songs from the charts' albums of which the listener holds nothing, neither the album nor any of
 * its tracks, each with its album: the cleanup may say to delete those albums, which takes every track with them.
 */
async function albumSongs(run: tRun): Promise<readonly tAlbumSong[]> {
  const songs = new Map<string, tAlbumSong>();
  for (const album of (await run.charts()).albums) {
    if (songs.size >= MOST_TRACKS) break;
    if (await inLibrary(run, album)) continue;
    const all = await tracksOf(run, album.id);
    if (await anyHeld(run, all)) continue;
    // Songs that can be played, which a song not yet out or no longer to be streamed cannot: Apple may refuse to add
    // one, and the request it was in would be taken for one too large.
    const tracks = all.filter((track) => at(track, "type") === "songs" && at(track, "attributes", "playParams") !== undefined);
    for (const id of tracks.map(idOf).filter(defined)) if (!songs.has(id)) songs.set(id, { id, album });
  }
  return [...songs.values()].slice(0, MOST_TRACKS);
}

/** The albums of the first `n` songs, once each, in order: what adding them may have put in the library. */
const albumsOf = (songs: readonly tAlbumSong[], n: number) => [...new Set(songs.slice(0, n).map((song) => song.album))];

async function playlistCheck(run: tRun): Promise<void> {
  const { music, signal } = run;
  const name = run.name;
  const description = "Made by open-music-sdk check, to see how Apple keeps a playlist. Safe to delete.";

  const made = { what: name, sure: false };
  run.left.playlists.push(made);
  let answer: unknown;
  try {
    answer = await createLibraryPlaylist(music, { attributes: { name, description } }, { signal });
  } catch (e) {
    if (refused(e)) run.left.playlists.splice(run.left.playlists.indexOf(made), 1);
    throw e;
  }
  made.sure = true;
  let id = idOf(list(at(answer, "data"))[0]);
  run.line("report", id === undefined ? "the answer to making a playlist held no playlist, so apply has to find it by its name and description." : "the answer to making a playlist held the playlist, with its id.");
  // The answer is held to its type too: createLibraryPlaylist is asked here alone, since a run makes one playlist.
  const diffs = id === undefined ? [] : diffsOf(schemas.libraryPlaylistsResponse, answer);
  if (diffs.length > 0) run.line("differs", `createLibraryPlaylist's answer: types: ${someOf(diffs)}.`, diffs);

  // Asked for by its id, as `read` asks, and looked for among the listener's playlists, where `apply` looks: at once,
  // each timed from when Apple took it. Without an id in the answer, the id is the one the listing gives.
  const madeAt = Date.now();
  let found: unknown;
  const readable = (known: string) => seconds(run, "the new playlist to be read by its id", async () => (await getLibraryPlaylist(music, known, { signal }), true), madeAt);
  let pages = 1;
  const among = async () => {
    const walked = await listed(run, name);
    pages = walked.pages;
    return (found = walked.playlist) !== undefined;
  };
  const listing = () => seconds(run, "the new playlist to be among the library's", among, madeAt, () => pages * 1000);
  let readAfter: number | undefined;
  let listAfter: number | undefined;
  if (id === undefined) {
    listAfter = await listing();
    id = idOf(found);
    if (id === undefined) {
      run.line("skipped", "the playlist neither came back with an id nor showed among the library's playlists, so nothing more can be asked of it");
      return;
    }
    readAfter = await readable(id);
  } else [readAfter, listAfter] = await Promise.all([readable(id), listing()]);
  run.line("report", `the new playlist could be read by its id after ${took(readAfter)}, and was among the library's playlists after ${took(listAfter)}; apply's settle waits about ${String(SETTLE_S)} seconds.`);
  const asSent = found !== undefined && text(at(found, "attributes", "name")) === name && text(at(found, "attributes", "description", "standard")) === description;
  // apply looks for its playlist in the listing, for as long as its settle waits, and makes it when it is not there.
  if (found === undefined) run.line("differs", `the playlist was not among the library's playlists within a minute. apply's settle waits about ${String(SETTLE_S)} seconds, so apply would make another every time it ran.`);
  else if (asSent) run.line("same", "its name and description came back as they were sent, which apply finds a playlist by.");
  else run.line("differs", `its description came back as "${printable(text(at(found, "attributes", "description", "standard")) ?? "none")}". apply finds a playlist by its name and description, so a run by this plan would make another.`);

  // What an empty playlist's tracks answer, and what `read` makes of it: once it can be read by its id, so that a 404
  // is not the new playlist still on its way. A refusal is a finding; Apple failing is not.
  if (readAfter === undefined) run.line("skipped", "the playlist could not be read by its id within a minute, so what an empty one answers is not seen");
  else {
    try {
      run.line("report", `its tracks, while it had none: Apple answered with ${plural(list(at(await getLibraryPlaylistRelationship(music, id, "tracks", { signal }), "data")).length, "track")}.`);
    } catch (e) {
      run.line("report", `its tracks, while it had none: ${brief(refusal(e))}.`);
    }
    try {
      await music.playlists.read(id, { signal });
      run.line("same", "lib-playlists' read takes it for a playlist with no tracks.");
    } catch (e) {
      run.line("differs", `lib-playlists' read rejects a playlist with no tracks: ${brief(refusal(e))}. apply reads a playlist before it adds to it, so it cannot fill one it made.`);
    }
  }

  const songs = await albumSongs(run);
  const [firstSong] = songs;
  if (firstSong === undefined) {
    run.line("skipped", unpicked(run, "no chart album's songs could be picked to add: you held each album, or something of it, or it had none to play"));
    return;
  }
  run.left.playlistSongs = { albums: albumsOf(songs, songs.length), seen: false };
  let tracks = songs.map((song) => ({ id: song.id, type: "songs" as const }));
  let lost = false;
  try {
    await addLibraryPlaylistTracks(music, id, tracks, { signal });
    run.line("report", `one request took ${plural(tracks.length, "track")}.`);
  } catch (e) {
    if (!refused(e)) {
      // The answer was lost: the tracks may be there, which the reads below show, and they are not sent again.
      run.line("report", `the answer to adding ${plural(tracks.length, "track")}: ${brief(apples(e))}; whether they were added is read back.`);
      lost = true;
    } else {
      // Refused, so nothing was added, and a smaller request is safe to send. Only if that is taken was it the size
      // Apple refused; a track it will not take would have both refused.
      const first = `one request of ${plural(tracks.length, "track")}: ${brief(e)}`;
      const unanswered = "so how many tracks one request takes is not answered.";
      // Nothing added: no album of these songs is left to remove.
      run.left.playlistSongs = undefined;
      if (tracks.length <= 100) {
        run.line("failed", `${first}, ${unanswered}`);
        return;
      }
      tracks = tracks.slice(0, 100);
      // The albums of what is sent now, the songs it may put in the library, whatever the answer but a refusal.
      const sentAlbums = { albums: albumsOf(songs, tracks.length), seen: false };
      try {
        await addLibraryPlaylistTracks(music, id, tracks, { signal });
      } catch (again) {
        if (refused(again)) {
          run.line("failed", `${first}; and one of 100: ${brief(again)}. Neither was taken, ${unanswered}`);
          return;
        }
        run.left.playlistSongs = sentAlbums;
        throw again;
      }
      run.left.playlistSongs = sentAlbums;
      run.line("differs", `${first}; one of 100 was taken. lib-playlists' apply sends ${String(MOST_TRACKS)} to a request by default.`);
    }
  }

  const playlistId = id;
  let held: readonly (string | undefined)[] = [];
  const settled = await seconds(run, "the tracks added to show in the playlist", async () => (held = (await music.playlists.read(playlistId, { signal })).tracks.map((track) => track.catalogId)).length >= tracks.length);
  if (settled === undefined) {
    if (held.length > 0) run.line("report", `${String(held.length)} of the ${plural(tracks.length, "track")} added showed within a minute: Apple may have taken some and not the others.`);
    else if (lost) run.line("report", "none of the tracks whose answer was lost showed within a minute, so they were most likely not added.");
    else run.line("differs", `none of the ${plural(tracks.length, "track")} added showed within a minute; apply's settle waits about ${String(SETTLE_S)} seconds.`);
    return;
  }
  run.line("report", `the ${plural(tracks.length, "track")} showed after ${took(settled)}; apply's settle waits about ${String(SETTLE_S)} seconds.`);
  const sent = tracks.map((track) => track.id);
  const other = sent.filter((song, i) => held[i] !== song).length;
  if (other === 0 && held.length === sent.length) run.line("same", "read gives back the catalog id each track was added by, in order, which plan goes by.");
  else run.line("differs", `${plural(other, "track")} of ${String(sent.length)} came back under another catalog id, or none, or in another place. plan goes by the catalog id, so apply would add them again.`);

  const seen = await inLibrary(run, { type: "songs", id: firstSong.id });
  run.left.playlistSongs = { albums: albumsOf(songs, tracks.length), seen };
  run.line("report", seen ? "adding songs to the playlist put them in the library too." : "adding songs to the playlist had not put them in the library when check looked.");

  if (!asSent || other > 0 || held.length !== sent.length) {
    run.line("skipped", "apply was not run with the same plan: it finds the playlist by its name and description and goes by catalog ids, and one of them did not hold, so it would make another playlist or add every track again");
    return;
  }
  const result = await music.playlists.apply(music.playlists.plan({ name, description }, tracks), { signal });
  if (!result.created && result.appended === 0 && result.verified) run.line("same", "apply with the same plan found the playlist, added nothing, and saw it whole.");
  else run.line("differs", `apply with the same plan resolved to created ${String(result.created)}, appended ${String(result.appended)}, verified ${String(result.verified)}, where it should have found the playlist and added nothing.`);
}

/** Every question, in the order a run asks them within its package. Their names are for the command line and for issues, so they stay. */
export const CHECKS: readonly tCheck[] = [
  { id: "recently-played-types", pkg: "client-user", about: "Whether recently played needs types, as Apple's documentation says", writes: false, run: recentlyPlayedTypes },
  { id: "search-next", pkg: "client-catalog", about: "What a search's next link answers with", writes: false, run: searchNext },
  { id: "charts-next", pkg: "client-catalog", about: "What a chart's next link answers with", writes: false, run: chartsNext },
  { id: "isrc-next", pkg: "client-catalog", about: "Whether songs looked up by ISRC come in pages", writes: false, run: isrcNext },
  { id: "rating-unset", pkg: "client-user", about: "What Apple answers for a rating never set", writes: false, run: ratingUnset },
  { id: "playlist-include", pkg: "lib-playlists", about: "Whether a long playlist's tracks keep their catalog songs and ISRCs past the first page, as read asks for them", writes: false, run: playlistInclude },
  { id: "playlist-include-tracks", pkg: "lib-playlists", about: "Whether a playlist asked for with include=tracks carries its tracks", writes: false, run: playlistIncludeTracks },
  { id: "resolve-misses", pkg: "lib-playlists", about: "How many chart songs resolve misses, given their name, artist and album", writes: false, run: resolveMisses },
  { id: "user-token-refused", pkg: "user-token", about: "What Apple answers for a Music User Token it never gave", writes: false, run: userTokenRefused },
  { id: "preview-hosts", pkg: "lib-preview-player", about: "Which hosts serve the preview clips", writes: false, run: previewHosts },
  { id: "artwork-placeholders", pkg: "util-artwork", about: "Which placeholders artwork templates hold", writes: false, run: artworkPlaceholders },
  { id: "artwork-formats", pkg: "util-artwork", about: "Whether Apple's image server sends each format util-artwork offers", writes: false, run: artworkFormats },
  { id: "add-to-library", pkg: "client-user", about: "Which types the library takes, how soon they show, and whether an album counts once one song of it is in", writes: true, run: addToLibraryCheck },
  { id: "add-to-favorites", pkg: "client-user", about: "Whether a song made a favorite gets a rating or goes into the library", writes: true, run: addToFavoritesCheck },
  { id: "playlist", pkg: "lib-playlists", about: "A playlist made, given 300 songs, read back, and applied again", writes: true, run: playlistCheck },
];

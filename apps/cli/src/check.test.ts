import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppleMusicError } from "@open-music-sdk/server";
import { CHECKS, brief } from "./check";
import { FileUserTokenStore } from "./files";
import { main } from "./main";

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
  /** Reads before the playlist answers by its id, and before it is listed. */
  readable: number;
  listed: number;
  /** Reads of its tracks before the last tracks added show. */
  hidden: number;
  shown: number;
}

const catalogItem = (type: tType, id: string, attributes: Record<string, unknown> = {}) => ({
  id,
  type,
  attributes: { name: `Name of ${id}`, artistName: `Artist of ${id}`, url: `https://music.apple.com/gb/x/${id}`, artwork: { url: `https://is1-ssl.mzstatic.com/${id}/{w}x{h}bb.jpg` }, ...attributes },
});
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
  recent: { played: number; tracks: number; without: "same" | "empty" | 400 };
  /** What is in the listener's library, as `type/id`. */
  library: Set<string>;
  addStatus: Partial<Record<tType, number>>;
  /** Whether a favorite becomes a rating of 1, and goes into the library. */
  favoriteRates: boolean;
  favoriteInLibrary: boolean;
  listener: tPlaylist[];
  nextKeepsInclude: boolean;
  /** Whether a playlist asked for with include=tracks carries them, and whether include=catalog gives tracks their song. */
  includeTracks: boolean;
  includeCatalog: boolean;
  /** Whether the answer to a new playlist holds it, and what its description comes back as. */
  madeWithId: boolean;
  descriptionBack: (sent: string) => string;
  lag: { readable: number; listed: number; tracks: number };
  /** The most tracks one append takes, and whether the first one's answer is lost though the tracks land. */
  appendMost: number;
  appendLost: boolean;
  /** The catalog id a track added by `id` is held under. */
  heldAs: (id: string) => string;
  playlistSongsInLibrary: boolean;
  madeUpToken: 401 | 403 | 200;
  /** A path that fails with this status, whatever it is. */
  failing: Record<string, number>;
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
    albums: Array.from({ length: 30 }, (_, i) => catalogItem("albums", `a${String(i + 1)}`)),
    // A playlist is by its curator, not an artist.
    playlists: ["pl.chart1", "pl.chart2"].map((id) => ({ id, type: "playlists", attributes: { name: `Name of ${id}`, curatorName: `Curator of ${id}`, url: `https://music.apple.com/gb/x/${id}`, artwork: { url: "https://is1-ssl.mzstatic.com/{w}x{h}.jpg" } } })),
    videos: [catalogItem("music-videos", "mv1")],
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
    favoriteRates: true,
    favoriteInLibrary: false,
    listener: [
      { id: "p.short", name: "Short", description: "", tracks: tracksOf(4), readable: 0, listed: 0, hidden: 0, shown: 4 },
      { id: "p.long", name: "Long", description: "", tracks: tracksOf(150), readable: 0, listed: 0, hidden: 0, shown: 150 },
    ],
    nextKeepsInclude: true,
    includeTracks: true,
    includeCatalog: true,
    madeWithId: true,
    descriptionBack: (sent) => sent,
    lag: { readable: 0, listed: 0, tracks: 0 },
    appendMost: 300,
    appendLost: false,
    heldAs: (id) => id,
    playlistSongsInLibrary: true,
    madeUpToken: 401,
    failing: {},
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
  const catalog = apple.includeCatalog && url.searchParams.get("include")?.split(",").includes("catalog") === true;
  const tracks = playlist.tracks.slice(0, playlist.shown);
  if (tracks.length === 0) return refuse(404);
  // A track with no catalog id, such as one the listener uploaded, has no catalog song either.
  const page = tracks.slice(offset, offset + 100).map((track, i) => ({
    id: `i.${playlist.id}.${String(offset + i)}`,
    type: "library-songs",
    attributes: { name: "Listener's song", playParams: track.catalogId === "" ? {} : { catalogId: track.catalogId } },
    ...(catalog && track.catalogId !== "" ? { relationships: { catalog: { data: [{ id: track.catalogId, type: "songs", attributes: { isrc: track.isrc } }] } } } : {}),
  }));
  const more = offset + 100 < tracks.length;
  return json({ data: page, ...(more ? { next: `/v1/me/library/playlists/${playlist.id}/tracks?offset=${String(offset + 100)}${apple.nextKeepsInclude && catalog ? "&include=catalog" : ""}` } : {}) });
}

const asPlaylist = (playlist: tPlaylist, tracks: boolean) => ({
  id: playlist.id,
  type: "library-playlists",
  attributes: { name: playlist.name, description: { standard: playlist.description }, canEdit: true },
  ...(tracks ? { relationships: { tracks: { data: apple.includeTracks ? playlist.tracks.slice(0, Math.min(playlist.shown, 100)).map((_, i) => ({ id: `i.${String(i)}`, type: "library-songs" })) : [] } } } : {}),
});

async function answer(req: Request): Promise<Response> {
  asked.push(req);
  const url = new URL(req.url);
  const path = url.pathname;
  const query = url.searchParams;
  const method = req.method;
  const failing = apple.failing[path];
  if (failing !== undefined) return refuse(failing);
  if (path === "/v1/test") return nothing(200);
  if (path === "/v1/me/storefront") {
    if (req.headers.get("music-user-token") === MADE_UP) return apple.madeUpToken === 200 ? json({ data: [{ id: "gb" }] }) : refuse(apple.madeUpToken);
    return json({ data: [{ id: "gb", type: "storefronts" }] });
  }
  if (path === "/v1/catalog/gb/charts") {
    if (url.search === new URL(apple.chartNextLink, url).search)
      return json(apple.chartNext === "page" ? { data: apple.songs.slice(1, 2) } : apple.chartNext === "neither" ? {} : { results: { songs: [{ chart: "most-played", data: apple.songs.slice(1, 2) }] } });
    const chart = (data: unknown[], next?: string) => [{ chart: "most-played", name: "Top", data, ...(next === undefined ? {} : { next }) }];
    return json({
      results: {
        songs: chart(apple.songs, apple.chartNext === "none" ? undefined : apple.chartNextLink),
        albums: chart(apple.albums),
        playlists: chart(apple.playlists),
        "music-videos": chart(apple.videos),
      },
    });
  }
  if (path === "/v1/catalog/gb/search") {
    if (!query.has("offset")) return json({ results: { songs: { data: apple.songs.slice(0, 1), ...(apple.searchNext === "none" ? {} : { next: "/v1/catalog/gb/search?offset=1&term=love&types=songs" }) } } });
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
    const songs = apple.songless.has(album) ? [] : Array.from({ length: 12 }, (_, i) => catalogItem("songs", `${album}t${String(i + 1)}`));
    return json({ data: [...songs, catalogItem("music-videos", `${album}v`)] });
  }
  const inLibrary = /^\/v1\/catalog\/gb\/([^/]+)\/([^/]+)\/library$/.exec(path);
  if (inLibrary) return apple.library.has(`${inLibrary[1] ?? ""}/${inLibrary[2] ?? ""}`) ? json({ data: [{ id: "l.held", type: "library-songs" }] }) : refuse(404);
  if (path === "/v1/me/ratings/songs") {
    const ids = query.get("ids")?.split(",") ?? [];
    const data = ids.filter((id) => apple.rated.has(id)).map((id) => ({ id, type: "ratings", attributes: { value: apple.rated.get(id) } }));
    return data.length === 0 && apple.noneRated === "404" ? refuse(404) : json({ data });
  }
  const rating = /^\/v1\/me\/ratings\/songs\/([^/]+)$/.exec(path);
  if (rating) {
    const id = rating[1] ?? "";
    if (apple.rated.has(id)) return json({ data: [{ id, type: "ratings", attributes: { value: apple.rated.get(id) } }] });
    return apple.unrated === "404" ? refuse(404) : json({ data: [] });
  }
  if (path === "/v1/me/recent/played" || path === "/v1/me/recent/played/tracks") {
    const n = path.endsWith("tracks") ? apple.recent.tracks : apple.recent.played;
    if (!query.has("types") && apple.recent.without === 400) return refuse(400);
    return json({ data: Array.from({ length: !query.has("types") && apple.recent.without === "empty" ? 0 : n }, (_, i) => ({ id: `r${String(i)}`, type: "albums" })) });
  }
  if (path === "/v1/me/library" && method === "POST") {
    for (const [key, ids] of query) {
      const type = /^ids\[(.+)\]$/.exec(key)?.[1] as tType;
      const status = apple.addStatus[type];
      if (status !== undefined) return refuse(status);
      for (const id of ids.split(",")) apple.library.add(`${type}/${id}`);
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
      const made: tPlaylist = { id: `p.made${String(apple.listener.length)}`, name: attributes.name, description: apple.descriptionBack(attributes.description), tracks: [], readable: apple.lag.readable, listed: apple.lag.listed, hidden: 0, shown: 0 };
      apple.listener.push(made);
      return json({ data: apple.madeWithId ? [asPlaylist(made, false)] : [] }, 201);
    }
    const offset = Number(query.get("offset") ?? "0");
    const limit = Number(query.get("limit") ?? "25");
    const listed = apple.listener.filter((playlist) => (playlist.listed-- <= 0 ? true : false));
    return json({ data: listed.slice(offset, offset + limit).map((playlist) => asPlaylist(playlist, false)), ...(offset + limit < listed.length ? { next: `/v1/me/library/playlists?offset=${String(offset + limit)}&limit=${String(limit)}` } : {}) });
  }
  const playlistPath = /^\/v1\/me\/library\/playlists\/([^/]+)(\/tracks)?$/.exec(path);
  const playlist = apple.listener.find((each) => each.id === playlistPath?.[1]);
  if (playlistPath && playlist) {
    if (playlistPath[2] === undefined) return playlist.readable-- > 0 ? refuse(404) : json({ data: [asPlaylist(playlist, query.get("include") === "tracks")] });
    if (method === "POST") {
      const { data } = (await req.json()) as { data: { id: string }[] };
      if (data.length > apple.appendMost) return refuse(400);
      playlist.tracks.push(...data.map(({ id }) => ({ catalogId: apple.heldAs(id), isrc: `ISRC${id}` })));
      playlist.hidden = apple.lag.tracks;
      if (apple.playlistSongsInLibrary) for (const { id } of data) apple.library.add(`songs/${id}`);
      if (apple.appendLost) {
        apple.appendLost = false;
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
      }
      return nothing(204);
    }
    if (playlist.hidden-- <= 0) playlist.shown = playlist.tracks.length;
    return tracksPage(playlist, url);
  }
  return refuse(404);
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
    ["a request the CLI's limit cut off", timeout, "Apple did not answer within 30 seconds"],
    ["no answer at all", new AppleMusicError("NetworkError", "GET /v1/me/library/playlists/p.secret: fetch failed"), "Apple could not be reached"],
    ["a rate limit", new AppleMusicError("RateLimited", "GET /p.secret: 429", { status: 429 }), "Apple is limiting requests for this key (429)"],
    ["the developer token refused", new AppleMusicError("DeveloperTokenInvalid", "GET /p.secret: 401", { status: 401 }), "Apple refused the developer token (401)"],
    ["no developer token to ask with", new AppleMusicError("DeveloperTokenUnavailable", "the minter failed on p.secret"), "Apple could not be asked"],
    ["a Music User Token refused before it was sent, with no status", new AppleMusicError("UserTokenInvalid", "/v1/me/p.secret needs a Music User Token"), "Apple refused the Music User Token"],
    ["an answer without a code", new AppleMusicError("ApiError", "GET /p.secret: 503", { status: 503 }), "Apple answered 503"],
    ["an answer with Apple's code",new AppleMusicError("ApiError", "GET /p.secret: 500", { status: 500, errors: [{ id: "e", status: "500", code: "50000", title: "Oops" }] }), "Apple answered 500, code 50000"],
  ])("%s", (_what, error, words) => {
    expect(brief(error)).toBe(words);
  });
});

describe("which checks run: by name, in the list's order, and the write checks only with --write", () => {
  test("with none named, every check that reads runs, none that writes, and stderr says --write adds them", async () => {
    expect(await main(["check", "--no-color"])).toBe(0);
    for (const id of READS) expect(linesOf(id).length, id).toBeGreaterThan(0);
    for (const id of WRITES) expect(linesOf(id), id).toEqual([]);
    expect(posts()).toEqual([]);
    expect(stderr).toContain("--write adds them");
  });

  test("named checks run alone, in the list's order whatever the order named, and each once", async () => {
    expect(await main(["check", "rating-unset", "search-next", "rating-unset", "--no-color"])).toBe(0);
    const ran = stdout
      .split(LF)
      .map((line) => /^. ([\w-]+): /.exec(line)?.[1])
      .filter((id) => id !== undefined && CHECKS.some((each) => each.id === id));
    expect([...new Set(ran)]).toEqual(["search-next", "rating-unset"]);
    expect(asked.some((req) => new URL(req.url).pathname.startsWith("/v1/me/recent"))).toBe(false);
    expect(stderr).not.toContain("--write adds them");
  });

  test("a check that is not there is a mistake in how the CLI was run, and Apple is not asked", async () => {
    expect(await main(["check", "nothing-like-it"])).toBe(2);
    expect(stderr).toContain("There is no check 'nothing-like-it'");
    for (const id of CHECKS.map((each) => each.id)) expect(stderr).toContain(id);
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

  test("--write with none named runs the write checks after every one that reads, and says first what they leave", async () => {
    expect(await main(["check", "--write", "--no-color"])).toBe(0);
    const order = stdout
      .split(LF)
      .map((line) => /^. ([\w-]+): /.exec(line)?.[1])
      .filter((id): id is string => id !== undefined && CHECKS.some((each) => each.id === id));
    expect([...new Set(order)]).toEqual(CHECKS.map((each) => each.id));
    expect(stderr.indexOf("Apple's API can delete none of it")).toBeLessThan(stderr.indexOf("Asking: add-to-library"));
  });

  test("help lists every check by name, and marks those that write", async () => {
    expect(await main(["help", "check"])).toBe(0);
    for (const each of CHECKS) expect(stdout.split(LF).find((line) => line.trim().startsWith(`${each.id} `))?.endsWith("(--write)"), each.id).toBe(each.writes);
    expect(stdout).toContain("--write");
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
    expect(linesOf("search-next")).toEqual(["✗ search-next: Apple answered 503, code 50301, so this was not answered."]);
    expect(marksOf("isrc-next")).toEqual(["✓"]);
    expect(stdout).not.toContain("detail with");
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
    expect(marksOf("preview-hosts")).toEqual(["·"]);
  });

  test("what is printed holds no token, no id of the listener's library, and nothing of Apple's error details", async () => {
    apple.failing["/v1/me/library/playlists/p.long/tracks"] = 500;
    await finish(["check", "--write", "--no-color"], ["setTimeout", "clearTimeout"]);
    expect(stdout).not.toContain(TOKEN);
    expect(stdout).not.toMatch(/\b[pil]\.\w/);
    expect(stdout).not.toContain("detail with");
    expect(stdout).not.toContain("Listener's song");
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

describe("rating-unset: what Apple answers for a rating never set", () => {
  test("the songs never rated are left out of the ratings of several, and one is answered 404", async () => {
    expect(await main(["check", "rating-unset", "--no-color"])).toBe(0);
    expect(linesOf("rating-unset")).toEqual([
      "· rating-unset: the ratings of 25 chart songs: Apple answered with 1 rating, and left out the songs with none.",
      "· rating-unset: the rating of a song never rated: Apple answered 404, which getSongRating rejects as an ApiError of status 404.",
    ]);
  });

  test("an empty answer for one never rated is what the bound function rejects as an ApiError of status 200", async () => {
    apple.unrated = "empty";
    await main(["check", "rating-unset", "--no-color"]);
    expect(linesOf("rating-unset")[1]).toBe("· rating-unset: the rating of a song never rated: Apple answered 200 with 0 ratings. music.user.getSongRating rejects an answer with none as an ApiError of status 200.");
  });

  test.each(["/v1/me/ratings/songs", "/v1/me/ratings/songs/s2"])("a failure other than a 404 for %s fails the check", async (path) => {
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
    apple.rated.clear();
    apple.noneRated = "404";
    expect(await main(["check", "rating-unset", "--no-color"])).toBe(1);
    expect(marksOf("rating-unset")).toEqual(["≠", "·"]);
  });

  test("every chart song rated already is not asked about", async () => {
    for (const song of apple.songs) apple.rated.set(song.id as string, 1);
    await main(["check", "rating-unset", "--no-color"]);
    expect(marksOf("rating-unset")).toEqual(["·", "-"]);
  });
});

describe("playlist-include: a long playlist's tracks, as lib-playlists' read reads them", () => {
  test("the next link keeps include=catalog and the tracks past the first page carry ISRCs, and include=tracks carries tracks", async () => {
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(0);
    expect(linesOf("playlist-include")).toEqual([
      "· playlist-include: a long playlist's page 1 of tracks, with include=catalog: 100 tracks, 100 with their catalog song, 100 of those with its ISRC, and 100 with playParams.catalogId.",
      "· playlist-include: a long playlist's page 2 of tracks, with include=catalog: 50 tracks, 50 with their catalog song, 50 of those with its ISRC, and 50 with playParams.catalogId.",
      "· playlist-include: the next link keeps include=catalog.",
      "✓ playlist-include: the tracks past the first page carry their catalog song and its ISRC, as lib-playlists' read takes them.",
      "✓ playlist-include: the playlist asked for with include=tracks carries its first 100 tracks, which read checks a 404 for its tracks against.",
    ]);
  });

  test("a next link that drops include=catalog loses the ISRCs after the first page", async () => {
    apple.nextKeepsInclude = false;
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(1);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "≠", "✓"]);
    expect(linesOf("playlist-include")[2]).toContain("the next link drops include=catalog");
  });

  test("include=catalog that gives no track its song is ≠ on the first page already", async () => {
    apple.includeCatalog = false;
    await main(["check", "playlist-include", "--no-color"]);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "≠", "✓"]);
    expect(linesOf("playlist-include")[3]).toContain("gave no track on the first page its catalog song");
  });

  test("tracks past the first page that are none of them in the catalog say nothing of the link", async () => {
    apple.listener[1]?.tracks.splice(100, 50, ...Array.from({ length: 50 }, () => ({ catalogId: "", isrc: undefined })));
    await main(["check", "playlist-include", "--no-color"]);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "-", "✓"]);
  });

  test("include=tracks that carries none is ≠: read would take a 404 for the tracks for a playlist with none", async () => {
    apple.includeTracks = false;
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(1);
    expect(marksOf("playlist-include")).toEqual(["·", "·", "·", "✓", "≠"]);
  });

  test("a playlist's tracks Apple fails to answer for, other than a 404, fail the check", async () => {
    apple.failing["/v1/me/library/playlists/p.short/tracks"] = 403;
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(1);
    expect(linesOf("playlist-include")).toEqual(["✗ playlist-include: Apple refused the Music User Token (403, code 40301), so this was not answered."]);
  });

  test("a library with no playlist of more than a page of tracks is not asked about, and an empty one is passed over", async () => {
    apple.listener = [{ id: "p.empty", name: "Empty", description: "", tracks: [], readable: 0, listed: 0, hidden: 0, shown: 0 }];
    expect(await main(["check", "playlist-include", "--no-color"])).toBe(0);
    expect(linesOf("playlist-include")).toEqual(["- playlist-include: none of the first 1 playlist in the library has more than a page of tracks"]);
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

  test("no answer for the made-up token is no answer to report: the check is ✗", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.headers.get("music-user-token") === MADE_UP) return Promise.reject(new TypeError("fetch failed"));
      return real(req);
    });
    expect(await finish(["check", "user-token-refused", "--no-color"], ["setTimeout", "clearTimeout"])).toBe(1);
    expect(linesOf("user-token-refused")).toEqual(["✗ user-token-refused: Apple could not be reached, so this was not answered."]);
  });
});

describe("preview-hosts and artwork-placeholders: read from the charts", () => {
  test("the hosts of the clips are reported, with how many of the songs have one", async () => {
    (apple.songs[0]?.attributes as Record<string, unknown>).previews = [];
    expect(await main(["check", "preview-hosts", "--no-color"])).toBe(0);
    expect(linesOf("preview-hosts")).toEqual(["· preview-hosts: 29 of 30 chart songs have a preview, served from audio-ssl.itunes.apple.com (29)."]);
  });

  test("a clip not over https is ≠, since the player refuses it", async () => {
    (apple.songs[0]?.attributes as Record<string, unknown>).previews = [{ url: "http://audio.itunes.apple.com/1.m4a" }];
    (apple.songs[1]?.attributes as Record<string, unknown>).previews = [{ url: "not a url" }];
    expect(await main(["check", "preview-hosts", "--no-color"])).toBe(1);
    expect(linesOf("preview-hosts")[0]).toContain("2 not over https");
  });

  test("clips none of which is a URL are served from no host", async () => {
    for (const song of apple.songs) (song.attributes as Record<string, unknown>).previews = [{ url: "not a url" }];
    await main(["check", "preview-hosts", "--no-color"]);
    expect(linesOf("preview-hosts")[0]).toContain("served from no host; 30 not over https");
  });

  test("songs with no clip at all are not asked about", async () => {
    for (const song of apple.songs) delete (song.attributes as Record<string, unknown>).previews;
    await main(["check", "preview-hosts", "--no-color"]);
    expect(marksOf("preview-hosts")).toEqual(["-"]);
  });

  test("templates holding only what util-artwork fills are ✓, with how many hold each", async () => {
    (apple.albums[0]?.attributes as Record<string, unknown>).artwork = { url: "https://is1-ssl.mzstatic.com/a/{w}x{h}{c}.{f}" };
    expect(await main(["check", "artwork-placeholders", "--no-color"])).toBe(0);
    expect(linesOf("artwork-placeholders")).toEqual(["✓ artwork-placeholders: of 63 artwork templates, these hold {w} (63), {h} (63), {c} (1), {f} (1): util-artwork fills each of them."]);
  });

  test("a placeholder util-artwork does not fill is ≠", async () => {
    (apple.videos[0]?.attributes as Record<string, unknown>).artwork = { url: "https://is1-ssl.mzstatic.com/v/{w}x{h}{q}.jpg" };
    expect(await main(["check", "artwork-placeholders", "--no-color"])).toBe(1);
    expect(linesOf("artwork-placeholders")[0]).toContain("leaves {q} as it is");
  });

  test("templates with no placeholder, and resources with no artwork, are counted as they are", async () => {
    for (const each of [...apple.songs, ...apple.albums, ...apple.playlists, ...apple.videos]) delete (each.attributes as Record<string, unknown>).artwork;
    (apple.albums[0]?.attributes as Record<string, unknown>).artwork = { url: "https://is1-ssl.mzstatic.com/a/fixed.jpg" };
    await main(["check", "artwork-placeholders", "--no-color"]);
    expect(linesOf("artwork-placeholders")).toEqual(["✓ artwork-placeholders: of 1 artwork template, none holds a placeholder: util-artwork fills each of them."]);
  });

  test("nothing in the charts with artwork is not asked about", async () => {
    for (const each of [...apple.songs, ...apple.albums, ...apple.playlists, ...apple.videos]) delete (each.attributes as Record<string, unknown>).artwork;
    await main(["check", "artwork-placeholders", "--no-color"]);
    expect(marksOf("artwork-placeholders")).toEqual(["-"]);
  });
});

/** The steps of the cleanup, after its heading. */
const cleanupOf = () => stdout.slice(stdout.indexOf("To undo what check left"));

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
    ]);
    expect(posts()).toEqual(["/v1/me/library", "/v1/me/library", "/v1/me/library", "/v1/me/library"]);
    const steps = cleanupOf();
    // s1 was the listener's already, so s2 was added, and only what was added is to be deleted.
    expect(steps).toContain('- the song "Name of s2" by Artist of s2: https://music.apple.com/gb/x/s2');
    expect(steps).not.toContain("Name of s1");
    expect(steps).toContain('- the album "Name of a1" by Artist of a1, with its songs: https://music.apple.com/gb/x/a1');
    expect(steps).toContain("choose Delete from Library from its … menu");
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
    expect(stdout).not.toContain("To undo");
  });

  test("whether a resource is in the library failing, other than with a 404, fails the check before anything is written", async () => {
    apple.failing["/v1/catalog/gb/songs/s1/library"] = 403;
    expect(await main(["check", "add-to-library", "--write", "--no-color"])).toBe(1);
    expect(marksOf("add-to-library")).toEqual(["✗"]);
    expect(posts()).toEqual([]);
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
    expect(linesOf("add-to-library")[0]).toContain("music-videos not asked, since the first five in the charts are in the library already");
  });

  test("an addition whose answer was lost is in the cleanup as one that may not be there, and the check is ✗", async () => {
    const real = answer;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "POST") return Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }));
      return real(req);
    });
    expect(await main(["check", "add-to-library", "--write", "--no-color"])).toBe(1);
    expect(linesOf("add-to-library")).toEqual(["✗ add-to-library: Apple could not be reached, so this was not answered."]);
    expect(cleanupOf()).toContain("Name of s1\" by Artist of s1: https://music.apple.com/gb/x/s1 (Apple's answer was lost, so it may not be there)");
  });

  test("a favorite that shows as a rating, made of a song neither in the library nor rated, is undone in the cleanup", async () => {
    apple.library.add("songs/s2");
    expect(await main(["check", "add-to-favorites", "--write", "--no-color"])).toBe(0);
    expect(linesOf("add-to-favorites")).toEqual(["· add-to-favorites: addToFavorites took a song, which had a rating of 1 after 0 seconds.", "· add-to-favorites: the song made a favorite was not in the library when check looked."]);
    // s1 is rated and s2 in the library, so s3.
    expect(cleanupOf()).toContain('Undo the favorite on the song "Name of s3" by Artist of s3: open https://music.apple.com/gb/x/s3, and choose Undo Favorite from its … menu.');
    expect(cleanupOf()).not.toContain("Delete these from your library");
  });

  test("a favorite that is no rating is said so after a minute, and one put in the library is deleted from it too", async () => {
    apple.favoriteRates = false;
    apple.favoriteInLibrary = true;
    expect(await finish(["check", "add-to-favorites", "--write", "--no-color"])).toBe(0);
    expect(linesOf("add-to-favorites")).toEqual(["· add-to-favorites: addToFavorites took a song, which had no rating a minute later: a favorite is not a rating.", "· add-to-favorites: the song made a favorite was put in the library too."]);
    expect(cleanupOf()).toContain('- the song "Name of s2" by Artist of s2');
  });

  test("ten chart songs each in the library or rated already are not asked about, and nothing is written", async () => {
    for (const song of apple.songs.slice(0, 10)) apple.library.add(`songs/${song.id as string}`);
    await main(["check", "add-to-favorites", "--write", "--no-color"]);
    expect(marksOf("add-to-favorites")).toEqual(["-"]);
    expect(posts()).toEqual([]);
    expect(stdout).not.toContain("To undo");
  });
});

describe("playlist: one made, given songs, read back, and applied again", () => {
  test("Apple keeps it as lib-playlists assumes: ✓ throughout, apply adds nothing, and the cleanup names the playlist and the albums", async () => {
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    const lines = linesOf("playlist").map((line) => line.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/, "<time>"));
    expect(lines).toEqual([
      "· playlist: the answer to making a playlist held the playlist, with its id.",
      "· playlist: the new playlist could be read by its id after 0 seconds, and was among the library's playlists after 0 seconds; apply's settle waits about 4 seconds.",
      "✓ playlist: its name and description came back as they were sent, which apply finds a playlist by.",
      "· playlist: its tracks, while it had none: Apple answered 404, code 40401.",
      "✓ playlist: lib-playlists' read takes it for a playlist with no tracks.",
      "· playlist: one request took 300 tracks.",
      "· playlist: the 300 tracks showed after 0 seconds; apply's settle waits about 4 seconds.",
      "✓ playlist: read gives back the catalog id each track was added by, in order, which plan goes by.",
      "· playlist: adding songs to the playlist put them in the library too.",
      "✓ playlist: apply with the same plan found the playlist, added nothing, and saw it whole.",
    ]);
    // One playlist made, one append: apply wrote nothing.
    expect(posts()).toEqual(["/v1/me/library/playlists", "/v1/me/library/playlists/p.made2/tracks"]);
    const steps = cleanupOf();
    expect(steps).toMatch(/1\. Delete the playlist "open-music-sdk check \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC": find it in Playlists/);
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

  test("300 tracks refused in one request is ≠, and 100, which is safe to send after a refusal, are added instead", async () => {
    apple.appendMost = 100;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist")).toContain("≠ playlist: one request of 300 tracks: Apple answered 400, code 40001. lib-playlists lets chunk be 300.");
    expect(linesOf("playlist")).toContain("· playlist: one request of 100 tracks was taken.");
    expect(linesOf("playlist")).toContain("· playlist: the 100 tracks showed after 0 seconds; apply's settle waits about 4 seconds.");
  });

  test("an append whose answer was lost is read back, not sent again", async () => {
    apple.appendLost = true;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist")).toContain("· playlist: the answer to adding 300 tracks: Apple could not be reached; whether they were added is read back.");
    expect(posts().filter((path) => path.endsWith("/tracks"))).toHaveLength(1);
  });

  test("how long each step takes to show is counted by the clock, a read a second", async () => {
    apple.lag = { readable: 2, listed: 3, tracks: 6 };
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist")).toContain("· playlist: the new playlist could be read by its id after 2 seconds, and was among the library's playlists after 3 seconds; apply's settle waits about 4 seconds.");
    expect(linesOf("playlist")).toContain("· playlist: the 300 tracks showed after 6 seconds; apply's settle waits about 4 seconds.");
  });

  test("tracks that do not show within a minute are ≠, and the rest is not asked", async () => {
    apple.lag.tracks = 1000;
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(1);
    expect(linesOf("playlist").at(-1)).toBe("≠ playlist: 0 tracks of the 300 added showed within a minute; apply's settle waits about 4 seconds.");
    expect(cleanupOf()).toContain("Delete the playlist");
  });

  test("an answer that holds no playlist is found among the listener's playlists by its name", async () => {
    apple.madeWithId = false;
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist").slice(0, 2)).toEqual([
      "· playlist: the answer to making a playlist held no playlist, so apply has to find it by its name and description.",
      "· playlist: the new playlist was among the library's playlists after 0 seconds; apply's settle waits about 4 seconds.",
    ]);
  });

  test("one with no id that is never listed cannot be asked more of, and is still in the cleanup", async () => {
    apple.madeWithId = false;
    apple.lag.listed = 1000;
    await finish(["check", "playlist", "--write", "--no-color"]);
    expect(marksOf("playlist").at(-1)).toBe("-");
    expect(cleanupOf()).toContain("Delete the playlist");
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
    expect(linesOf("playlist").at(-1)).toMatch(/^≠ playlist: apply with the same plan resolved to created true, appended 300, verified (true|false), where it should have found the playlist and added nothing\.$/);
    expect(cleanupOf()).toContain(", all 2 of that name");
  });

  test("a playlist with an id that is never listed is read on, but its name and description are not seen, and apply is not run", async () => {
    apple.lag.listed = 1000;
    expect(await finish(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist")).toContain("- playlist: the playlist was not listed within a minute, so whether its name and description come back as sent is not seen");
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
    expect(cleanupOf()).toContain("Delete the playlist");
  });

  test("albums that are all in the library, or hold no songs, give none to add, and the playlist alone is to be deleted", async () => {
    for (const album of apple.albums.slice(1)) apple.library.add(`albums/${album.id as string}`);
    apple.songless.add("a1");
    expect(await main(["check", "playlist", "--write", "--no-color"])).toBe(0);
    expect(linesOf("playlist").at(-1)).toBe("- playlist: no chart album that is not in the library had songs to add");
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
    expect(cleanupOf()).toMatch(/Delete the playlist "open-music-sdk check .* UTC": find it in Playlists, and choose Delete from Library from its … menu\. \(Apple's answer was lost, so it may not be there\)/);
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
    expect(cleanupOf()).toContain("Delete the playlist");
  });

  test("Ctrl+C stops it: exit 130, and the cleanup is printed for what was written so far", async () => {
    apple.lag.listed = 1000;
    const before = new Set(process.listeners("SIGINT"));
    const running = main(["check", "playlist", "--write", "--no-color"]);
    // While it waits for the playlist to be listed.
    await vi.waitFor(() => {
      expect(stdout).toContain("held the playlist");
    });
    const added = process.listeners("SIGINT").filter((listener) => !before.has(listener));
    expect(added).toHaveLength(1);
    added[0]?.("SIGINT");
    expect(await running).toBe(130);
    expect(stderr).toContain("Stopped.");
    expect(process.listeners("SIGINT")).toHaveLength(before.size);
    expect(cleanupOf()).toContain("Delete the playlist");
  });
});

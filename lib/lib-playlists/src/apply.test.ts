import type { tPlaylistTrack } from "@open-music-sdk/client-user";
import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { apply, type tApplyOptions } from "./apply";
import { plan, type tPlaylistPlan } from "./plan";

/** A track as the fake library keeps one: its own id, and the catalog's where it has one. */
interface tKept {
  readonly id: string;
  readonly catalogId?: string;
}

/** A playlist as the fake library keeps one. */
interface tKeptPlaylist {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly canEdit?: boolean | undefined;
  /** What a read shows. */
  tracks: tKept[];
  /** What was written and does not show yet, with how many more reads of the tracks each has to wait. */
  pending: { readonly tracks: tKept[]; reads: number }[];
  /** How many more times the listener's playlists are listed before this one is among them. */
  hidden: number;
}

/** Something to go wrong with the next requests that match, in place of the answer they would have had. */
interface tFault {
  readonly method: string;
  readonly path: RegExp;
  /** `lost`: no answer comes, as when a connection drops. A number: Apple answers with that status. */
  readonly answer: "lost" | number;
  /** Whether Apple carries the request out all the same. */
  readonly carried: boolean;
  times: number;
}

interface tReply {
  status?: number;
  body?: unknown;
}

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

const TRACKS = /^\/v1\/me\/library\/playlists\/[^/]+\/tracks$/;
const PLAYLISTS = /^\/v1\/me\/library\/playlists$/;

/**
 * A fetch that keeps a listener's playlists as Apple does, so far as these verbs go: they can be listed, read, made
 * and added to, and nothing else. `lag` is how many reads of a playlist's tracks pass before a write to it shows.
 */
function apple(start: readonly { id: string; name?: string; description?: string; canEdit?: boolean; holds?: readonly string[] }[] = [], options: { lag?: number; page?: number; retry?: false; madeWithNone?: boolean; hidden?: number } = {}) {
  const { lag = 0, page = 100 } = options;
  let made = 0;
  let added = 0;
  const kept = (catalogId: string): tKept => ({ id: `i.${String(++added)}`, catalogId });
  const library: tKeptPlaylist[] = start.map((each) => ({ id: each.id, name: each.name ?? "Untitled", description: each.description, canEdit: each.canEdit, tracks: (each.holds ?? []).map(kept), pending: [], hidden: 0 }));
  const calls: Request[] = [];
  const faults: tFault[] = [];
  const posted: string[][] = [];
  const bodies: unknown[] = [];

  const resource = (playlist: tKeptPlaylist) => ({
    id: playlist.id,
    type: "library-playlists",
    href: `/v1/me/library/playlists/${playlist.id}`,
    attributes: { name: playlist.name, canEdit: playlist.canEdit ?? true, ...(playlist.description === undefined ? {} : { description: { standard: playlist.description } }) },
  });
  const missing: tReply = { status: 404, body: { errors: [{ status: "404", title: "Resource Not Found" }] } };

  /** Carries a request out, and gives what Apple would answer. */
  async function route(request: Request, url: URL): Promise<tReply> {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (PLAYLISTS.test(url.pathname) && request.method === "GET") {
      if (offset === 0) for (const each of library) each.hidden = Math.max(0, each.hidden - 1);
      const shown = library.filter((each) => each.hidden === 0);
      return { body: { data: shown.slice(offset, offset + 2).map(resource), ...(offset + 2 < shown.length ? { next: `${url.pathname}?offset=${String(offset + 2)}` } : {}) } };
    }
    if (PLAYLISTS.test(url.pathname) && request.method === "POST") {
      const body = (await request.json()) as { attributes: { name: string; description?: string } };
      bodies.push(body);
      const playlist: tKeptPlaylist = { id: `p.new${String(++made)}`, name: body.attributes.name, description: body.attributes.description, tracks: [], pending: [], hidden: (options.hidden ?? 0) + 1 };
      library.push(playlist);
      return { status: 201, body: { data: options.madeWithNone === true ? [] : [resource(playlist)] } };
    }
    const playlist = library.find((each) => url.pathname.startsWith(`/v1/me/library/playlists/${each.id}`));
    if (playlist === undefined) return missing;
    if (TRACKS.test(url.pathname) && request.method === "POST") {
      const { data } = (await request.json()) as { data: tPlaylistTrack[] };
      posted.push(data.map((each) => each.id));
      playlist.pending.push({ tracks: data.map((each) => kept(each.id)), reads: lag });
      return { status: 204 };
    }
    if (TRACKS.test(url.pathname)) {
      if (offset === 0) {
        for (const write of playlist.pending) if (write.reads-- <= 0) playlist.tracks.push(...write.tracks);
        playlist.pending = playlist.pending.filter((write) => write.reads >= 0);
      }
      if (playlist.tracks.length === 0) return missing;
      const data = playlist.tracks.slice(offset, offset + page).map((each) => ({ id: each.id, type: "library-songs", attributes: { playParams: { id: each.id, catalogId: each.catalogId } } }));
      return { body: { data, ...(offset + page < playlist.tracks.length ? { next: `${url.pathname}?offset=${String(offset + page)}` } : {}) } };
    }
    return { body: { data: [resource(playlist)] } };
  }

  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    if (request.signal.aborted) throw request.signal.reason;
    const url = new URL(request.url);
    const fault = faults.find((each) => each.times > 0 && each.method === request.method && each.path.test(url.pathname));
    if (fault !== undefined) fault.times--;
    const reply = fault === undefined || fault.carried ? await route(request, url) : missing;
    if (fault?.answer === "lost") throw new TypeError("fetch failed");
    const answered = fault === undefined ? reply : { status: fault.answer, body: { errors: [] } };
    const res = new Response(answered.body === undefined ? null : JSON.stringify(answered.body), { status: answered.status ?? 200 });
    responses.push(res);
    return res;
  };

  return {
    music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, ...(options.retry === false || !("retry" in options) ? { retry: false as const } : {}) }),
    /** A client that makes its requests under the default retry policy. */
    patient: () => createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch }),
    calls,
    /** Each request as its method and path. */
    lines: () => calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    /** The ids each request to add tracks carried, in order. */
    posted,
    /** The body of each request to make a playlist. */
    bodies,
    /** The catalog ids a playlist holds, shown or not yet, in order. */
    holds: (id: string) => library.filter((each) => each.id === id).flatMap((each) => [...each.tracks, ...each.pending.flatMap((write) => write.tracks)].map((track) => track.catalogId)),
    playlists: () => library.map((each) => each.id),
    /** Has the next `times` matching requests go wrong. */
    fail: (method: string, path: RegExp, answer: "lost" | number, carried: boolean, times = 1) => {
      faults.push({ method, path, answer, carried, times });
    },
    /** Someone else adds a track to a playlist. */
    add: (id: string, catalogId: string) => library.find((each) => each.id === id)?.tracks.push(kept(catalogId)),
  };
}

const want = (...ids: string[]): tPlaylistTrack[] => ids.map((id) => ({ id, type: "songs" }));
/** A plan for the playlist with an id to hold these songs, made as if it held nothing: `apply` works out afresh what is missing. */
const forId = (id: string, ...ids: string[]): tPlaylistPlan => plan({ id, tracks: [] }, want(...ids));
/** No wait between the reads that settle a write, so that a test that has several does not take seconds. */
const QUICK: tApplyOptions = { settle: { waitMs: 0 } };
const numbered = (count: number): string[] => Array.from({ length: count }, (_, at) => String(1000 + at));

afterEach(() => {
  vi.useRealTimers();
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("apply: the playlist a plan names by its id", () => {
  test("what it is missing is added to its end, in the order wanted, and the answer says what was done", async () => {
    const { music, posted, holds } = apple([{ id: "p.1", holds: ["1", "2"] }]);
    expect(await apply(music, forId("p.1", "1", "2", "3", "4"))).toEqual({ id: "p.1", created: false, appended: 2, verified: true });
    expect(posted).toEqual([["3", "4"]]);
    expect(holds("p.1")).toEqual(["1", "2", "3", "4"]);
  });

  test("it is read, added to, and read once more", async () => {
    const { music, lines } = apple([{ id: "p.1", holds: ["1"] }]);
    await apply(music, forId("p.1", "1", "2"));
    expect(lines()).toEqual([
      "GET /v1/me/library/playlists/p.1",
      "GET /v1/me/library/playlists/p.1/tracks",
      "POST /v1/me/library/playlists/p.1/tracks",
      "GET /v1/me/library/playlists/p.1",
      "GET /v1/me/library/playlists/p.1/tracks",
    ]);
  });

  test("a playlist that holds everything wanted is written to not at all, and the read that showed so is the proof", async () => {
    const { music, lines } = apple([{ id: "p.1", holds: ["1", "2", "9"] }]);
    expect(await apply(music, forId("p.1", "2", "1"))).toEqual({ id: "p.1", created: false, appended: 0, verified: true });
    expect(lines()).toEqual(["GET /v1/me/library/playlists/p.1", "GET /v1/me/library/playlists/p.1/tracks"]);
  });

  test("an empty playlist is added to like any other", async () => {
    const { music, holds } = apple([{ id: "p.1" }]);
    expect(await apply(music, forId("p.1", "1", "2"))).toMatchObject({ appended: 2, verified: true });
    expect(holds("p.1")).toEqual(["1", "2"]);
  });

  test("what is missing is worked out from what the playlist holds now, not from when the plan was made", async () => {
    const { music, posted } = apple([{ id: "p.1", holds: ["1", "2"] }]);
    const stale = plan({ id: "p.1", tracks: [] }, want("1", "2", "3"));
    expect(stale.append).toEqual(want("1", "2", "3"));
    await apply(music, stale);
    expect(posted).toEqual([["3"]]);
  });

  test("a plan that says less is missing than is, is not taken at its word either", async () => {
    const { music, posted } = apple([{ id: "p.1" }]);
    await apply(music, { ...forId("p.1", "1", "2"), append: [] });
    expect(posted).toEqual([["1", "2"]]);
  });

  test("a plan that was written to a file and read back is a plan", async () => {
    const { music, holds } = apple([{ id: "p.1", holds: ["1"] }]);
    await apply(music, JSON.parse(JSON.stringify(forId("p.1", "1", "2"))) as tPlaylistPlan);
    expect(holds("p.1")).toEqual(["1", "2"]);
  });

  test("a song wanted twice is added as often as it is missing", async () => {
    const { music, posted } = apple([{ id: "p.1", holds: ["1"] }]);
    await apply(music, forId("p.1", "1", "1", "1"));
    expect(posted).toEqual([["1", "1"]]);
  });

  test("a playlist that is not there is Apple's 404, and nothing is written", async () => {
    const { music, posted } = apple();
    const error: unknown = await apply(music, forId("p.gone", "1")).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError") && error.status).toBe(404);
    expect(posted).toEqual([]);
  });

  test("both tokens go with every request: the playlist is the listener's", async () => {
    const { music, calls } = apple([{ id: "p.1" }]);
    await apply(music, forId("p.1", "1"));
    expect(new Set(calls.map((c) => `${c.headers.get("authorization") ?? ""} ${c.headers.get("music-user-token") ?? ""}`))).toEqual(new Set(["Bearer dev listener"]));
  });

  test("what it resolves to is frozen", async () => {
    const { music } = apple([{ id: "p.1" }]);
    expect(Object.isFrozen(await apply(music, forId("p.1", "1")))).toBe(true);
  });
});

describe("apply: what a playlist holds is read as its own, whatever other code put on Object.prototype", () => {
  const polluted = Object.prototype as Record<string, unknown>;

  afterEach(() => {
    for (const key of ["id", "catalogId", "data"]) Reflect.deleteProperty(polluted, key);
  });

  test("an id planted there is no track's catalog id: what the playlist holds is not added a second time", async () => {
    const { music, posted, holds } = apple([{ id: "p.1", holds: ["1", "2"] }]);
    const made = forId("p.1", "1", "2");
    polluted.id = "zzz";
    const applied = await apply(music, made, QUICK);
    Reflect.deleteProperty(polluted, "id");
    expect(applied).toMatchObject({ appended: 0, verified: true });
    expect(posted).toEqual([]);
    expect(holds("p.1")).toEqual(["1", "2"]);
  });

  test("a catalog id planted there is no track's either: a track the playlist does not hold is still added", async () => {
    const { music, posted, add } = apple([{ id: "p.1" }]);
    add("p.1", undefined as unknown as string);
    const made = forId("p.1", "1");
    polluted.catalogId = "1";
    const applied = await apply(music, made, QUICK);
    Reflect.deleteProperty(polluted, "catalogId");
    expect(applied).toMatchObject({ appended: 1, verified: true });
    expect(posted).toEqual([["1"]]);
  });
});

describe("apply: tracks go in order, chunk to a request", () => {
  test("five tracks two at a time are three requests, and the playlist ends in the order wanted", async () => {
    const { music, posted, holds } = apple([{ id: "p.1" }]);
    expect(await apply(music, forId("p.1", "a", "b", "c", "d", "e"), { chunk: 2 })).toMatchObject({ appended: 5, verified: true });
    expect(posted).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(holds("p.1")).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("left alone, a request carries a hundred", async () => {
    const { music, posted } = apple([{ id: "p.1" }]);
    await apply(music, forId("p.1", ...numbered(250)));
    expect(posted.map((ids) => ids.length)).toEqual([100, 100, 50]);
  });

  test("three hundred is the most one may carry, which is the most the client's function takes", async () => {
    const { music, posted } = apple([{ id: "p.1" }]);
    await apply(music, forId("p.1", ...numbered(301)), { chunk: 300 });
    expect(posted.map((ids) => ids.length)).toEqual([300, 1]);
  });
});

describe("apply: a write is sent once, whatever becomes of its answer", () => {
  test("an answer that is lost for a write Apple carried out: the playlist is read back, shows the tracks, and the run carries on", async () => {
    const { music, posted, holds, fail } = apple([{ id: "p.1", holds: ["0"] }]);
    fail("POST", TRACKS, "lost", true);
    expect(await apply(music, forId("p.1", "0", "a", "b", "c", "d"), { chunk: 2, ...QUICK })).toEqual({ id: "p.1", created: false, appended: 4, verified: true });
    expect(posted).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(holds("p.1")).toEqual(["0", "a", "b", "c", "d"]);
  });

  test("an answer that is lost for a write Apple did not carry out: the run rejects with the error it got, and sends nothing again", async () => {
    const { music, calls, holds, fail } = apple([{ id: "p.1" }]);
    fail("POST", TRACKS, "lost", false);
    const error: unknown = await apply(music, forId("p.1", "a", "b", "c", "d"), { chunk: 2, ...QUICK }).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "NetworkError")).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(holds("p.1")).toEqual([]);
  });

  test("a 500 for a write Apple carried out all the same is settled the same way", async () => {
    const { music, posted, fail } = apple([{ id: "p.1" }]);
    fail("POST", TRACKS, 500, true);
    expect(await apply(music, forId("p.1", "a", "b", "c"), { chunk: 2, ...QUICK })).toMatchObject({ appended: 3, verified: true });
    expect(posted).toEqual([["a", "b"], ["c"]]);
  });

  test("a 500 for a write Apple did not carry out rejects with that 500", async () => {
    const { music, calls, fail } = apple([{ id: "p.1" }]);
    fail("POST", TRACKS, 503, false);
    const error: unknown = await apply(music, forId("p.1", "a", "b"), QUICK).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError") && error.status).toBe(503);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  test.each([400, 403, 404, 409, 429, 501])("a %s says the write was not carried out: the run rejects at once, and the playlist is not read back", async (status) => {
    const { music, lines, fail } = apple([{ id: "p.1" }]);
    fail("POST", TRACKS, status, false);
    const error: unknown = await apply(music, forId("p.1", "a", "b", "c"), { chunk: 2 }).catch((e: unknown) => e);
    expect(isAppleMusicError(error) && error.status).toBe(status);
    expect(lines().at(-1)).toBe("POST /v1/me/library/playlists/p.1/tracks");
    expect(lines().filter((line) => line.startsWith("POST"))).toHaveLength(1);
  });

  test("a write whose tracks show late is waited for as settle says, and the run carries on", async () => {
    const { music, posted, fail } = apple([{ id: "p.1" }], { lag: 2 });
    fail("POST", TRACKS, "lost", true);
    expect(await apply(music, forId("p.1", "a", "b", "c"), { chunk: 2, settle: { tries: 5, waitMs: 0 } })).toMatchObject({ appended: 3 });
    expect(posted).toEqual([["a", "b"], ["c"]]);
  });

  test("a write whose tracks do not show within the reads settle allows rejects with the error it got", async () => {
    const { music, posted, fail } = apple([{ id: "p.1" }], { lag: 5 });
    fail("POST", TRACKS, "lost", true);
    const error: unknown = await apply(music, forId("p.1", "a", "b", "c"), { chunk: 2, settle: { tries: 3, waitMs: 0 } }).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "NetworkError")).toBe(true);
    expect(posted).toEqual([["a", "b"]]);
  });

  test("a read back that fails does not stand in for the write's own error", async () => {
    const { music, fail } = apple([{ id: "p.1", holds: ["0"] }]);
    fail("POST", TRACKS, "lost", false);
    fail("GET", /^\/v1\/me\/library\/playlists\/p\.1$/, 500, false, 9);
    // The first read is made before anything can fail: the fault is for the reads that follow the write.
    const error: unknown = await apply(music, plan({ name: "Untitled" }, want("a")), { settle: { tries: 2, waitMs: 0 } }).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError") && error.status).toBe(500);
    expect(isAppleMusicError(error, "NetworkError")).toBe(false);
  });

  test("tracks someone else added meanwhile are not taken for this run's: the run rejects, and does not carry on from a place it cannot be sure of", async () => {
    const { music, posted, fail, add } = apple([{ id: "p.1" }]);
    fail("POST", TRACKS, "lost", false);
    add("p.1", "theirs");
    add("p.1", "theirs too");
    const error: unknown = await apply(music, plan({ id: "p.1", tracks: [] }, want("a", "b", "c")), { chunk: 2, ...QUICK }).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "NetworkError")).toBe(true);
    expect(posted).toEqual([]);
  });

  test("a client that tries a failed request again still sends each write once", async () => {
    const { patient, posted, fail, holds } = apple([{ id: "p.1" }]);
    fail("POST", TRACKS, "lost", true);
    expect(await apply(patient(), forId("p.1", "a", "b"), QUICK)).toMatchObject({ appended: 2, verified: true });
    expect(posted).toEqual([["a", "b"]]);
    expect(holds("p.1")).toEqual(["a", "b"]);
  });
});

describe("apply: a run that stopped is carried on by calling it again with the same plan", () => {
  test("the second run adds what the first did not, and nothing the first did", async () => {
    const { music, posted, holds, fail } = apple([{ id: "p.1" }]);
    const made = forId("p.1", "a", "b", "c", "d", "e");
    fail("POST", TRACKS, 500, false);
    fail("POST", TRACKS, 500, false);
    posted.length = 0;
    await expect(apply(music, made, { chunk: 2, ...QUICK })).rejects.toMatchObject({ status: 500 });
    await expect(apply(music, made, { chunk: 2, ...QUICK })).rejects.toMatchObject({ status: 500 });
    expect(holds("p.1")).toEqual([]);
    expect(await apply(music, made, { chunk: 2, ...QUICK })).toMatchObject({ appended: 5, verified: true });
    expect(holds("p.1")).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("a run that stopped after its first request is carried on from the second", async () => {
    const { music, holds, fail } = apple([{ id: "p.1" }]);
    const made = forId("p.1", "a", "b", "c", "d", "e");
    await apply(music, forId("p.1", "a", "b"), QUICK);
    fail("POST", TRACKS, 403, false);
    await expect(apply(music, made, { chunk: 2 })).rejects.toMatchObject({ status: 403 });
    expect(await apply(music, made, { chunk: 2, ...QUICK })).toMatchObject({ appended: 3, verified: true });
    expect(holds("p.1")).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("a run whose lost write showed only afterwards adds nothing twice when it is run again", async () => {
    const { music, holds, fail } = apple([{ id: "p.1" }], { lag: 1 });
    const made = forId("p.1", "a", "b");
    fail("POST", TRACKS, "lost", true);
    await expect(apply(music, made, { settle: { tries: 1 } })).rejects.toMatchObject({ _tag: "NetworkError" });
    expect(await apply(music, made, { settle: { tries: 5, waitMs: 0 } })).toMatchObject({ appended: 0, verified: true });
    expect(holds("p.1")).toEqual(["a", "b"]);
  });

  test("a run begun again before a lost write shows cannot see it, and adds its tracks a second time: a run that rejected is not to be run again at once", async () => {
    const { music, holds, fail } = apple([{ id: "p.1" }], { lag: 3 });
    const made = forId("p.1", "a", "b");
    fail("POST", TRACKS, "lost", true);
    await expect(apply(music, made, { settle: { tries: 1 } })).rejects.toMatchObject({ _tag: "NetworkError" });
    await apply(music, made, { settle: { tries: 1 } });
    expect(holds("p.1")).toEqual(["a", "b", "a", "b"]);
  });
});

describe("apply: a playlist named by what it is called is found, or made once", () => {
  const mine = { name: "Road trip", description: "made by my-app" };

  test("one with that name and description is the playlist: it is not made, and what it is missing is added", async () => {
    const { music, posted, bodies, lines } = apple([
      { id: "p.other", name: "Road trip", description: "another app's" },
      { id: "p.1", ...mine, holds: ["1"] },
    ]);
    expect(await apply(music, plan(mine, want("1", "2")))).toEqual({ id: "p.1", created: false, appended: 1, verified: true });
    expect([posted, bodies]).toEqual([[["2"]], []]);
    expect(lines()[0]).toBe("GET /v1/me/library/playlists");
  });

  test("it is looked for on every page of the listener's playlists", async () => {
    const { music, lines } = apple([{ id: "p.a" }, { id: "p.b" }, { id: "p.c" }, { id: "p.d" }, { id: "p.1", ...mine }]);
    expect(await apply(music, plan(mine, want("1")))).toMatchObject({ id: "p.1", created: false });
    expect(lines().filter((line) => line === "GET /v1/me/library/playlists")).toHaveLength(3);
  });

  test("a playlist with no description is found by a plan with none", async () => {
    const { music } = apple([{ id: "p.1", name: "Road trip" }]);
    expect(await apply(music, plan({ name: "Road trip" }, want("1")))).toMatchObject({ id: "p.1", created: false });
  });

  test.each<[string, { id: string; name?: string; description?: string; canEdit?: boolean }]>([
    ["another description", { id: "p.1", name: "Road trip", description: "made by my-app (2)" }],
    ["no description", { id: "p.1", name: "Road trip" }],
    ["another name", { id: "p.1", name: "road trip", description: "made by my-app" }],
    ["the name and description, which the listener may not add to", { id: "p.1", ...mine, canEdit: false }],
  ])("a playlist with %s is not the one: the playlist is made", async (_name, there) => {
    const { music, bodies, holds } = apple([there]);
    expect(await apply(music, plan(mine, want("1")))).toEqual({ id: "p.new1", created: true, appended: 1, verified: true });
    expect(bodies).toEqual([{ attributes: mine }]);
    expect(holds("p.1")).toEqual([]);
  });

  test("a playlist that is made is made with its name and description and nothing else, and is added to without being read first", async () => {
    const { music, lines, bodies } = apple();
    await apply(music, plan({ name: "Road trip" }, want("1", "2")));
    expect(bodies).toEqual([{ attributes: { name: "Road trip" } }]);
    expect(lines().slice(0, 3)).toEqual(["GET /v1/me/library/playlists", "POST /v1/me/library/playlists", "POST /v1/me/library/playlists/p.new1/tracks"]);
  });

  test("a playlist that is to hold nothing is made all the same", async () => {
    const { music, lines } = apple();
    expect(await apply(music, plan(mine, []))).toEqual({ id: "p.new1", created: true, appended: 0, verified: true });
    expect(lines()).toEqual(["GET /v1/me/library/playlists", "POST /v1/me/library/playlists"]);
  });

  test("the answer to making it is lost, and Apple made it: it is found by looking, and is not made a second time", async () => {
    const { music, playlists, fail, holds } = apple();
    fail("POST", PLAYLISTS, "lost", true);
    expect(await apply(music, plan(mine, want("1")), QUICK)).toEqual({ id: "p.new1", created: true, appended: 1, verified: true });
    expect(playlists()).toEqual(["p.new1"]);
    expect(holds("p.new1")).toEqual(["1"]);
  });

  test("the answer to making it is lost, and it shows in the library only after a while: it is waited for as settle says", async () => {
    const { music, playlists, fail } = apple([], { hidden: 2 });
    fail("POST", PLAYLISTS, "lost", true);
    expect(await apply(music, plan(mine, want("1")), { settle: { tries: 5, waitMs: 0 } })).toMatchObject({ id: "p.new1", created: true });
    expect(playlists()).toEqual(["p.new1"]);
  });

  test("the answer to making it is lost, and Apple did not make it: the run rejects with the error it got, and does not try again", async () => {
    const { music, calls, playlists, fail } = apple();
    fail("POST", PLAYLISTS, "lost", false);
    const error: unknown = await apply(music, plan(mine, want("1")), QUICK).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "NetworkError")).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(playlists()).toEqual([]);
  });

  test("Apple makes it and answers with no playlist: it is found by looking", async () => {
    const { music, playlists } = apple([], { madeWithNone: true });
    expect(await apply(music, plan(mine, want("1")), QUICK)).toMatchObject({ id: "p.new1", created: true, appended: 1 });
    expect(playlists()).toEqual(["p.new1"]);
  });

  test("Apple answers with no playlist and none shows: the run says so, and what it says is an ApiError", async () => {
    const { music, calls } = apple([], { madeWithNone: true, hidden: 9 });
    const error: unknown = await apply(music, plan(mine, want("1")), { settle: { tries: 2, waitMs: 0 } }).catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError")).toBe(true);
    expect((error as Error).message).toBe("playlists.apply: Apple took the new playlist and answered with none, and it does not show in the library yet");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  test.each([400, 403, 429])("a %s to making it rejects at once, and the library is not looked through again", async (status) => {
    const { music, lines, fail } = apple();
    fail("POST", PLAYLISTS, status, false);
    await expect(apply(music, plan(mine, want("1")))).rejects.toMatchObject({ status });
    expect(lines()).toEqual(["GET /v1/me/library/playlists", "POST /v1/me/library/playlists"]);
  });

  test("an id put on Object.prototype by other code is not the plan's playlist: nothing is read there or written there", async () => {
    const { music, lines, holds } = apple([{ id: "p.theirs", holds: ["9"] }]);
    const stored = JSON.parse(JSON.stringify(plan(mine, want("1")))) as tPlaylistPlan;
    const polluted = Object.prototype as { id?: unknown };
    polluted.id = "p.theirs";
    try {
      expect(await apply(music, stored)).toMatchObject({ id: "p.new1", created: true, appended: 1 });
    } finally {
      delete polluted.id;
    }
    expect(lines().filter((line) => line.includes("p.theirs"))).toEqual([]);
    expect(holds("p.theirs")).toEqual(["9"]);
  });

  test("the plan carried out a second time finds the playlist the first time made", async () => {
    const { music, playlists, holds } = apple();
    const first = await apply(music, plan(mine, want("1", "2")));
    const second = await apply(music, plan(mine, want("1", "2", "3")));
    expect([first.created, second.created, second.id]).toEqual([true, false, first.id]);
    expect(playlists()).toEqual(["p.new1"]);
    expect(holds("p.new1")).toEqual(["1", "2", "3"]);
  });
});

describe("apply: verified says whether what was written showed before the run resolved", () => {
  test("tracks that show on a later read are waited for as settle says", async () => {
    const { music, lines } = apple([{ id: "p.1", holds: ["0"] }], { lag: 2 });
    expect(await apply(music, forId("p.1", "0", "a"), { settle: { tries: 5, waitMs: 0 } })).toMatchObject({ appended: 1, verified: true });
    expect(lines().filter((line) => line === "GET /v1/me/library/playlists/p.1/tracks")).toHaveLength(4);
  });

  test("tracks that do not show within the reads settle allows leave the run resolved, with verified false: nothing failed", async () => {
    const { music, holds } = apple([{ id: "p.1" }], { lag: 9 });
    expect(await apply(music, forId("p.1", "a", "b"), { settle: { tries: 3, waitMs: 0 } })).toEqual({ id: "p.1", created: false, appended: 2, verified: false });
    expect(holds("p.1")).toEqual(["a", "b"]);
  });

  test("a read afterwards that fails is not a run that failed: what was written stays written, and is not verified", async () => {
    const { music, fail, holds } = apple([{ id: "p.1", holds: ["0"] }]);
    const applying = apply(music, forId("p.1", "0", "a"), { settle: { tries: 2, waitMs: 0 }, onProgress: () => {
        fail("GET", TRACKS, 500, false, 9);
      },
    });
    expect(await applying).toEqual({ id: "p.1", created: false, appended: 1, verified: false });
    expect(holds("p.1")).toEqual(["0", "a"]);
  });

  test("settle.waitMs is waited between one such read and the next, and not before the first", async () => {
    vi.useFakeTimers();
    const { music, lines } = apple([{ id: "p.1", holds: ["0"] }], { lag: 1 });
    const answered = vi.fn();
    void apply(music, forId("p.1", "0", "a"), { settle: { tries: 3, waitMs: 2000 } }).then(answered);
    const reads = () => lines().filter((line) => line === "GET /v1/me/library/playlists/p.1/tracks").length;
    await vi.advanceTimersByTimeAsync(0);
    expect(reads()).toBe(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(reads()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads()).toBe(3);
    expect(answered).toHaveBeenCalledWith({ id: "p.1", created: false, appended: 1, verified: true });
  });

  test("left alone, a write is given five reads a second apart", async () => {
    vi.useFakeTimers();
    const { music, lines } = apple([{ id: "p.1", holds: ["0"] }], { lag: 99 });
    const answered = vi.fn();
    void apply(music, forId("p.1", "0", "a")).then(answered);
    await vi.advanceTimersByTimeAsync(3999);
    expect(answered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toHaveBeenCalledWith(expect.objectContaining({ verified: false }));
    expect(lines().filter((line) => line === "GET /v1/me/library/playlists/p.1/tracks")).toHaveLength(6);
  });
});

describe("apply: progress, pace and stopping", () => {
  test("it is told how many tracks have been added, of how many there are to add, after each request", async () => {
    const { music } = apple([{ id: "p.1", holds: ["0"] }]);
    const heard = vi.fn();
    await apply(music, forId("p.1", "0", "a", "b", "c", "d", "e"), { chunk: 2, onProgress: heard });
    expect(heard.mock.calls).toEqual([[{ done: 2, total: 5 }], [{ done: 4, total: 5 }], [{ done: 5, total: 5 }]]);
  });

  test("with nothing to add, there is nothing to tell", async () => {
    const { music } = apple([{ id: "p.1", holds: ["a"] }]);
    const heard = vi.fn();
    await apply(music, forId("p.1", "a"), { onProgress: heard });
    expect(heard).not.toHaveBeenCalled();
  });

  test("what onProgress throws stops the run, and is what apply rejects with; what was written stays written", async () => {
    const { music, posted } = apple([{ id: "p.1" }]);
    const stop = new Error("enough");
    await expect(
      apply(music, forId("p.1", "a", "b", "c"), {
        chunk: 2,
        onProgress: () => {
          throw stop;
        },
      }),
    ).rejects.toBe(stop);
    expect(posted).toEqual([["a", "b"]]);
  });

  test("delayMs is waited between one request to add and the next, and neither before the first nor after the last", async () => {
    vi.useFakeTimers();
    const { music, posted } = apple([{ id: "p.1" }]);
    const answered = vi.fn();
    void apply(music, forId("p.1", "a", "b", "c"), { chunk: 1, delayMs: 500 }).then(answered);
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(posted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(posted).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(posted).toHaveLength(3);
    expect(answered).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a signal already aborted asks for nothing, and its reason is what apply rejects with", async () => {
    const { music, calls } = apple([{ id: "p.1" }]);
    const reason = new Error("gone");
    await expect(apply(music, forId("p.1", "a"), { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(calls.every((c) => c.signal.aborted)).toBe(true);
  });

  test("an abort between two requests to add stops the run there: what was written stays, and nothing more is sent", async () => {
    const controller = new AbortController();
    const { music, posted } = apple([{ id: "p.1" }]);
    const reason = new Error("gone");
    await expect(
      apply(music, forId("p.1", "a", "b", "c", "d"), {
        chunk: 2,
        delayMs: 60_000,
        signal: controller.signal,
        onProgress: () => {
          controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(posted).toEqual([["a", "b"]]);
  });

  test("an abort while a lost write is being settled is the abort, and not the error the write got", async () => {
    const controller = new AbortController();
    const { music, fail } = apple([{ id: "p.1" }], { lag: 9 });
    const reason = new Error("gone");
    fail("POST", TRACKS, "lost", true);
    const applying = apply(music, forId("p.1", "a"), { settle: { tries: 9, waitMs: 60_000 }, signal: controller.signal });
    setTimeout(() => {
      controller.abort(reason);
    }, 20);
    await expect(applying).rejects.toBe(reason);
  });
});

describe("apply: what it is handed is checked before Apple is asked, and a mistake names the verb and the argument", () => {
  test.each<[string, unknown, RegExp]>([
    ["nothing", undefined, /^playlists\.apply: plan must be a plan as plan gives one, with a playlist and the tracks it is to hold; got undefined$/],
    ["a playlist's id", "p.1", /^playlists\.apply: plan must be a plan .*; got 3 characters$/],
    ["a list of tracks", want("1"), /^playlists\.apply: plan must be a plan .*; got object$/],
    ["a plan with no playlist", { tracks: want("1") }, /^playlists\.apply: playlist must be a playlist as read gives one, with an id, or one to make, as \{ name, description \}; got undefined$/],
    ["a plan for a playlist with an id that would leave its path", { playlist: { id: "p.1/../p.2" }, tracks: [] }, /^playlists\.apply: playlist\.id must be a string of 1 to 64 characters, with no slash/],
    ["a plan for a playlist with no name", { playlist: { description: "made by my-app" }, tracks: [] }, /^playlists\.apply: playlist must be .*; got one with no id, and undefined for a name$/],
    ["a plan with no tracks", { playlist: { id: "p.1" } }, /^playlists\.apply: tracks must be a list of tracks, .*; got undefined$/],
    ["a plan with a track that has no type", { playlist: { id: "p.1" }, tracks: [{ id: "1" }] }, /^playlists\.apply: tracks must be a list of tracks, .*; got object at index 0$/],
  ])("%s", async (_name, given, message) => {
    const { music, calls } = apple([{ id: "p.1" }]);
    await expect(apply(music, given as tPlaylistPlan)).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  test.each<[string, unknown, RegExp]>([
    ["options that are a list", [], /^playlists\.apply: expected an options object; got a list$/],
    ["a signal that is none", { signal: "stop" }, /^playlists\.apply: signal must be an AbortSignal; got 4 characters$/],
    ["an onProgress that is no function", { onProgress: {} }, /^playlists\.apply: onProgress must be a function; got object$/],
    ["a delayMs that is a string", { delayMs: "500" }, /^playlists\.apply: delayMs must be a number of milliseconds from 0 to 2147483647; got 3 characters$/],
    ["a chunk of none", { chunk: 0 }, /^playlists\.apply: chunk must be a whole number from 1 to 300; got 0$/],
    ["a chunk past what a request takes", { chunk: 301 }, /^playlists\.apply: chunk must be a whole number from 1 to 300; got 301$/],
    ["a chunk and a half", { chunk: 1.5 }, /^playlists\.apply: chunk must be a whole number from 1 to 300; got 1.5$/],
    ["a settle that is a number", { settle: 5 }, /^playlists\.apply: expected settle to be an options object; got 5$/],
    ["no tries at all", { settle: { tries: 0 } }, /^playlists\.apply: settle\.tries must be a whole number from 1; got 0$/],
    ["a wait below zero", { settle: { waitMs: -1 } }, /^playlists\.apply: settle\.waitMs must be a number of milliseconds from 0 to 2147483647; got -1$/],
  ])("%s", async (_name, options, message) => {
    const { music, calls } = apple([{ id: "p.1" }]);
    await expect(apply(music, forId("p.1", "1"), options as tApplyOptions)).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  test("the plan is checked before the options, in the order they were handed over", async () => {
    const { music } = apple();
    await expect(apply(music, undefined as unknown as tPlaylistPlan, [] as tApplyOptions)).rejects.toThrow(/^playlists\.apply: plan must be /);
  });

  test("the options are taken as the call is made: changing the caller's object afterwards changes nothing", async () => {
    const { music, posted } = apple([{ id: "p.1" }]);
    const options = { chunk: 2 };
    const applying = apply(music, forId("p.1", "a", "b", "c", "d"), options);
    options.chunk = 300;
    await applying;
    expect(posted.map((ids) => ids.length)).toEqual([2, 2]);
  });

  test("no error repeats what it was handed", async () => {
    const { music } = apple();
    const secret = "a-token-put-where-the-plan-goes";
    const error = (await apply(music, secret as unknown as tPlaylistPlan).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain(`${String(secret.length)} characters`);
    expect(error.message).not.toContain(secret);
  });
});

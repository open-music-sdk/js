import type { tPlaylistTrack } from "@open-music-sdk/client-user";
import type { tSong } from "@open-music-sdk/types";
import { describe, expect, expectTypeOf, test } from "vitest";
import { diff, plan, refsOf, targetOf, type tHeld, type tPlaylistSnapshot } from "./plan";

/** A catalog song as a wanted track. */
const want = (id: string): tPlaylistTrack => ({ id, type: "songs" });
/** A track a playlist holds: its own id is `i.` and the catalog's, unless it is told it has none. */
const hold = (catalogId: string | undefined, id = `i.${catalogId ?? "upload"}`): tHeld => ({ id, catalogId });
/** A playlist as read gives one, holding the catalog songs named. */
const snapshot = (...catalogIds: (string | undefined)[]): tPlaylistSnapshot => ({
  id: "p.1",
  name: "Road trip",
  tracks: catalogIds.map((catalogId, at) => (catalogId === undefined ? { id: `i.upload${String(at)}`, type: "library-songs" } : { id: `i.${catalogId}.${String(at)}`, type: "library-songs", catalogId })),
});

describe("diff", () => {
  test.each<[string, (string | undefined)[], string[], string[], number[], boolean]>([
    ["an empty playlist is missing everything wanted, in order", [], ["1", "2", "3"], ["1", "2", "3"], [], false],
    ["nothing wanted is nothing missing, and all it holds is extra", ["1", "2"], [], [], [0, 1], false],
    ["what it holds already is not added again", ["1", "2"], ["1", "2", "3"], ["3"], [], false],
    ["what is missing is added in the order wanted, wherever it falls among what is held", ["2"], ["1", "2", "3"], ["1", "3"], [], false],
    ["a track held and not wanted is extra, by where it is held", ["1", "9", "2"], ["1", "2"], [], [1], false],
    ["a song wanted twice and held once is missing once", ["1"], ["1", "1"], ["1"], [], false],
    ["a song wanted twice and held twice is not missing", ["1", "1"], ["1", "1"], [], [], false],
    ["a song wanted once and held twice has one extra: the later one", ["1", "1"], ["1"], [], [1], false],
    ["wanted tracks held in another order are reordered, and nothing is added for it", ["2", "1"], ["1", "2"], [], [], true],
    ["an extra between two wanted tracks does not make them reordered", ["1", "9", "2"], ["1", "2"], [], [1], false],
    ["a track the catalog does not know matches no catalog song", [undefined], ["1"], ["1"], [0], false],
  ])("%s", (_name, held, wanted, append, extra, reordered) => {
    expect(diff(held.map((id) => hold(id)), wanted.map(want))).toEqual({ append: append.map(want), extra, reordered });
  });

  test("a track is held under its own id as well, so a library track can be wanted by the id the library gave it", () => {
    expect(diff([hold("1", "i.abc")], [{ id: "i.abc", type: "library-songs" }])).toEqual({ append: [], extra: [], reordered: false });
  });

  test("a held track answers for one wanted track, whichever of its two ids it was wanted by", () => {
    const wanted: tPlaylistTrack[] = [want("1"), { id: "i.abc", type: "library-songs" }];
    expect(diff([hold("1", "i.abc")], wanted).append).toEqual([{ id: "i.abc", type: "library-songs" }]);
    expect(diff([hold("1", "i.abc"), hold("1", "i.def")], wanted).append).toEqual([{ id: "i.abc", type: "library-songs" }]);
  });

  test("an id that is the name of something every object has is an id and nothing else", () => {
    expect(diff([hold("constructor"), hold("__proto__")], [want("constructor"), want("__proto__"), want("toString")]).append).toEqual([want("toString")]);
  });

  test("what it was handed is left as it was", () => {
    const [held, wanted] = [Object.freeze([Object.freeze(hold("1"))]), Object.freeze([Object.freeze(want("2"))])];
    expect(() => diff(held, wanted)).not.toThrow();
  });

  test("ten thousand tracks, each wanted twice, are worked through without going over the list for each one", () => {
    const ids = Array.from({ length: 10_000 }, (_, at) => String(at));
    const started = performance.now();
    const { append } = diff(ids.map((id) => hold(id)), [...ids, ...ids].map(want));
    expect(append).toHaveLength(10_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("refsOf", () => {
  test("each track is taken as its id and its type and nothing else it held: a song is a track as it is", () => {
    const song = { id: "1", type: "songs", href: "/v1/catalog/us/songs/1", attributes: { name: "A" } } as unknown as tSong;
    expect(refsOf("playlists.plan", [song, { id: "i.2", type: "library-songs" }])).toEqual([want("1"), { id: "i.2", type: "library-songs" }]);
  });

  test("no tracks at all is a list like any other", () => {
    expect(refsOf("playlists.plan", [])).toEqual([]);
  });

  test("the list is this call's own: the caller's can change afterwards", () => {
    const given = [want("1")];
    const taken = refsOf("playlists.plan", given);
    given.push(want("2"));
    expect(taken).toEqual([want("1")]);
  });

  test.each<[string, unknown, string]>([
    ["no list", want("1"), "object"],
    ["nothing", undefined, "undefined"],
    ["a track that is an id alone", ["1"], "1 characters at index 0"],
    ["a track with no type", [want("1"), { id: "2" }], "object at index 1"],
    ["a track with an empty id", [{ id: "", type: "songs" }], "object at index 0"],
    ["a track whose id is as long as a token", [{ id: "a".repeat(65), type: "songs" }], "object at index 0"],
    ["a track that inherits its id", [Object.create(want("1"))], "object at index 0"],
    ["a track that is an instance of a class", [new (class { id = "1"; type = "songs"; })()], "object at index 0"],
  ])("%s is refused, with where the mistake is and nothing of what it held", (_name, tracks, what) => {
    expect(() => refsOf("playlists.plan", tracks)).toThrow(
      new TypeError(`playlists.plan: tracks must be a list of tracks, each a plain object with an id and a type of its own that are strings of 1 to 64 characters, such as { id: "1", type: "songs" }; got ${what}`),
    );
  });
});

describe("targetOf", () => {
  test("a playlist with an id is that playlist, whatever else it holds", () => {
    expect(targetOf("playlists.plan", snapshot("1"))).toEqual({ id: "p.1" });
    expect(targetOf("playlists.plan", { id: "p.1", name: "Another name" })).toEqual({ id: "p.1" });
  });

  test("a playlist with no id is one to find or make, by its name and its description", () => {
    expect(targetOf("playlists.plan", { name: "Road trip" })).toEqual({ name: "Road trip" });
    expect(targetOf("playlists.plan", { name: "Road trip", description: "made by my-app" })).toEqual({ name: "Road trip", description: "made by my-app" });
    expect(Object.keys(targetOf("playlists.plan", { name: "Road trip", description: undefined }))).toEqual(["name"]);
  });

  test.each<[string, unknown, RegExp]>([
    ["nothing", undefined, /^playlists\.plan: playlist must be a playlist as read gives one, with an id, or one to make, as \{ name, description \}; got undefined$/],
    ["an id alone", "p.1", /; got 3 characters$/],
    ["a list", [], /; got object$/],
    ["an empty object", {}, /; got one with no id, and undefined for a name$/],
    ["an empty name", { name: "" }, /; got one with no id, and 0 characters for a name$/],
    ["a name that is no string", { name: 7 }, /; got one with no id, and 7 for a name$/],
    ["a description that is no string", { name: "Road trip", description: 7 }, /^playlists\.plan: playlist\.description must be a string; got 7$/],
    ["an id that would leave its path", { id: "../../ratings" }, /^playlists\.plan: playlist\.id must be a string of 1 to 64 characters, with no slash/],
    ["an id that is no string", { id: 7 }, /^playlists\.plan: playlist\.id must be /],
    ["an object that inherits its id, which is no plain object", Object.create({ id: "p.1" }), /; got object$/],
  ])("a playlist that is %s is refused", (_name, playlist, message) => {
    expect(() => targetOf("playlists.plan", playlist)).toThrow(message);
  });
});

describe("plan: what a playlist is missing, and what cannot be done, with no request made", () => {
  test("for a playlist that was read: what to add, what would have to come out, and whether anything would have to move", () => {
    const playlist = snapshot("2", "9", "1");
    const made = plan(playlist, [want("1"), want("2"), want("3")]);
    expect(made).toEqual({ playlist: { id: "p.1" }, tracks: [want("1"), want("2"), want("3")], append: [want("3")], extra: [playlist.tracks[1]], reordered: true });
  });

  test("for a playlist still to be made: everything is added, and nothing is in the way", () => {
    expect(plan({ name: "Road trip", description: "made by my-app" }, [want("1"), want("2")])).toEqual({
      playlist: { name: "Road trip", description: "made by my-app" },
      tracks: [want("1"), want("2")],
      append: [want("1"), want("2")],
      extra: [],
      reordered: false,
    });
  });

  test("songs as the catalog gives them are tracks: a plan holds their ids and types and nothing else of them", () => {
    const songs = [{ id: "1", type: "songs", href: "/1", attributes: { name: "A" } }] as unknown as tSong[];
    expect(plan(snapshot(), songs).append).toEqual([want("1")]);
  });

  test("a plan is frozen all the way down, and is plain JSON: it is the same after being written out and read back", () => {
    const made = plan(snapshot("9"), [want("1")]);
    expect([made, made.playlist, made.tracks, made.append, made.extra].every((each) => Object.isFrozen(each))).toBe(true);
    expect(JSON.parse(JSON.stringify(made))).toEqual(made);
  });

  test("the extra tracks are the playlist's own, as they were read", () => {
    const playlist = snapshot("9");
    expect(plan(playlist, []).extra[0]).toBe(playlist.tracks[0]);
  });

  test("a playlist that was read, written to a file and read back plans the same", () => {
    const playlist = snapshot("1", undefined, "2");
    expect(plan(JSON.parse(JSON.stringify(playlist)) as tPlaylistSnapshot, [want("2"), want("3")])).toEqual(plan(playlist, [want("2"), want("3")]));
  });

  test("the caller's playlist and tracks are left as they were", () => {
    const [playlist, tracks] = [snapshot("1"), [want("2")]];
    const before = JSON.stringify([playlist, tracks]);
    plan(playlist, tracks);
    expect(JSON.stringify([playlist, tracks])).toBe(before);
  });

  test("an id put on Object.prototype by other code is not the playlist's: one named by what it is called stays one to find or make", () => {
    const polluted = Object.prototype as { id?: unknown };
    polluted.id = "p.theirs";
    try {
      expect(Object.keys(plan({ name: "Road trip" }, [want("1")]).playlist)).toEqual(["name"]);
      expect(plan({ name: "Road trip" }, [want("1")]).append).toEqual([want("1")]);
    } finally {
      delete polluted.id;
    }
  });

  test("the playlist is checked before the tracks, in the order they were handed over", () => {
    expect(() => plan(undefined as unknown as tPlaylistSnapshot, undefined as unknown as tPlaylistTrack[])).toThrow(/^playlists\.plan: playlist must be /);
    expect(() => plan({ name: "Road trip" }, undefined as unknown as tPlaylistTrack[])).toThrow(/^playlists\.plan: tracks must be /);
  });

  test.each<[string, unknown, string]>([
    ["no tracks, which is what a playlist that was read always has", { id: "p.1" }, "undefined"],
    ["tracks that are no list", { id: "p.1", tracks: {} }, "object"],
    ["a track with no id", { id: "p.1", tracks: [{ catalogId: "1" }] }, "object at index 0"],
    ["a track whose catalog id is no string", { id: "p.1", tracks: [{ id: "i.1" }, { id: "i.2", catalogId: 2 }] }, "object at index 1"],
    ["a track that is an id alone", { id: "p.1", tracks: ["i.1"] }, "3 characters at index 0"],
  ])("a playlist with an id and %s is refused", (_name, playlist, what) => {
    expect(() => plan(playlist as tPlaylistSnapshot, [])).toThrow(
      new TypeError(`playlists.plan: playlist.tracks must be the list of tracks read gave, each a plain object with an id of its own, and a catalogId where it has one, that are strings of 1 to 64 characters; got ${what}`),
    );
  });

  test("the types: a song is a track, and so is anything else with an id and one of the four types a playlist takes", () => {
    expectTypeOf<tSong>().toExtend<Parameters<typeof plan>[1][number]>();
    expectTypeOf<{ id: string; type: "library-songs" }>().toExtend<Parameters<typeof plan>[1][number]>();
    expectTypeOf<{ id: string; type: "albums" }>().not.toExtend<Parameters<typeof plan>[1][number]>();
  });
});

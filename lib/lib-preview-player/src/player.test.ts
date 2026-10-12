import type { tLibrarySong, tMusicVideo, tSong } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { previewPlayer, type tPreviewAudio, type tPreviewPlayer } from "./player";

/**
 * An audio element as far as the player uses one. Where a browser's is driven by the network and the clock, this
 * one is driven by the test: it says nothing by itself, so each test decides which events arrive, and in what order.
 */
class FakeAudio implements tPreviewAudio {
  readonly listeners = new Map<string, Set<() => void>>();
  /** Every URL the element was given, in order. */
  readonly sources: string[] = [];
  /** How many times it was asked to play. */
  plays = 0;
  /** What the next play() rejects with. Left alone, it resolves. */
  refusal: Error | undefined;
  /** Set, each play() waits in `waiting` for the test to settle it. */
  hold = false;
  readonly waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  #src = "";
  #volume = 1;

  get src(): string {
    return this.#src;
  }
  /** A new clip: as in a browser, the element forgets where it was and stops. */
  set src(url: string) {
    this.#src = url;
    this.sources.push(url);
    this.currentTime = 0;
    this.duration = Number.NaN;
    this.ended = false;
    this.paused = true;
  }
  get volume(): number {
    return this.#volume;
  }
  set volume(value: number) {
    this.#volume = value;
    this.emit("volumechange");
  }
  play(): Promise<void> {
    this.plays++;
    const { refusal } = this;
    this.refusal = undefined;
    if (refusal !== undefined) return Promise.reject(refusal);
    this.paused = false;
    this.ended = false;
    if (!this.hold) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit("pause");
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  /** The clip is `at` seconds in, of `of` seconds. */
  reach(at: number, of = this.duration): void {
    this.currentTime = at;
    if (!Object.is(of, this.duration)) {
      this.duration = of;
      this.emit("durationchange");
    }
    this.emit("timeupdate");
  }
  /** The clip runs out, in the order a browser says so: it is paused, and then it has ended. */
  finish(): void {
    this.ended = true;
    this.paused = true;
    this.emit("pause");
    this.emit("ended");
  }
  /** How many listeners the element still holds. */
  heldBy(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

const clip = (id: string) => `https://audio-ssl.itunes.apple.com/previews/${id}.m4a`;

/** A catalog song as the player reads one: its previews, and enough else to tell it from another. */
const song = (id: string, previews: unknown = [{ url: clip(id) }]): tSong => ({ id, type: "songs", href: `/v1/catalog/us/songs/${id}`, attributes: { name: `Song ${id}`, previews } as NonNullable<tSong["attributes"]> });

/** A player over a fake element, with the three songs a, b and c loaded unless the test says otherwise. */
function loaded(tracks: readonly tSong[] = [song("a"), song("b"), song("c")], options: { hosts?: string[] } = {}) {
  const audio = new FakeAudio();
  const player = previewPlayer<tSong>({ audio, ...options });
  const answer = player.load(tracks);
  return { audio, player, answer };
}

/** Lets what is already settled be heard. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("which clip a track has: the URL of its first preview, read as the track's own", () => {
  test("a song with a preview is kept, and its first preview is the one played", async () => {
    const two = song("a", [{ url: clip("first") }, { url: clip("second") }]);
    const { audio, player, answer } = loaded([two]);
    expect(answer).toEqual({ tracks: [two], skipped: [] });
    await player.play();
    expect(audio.sources).toEqual([clip("first")]);
  });

  test.each<[string, unknown]>([
    ["a song with no previews", song("a", [])],
    ["a song whose previews are no list", song("a", { url: clip("a") })],
    ["a song whose first preview has no url", song("a", [{ hlsUrl: clip("a") }, { url: clip("b") }])],
    ["a song whose url is no string", song("a", [{ url: 42 }])],
    ["a song whose url is empty", song("a", [{ url: "" }])],
    ["a song whose first preview is nothing", song("a", [null])],
    ["a song with no attributes", { id: "a", type: "songs", href: "/a" }],
    ["a library song, which has none", { id: "i.a", type: "library-songs", href: "/i.a", attributes: { name: "Mine" } }],
    ["a song whose attributes are inherited", Object.create({ attributes: { previews: [{ url: clip("a") }] } })],
    ["a song that is an instance of a class", new (class { attributes = { previews: [{ url: clip("a") }] }; })()],
    ["a string", clip("a")],
    ["a number", 7],
    ["null", null],
    ["nothing", undefined],
  ])("%s has no clip, and is skipped as having no preview", (_name, track) => {
    const { answer } = loaded([track as tSong]);
    expect(answer).toEqual({ tracks: [], skipped: [{ index: 0, track, reason: "no-preview" }] });
  });

  test("a clip put on Object.prototype by other code is nobody's clip", () => {
    const polluted = Object.prototype as { attributes?: unknown };
    polluted.attributes = { previews: [{ url: clip("planted") }] };
    try {
      expect(loaded([{ id: "a", type: "songs", href: "/a" }]).answer.tracks).toEqual([]);
    } finally {
      delete polluted.attributes;
    }
  });
});

describe("load: a track that cannot be played is left out and said so, never an error", () => {
  test("the queue is the tracks with a clip, in the order handed over, and each one left out says where it was", () => {
    const bare: tSong = { id: "x", type: "songs", href: "/x" };
    const [a, none, c] = [song("a"), song("none", []), song("c")];
    const { player, answer } = loaded([a, none, c, bare]);
    expect(answer.tracks).toEqual([a, c]);
    expect(answer.skipped).toEqual([
      { index: 1, track: none, reason: "no-preview" },
      { index: 3, track: bare, reason: "no-preview" },
    ]);
    expect(player.state.tracks).toBe(answer.tracks);
  });

  test("the tracks are handed back as they were handed over, not as copies", () => {
    const a = song("a");
    expect(loaded([a]).answer.tracks[0]).toBe(a);
  });

  test("the answer and the queue are frozen, and are this call's own: the caller's list can change afterwards", () => {
    const list = [song("a"), song("b")];
    const { player, answer } = loaded(list);
    list.length = 0;
    expect(player.state.tracks).toHaveLength(2);
    expect([answer, answer.tracks, answer.skipped].every((each) => Object.isFrozen(each))).toBe(true);
  });

  test("an empty list is an empty queue", () => {
    expect(loaded([]).answer).toEqual({ tracks: [], skipped: [] });
  });

  test("a list that says it is longer than it is, is read no further than it says, once", () => {
    const lengths = vi.fn(() => 1);
    const list = new Proxy([song("a"), song("b")], { get: (target, key, receiver) => (key === "length" ? lengths() : (Reflect.get(target, key, receiver) as unknown)) });
    expect(loaded(list).answer.tracks).toHaveLength(1);
    expect(lengths).toHaveBeenCalledTimes(1);
  });

  test("a new queue replaces the old one: what was playing stops, and no track is current", async () => {
    const { audio, player } = loaded();
    await player.play(1);
    player.load([song("z")]);
    expect(audio.paused).toBe(true);
    expect(player.state).toMatchObject({ status: "idle", index: -1, track: undefined, position: 0, duration: 0 });
    expect(player.state.tracks.map((track) => track.id)).toEqual(["z"]);
  });

  test.each<[string, unknown]>([
    ["one track", song("a")],
    ["a string", "songs"],
    ["nothing", undefined],
    ["null", null],
    ["a set", new Set([song("a")])],
  ])("%s is no list of tracks: a TypeError that names load and repeats nothing", (_name, tracks) => {
    const { player } = loaded([]);
    expect(() => player.load(tracks as tSong[])).toThrow(/^previewPlayer\.load: tracks must be a list of tracks, as a client hands them over; got /);
  });
});

describe("hosts: where a clip may come from, for a caller who says", () => {
  const elsewhere = song("b", [{ url: "https://example.org/b.m4a" }]);
  const plain = song("c", [{ url: "http://audio-ssl.itunes.apple.com/c.m4a" }]);

  test("with hosts named, a clip that is not https on one of them is skipped as being on another host", () => {
    const a = song("a");
    const { answer } = loaded([a, elsewhere, plain], { hosts: ["itunes.apple.com"] });
    expect(answer.tracks).toEqual([a]);
    expect(answer.skipped).toEqual([
      { index: 1, track: elsewhere, reason: "host" },
      { index: 2, track: plain, reason: "host" },
    ]);
  });

  test("with none named, where a clip points is not checked at all", () => {
    expect(loaded([elsewhere, plain]).answer.skipped).toEqual([]);
  });

  test("a track with no clip is skipped for that, whatever the hosts", () => {
    expect(loaded([song("a", [])], { hosts: ["itunes.apple.com"] }).answer.skipped[0]?.reason).toBe("no-preview");
  });

  test.each<[string, unknown]>([
    ["a URL", ["https://itunes.apple.com"]],
    ["a pattern", ["*.apple.com"]],
    ["an empty list", []],
    ["one string", "itunes.apple.com"],
  ])("hosts that are %s are refused when the player is made, under its name", (_name, hosts) => {
    expect(() => previewPlayer({ audio: new FakeAudio(), hosts: hosts as string[] })).toThrow(new TypeError("previewPlayer: hosts must be an array of 1 to 16 host names in small letters, such as itunes.apple.com"));
  });

  test("the hosts are taken when the player is made: changing the caller's list afterwards changes nothing", () => {
    const hosts = ["itunes.apple.com"];
    const player = previewPlayer<tSong>({ audio: new FakeAudio(), hosts });
    hosts[0] = "example.org";
    expect(player.load([song("a"), elsewhere]).tracks).toHaveLength(1);
  });
});

describe("nothing is asked of the element, and nothing is played, until a verb says so", () => {
  test("making a player gives the element no clip and does not play", () => {
    const audio = new FakeAudio();
    const player = previewPlayer({ audio });
    expect([audio.sources, audio.plays]).toEqual([[], 0]);
    expect(player.state).toEqual({ status: "idle", tracks: [], index: -1, track: undefined, position: 0, duration: 0, volume: 1 });
  });

  test("loading a queue gives the element no clip and does not play", () => {
    const { audio, player } = loaded();
    expect([audio.sources, audio.plays]).toEqual([[], 0]);
    expect(player.state).toMatchObject({ status: "idle", index: -1 });
  });

  test("with nothing loaded, play, next, previous, pause and seek do nothing", async () => {
    const { audio, player } = loaded([]);
    await player.play();
    await player.next();
    await player.previous();
    player.pause();
    player.seek(3);
    expect([audio.sources, audio.plays, audio.currentTime]).toEqual([[], 0, 0]);
    expect(player.state.status).toBe("idle");
  });
});

describe("play", () => {
  test("with no track current it starts the first, and says so once the element has begun", async () => {
    const { audio, player } = loaded();
    const begun = player.play();
    expect(player.state).toMatchObject({ status: "loading", index: 0 });
    await begun;
    expect(audio.sources).toEqual([clip("a")]);
    expect(player.state).toMatchObject({ status: "playing", index: 0 });
    expect(player.state.track?.id).toBe("a");
  });

  test("with an index it plays that track from its start, whatever was current", async () => {
    const { audio, player } = loaded();
    await player.play(2);
    audio.reach(12, 30);
    await player.play(1);
    expect(audio.sources).toEqual([clip("c"), clip("b")]);
    expect(player.state).toMatchObject({ status: "playing", index: 1, position: 0 });
  });

  test("the index of the current track plays it again from its start", async () => {
    const { audio, player } = loaded();
    await player.play(0);
    audio.reach(12, 30);
    await player.play(0);
    expect(audio.sources).toEqual([clip("a"), clip("a")]);
    expect(player.state.position).toBe(0);
  });

  test("after a pause it carries on with the same clip, where it was", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.reach(12, 30);
    player.pause();
    expect(player.state).toMatchObject({ status: "paused", position: 12 });
    await player.play();
    expect(audio.sources).toEqual([clip("a")]);
    expect(player.state).toMatchObject({ status: "playing", index: 0, position: 12 });
  });

  test("once the queue has run out it starts again from the first track", async () => {
    const { audio, player } = loaded([song("a")]);
    await player.play();
    audio.finish();
    expect(player.state.status).toBe("ended");
    await player.play();
    expect(audio.sources).toEqual([clip("a"), clip("a")]);
    expect(player.state).toMatchObject({ status: "playing", index: 0 });
  });

  test("the element's own event says it is playing as well: whichever comes first, the state is the same", async () => {
    const { audio, player } = loaded();
    audio.hold = true;
    const begun = player.play();
    audio.emit("playing");
    expect(player.state.status).toBe("playing");
    audio.waiting[0]?.resolve();
    await begun;
    expect(player.state.status).toBe("playing");
  });

  test.each<[string, unknown]>([
    ["one past the last", 3],
    ["below zero", -1],
    ["a fraction", 0.5],
    ["not a number", Number.NaN],
    ["a string", "1"],
    ["null", null],
  ])("an index that is %s is refused, and nothing is played", async (_name, index) => {
    const { audio, player } = loaded();
    await expect(player.play(index as number)).rejects.toThrow(/^previewPlayer\.play: index must be the place of a track in the queue, a whole number from 0 and below 3; got /);
    expect(audio.plays).toBe(0);
  });
});

describe("the queue: next and previous go to the neighbour, from its start, and stop at the ends", () => {
  test("next goes one up, and from no track at all it is the first", async () => {
    const { audio, player } = loaded();
    await player.next();
    await player.next();
    expect(audio.sources).toEqual([clip("a"), clip("b")]);
    expect(player.state).toMatchObject({ status: "playing", index: 1 });
  });

  test("previous goes one down", async () => {
    const { audio, player } = loaded();
    await player.play(2);
    await player.previous();
    expect(audio.sources).toEqual([clip("c"), clip("b")]);
    expect(player.state.index).toBe(1);
  });

  test("at the last track next does nothing, and at the first neither does previous", async () => {
    const { audio, player } = loaded();
    await player.play(2);
    await player.next();
    await player.play(0);
    await player.previous();
    expect(audio.sources).toEqual([clip("c"), clip("a")]);
    expect(player.state).toMatchObject({ status: "playing", index: 0 });
  });

  test("a track that was skipped is not in the queue, so there is nothing to step over", async () => {
    const { audio, player } = loaded([song("a"), song("none", []), song("c")]);
    await player.play();
    await player.next();
    expect(audio.sources).toEqual([clip("a"), clip("c")]);
  });
});

describe("when a clip ends the next one starts, and after the last the player has ended", () => {
  test("the end of a clip plays the next track, with nobody having asked", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.finish();
    await settled();
    expect(audio.sources).toEqual([clip("a"), clip("b")]);
    expect(player.state).toMatchObject({ status: "playing", index: 1 });
  });

  test("the end of the last clip leaves the player ended, on the last track, and never paused in between", async () => {
    const { audio, player } = loaded([song("a"), song("b")]);
    const seen: string[] = [];
    player.subscribe(() => seen.push(player.state.status));
    await player.play(1);
    audio.finish();
    expect(player.state).toMatchObject({ status: "ended", index: 1 });
    expect(seen).not.toContain("paused");
  });

  test("a next clip the element will not play is nobody's unhandled rejection: the state says where things stand", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.refusal = new Error("the element would not start");
    audio.finish();
    await settled();
    expect(player.state).toMatchObject({ status: "paused", index: 1 });
  });

  test("an end heard late, for a clip that is no longer the current one, moves nothing", async () => {
    const { audio, player } = loaded();
    await player.play();
    await player.play(1);
    audio.emit("ended");
    await settled();
    expect(audio.sources).toEqual([clip("a"), clip("b")]);
    expect(player.state).toMatchObject({ status: "playing", index: 1 });
  });
});

describe("what the element refuses is passed on as it is, and the state says where that leaves things", () => {
  test("a play the element rejects rejects with the element's own error, and the clip is left paused", async () => {
    const { audio, player } = loaded();
    const refusal = new DOMException("play() failed because the user didn't interact with the document first", "NotAllowedError");
    audio.refusal = refusal;
    await expect(player.play()).rejects.toBe(refusal);
    expect(player.state).toMatchObject({ status: "paused", index: 0 });
  });

  test("a clip the element cannot play is an error in the state, and the next track can still be played", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.emit("error");
    expect(player.state).toMatchObject({ status: "error", index: 0 });
    await player.next();
    expect(player.state).toMatchObject({ status: "playing", index: 1 });
  });

  test("play after an error asks for the same clip again, from its start", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.emit("error");
    await player.play();
    expect(audio.sources).toEqual([clip("a"), clip("a")]);
    expect(player.state.status).toBe("playing");
  });

  test("a play overtaken by another rejects as the element rejects it, and leaves the state to the later one", async () => {
    const { audio, player } = loaded();
    audio.hold = true;
    const first = player.play(0);
    const second = player.play(1);
    audio.waiting[0]?.reject(new DOMException("The play() request was interrupted by a new load request", "AbortError"));
    await expect(first).rejects.toHaveProperty("name", "AbortError");
    expect(player.state).toMatchObject({ status: "loading", index: 1 });
    audio.waiting[1]?.resolve();
    await second;
    expect(player.state).toMatchObject({ status: "playing", index: 1 });
  });

  test("a play still waiting when a new queue is loaded leaves the new queue idle, however it settles", async () => {
    const { audio, player } = loaded();
    audio.hold = true;
    const begun = player.play();
    player.load([song("z")]);
    audio.waiting[0]?.resolve();
    await begun;
    expect(player.state).toMatchObject({ status: "idle", index: -1 });
  });

  test("a clip that stops to wait for more of itself is loading, and playing again when it has it", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.emit("waiting");
    expect(player.state.status).toBe("loading");
    audio.emit("playing");
    expect(player.state.status).toBe("playing");
  });
});

describe("pause", () => {
  test("pauses the element, and the state follows what the element says", async () => {
    const { audio, player } = loaded();
    await player.play();
    player.pause();
    expect(audio.paused).toBe(true);
    expect(player.state.status).toBe("paused");
  });

  test("an element paused by something else, such as its own controls, is paused here too", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.pause();
    expect(player.state.status).toBe("paused");
  });

  test("a pause heard late, when the element is playing again, changes nothing", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.emit("pause");
    expect(player.state.status).toBe("playing");
  });

  test("a playing heard late, when the element is paused, changes nothing", async () => {
    const { audio, player } = loaded();
    await player.play();
    player.pause();
    audio.emit("playing");
    expect(player.state.status).toBe("paused");
  });
});

describe("state: one frozen snapshot, replaced only when something a page would draw has changed", () => {
  test("it is the same object for as long as nothing changes, and another once something does", async () => {
    const { audio, player } = loaded();
    const idle = player.state;
    expect(player.state).toBe(idle);
    audio.emit("timeupdate");
    expect(player.state).toBe(idle);
    await player.play();
    const playing = player.state;
    expect(playing).not.toBe(idle);
    audio.emit("timeupdate");
    expect(player.state).toBe(playing);
    audio.reach(1, 30);
    expect(player.state).not.toBe(playing);
  });

  test("each one is frozen", async () => {
    const { player } = loaded();
    await player.play();
    expect(Object.isFrozen(player.state)).toBe(true);
    expect(Object.isFrozen(player.state.tracks)).toBe(true);
  });

  test("position and duration are the element's, in seconds", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.reach(4.5, 29.98);
    expect(player.state).toMatchObject({ position: 4.5, duration: 29.98 });
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0])("a duration the element gives as %s is 0: it does not know yet", async (duration) => {
    const { audio, player } = loaded();
    await player.play();
    audio.reach(1, duration);
    expect(player.state.duration).toBe(0);
  });

  test("with no track current, position and duration are 0 whatever the element still holds", async () => {
    const { audio, player } = loaded();
    await player.play();
    audio.reach(12, 30);
    player.load([song("z")]);
    expect([audio.currentTime, audio.duration]).toEqual([12, 30]);
    expect(player.state).toMatchObject({ position: 0, duration: 0 });
  });

  test("a listener hears each change once, after the state has changed", async () => {
    const { audio, player } = loaded();
    const seen: string[] = [];
    player.subscribe(() => seen.push(`${player.state.status} ${String(player.state.index)} ${String(player.state.position)}`));
    await player.play();
    audio.reach(2, 30);
    audio.emit("timeupdate");
    player.pause();
    expect(seen).toEqual(["loading 0 0", "playing 0 0", "playing 0 2", "paused 0 2"]);
  });

  test("the function subscribe gives stops that listener and no other", async () => {
    const { player } = loaded();
    const [first, second] = [vi.fn(), vi.fn()];
    const stop = player.subscribe(first);
    player.subscribe(second);
    stop();
    stop();
    await player.play();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  test("a listener subscribed twice is told twice, and each of its two stops alone", () => {
    const { player } = loaded();
    const listener = vi.fn();
    const stop = player.subscribe(listener);
    player.subscribe(listener);
    player.setVolume(0.5);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    player.setVolume(0.25);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test("a listener that unsubscribes another while they are being told does not stop the telling", () => {
    const { player } = loaded();
    const second = vi.fn();
    const stops: (() => void)[] = [];
    player.subscribe(() => stops[0]?.());
    stops.push(player.subscribe(second));
    player.setVolume(0.5);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["an object", {}],
    ["a string", "listener"],
  ])("a listener that is %s is refused", (_name, listener) => {
    expect(() => loaded().player.subscribe(listener as () => void)).toThrow(/^previewPlayer\.subscribe: listener must be a function; got /);
  });
});

describe("seek and volume are held to what an element takes", () => {
  test("seek moves the current clip, and the state follows", async () => {
    const { audio, player } = loaded();
    await player.play();
    player.seek(10);
    expect(audio.currentTime).toBe(10);
    expect(player.state.position).toBe(10);
  });

  test.each<[string, unknown]>([
    ["below zero", -1],
    ["not a number", Number.NaN],
    ["without end", Number.POSITIVE_INFINITY],
    ["a string", "10"],
    ["nothing", undefined],
  ])("seconds that are %s are refused, and the clip stays where it was", async (_name, to) => {
    const { audio, player } = loaded();
    await player.play();
    audio.reach(5, 30);
    expect(() => {
      player.seek(to as number);
    }).toThrow(/^previewPlayer\.seek: seconds must be a number from 0; got /);
    expect(audio.currentTime).toBe(5);
  });

  test("the volume is set on the element, and is in the state with or without a track", () => {
    const { audio, player } = loaded();
    player.setVolume(0.4);
    expect(audio.volume).toBe(0.4);
    expect(player.state.volume).toBe(0.4);
  });

  test("a volume the element was given by something else is in the state too", () => {
    const { audio, player } = loaded();
    audio.volume = 0.2;
    expect(player.state.volume).toBe(0.2);
  });

  test.each<[string, unknown]>([
    ["above one", 1.01],
    ["below zero", -0.01],
    ["not a number", Number.NaN],
    ["a string", "0.5"],
    ["nothing", undefined],
  ])("a volume that is %s is refused, and the element keeps the one it had", (_name, volume) => {
    const { audio, player } = loaded();
    expect(() => {
      player.setVolume(volume as number);
    }).toThrow(/^previewPlayer\.setVolume: volume must be a number from 0 to 1; got /);
    expect(audio.volume).toBe(1);
  });
});

describe("what a player is handed is checked when it is made, not when it first plays", () => {
  test.each<[string, unknown]>([
    ["a list", []],
    ["a string", "audio"],
    ["an audio element, where the options go", new FakeAudio()],
    ["null", null],
  ])("options that are %s are refused", (_name, options) => {
    expect(() => previewPlayer(options as object)).toThrow(/^previewPlayer: expected an options object; got /);
  });

  test.each<[string, unknown]>([
    ["a plain object", {}],
    ["a URL", clip("a")],
    ["null", null],
    ["something that plays and pauses but cannot be listened to", { play: () => Promise.resolve(), pause: () => undefined }],
  ])("audio that is %s is refused", (_name, audio) => {
    expect(() => previewPlayer({ audio: audio as tPreviewAudio })).toThrow(/^previewPlayer: audio must be an audio element, with play, pause, addEventListener and removeEventListener; got /);
  });

  test("with no element handed over and no Audio to make one with, as on a server, it says so", () => {
    vi.stubGlobal("Audio", undefined);
    expect(() => previewPlayer()).toThrow(new TypeError("previewPlayer: there is no Audio here to make an element with, as there is in a browser; pass one as audio"));
  });

  test("with no element handed over, it makes one with Audio, as a browser has", async () => {
    const made: FakeAudio[] = [];
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        constructor() {
          super();
          made.push(this);
        }
      },
    );
    const player = previewPlayer<tSong>();
    player.load([song("a")]);
    await player.play();
    expect(made).toHaveLength(1);
    expect(made[0]?.sources).toEqual([clip("a")]);
  });

  test("an option put on Object.prototype by other code is not an option anyone passed", () => {
    const polluted = Object.prototype as { hosts?: unknown };
    polluted.hosts = ["example.org"];
    try {
      expect(loaded([song("a")]).answer.tracks).toHaveLength(1);
    } finally {
      delete polluted.hosts;
    }
  });

  test("no error repeats what it was handed", () => {
    const secret = "a-token-put-where-the-audio-goes";
    const message = (() => {
      try {
        previewPlayer({ audio: secret as unknown as tPreviewAudio });
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(message).toContain(`${String(secret.length)} characters`);
    expect(message).not.toContain(secret);
  });
});

describe("dispose: the player lets go of its element, and of whoever listens", () => {
  test("it pauses what was playing and leaves no listener on the element", async () => {
    const { audio, player } = loaded();
    expect(audio.heldBy()).toBeGreaterThan(0);
    await player.play();
    player.dispose();
    expect(audio.paused).toBe(true);
    expect(audio.heldBy()).toBe(0);
  });

  test("the state is empty and idle afterwards, and listeners hear of it once and then no more", async () => {
    const { audio, player } = loaded();
    const listener = vi.fn();
    await player.play();
    player.subscribe(listener);
    player.dispose();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(player.state).toMatchObject({ status: "idle", tracks: [], index: -1, track: undefined });
    audio.volume = 0.3;
    audio.emit("timeupdate");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("disposing twice is disposing once", () => {
    const { player } = loaded();
    player.dispose();
    expect(() => {
      player.dispose();
    }).not.toThrow();
  });

  test.each<[string, (player: tPreviewPlayer<tSong>) => unknown]>([
    ["load", (player) => player.load([])],
    ["pause", (player) => {
      player.pause();
    }],
    ["seek", (player) => {
      player.seek(1);
    }],
    ["setVolume", (player) => {
      player.setVolume(1);
    }],
    ["subscribe", (player) => player.subscribe(() => undefined)],
  ])("%s on a disposed player is the caller's mistake", (verb, call) => {
    const { player } = loaded();
    player.dispose();
    expect(() => call(player)).toThrow(new TypeError(`previewPlayer.${verb}: the player was disposed, and plays nothing more`));
  });

  test.each<[string, (player: tPreviewPlayer<tSong>) => Promise<void>]>([
    ["play", (player) => player.play()],
    ["next", (player) => player.next()],
    ["previous", (player) => player.previous()],
  ])("%s on a disposed player rejects the same way, and asks nothing of the element", async (verb, call) => {
    const { audio, player } = loaded();
    player.dispose();
    await expect(call(player)).rejects.toThrow(new TypeError(`previewPlayer.${verb}: the player was disposed, and plays nothing more`));
    expect(audio.plays).toBe(0);
  });

  test("Symbol.asyncDispose disposes, and resolves to nothing", async () => {
    const { audio, player } = loaded();
    await expect(player[Symbol.asyncDispose]()).resolves.toBeUndefined();
    expect(audio.heldBy()).toBe(0);
  });

  test("`await using` takes a player", async () => {
    const audio = new FakeAudio();
    {
      await using player = previewPlayer<tSong>({ audio });
      player.load([song("a")]);
      await player.play();
    }
    expect([audio.paused, audio.heldBy()]).toEqual([true, 0]);
  });
});

describe("the player itself", () => {
  test("is frozen and inherits nothing: a name looked up on it is one of its own or is not there", () => {
    const { player } = loaded();
    expect(Object.isFrozen(player)).toBe(true);
    expect(Object.getPrototypeOf(player)).toBeNull();
    expect(Object.keys(player).sort()).toEqual(["dispose", "load", "next", "pause", "play", "previous", "seek", "setVolume", "state", "subscribe"]);
    expect("toString" in player).toBe(false);
  });

  test("its functions need no `this`: each can be handed on by itself", async () => {
    const { player } = loaded();
    const { play, pause, subscribe } = player;
    const listener = vi.fn();
    subscribe(listener);
    await play();
    pause();
    expect(player.state.status).toBe("paused");
    expect(listener).toHaveBeenCalled();
  });

  test("two players are two queues: one knows nothing of the other", async () => {
    const [one, other] = [loaded([song("a")]), loaded([song("b")])];
    await one.player.play();
    expect(other.player.state.status).toBe("idle");
    expect(other.audio.plays).toBe(0);
  });
});

describe("the types", () => {
  test("the current track is the kind of track the player was made for", () => {
    expectTypeOf(previewPlayer<tSong>({ audio: new FakeAudio() }).state.track).toEqualTypeOf<tSong | undefined>();
    expectTypeOf(previewPlayer<tSong>({ audio: new FakeAudio() }).load([]).skipped).items.toHaveProperty("track").toEqualTypeOf<tSong>();
  });

  test("songs, music videos and library songs are all tracks it can be handed; which of them have a clip is found when they are loaded", () => {
    expectTypeOf<tSong>().toExtend<Parameters<tPreviewPlayer["load"]>[0][number]>();
    expectTypeOf<tMusicVideo>().toExtend<Parameters<tPreviewPlayer["load"]>[0][number]>();
    expectTypeOf<tLibrarySong>().toExtend<Parameters<tPreviewPlayer["load"]>[0][number]>();
  });

  test("an element of a browser's is an element it can play through", () => {
    expectTypeOf<HTMLAudioElement>().toExtend<tPreviewAudio>();
  });

  test("something that is no resource is not a track", () => {
    const player = previewPlayer({ audio: new FakeAudio() });
    // @ts-expect-error -- a URL is not a track: the player takes resources, and finds the clip itself
    expect(player.load(["https://example.org/a.m4a"]).skipped).toHaveLength(1);
  });
});

/// <reference lib="esnext.disposable" />
// A queue of preview clips played through one audio element. A song and a music video of the catalog each carry a
// short clip under `attributes.previews`, which any audio element can play. What every page would otherwise write
// around it is here: which clip a track has, a queue to go up and down, one clip following another, and one
// snapshot of where things stand for a page to draw. It asks Apple for nothing: it is fed what was fetched.
import { got, has, hostsOf, isOnHost, isPlain, itemsOf, optionsOf, ownOf } from "@open-music-sdk/core";

/**
 * A track as the player takes one: any resource, as a client handed it over. What is read is the URL of its first
 * preview, under `attributes.previews`. A `tSong` and a `tMusicVideo` from `@open-music-sdk/types` have one. A
 * library song has none, and is skipped like any other track without a clip.
 */
export interface tPreviewable {
  /** What the resource says of itself. Its `previews` list is read, and the `url` of the first preview in it. A track without one is skipped. */
  readonly attributes?: object | undefined;
}

/**
 * The part of an audio element the player uses. An `HTMLAudioElement` fits, and so does a test's own. Each member
 * is read or called as the element's is, and means what it means there.
 */
export interface tPreviewAudio {
  /** The URL of the clip the element holds. Set to a track's clip before it is played. */
  src: string;
  /** How far into the clip the element is, in seconds. Set by `seek`. */
  currentTime: number;
  /** How loud, from 0 to 1. Set by `setVolume`. */
  volume: number;
  /** How long the clip is, in seconds, or `NaN` until the element knows. */
  readonly duration: number;
  /** Whether the element is not playing. */
  readonly paused: boolean;
  /** Whether the clip has run to its end. */
  readonly ended: boolean;
  /** What stopped the element playing the clip it holds, or `null` when nothing has: an element forgets it when it is given another clip. */
  readonly error: unknown;
  /**
   * Starts playing the clip under `src`, and settles as `HTMLMediaElement.play()` does: once playing has begun, or
   * with why it will not.
   *
   * @throws The element's own refusal, as a rejection: a browser that will not start sound without a click behind
   * it rejects with its `NotAllowedError`. The player hands it on to whoever called `play`, `next` or `previous`.
   */
  play(): Promise<void>;
  /** Stops playing, keeping the clip and the position in it. */
  pause(): void;
  /** With `removeAttribute("src")`, how a clip is taken off the element, so that it holds nothing of a queue that is gone. */
  load(): void;
  /**
   * Takes an attribute off the element. The player calls it for `"src"` alone, before `load()`.
   *
   * @param name - The attribute's name.
   */
  removeAttribute(name: string): void;
  /**
   * Hears an event of the element. The player listens for `playing`, `pause`, `waiting`, `timeupdate`,
   * `durationchange`, `volumechange`, `ended` and `error`, from when it is made until it is disposed.
   *
   * @param type - The event's name.
   * @param listener - What to call when it fires.
   */
  addEventListener(type: string, listener: () => void): void;
  /**
   * Stops hearing an event: `dispose` takes off every listener `addEventListener` was given.
   *
   * @param type - The event's name.
   * @param listener - The function `addEventListener` was handed for it.
   */
  removeEventListener(type: string, listener: () => void): void;
}

/** The options of `previewPlayer`. Both are checked and taken when the player is made. */
export interface tPreviewPlayerOptions {
  /** The audio element to play through. Default: one made with `new Audio()`, which a browser has and a server has not. */
  readonly audio?: tPreviewAudio | undefined;
  /**
   * The hosts a clip may come from, such as `["itunes.apple.com"]`. With this, a track whose clip is not `https` on
   * one of them or on a subdomain of one, with no port and no credentials, is skipped as `"host"`. Default: where a
   * clip points is not checked at all.
   */
  readonly hosts?: readonly string[] | undefined;
}

/**
 * Where a player stands. `idle`: no track is current. `loading`: a clip was asked for and has not begun, or has
 * stopped to wait for more of itself. `paused`: a clip is current and not playing. `ended`: the last clip of the
 * queue ran out. `error`: the element could not play the current clip.
 */
export type tPreviewStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

/** What a page draws a player from. Each one is frozen, and replaced by another only when something in it changed. */
export interface tPreviewPlayerState<T extends tPreviewable = tPreviewable> {
  /** Where the player stands: idle, loading, playing, paused, ended or in error. */
  readonly status: tPreviewStatus;
  /** The queue: the tracks `load` kept, in the order they were handed over. */
  readonly tracks: readonly T[];
  /** Where in the queue the current track is, or -1 when none is. */
  readonly index: number;
  /** The current track, or `undefined` when none is. */
  readonly track: T | undefined;
  /** How far into the current clip the element is, in seconds. */
  readonly position: number;
  /** How long the current clip is, in seconds, or 0 until the element knows. */
  readonly duration: number;
  /** The element's volume, from 0 to 1. */
  readonly volume: number;
}

/** A track `load` left out of the queue: where it was in the list handed over, and why it cannot be played. */
export interface tSkippedPreview<T> {
  /** Where the track was in the list handed to `load`, counted from 0. */
  readonly index: number;
  /** The track as it was handed over. */
  readonly track: T;
  /** `"no-preview"`: the track has no clip. `"host"`: its clip is not on one of the hosts allowed. */
  readonly reason: "no-preview" | "host";
}

/** What `load` answers with: the tracks that are now the queue, and the ones left out of it. */
export interface tLoadedPreviews<T> {
  /** The queue: the tracks with a clip, in the order they were handed over. The same list `state.tracks` holds, unless a listener loaded another on hearing of the change. */
  readonly tracks: readonly T[];
  /** The tracks left out, in order, each with where it was and why. */
  readonly skipped: readonly tSkippedPreview<T>[];
}

/**
 * A player from `previewPlayer`. Its functions need no `this`, so each can be handed on by itself. It is disposable
 * with `await using` where the runtime has that: in one that has no `Symbol.asyncDispose`, a player has no such
 * function, and `dispose()` is the way.
 */
export interface tPreviewPlayer<T extends tPreviewable = tPreviewable> extends AsyncDisposable {
  /**
   * Replaces the queue with the tracks that have a clip, and answers with those and with the ones left out. What
   * was playing stops and its clip is taken off the element, no track is current afterwards, and nothing is played.
   *
   * @param tracks - The tracks to queue, as a client handed them over: songs or music videos of the catalog, or
   * anything else with `attributes.previews`. One without a clip, or whose clip is not on an allowed host, is left
   * out and is never an error.
   * @returns The tracks that are now the queue, in the order they were handed over, and the ones left out, each
   * with where it was and why.
   * @throws TypeError if the player was disposed, or if `tracks` is no list.
   * @throws What a listener threw on hearing of the change, after the queue has been replaced.
   */
  readonly load: (tracks: readonly T[]) => tLoadedPreviews<T>;
  /**
   * Plays the track at `index` from its start. With no index, it carries on with the current clip, or starts the
   * first track when none is current or the queue ran out, and asks again for a clip the element could not play.
   * It settles as the element's own `play()` does: a browser that will not start sound without a click says so
   * here, with its own error. With nothing loaded and no index it does nothing.
   *
   * @param index - The place in the queue of the track to play, counted from 0, or nothing to carry on.
   * @throws TypeError if the player was disposed, or if `index` is not the place of a track in the queue.
   * @throws The element's own refusal to play, as it rejected with it. The state is then `paused`, or `error` where
   * the element said why with an event, unless a later call has taken over, when the state is that call's.
   * @throws What a listener threw on hearing that the clip is loading or playing. The element was asked all the
   * same.
   */
  readonly play: (index?: number) => Promise<void>;
  /**
   * Pauses the current clip. With none current it does nothing.
   *
   * @throws TypeError if the player was disposed.
   */
  readonly pause: () => void;
  /**
   * Plays the next track of the queue from its start. At the last one, or with nothing loaded, it does nothing.
   *
   * @throws TypeError if the player was disposed.
   * @throws The element's own refusal to play, as `play` rejects with it.
   * @throws What a listener threw on hearing of the change, as `play` rejects with it.
   */
  readonly next: () => Promise<void>;
  /**
   * Plays the track before the current one from its start. At the first one, or with none current, it does nothing.
   *
   * @throws TypeError if the player was disposed.
   * @throws The element's own refusal to play, as `play` rejects with it.
   * @throws What a listener threw on hearing of the change, as `play` rejects with it.
   */
  readonly previous: () => Promise<void>;
  /**
   * Moves to `seconds` into the current clip. The element holds it to the clip's length. With no track current it
   * does nothing.
   *
   * @param seconds - How far into the clip to move, from 0.
   * @throws TypeError if the player was disposed, or if `seconds` is not a number from 0.
   * @throws What a listener threw on hearing of the change, after the move.
   */
  readonly seek: (seconds: number) => void;
  /**
   * Sets the element's volume.
   *
   * @param volume - How loud, from 0 to 1.
   * @throws TypeError if the player was disposed, or if `volume` is not a number from 0 to 1.
   * @throws What a listener threw on hearing of the change, after the volume was set.
   */
  readonly setVolume: (volume: number) => void;
  /** Where the player stands now. The same object for as long as nothing changes. */
  readonly state: tPreviewPlayerState<T>;
  /**
   * Calls `listener` after each change of `state`, and gives the function that stops it. A listener subscribed
   * twice is called twice, and each of its two is stopped alone. Every listener is called, whatever another throws.
   *
   * @param listener - What to call after each change. It takes nothing: the state is read from `state`.
   * @returns The function that stops the calls. It can be called more than once, and throws nothing.
   * @throws TypeError if the player was disposed, or if `listener` is no function.
   */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Pauses, takes its clip off the element and lets go of it, forgets the queue and whoever listens. Afterwards
   * every other function refuses, and calling this again does nothing.
   *
   * @throws What a listener threw on hearing of the last change. The listeners are let go of all the same.
   */
  readonly dispose: () => void;
}

const NAME = "previewPlayer";
const OPTIONS = "an options object";
/** What makes a value an audio element here: the functions the player calls on one. */
const AUDIO = ["play", "pause", "load", "removeAttribute", "addEventListener", "removeEventListener"];
/** The element's events the player hears. */
const EVENTS = ["playing", "pause", "waiting", "timeupdate", "durationchange", "volumechange", "ended", "error"] as const;
/** What a state holds, for telling whether the next one differs. */
const HELD = ["status", "tracks", "index", "track", "position", "duration", "volume"] as const;

/** What a plain object holds under `key` itself. One it inherits, or that other code has put on Object.prototype, is not its own. */
const own = (value: unknown, key: string): unknown => (isPlain(value) && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined);

/**
 * The clip a track has: the URL of its first preview, or nothing. A track is data from somewhere else, so one with
 * no clip, or that is no track at all, is not an error: it is a track that cannot be played.
 */
function clipOf(track: unknown): string | undefined {
  const previews = own(own(track, "attributes"), "previews");
  // The first preview is one the list holds itself: an empty list has none, whatever is under 0 on Object.prototype.
  const url = own(Array.isArray(previews) && Object.hasOwn(previews, 0) ? (previews[0] as unknown) : undefined, "url");
  return typeof url === "string" && url !== "" ? url : undefined;
}

/** A length of time the element gave, in seconds, or 0 where it has none to give: a duration is NaN until it is known. */
const seconds = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** The element to play through: the one handed over, checked by its functions, or one made here where there is an `Audio` to make it with. */
function audioOf(given: unknown): tPreviewAudio {
  if (given !== undefined) {
    if (has(given, AUDIO)) return given as tPreviewAudio;
    throw new TypeError(`${NAME}: audio must be an audio element, with play, pause, load, removeAttribute, addEventListener and removeEventListener; got ${got(given)}`);
  }
  const make: unknown = Reflect.get(globalThis, "Audio");
  if (typeof make !== "function") throw new TypeError(`${NAME}: there is no Audio here to make an element with, as there is in a browser; pass one as audio`);
  return new (make as new () => tPreviewAudio)();
}

/**
 * Makes a player of preview clips around one audio element. The element is listened to from then on, and that is
 * all: it is given no clip, and nothing is played, until one of the player's functions is called. `T` is the kind of track it is fed, such as `tSong`, and
 * is what `state.track` is typed as.
 *
 * Sound starts only from `play`, `next` and `previous`, and from the end of a clip that was playing, which starts
 * the next one. So the first sound follows a call the page made, which is what a browser wants a click behind.
 *
 * @param options - The element to play through, and the hosts a clip may come from.
 * @returns The player, frozen and inheriting nothing, with an empty queue and no track current.
 * @throws TypeError if `options` is no plain object, if `hosts` is not a list of host names, if `audio` is no audio
 * element, or if none was given where there is no `Audio` to make one with, as on a server.
 */
export function previewPlayer<T extends tPreviewable = tPreviewable>(options?: tPreviewPlayerOptions): tPreviewPlayer<T> {
  const bag = optionsOf(NAME, options, OPTIONS);
  const hosts = hostsOf(NAME, bag.hosts, "itunes.apple.com");
  const audio = audioOf(bag.audio);

  let tracks: readonly T[] = Object.freeze([]);
  let clips: readonly string[] = [];
  let index = -1;
  let status: tPreviewStatus = "idle";
  let disposed = false;
  /** How many times the element has been asked to play. An answer to an earlier asking leaves the state to the later one. */
  let turns = 0;
  const listeners = new Set<{ readonly heard: () => void }>();

  const snapshot = (): tPreviewPlayerState<T> =>
    Object.freeze({
      status,
      tracks,
      index,
      track: tracks[index],
      // With no track current, what the element says of itself is not the page's to draw.
      position: index < 0 ? 0 : seconds(audio.currentTime),
      duration: index < 0 ? 0 : seconds(audio.duration),
      volume: audio.volume,
    });
  let state = snapshot();

  /**
   * Takes the state as it now is and tells whoever listens, when something a page would draw has changed. Every
   * listener is told, whatever another one throws, and the first such error is thrown on once they all have been.
   * It is always the last thing done for a change, so what a listener throws cuts none of the player's own work
   * short: it goes to whoever called the verb, or out through the element's event.
   */
  function changed(): void {
    const now = snapshot();
    if (HELD.every((key) => Object.is(now[key], state[key]))) return;
    state = now;
    let thrown: { readonly error: unknown } | undefined;
    for (const each of [...listeners]) {
      try {
        each.heard();
      } catch (error) {
        thrown ??= { error };
      }
    }
    if (thrown !== undefined) throw thrown.error;
  }

  /** A verb called on a player that was disposed is the caller's mistake: it has let go of its element. */
  function live(verb: string): void {
    if (disposed) throw new TypeError(`${NAME}.${verb}: the player was disposed, and plays nothing more`);
  }

  /**
   * Asks the element to play what it holds, and settles as the element does. The element is asked before anyone
   * is told that a clip is loading. So whatever a listener does on hearing it, pause, load another queue or
   * dispose, comes after the asking and is what stands: sound that a listener stopped stays stopped.
   */
  function sound(): Promise<void> {
    const turn = ++turns;
    const asked = (async (): Promise<void> => {
      try {
        await audio.play();
      } catch (error) {
        // The element did not start. Where it said why, with an error event, the state says so already.
        if (turn === turns && status === "loading") {
          status = "paused";
          try {
            changed();
          } catch {
            // The element's own refusal is what this call rejects with. A listener that throws on hearing of it is not heard over it.
          }
        }
        throw error;
      }
      // An element says it is playing with an event as well. Whichever comes first, the state is the same.
      if (turn === turns && status === "loading" && !audio.paused) {
        status = "playing";
        changed();
      }
    })();
    try {
      changed();
    } catch (error) {
      // A listener threw, and that goes to whoever called. The element was asked all the same, and what it answers is nobody's to wait for now.
      void asked.catch(() => undefined);
      throw error;
    }
    return asked;
  }

  /** Makes the track at `at` the current one and plays it from its start. */
  function start(at: number): Promise<void> {
    index = at;
    status = "loading";
    audio.src = clips[at] ?? "";
    return sound();
  }

  /** What the element said. Each event is checked against the element itself, since one may arrive late, for a clip that is no longer the current one. */
  function heard(type: (typeof EVENTS)[number]): void {
    if (index >= 0) {
      if (type === "playing" && !audio.paused) status = "playing";
      else if (type === "waiting" && status === "playing") status = "loading";
      else if (type === "pause" && audio.paused && !audio.ended && (status === "playing" || status === "loading")) status = "paused";
      // An element with a new clip has no error: one heard then is the last clip's, come late.
      else if (type === "error" && audio.error !== null && audio.error !== undefined) status = "error";
      // A clip that was playing has run out. One that was paused and then moved to its end has not: the next
      // clip starts from the end of a clip that was playing, and from nothing else the element says.
      else if (type === "ended" && audio.ended && (status === "playing" || status === "loading")) {
        if (index + 1 < tracks.length) {
          // Nobody is waiting on this one. If the next clip will not play, the state says so.
          void start(index + 1).catch(() => undefined);
          return;
        }
        status = "ended";
      }
    }
    changed();
  }
  const handlers = EVENTS.map((type) => [type, () => { heard(type); }] as const);
  for (const [type, handler] of handlers) audio.addEventListener(type, handler);

  /**
   * Stops what is playing and forgets which track was current, so that what the element says of the old clip
   * afterwards is nobody's. The clip is taken off the element as well: left there, the element's own controls could
   * play a clip that is in no queue, with the state saying that nothing is current.
   */
  function reset(queue: readonly T[], urls: readonly string[]): void {
    const current = index >= 0;
    tracks = queue;
    clips = urls;
    index = -1;
    status = "idle";
    turns++;
    if (current) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    changed();
  }

  const load = (given: readonly T[]): tLoadedPreviews<T> => {
    live("load");
    const list = itemsOf(given, 0, Number.MAX_SAFE_INTEGER);
    if (list === undefined) throw new TypeError(`${NAME}.load: tracks must be a list of tracks, as a client hands them over; got ${got(given)}`);
    const kept: T[] = [];
    const urls: string[] = [];
    const skipped: tSkippedPreview<T>[] = [];
    list.forEach((each, at) => {
      const track = each as T;
      const clip = clipOf(track);
      if (clip === undefined) skipped.push(Object.freeze({ index: at, track, reason: "no-preview" }));
      else if (hosts !== undefined && !isOnHost(clip, hosts)) skipped.push(Object.freeze({ index: at, track, reason: "host" }));
      else {
        kept.push(track);
        urls.push(clip);
      }
    });
    // Its own queue, and not whatever the player holds by the time it answers: a listener may have loaded another meanwhile.
    const queue = Object.freeze(kept);
    reset(queue, urls);
    return Object.freeze({ tracks: queue, skipped: Object.freeze(skipped) });
  };

  const play = async (at?: number): Promise<void> => {
    live("play");
    if (at !== undefined) {
      if (!Number.isSafeInteger(at) || at < 0 || at >= tracks.length) {
        throw new TypeError(`${NAME}.play: index must be the place of a track in the queue, a whole number from 0 and below ${String(tracks.length)}; got ${got(at)}`);
      }
      return start(at);
    }
    if (tracks.length === 0) return;
    if (index < 0 || status === "ended") return start(0);
    // The clip that failed is asked for again from its start: the element holds nothing of it to carry on with.
    if (status === "error") return start(index);
    if (status === "paused") status = "loading";
    return sound();
  };

  const pause = (): void => {
    live("pause");
    if (index >= 0) audio.pause();
  };

  const next = async (): Promise<void> => {
    live("next");
    if (index + 1 < tracks.length) await start(index + 1);
  };

  const previous = async (): Promise<void> => {
    live("previous");
    if (index > 0) await start(index - 1);
  };

  const seek = (to: number): void => {
    live("seek");
    if (typeof to !== "number" || !Number.isFinite(to) || to < 0) throw new TypeError(`${NAME}.seek: seconds must be a number from 0; got ${got(to)}`);
    if (index < 0) return;
    audio.currentTime = to;
    changed();
  };

  const setVolume = (volume: number): void => {
    live("setVolume");
    if (typeof volume !== "number" || !(volume >= 0 && volume <= 1)) throw new TypeError(`${NAME}.setVolume: volume must be a number from 0 to 1; got ${got(volume)}`);
    audio.volume = volume;
    changed();
  };

  const subscribe = (listener: () => void): (() => void) => {
    live("subscribe");
    if (typeof listener !== "function") throw new TypeError(`${NAME}.subscribe: listener must be a function; got ${got(listener)}`);
    // An entry of its own, so that a listener subscribed twice is told twice, and each of its two leaves alone.
    const entry = { heard: listener };
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const [type, handler] of handlers) audio.removeEventListener(type, handler);
    try {
      reset(Object.freeze([]), []);
    } finally {
      // Whoever listened is let go of, whatever one of them threw on hearing the last of it.
      listeners.clear();
    }
  };

  const player = ownOf({
    load,
    play,
    pause,
    next,
    previous,
    seek,
    setVolume,
    subscribe,
    dispose,
  });
  // Where the runtime has `await using`, a player can be taken by it. Where it has not, as in a browser that came
  // before it, there is no such symbol: written as a key all the same, it would be the name "undefined".
  const asyncDispose: unknown = Reflect.get(Symbol, "asyncDispose");
  if (typeof asyncDispose === "symbol") {
    Object.defineProperty(player, asyncDispose, {
      value: (): Promise<void> => {
        dispose();
        return Promise.resolve();
      },
      enumerable: true,
    });
  }
  // A getter, so that the one object handed out always gives the state as it now is. Frozen with the rest, and with
  // nothing to inherit from, so a name looked up on a player is one of these or is not there.
  Object.defineProperty(player, "state", { get: () => state, enumerable: true });
  return Object.freeze(player) as unknown as tPreviewPlayer<T>;
}

import { createBrowserClient, type tBrowserMusic, type tMusicKitInstance } from "@open-music-sdk/browser";
import { Window } from "happy-dom";
import { StrictMode, act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MusicProvider, useConnect, useMusic, useMusicQueries, useMusicUserToken, usePreviewPlayer } from "./client";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64url({ alg: "ES256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 900 })}.c2ln`;
const SONG = { id: "1", type: "songs", href: "/v1/catalog/us/songs/1", attributes: { name: "Hey Jude", previews: [{ url: "https://audio-ssl.itunes.apple.com/1.m4a" }] } };
const APP = { name: "Crate Digger" };

/** A page's client over a token endpoint and an Apple that each answer with one thing, recording what Apple was asked. */
function page() {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    calls.push(req);
    const path = new URL(req.url).pathname;
    const body = path.endsWith("/token") ? { token: TOKEN } : path.endsWith("/me/storefront") ? { data: [{ id: "us", type: "storefronts", href: "/v1/storefronts/us" }] } : { data: [SONG] };
    return Promise.resolve(new Response(JSON.stringify(body)));
  };
  const music = createBrowserClient({ tokenUrl: "https://app.example/api/music/token", endpoint: { fetch }, fetch, retry: false, storefront: "us" });
  return { music, userTokens: () => calls.filter((c) => c.url.includes("/v1/")).map((c) => c.headers.get("music-user-token")) };
}

/** A component that calls `use` and keeps what it gave, so a test can look. */
function probe<R>(use: () => R) {
  const seen: { current?: R; renders: number } = { renders: 0 };
  function Probe(): null {
    seen.current = use();
    seen.renders++;
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention -- a component is named as React names one
  return { Probe, seen };
}

const roots: Root[] = [];
function mount(element: ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(element);
  });
  return {
    rerender: (next: ReactNode) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}
/** Lets what is pending settle: a configure, a ready, a play. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

afterEach(() => {
  for (const root of roots.splice(0))
    act(() => {
      root.unmount();
    });
  vi.unstubAllGlobals();
});

describe("MusicProvider and useMusic", () => {
  test("gives one client to every component: the page's, until a token is held", () => {
    const { music } = page();
    const a = probe(useMusic);
    const b = probe(useMusic);
    mount(createElement(MusicProvider, { music }, createElement(a.Probe), createElement(b.Probe)));
    expect(a.seen.current).toBe(music);
    expect(b.seen.current).toBe(music);
  });

  test("useMusic without a provider is a TypeError naming it", () => {
    const { Probe } = probe(useMusic);
    expect(() => renderToString(createElement(Probe))).toThrow(new TypeError("useMusic: no MusicProvider above this component"));
  });

  test.each<[string, unknown, string]>([
    ["no client", undefined, "undefined"],
    ["a client without the provider on it", { request: () => undefined, paginate: () => undefined, storefront: () => undefined, as: () => undefined, forUser: () => undefined }, "object"],
    ["a token where the client belongs", "dev", "3 characters"],
  ])("a provider handed %s is a TypeError", (_name, music, what) => {
    expect(() => renderToString(createElement(MusicProvider, { music: music as tBrowserMusic }))).toThrow(new TypeError(`MusicProvider: music must be a client from createBrowserClient; got ${what}`));
  });
});

describe("useMusicUserToken", () => {
  test("setToken binds every component's client to the listener and raises the generation; the same token again changes nothing; undefined forgets it", async () => {
    const { music, userTokens } = page();
    const { Probe, seen } = probe(() => ({ token: useMusicUserToken(), music: useMusic(), key: useMusicQueries().catalog.getSong("1").queryKey }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    expect([seen.current?.token[0], seen.current?.key[1]]).toEqual([undefined, 0]);
    act(() => {
      seen.current?.token[1]("listener");
    });
    expect(seen.current?.token[0]).toBe("listener");
    expect(seen.current?.music).not.toBe(music);
    expect(seen.current?.key[1]).toBe(1);
    await seen.current?.music.request("v1/me/storefront");
    expect(userTokens()).toEqual(["listener"]);
    const bound = seen.current?.music;
    act(() => {
      seen.current?.token[1](" listener ");
    });
    expect([seen.current?.music, seen.current?.key[1]]).toEqual([bound, 1]);
    act(() => {
      seen.current?.token[1](undefined);
    });
    expect([seen.current?.token[0], seen.current?.music, seen.current?.key[1]]).toEqual([undefined, music, 2]);
  });

  test("what is no token is a TypeError naming useMusicUserToken, and nothing changes", () => {
    const { music } = page();
    const { Probe, seen } = probe(() => ({ token: useMusicUserToken(), music: useMusic() }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    expect(() =>
      act(() => {
        seen.current?.token[1]("a b");
      }),
    ).toThrow(new TypeError("useMusicUserToken: token must be a token, printable characters with no spaces or line breaks inside, or undefined to forget it; got 3 characters"));
    expect(seen.current?.music).toBe(music);
  });

  test("the token and its setter keep their identity between renders that change neither", () => {
    const { music } = page();
    const { Probe, seen } = probe(useMusicUserToken);
    const { rerender } = mount(createElement(MusicProvider, { music }, createElement(Probe)));
    const first = seen.current;
    rerender(createElement(MusicProvider, { music }, createElement(Probe)));
    expect(seen.renders).toBe(2);
    expect(seen.current).toBe(first);
  });
});

describe("useConnect", () => {
  /** Apple's script as the hook meets it: configure gives an instance that holds what it was given and authorizes as told. */
  function kit(instance: Partial<tMusicKitInstance> = {}) {
    const made: tMusicKitInstance = { authorize: () => Promise.resolve("signed"), ...instance };
    return { configure: vi.fn((options: { developerToken: string }) => ((made.developerToken = options.developerToken), Promise.resolve(made))), instance: made };
  }

  // Apple's script is one per page, so each test gets a page of its own.
  beforeEach(() => {
    const window = new Window();
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
  });

  test("makes the helper when the component mounts, once under StrictMode; is ready once Apple's script is configured; and hands a restored token to the provider", async () => {
    const { music, userTokens } = page();
    const musicKit = kit({ musicUserToken: "restored" });
    const { Probe, seen } = probe(() => ({ connect: useConnect({ app: APP, musicKit }), music: useMusic() }));
    mount(createElement(StrictMode, null, createElement(MusicProvider, { music }, createElement(Probe))));
    expect(seen.current?.connect.isReady).toBe(false);
    await settle();
    expect([seen.current?.connect.isReady, seen.current?.connect.error]).toEqual([true, undefined]);
    expect(musicKit.configure).toHaveBeenCalledTimes(1);
    expect(seen.current?.music).not.toBe(music);
    await seen.current?.music.request("v1/me/storefront");
    expect(userTokens()).toEqual(["restored"]);
  });

  test("connect() opens Apple's window and hands the token to the provider; a decline leaves things as they were", async () => {
    const { music } = page();
    const answers = ["signed", undefined];
    const musicKit = kit({ authorize: () => Promise.resolve(answers.shift()) });
    const { Probe, seen } = probe(() => ({ connect: useConnect({ app: APP, musicKit }), music: useMusic(), token: useMusicUserToken()[0] }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    await settle();
    let token: string | undefined;
    await act(async () => {
      token = await seen.current?.connect.connect();
    });
    expect([token, seen.current?.token]).toEqual(["signed", "signed"]);
    const bound = seen.current?.music;
    await act(async () => {
      token = await seen.current?.connect.connect();
    });
    expect([token, seen.current?.token, seen.current?.music]).toEqual([undefined, "signed", bound]);
  });

  test("a script that cannot be configured: isReady stays false, and error says why", async () => {
    const { music } = page();
    const musicKit = { configure: () => Promise.reject(new Error("configure failed")) };
    const { Probe, seen } = probe(() => useConnect({ app: APP, musicKit }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    await settle();
    expect(seen.current?.isReady).toBe(false);
    expect(seen.current?.error).toEqual(new Error("configure failed"));
  });

  test("the options are read on the first mount: a render with another app makes no second helper, and connect keeps its identity", async () => {
    const { music } = page();
    const musicKit = kit();
    const { Probe, seen } = probe((options: { app: { name: string } } = { app: APP }) => useConnect({ ...options, musicKit }));
    const { rerender } = mount(createElement(MusicProvider, { music }, createElement(Probe)));
    await settle();
    const first = seen.current;
    rerender(createElement(MusicProvider, { music }, createElement(Probe, { app: { name: "Another" } })));
    expect(musicKit.configure).toHaveBeenCalledTimes(1);
    expect(seen.current?.connect).toBe(first?.connect);
  });

  test("unmount disposes the helper: connect() after it is a TypeError", async () => {
    const { music } = page();
    const { Probe, seen } = probe(() => useConnect({ app: APP, musicKit: kit() }));
    const { unmount } = mount(createElement(MusicProvider, { music }, createElement(Probe)));
    await settle();
    const { connect } = seen.current ?? {};
    unmount();
    await expect(connect?.()).rejects.toThrow(new TypeError("useConnect: connect() was called before the component mounted, or after it unmounted"));
  });

  test("on a server render there is no helper: isReady is false and connect() is a TypeError", async () => {
    const { music } = page();
    const { Probe, seen } = probe(() => useConnect({ app: APP }));
    renderToString(createElement(MusicProvider, { music }, createElement(Probe)));
    expect(seen.current?.isReady).toBe(false);
    await expect(seen.current?.connect()).rejects.toThrow(TypeError);
  });
});

describe("usePreviewPlayer", () => {
  /** An audio element that plays nothing and says nothing, and records what it was told. */
  const audio = () => ({ src: "", currentTime: 0, volume: 1, duration: Number.NaN, paused: true, ended: false, error: null, play: vi.fn(() => Promise.resolve()), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });

  test("the state is idle until the component mounts, and the player's from then on; the verbs reach the element", async () => {
    const element = audio();
    const { Probe, seen } = probe(() => usePreviewPlayer<typeof SONG>({ audio: element }));
    mount(createElement(Probe));
    expect(seen.current?.state.status).toBe("idle");
    act(() => {
      expect(seen.current?.load([SONG])).toEqual({ tracks: [SONG], skipped: [] });
    });
    expect(seen.current?.state.tracks).toEqual([SONG]);
    await act(() => seen.current?.play());
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(element.src).toBe("https://audio-ssl.itunes.apple.com/1.m4a");
    expect([seen.current?.state.track, seen.current?.state.index]).toEqual([SONG, 0]);
    act(() => {
      seen.current?.pause();
    });
    expect(element.pause).toHaveBeenCalledTimes(1);
  });

  test("the verbs keep their identity across renders and changes of state, so one can go into an effect's dependencies", async () => {
    const { Probe, seen } = probe(() => usePreviewPlayer({ audio: audio() }));
    const { rerender } = mount(createElement(Probe));
    const first = seen.current;
    rerender(createElement(Probe));
    act(() => {
      seen.current?.load([SONG]);
    });
    await act(() => seen.current?.play());
    expect(seen.current?.state).not.toBe(first?.state);
    for (const verb of ["load", "play", "pause", "next", "previous", "seek", "setVolume"] as const) expect(seen.current?.[verb]).toBe(first?.[verb]);
  });

  test("a ref to the element is read when the component mounts, when the element is there", async () => {
    const element = audio();
    const ref = { current: null as typeof element | null };
    const { Probe, seen } = probe(() => usePreviewPlayer({ audio: ref }));
    ref.current = element;
    mount(createElement(Probe));
    act(() => {
      seen.current?.load([SONG]);
    });
    await act(() => seen.current?.play());
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  test("a verb before the player exists is a TypeError naming it: on a server render, where no effect runs", () => {
    const { Probe, seen } = probe(() => usePreviewPlayer());
    renderToString(createElement(Probe));
    expect(seen.current?.state.status).toBe("idle");
    expect(() => seen.current?.load([SONG])).toThrow(new TypeError("usePreviewPlayer.load: the player is made when the component mounts; call load from a click, or from an effect of the component that called usePreviewPlayer"));
  });

  test("unmount disposes the player: the clip comes off the element, and a verb after it is a TypeError", async () => {
    const element = audio();
    const { Probe, seen } = probe(() => usePreviewPlayer({ audio: element }));
    const { unmount } = mount(createElement(Probe));
    act(() => {
      seen.current?.load([SONG]);
    });
    await act(() => seen.current?.play());
    const { pause } = seen.current ?? {};
    unmount();
    expect(element.removeAttribute).toHaveBeenCalledWith("src");
    expect(() => pause?.()).toThrow(TypeError);
  });

  test("the options are read on the first mount: another element on a later render is not the one played through", async () => {
    const first = audio();
    const second = audio();
    const { Probe, seen } = probe((options: { audio: ReturnType<typeof audio> } = { audio: first }) => usePreviewPlayer(options));
    const { rerender } = mount(createElement(Probe));
    rerender(createElement(Probe, { audio: second }));
    act(() => {
      seen.current?.load([SONG]);
    });
    await act(() => seen.current?.play());
    expect([first.play.mock.calls.length, second.play.mock.calls.length]).toEqual([1, 0]);
  });

  test("an option the player refuses is refused when the component mounts, naming the player", () => {
    const { Probe } = probe(() => usePreviewPlayer({ audio: audio(), hosts: "itunes.apple.com" as never }));
    expect(() => mount(createElement(Probe))).toThrow(/^previewPlayer: hosts must be/);
  });
});

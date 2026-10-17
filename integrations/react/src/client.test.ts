import { createBrowserClient, type tBrowserMusic, type tMusicKitInstance } from "@open-music-sdk/browser";
import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { Activity, StrictMode, act, createElement, type ReactNode } from "react";
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
  test("setToken binds every component's client to the listener and gives the sign-in a scope of its own; the same token again changes nothing; undefined forgets it, and the scope is the page's again", async () => {
    const { music, userTokens } = page();
    const { Probe, seen } = probe(() => ({ token: useMusicUserToken(), music: useMusic(), key: useMusicQueries().catalog.getSong("1").queryKey }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    expect([seen.current?.token[0], seen.current?.key[1]]).toEqual([undefined, 0]);
    act(() => {
      seen.current?.token[1]("listener");
    });
    expect(seen.current?.token[0]).toBe("listener");
    expect(seen.current?.music).not.toBe(music);
    const scope = seen.current?.key[1];
    expect(typeof scope).toBe("string");
    await seen.current?.music.request("v1/me/storefront");
    expect(userTokens()).toEqual(["listener"]);
    const bound = seen.current?.music;
    act(() => {
      seen.current?.token[1](" listener ");
    });
    expect([seen.current?.music, seen.current?.key[1]]).toEqual([bound, scope]);
    act(() => {
      seen.current?.token[1](undefined);
    });
    expect([seen.current?.token[0], seen.current?.music, seen.current?.key[1]]).toEqual([undefined, music, 0]);
  });

  test("each sign-in has a scope of its own, across providers and reloads: what one listener cached is never under another's keys", () => {
    const { music } = page();
    const cache = new QueryClient();
    const { Probe, seen } = probe(() => ({ setToken: useMusicUserToken()[1], key: useMusicQueries().user.getLibrarySong("l.1").queryKey }));
    const { unmount } = mount(createElement(MusicProvider, { music }, createElement(Probe)));
    act(() => {
      seen.current?.setToken("a");
    });
    const first = seen.current?.key ?? [];
    cache.setQueryData(first, "what A has");
    act(() => {
      seen.current?.setToken(undefined);
    });
    act(() => {
      seen.current?.setToken("b");
    });
    expect(seen.current?.key).not.toEqual(first);
    expect(cache.getQueryData(seen.current?.key ?? [])).toBeUndefined();
    unmount();
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    act(() => {
      seen.current?.setToken("a");
    });
    expect(seen.current?.key).not.toEqual(first);
    expect(cache.getQueryData(seen.current?.key ?? [])).toBeUndefined();
    expect(cache.getQueryData(first)).toBe("what A has");
    expect(JSON.stringify(seen.current?.key)).not.toContain('"a"');
    cache.clear();
  });

  test("a page that is not secure has no crypto.randomUUID, and each sign-in still has a scope of its own", () => {
    const { music } = page();
    vi.stubGlobal("crypto", {});
    const { Probe, seen } = probe(() => ({ setToken: useMusicUserToken()[1], key: useMusicQueries().catalog.getSong("1").queryKey }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    act(() => {
      seen.current?.setToken("a");
    });
    const first = seen.current?.key[1];
    act(() => {
      seen.current?.setToken("b");
    });
    expect(typeof first).toBe("string");
    expect(seen.current?.key[1]).not.toBe(first);
  });

  test("a client handed over later is another scope; the first is the page's, 0, as on a server", () => {
    const { music } = page();
    const other = page().music;
    const { Probe, seen } = probe(() => useMusicQueries().catalog.getSong("1").queryKey);
    const { rerender } = mount(createElement(MusicProvider, { music }, createElement(Probe)));
    expect(seen.current?.[1]).toBe(0);
    rerender(createElement(MusicProvider, { music: other }, createElement(Probe)));
    expect(typeof seen.current?.[1]).toBe("string");
    rerender(createElement(MusicProvider, { music }, createElement(Probe)));
    expect(seen.current?.[1]).toBe(0);
  });

  test("what is no token is a TypeError naming useMusicUserToken, and nothing changes", () => {
    const { music } = page();
    const { Probe, seen } = probe(() => ({ token: useMusicUserToken(), music: useMusic() }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    expect(() => {
      act(() => {
        seen.current?.token[1]("a b");
      });
    }).toThrow(new TypeError("useMusicUserToken: token must be a token, printable characters with no spaces or line breaks inside, or undefined to forget it; got 3 characters"));
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

  test("makes the helper when the component mounts, and again after StrictMode's simulated remount; Apple's script is configured once for the page; a restored token goes to the provider", async () => {
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

  test("a script that cannot be configured: isReady stays false, and error says why; connect() tries again, and isReady and error follow", async () => {
    const { music } = page();
    const instance: tMusicKitInstance = { authorize: () => Promise.resolve("signed") };
    const configure = vi.fn<(options: { developerToken: string }) => Promise<tMusicKitInstance>>().mockRejectedValueOnce(new Error("configure failed")).mockResolvedValue(instance);
    const { Probe, seen } = probe(() => ({ connect: useConnect({ app: APP, musicKit: { configure } }), token: useMusicUserToken()[0] }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    await settle();
    expect(seen.current?.connect.isReady).toBe(false);
    expect(seen.current?.connect.error).toEqual(new Error("configure failed"));
    let token: string | undefined;
    await act(async () => {
      token = await seen.current?.connect.connect();
    });
    expect([token, seen.current?.token, seen.current?.connect.isReady, seen.current?.connect.error]).toEqual(["signed", "signed", true, undefined]);
  });

  test("a helper let go of while Apple's script was being configured, as when an Activity hides the component, puts its failure nowhere: the component shown again starts afresh", async () => {
    const { music } = page();
    let fail: (error: Error) => void = () => undefined;
    const instance: tMusicKitInstance = { authorize: () => Promise.resolve("signed") };
    const configure = vi.fn<(options: { developerToken: string }) => Promise<tMusicKitInstance>>().mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject))).mockResolvedValue(instance);
    const { Probe, seen } = probe(() => useConnect({ app: APP, musicKit: { configure } }));
    const tree = (mode: "visible" | "hidden") => createElement(MusicProvider, { music }, createElement(Activity, { mode, children: createElement(Probe) }));
    const { rerender } = mount(tree("visible"));
    await settle();
    expect(configure).toHaveBeenCalledTimes(1);
    rerender(tree("hidden"));
    fail(new Error("configure failed"));
    await settle();
    rerender(tree("visible"));
    expect([seen.current?.isReady, seen.current?.error]).toEqual([false, undefined]);
    await settle();
    expect([seen.current?.isReady, seen.current?.error]).toEqual([true, undefined]);
    expect(configure).toHaveBeenCalledTimes(2);
  });

  test("a restored token is not taken while the provider holds one, nor after the app forgot one: signing out stays signed out", async () => {
    const { music } = page();
    const musicKit = kit({ musicUserToken: "restored" });
    const holder = probe(() => useMusicUserToken());
    const connect = probe(() => useConnect({ app: APP, musicKit }));
    const tree = (show: boolean) => createElement(MusicProvider, { music }, createElement(holder.Probe), show ? createElement(connect.Probe) : null);
    const { rerender } = mount(tree(false));
    act(() => {
      holder.seen.current?.[1]("mine");
    });
    rerender(tree(true));
    await settle();
    expect([connect.seen.current?.isReady, holder.seen.current?.[0]]).toEqual([true, "mine"]);
    act(() => {
      holder.seen.current?.[1](undefined);
    });
    rerender(tree(false));
    rerender(tree(true));
    await settle();
    expect([connect.seen.current?.isReady, holder.seen.current?.[0]]).toEqual([true, undefined]);
  });

  test("disconnect() is Apple's own sign-out, and the provider forgets the token", async () => {
    const { music } = page();
    const instance: tMusicKitInstance = { musicUserToken: "restored", authorize: () => Promise.resolve("signed"), unauthorize: vi.fn() };
    const musicKit = { configure: () => Promise.resolve(instance) };
    const { Probe, seen } = probe(() => ({ connect: useConnect({ app: APP, musicKit }), token: useMusicUserToken()[0], music: useMusic() }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    await settle();
    expect(seen.current?.token).toBe("restored");
    await act(async () => {
      await seen.current?.connect.disconnect();
    });
    expect(instance.unauthorize).toHaveBeenCalledTimes(1);
    expect([seen.current?.token, seen.current?.music]).toEqual([undefined, music]);
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

  test("on a server render there is no helper: isReady is false, and connect() and disconnect() are TypeErrors naming the hook", async () => {
    const { music } = page();
    const { Probe, seen } = probe(() => useConnect({ app: APP }));
    renderToString(createElement(MusicProvider, { music }, createElement(Probe)));
    expect(seen.current?.isReady).toBe(false);
    await expect(seen.current?.connect()).rejects.toThrow(new TypeError("useConnect: connect() was called before the component mounted, or after it unmounted"));
    await expect(seen.current?.disconnect()).rejects.toThrow(new TypeError("useConnect: disconnect() was called before the component mounted, or after it unmounted"));
  });

  test("what Apple's script throws from connect() is handed on as it came, and is the hook's error too", async () => {
    const { music } = page();
    const boom = { errorCode: "AUTHORIZATION_ERROR", message: "Unauthorized" };
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Apple's script rejects with an object of its own, not an Error
    const musicKit = kit({ authorize: () => Promise.reject(boom) });
    const { Probe, seen } = probe(() => ({ connect: useConnect({ app: APP, musicKit }), token: useMusicUserToken()[0] }));
    mount(createElement(MusicProvider, { music }, createElement(Probe)));
    await settle();
    expect(seen.current?.connect.isReady).toBe(true);
    let thrown: unknown;
    await act(async () => {
      thrown = await seen.current?.connect.connect().catch((e: unknown) => e);
    });
    expect(thrown).toBe(boom);
    expect([seen.current?.connect.isReady, seen.current?.connect.error, seen.current?.token]).toEqual([false, boom, undefined]);
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

  test("under StrictMode, whose simulated remount disposes the first player, the hook holds the second: its state follows the verbs, which reach the element", async () => {
    const element = audio();
    const { Probe, seen } = probe(() => usePreviewPlayer<typeof SONG>({ audio: element }));
    mount(createElement(StrictMode, null, createElement(Probe)));
    act(() => {
      seen.current?.load([SONG]);
    });
    expect(seen.current?.state.tracks).toEqual([SONG]);
    await act(() => seen.current?.play());
    expect(element.play).toHaveBeenCalledTimes(1);
    expect([seen.current?.state.track, seen.current?.state.index]).toEqual([SONG, 0]);
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

  test("a ref with nothing in it when the component mounts is a TypeError naming the hook, not a silent element of the player's own", () => {
    const { Probe } = probe(() => usePreviewPlayer({ audio: { current: null } }));
    expect(() => mount(createElement(Probe))).toThrow(new TypeError("usePreviewPlayer: audio is a ref with nothing in it when the component mounted; render the element before this component, or hand over the element itself"));
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

import { isAppleMusicError } from "@open-music-sdk/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MUSICKIT_SCRIPT, createConnect, type tConnectOptions, type tMusicKit, type tMusicKitInstance } from "./connect";

const APP = { name: "Vinyl Collector Simulator" };

/** An unsigned JWT with an `exp` this many seconds ahead, marked so two can be told apart. */
const jwt = (lifeSeconds: number, mark = "a") => {
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64url({ alg: "ES256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + lifeSeconds, mark })}.c2ln`;
};

interface tFakeScript {
  src: string;
  async: boolean;
  readonly listeners: Map<string, () => void>;
  addEventListener(type: string, listener: () => void): void;
  readonly remove: () => void;
}

/** A page as the helper sees it: where a script goes, what it listens to, and whether the tab is visible. Its storage throws, so a read or a write of it is seen. */
function page(visibilityState = "visible") {
  const listeners = new Map<string, Set<() => void>>();
  const scripts: tFakeScript[] = [];
  const doc = {
    visibilityState,
    get cookie(): string {
      throw new Error("document.cookie was read");
    },
    createElement: (tag: string): tFakeScript => {
      const script: tFakeScript = {
        src: "",
        async: false,
        listeners: new Map(),
        addEventListener: (type, listener) => script.listeners.set(type, listener),
        remove: vi.fn(),
      };
      expect(tag).toBe("script");
      scripts.push(script);
      return script;
    },
    head: { appendChild: vi.fn() },
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    /** Fires an event of the page's, as the browser would. */
    fire: (type: string) => {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listening: (type: string) => listeners.get(type)?.size ?? 0,
    scripts,
  };
  return doc;
}

/** Apple's script, as the helper uses it: `configure` gives an instance that holds what it was configured with, and authorizes as told. */
function kit(instance: Partial<tMusicKitInstance> = {}) {
  const made: tMusicKitInstance = { authorize: () => Promise.resolve("listener"), ...instance };
  const configure = vi.fn((options: { developerToken: string }) => {
    made.developerToken = options.developerToken;
    return Promise.resolve(made);
  });
  return { configure, instance: made } satisfies tMusicKit & { instance: tMusicKitInstance };
}

/** The script loaded, as the browser does it: the global defined, then the page told. */
function scriptLoads(doc: ReturnType<typeof page>, musicKit: tMusicKit) {
  vi.stubGlobal("MusicKit", musicKit);
  doc.fire("musickitloaded");
}

const storage = new Proxy(
  {},
  {
    get() {
      throw new Error("storage was read");
    },
    set() {
      throw new Error("storage was written");
    },
  },
);

/** A provider that answers with the token it is told to, and counts the askings. */
const provider = (token = jwt(900)) => vi.fn(() => Promise.resolve(token));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("MusicKit", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createConnect: Apple's script", () => {
  test("is loaded from Apple's CDN when the helper is made, once per page however many helpers, and configured once with the developer token and the app", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const token = jwt(900);
    const developerToken = provider(token);
    const first = createConnect({ developerToken }, { app: APP });
    const second = createConnect({ developerToken }, { app: APP });
    expect(doc.scripts).toHaveLength(1);
    expect([doc.scripts[0]?.src, doc.scripts[0]?.async]).toEqual([MUSICKIT_SCRIPT, true]);
    expect(doc.head.appendChild).toHaveBeenCalledWith(doc.scripts[0]);
    const musicKit = kit();
    scriptLoads(doc, musicKit);
    await expect(Promise.all([first.ready, second.ready])).resolves.toEqual([undefined, undefined]);
    expect(musicKit.configure).toHaveBeenCalledTimes(1);
    expect(musicKit.configure).toHaveBeenCalledWith({ developerToken: token, app: { name: "Vinyl Collector Simulator" } });
    expect(developerToken).toHaveBeenCalledTimes(1);
  });

  test("is not loaded when the page has it already: a MusicKit global is configured as it is", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const musicKit = kit({ musicUserToken: "restored" });
    vi.stubGlobal("MusicKit", musicKit);
    const helper = createConnect({ developerToken: provider() }, { app: APP });
    expect(doc.scripts).toHaveLength(0);
    expect(await helper.ready).toBe("restored");
  });

  test("is the page's own when musicKit is given: nothing is loaded, and that one is configured", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const musicKit = kit();
    const helper = createConnect({ developerToken: provider() }, { app: { name: "Vinyl Collector Simulator", build: "1.2.0" }, musicKit });
    expect(doc.scripts).toHaveLength(0);
    await helper.ready;
    expect(musicKit.configure).toHaveBeenCalledWith(expect.objectContaining({ app: { name: "Vinyl Collector Simulator", build: "1.2.0" } }));
  });

  test("a load that fails rejects ready with a NetworkError and takes the element out of the page; connect() tries again, and rejects the same way when that fails too", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const helper = createConnect({ developerToken: provider() }, { app: APP });
    doc.scripts[0]?.listeners.get("error")?.();
    const error: unknown = await helper.ready.catch((e: unknown) => e);
    expect(isAppleMusicError(error, "NetworkError")).toBe(true);
    expect((error as Error).message).toContain("js-cdn.music.apple.com");
    expect(doc.scripts[0]?.remove).toHaveBeenCalledTimes(1);
    expect(doc.listening("musickitloaded")).toBe(0);
    const retried = helper.connect();
    expect(doc.scripts).toHaveLength(2);
    doc.scripts[1]?.listeners.get("error")?.();
    expect(isAppleMusicError(await retried.catch((e: unknown) => e), "NetworkError")).toBe(true);
    const signedIn = helper.connect();
    expect(doc.scripts).toHaveLength(3);
    scriptLoads(doc, kit({ musicUserToken: "back" }));
    expect(await signedIn).toBe("listener");
    expect(await createConnect({ developerToken: provider() }, { app: APP }).ready).toBe("back");
    expect(doc.scripts).toHaveLength(3);
  });

  test("a script that runs but defines no MusicKit is a NetworkError too", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const helper = createConnect({ developerToken: provider() }, { app: APP });
    doc.fire("musickitloaded");
    expect(isAppleMusicError(await helper.ready.catch((e: unknown) => e), "NetworkError")).toBe(true);
  });

  test("a rejection nobody awaits is nobody's unhandled rejection", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    createConnect({ developerToken: provider() }, { app: APP });
    doc.scripts[0]?.listeners.get("error")?.();
    await vi.advanceTimersByTimeAsync(0);
  });

  test("a provider that cannot give a token fails ready with the provider's error, and the page is left for another helper to configure", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const failing = vi.fn(() => Promise.reject(new Error("endpoint down")));
    const helper = createConnect({ developerToken: failing }, { app: APP, musicKit: kit() });
    await expect(helper.ready).rejects.toThrow("endpoint down");
    const musicKit = kit({ musicUserToken: "restored" });
    expect(await createConnect({ developerToken: provider() }, { app: APP, musicKit }).ready).toBe("restored");
  });

  test("is one per page: a second helper for another app is a TypeError, and one for the same app shares the configuration", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const musicKit = kit();
    const first = createConnect({ developerToken: provider() }, { app: APP, musicKit });
    expect(() => createConnect({ developerToken: provider() }, { app: { name: "Another" }, musicKit })).toThrow(new TypeError("createConnect: Apple's script is one per page, and this page's is configured for another app; make one helper per page, or make each for the same app"));
    const same = createConnect({ developerToken: provider() }, { app: { ...APP }, musicKit });
    await Promise.all([first.ready, same.ready]);
    expect(musicKit.configure).toHaveBeenCalledTimes(1);
  });

  test("two pages are two: each loads and configures its own", async () => {
    const one = page();
    vi.stubGlobal("document", one);
    const first = createConnect({ developerToken: provider() }, { app: APP });
    const two = page();
    vi.stubGlobal("document", two);
    const second = createConnect({ developerToken: provider() }, { app: { name: "Another" } });
    expect([one.scripts.length, two.scripts.length]).toEqual([1, 1]);
    scriptLoads(two, kit({ musicUserToken: "two" }));
    expect(await second.ready).toBe("two");
    vi.stubGlobal("MusicKit", undefined);
    scriptLoads(one, kit({ musicUserToken: "one" }));
    expect(await first.ready).toBe("one");
  });
});

describe("createConnect: ready and connect()", () => {
  /** A helper on a page whose script is Apple's as given, loaded at once. */
  function made(instance: Partial<tMusicKitInstance> = {}, options: Partial<tConnectOptions> = {}, developerToken = provider()) {
    const doc = page();
    vi.stubGlobal("document", doc);
    const musicKit = kit(instance);
    return { doc, musicKit, developerToken, helper: createConnect({ developerToken }, { app: APP, musicKit, ...options }) };
  }

  test.each<[string, string | null | undefined, string | undefined]>([
    ["the token Apple's script restored for a returning listener", "restored", "restored"],
    ["that token with whitespace around it, as a token", " restored\n", "restored"],
    ["nothing, when the script holds none", null, undefined],
    ["nothing, when the script says nothing", undefined, undefined],
  ])("ready resolves to %s", async (_name, musicUserToken, expected) => {
    const { helper } = made({ musicUserToken });
    expect(await helper.ready).toBe(expected);
  });

  test.each<[string, Promise<string | null | undefined>, string | undefined]>([
    ["the Music User Token the listener's sign-in gave", Promise.resolve("listener"), "listener"],
    ["undefined when the listener declined and the script answered with nothing", Promise.resolve(undefined), undefined],
    ["undefined when the script answered with null", Promise.resolve(null), undefined],
    ["undefined when the script answered with no token at all", Promise.resolve(""), undefined],
  ])("connect() resolves to %s", async (_name, answer, expected) => {
    const { helper } = made({ authorize: () => answer });
    await helper.ready;
    expect(await helper.connect()).toBe(expected);
  });

  /** What the script rejected with when the listener declined, or closed its window, in Firefox on 18 October 2026: an Error of its own, its code a getter. */
  const mkError = (code: string, message: string) =>
    Object.defineProperty(Object.assign(new Error(message), { name: code, isMKError: true, reason: code, description: message }), "errorCode", { get: () => code });

  test.each<[string, unknown]>([
    ["the script's own error for it", mkError("AUTHORIZATION_ERROR", "Unauthorized")],
    ["an object with its code alone", { errorCode: "AUTHORIZATION_ERROR" }],
    ["an object with its name alone", { name: "AUTHORIZATION_ERROR" }],
  ])("a listener who declines, or closes Apple's window, makes the script reject with AUTHORIZATION_ERROR: connect() resolves to undefined, given %s", async (_what, declined) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Apple's script may reject with an object of its own
    const { helper } = made({ authorize: () => Promise.reject(declined) });
    await helper.ready;
    expect(await helper.connect()).toBeUndefined();
  });

  test.each<[string, unknown]>([
    ["the script's error for a developer token Apple refuses", mkError("UNAUTHORIZED_ERROR", "Unauthorized")],
    ["an object of Apple's shape with another code", { errorCode: "NETWORK_ERROR", message: "offline" }],
    ["an error of the page's own", new TypeError("popup blocked")],
    ["no object at all", "AUTHORIZATION_ERROR"],
  ])("anything else the script throws is handed on as it came, such as %s", async (_what, boom) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Apple's script may reject with an object of its own
    const { helper } = made({ authorize: () => Promise.reject(boom) });
    await helper.ready;
    await expect(helper.connect()).rejects.toBe(boom);
  });

  test("connect() waits on nothing but ready, which is settled: the provider is not asked, and authorize runs within a few microtasks, before any timer or task could", async () => {
    const authorize = vi.fn(() => Promise.resolve("listener"));
    const { helper, developerToken } = made({ authorize });
    await helper.ready;
    const asked = developerToken.mock.calls.length;
    const pending = helper.connect();
    for (let tick = 0; tick < 3; tick++) await Promise.resolve();
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(developerToken).toHaveBeenCalledTimes(asked);
    expect(await pending).toBe("listener");
  });

  test("after a ready that failed, connect() loads and configures afresh, so a page whose endpoint was down when it loaded can still sign in", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const instance: tMusicKitInstance = { authorize: () => Promise.resolve("listener") };
    const configure = vi.fn<(options: { developerToken: string }) => Promise<tMusicKitInstance>>().mockRejectedValueOnce(new Error("configure failed")).mockResolvedValue(instance);
    const helper = createConnect({ developerToken: provider() }, { app: APP, musicKit: { configure } });
    await expect(helper.ready).rejects.toThrow("configure failed");
    expect(await helper.connect()).toBe("listener");
    expect(await helper.connect()).toBe("listener");
    expect(configure).toHaveBeenCalledTimes(2);
  });

  test("disconnect() is Apple's own sign-out, where the script has one: a later helper on the page restores nothing", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const instance: tMusicKitInstance = { musicUserToken: "restored", authorize: () => Promise.resolve("listener"), unauthorize: vi.fn(() => ((instance as { musicUserToken?: string | undefined }).musicUserToken = undefined)) };
    const musicKit = { configure: () => Promise.resolve(instance) };
    const helper = createConnect({ developerToken: provider() }, { app: APP, musicKit });
    expect(await helper.ready).toBe("restored");
    await helper.disconnect();
    expect(instance.unauthorize).toHaveBeenCalledTimes(1);
    expect(await createConnect({ developerToken: provider() }, { app: APP, musicKit }).ready).toBeUndefined();
  });

  test("disconnect() where the script has no sign-out does nothing, and after dispose() it is a TypeError", async () => {
    const { helper } = made({ musicUserToken: "restored" });
    await helper.ready;
    await expect(helper.disconnect()).resolves.toBeUndefined();
    helper.dispose();
    await expect(helper.disconnect()).rejects.toThrow(new TypeError("createConnect: disconnect() was called after dispose()"));
  });

  test("disconnect() on a page whose configuration failed does nothing: there is no sign-in to end, and nothing is configured to end one", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const configure = vi.fn(() => Promise.reject(new Error("configure failed")));
    const helper = createConnect({ developerToken: provider() }, { app: APP, musicKit: { configure } });
    await expect(helper.ready).rejects.toThrow("configure failed");
    await expect(helper.disconnect()).resolves.toBeUndefined();
    expect(configure).toHaveBeenCalledTimes(1);
  });

  test("connect() before ready waits for it, and then goes on", async () => {
    const { helper } = made({ authorize: () => Promise.resolve("listener") });
    expect(await helper.connect()).toBe("listener");
  });

  test("what it gives is frozen, inherits nothing, and its functions need no this", async () => {
    const { helper } = made();
    expect(Object.isFrozen(helper)).toBe(true);
    expect(Object.getPrototypeOf(helper)).toBeNull();
    expect(Object.keys(helper).sort()).toEqual(["connect", "disconnect", "dispose", "ready"]);
    const { connect, ready } = helper;
    await ready;
    expect(await connect()).toBe("listener");
  });

  test("reads and writes no storage: the page's throws, and nothing here notices", async () => {
    const { helper } = made({ musicUserToken: "restored" });
    expect(await helper.ready).toBe("restored");
    expect(await helper.connect()).toBe("listener");
  });
});

describe("createConnect: the developer token is kept fresh off the click path", () => {
  test("halfway to the token's end the provider is asked again, and a changed token is set on the instance", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const tokens = [jwt(900, "first"), jwt(900, "first"), jwt(900, "second")];
    const developerToken = vi.fn(() => Promise.resolve(tokens.shift() ?? jwt(900, "later")));
    const musicKit = kit();
    const helper = createConnect({ developerToken }, { app: APP, musicKit });
    await helper.ready;
    const first = musicKit.instance.developerToken;
    expect(developerToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(449_000);
    expect(developerToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(developerToken).toHaveBeenCalledTimes(2);
    expect(musicKit.instance.developerToken).toBe(first);
    await vi.advanceTimersByTimeAsync(225_000);
    expect(developerToken).toHaveBeenCalledTimes(3);
    expect(musicKit.instance.developerToken).not.toBe(first);
    expect(musicKit.configure).toHaveBeenCalledTimes(1);
  });

  test("the askings never come closer than a minute apart, however near the end, and a token with no end is asked about every ten minutes", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const nearEnd = provider(jwt(70));
    const helper = createConnect({ developerToken: nearEnd }, { app: APP, musicKit: kit() });
    await helper.ready;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(nearEnd).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(nearEnd).toHaveBeenCalledTimes(2);
    helper.dispose();

    const plain = provider("not-a-jwt");
    const other = page();
    vi.stubGlobal("document", other);
    await createConnect({ developerToken: plain }, { app: APP, musicKit: kit() }).ready;
    await vi.advanceTimersByTimeAsync(599_000);
    expect(plain).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(plain).toHaveBeenCalledTimes(2);
  });

  test.each<[string, string]>([
    ["a payload that is no JSON", `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from("not json").toString("base64url")}.c2ln`],
    ["a payload with no exp in it", `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from('{"iss":"DEF123GHIJ"}').toString("base64url")}.c2ln`],
    ["an exp that is no number", `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from('{"exp":"soon"}').toString("base64url")}.c2ln`],
  ])("a token with %s says nothing of its end, and is asked about every ten minutes", async (_name, token) => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const developerToken = provider(token);
    await createConnect({ developerToken }, { app: APP, musicKit: kit() }).ready;
    await vi.advanceTimersByTimeAsync(599_000);
    expect(developerToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(developerToken).toHaveBeenCalledTimes(2);
  });

  test("when the tab comes back the provider is asked at once; a tab going hidden asks nothing", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const developerToken = provider();
    const helper = createConnect({ developerToken }, { app: APP, musicKit: kit() });
    await helper.ready;
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(developerToken).toHaveBeenCalledTimes(2);
    (doc as { visibilityState: string }).visibilityState = "hidden";
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(developerToken).toHaveBeenCalledTimes(2);
  });

  test("a provider that fails when the tab comes back is nobody's unhandled rejection, and the timer asks again", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const first = jwt(900);
    const answers = [Promise.resolve(first), Promise.reject(new Error("endpoint down"))];
    for (const answer of answers) answer.catch(() => undefined);
    const developerToken = vi.fn(() => answers.shift() ?? Promise.resolve(jwt(900, "b")));
    const musicKit = kit();
    const helper = createConnect({ developerToken }, { app: APP, musicKit });
    await helper.ready;
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(developerToken).toHaveBeenCalledTimes(2);
    expect(musicKit.instance.developerToken).toBe(first);
    await vi.advanceTimersByTimeAsync(451_000);
    expect(developerToken).toHaveBeenCalledTimes(3);
    expect(musicKit.instance.developerToken).not.toBe(first);
  });

  test("after a configuration that failed there is nothing to keep fresh: the tab coming back and the timer ask nothing, until connect() configures afresh", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const instance: tMusicKitInstance = { authorize: () => Promise.resolve("listener") };
    const configure = vi.fn<(options: { developerToken: string }) => Promise<tMusicKitInstance>>().mockRejectedValueOnce(new Error("configure failed")).mockResolvedValue(instance);
    const developerToken = vi.fn(() => Promise.resolve(jwt(900)));
    const helper = createConnect({ developerToken }, { app: APP, musicKit: { configure } });
    await expect(helper.ready).rejects.toThrow("configure failed");
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(developerToken).toHaveBeenCalledTimes(1);
    expect(await helper.connect()).toBe("listener");
    expect(developerToken).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(451_000);
    expect(developerToken).toHaveBeenCalledTimes(3);
  });

  test("dispose() before ready settles: ready still settles, and no timer is left behind", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const helper = createConnect({ developerToken: provider() }, { app: APP, musicKit: kit({ musicUserToken: "restored" }) });
    helper.dispose();
    expect(await helper.ready).toBe("restored");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("dispose() while the provider is being asked: what it answers is not set on the instance, and no timer is left behind", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    let answer: (token: string) => void = () => undefined;
    const answers = [Promise.resolve(jwt(900)), new Promise<string>((resolve) => (answer = resolve))];
    const developerToken = vi.fn(() => answers.shift() ?? Promise.resolve(jwt(900, "c")));
    const musicKit = kit();
    const helper = createConnect({ developerToken }, { app: APP, musicKit });
    await helper.ready;
    const first = musicKit.instance.developerToken;
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(developerToken).toHaveBeenCalledTimes(2);
    helper.dispose();
    answer(jwt(900, "b"));
    await vi.advanceTimersByTimeAsync(0);
    expect(musicKit.instance.developerToken).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("dispose() stops the timer and the listening, and connect() after it is a TypeError", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const developerToken = provider();
    const helper = createConnect({ developerToken }, { app: APP, musicKit: kit() });
    await helper.ready;
    expect(doc.listening("visibilitychange")).toBe(1);
    helper.dispose();
    expect(doc.listening("visibilitychange")).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    doc.fire("visibilitychange");
    expect(developerToken).toHaveBeenCalledTimes(1);
    await expect(helper.connect()).rejects.toThrow(new TypeError("createConnect: connect() was called after dispose()"));
  });

  test("a provider that fails on a later asking is asked again by the timer, with no tab change: a laptop that woke offline gets a fresh token once it is back", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const first = jwt(900);
    const answers = [Promise.resolve(first), Promise.reject(new Error("endpoint down")), Promise.resolve(jwt(900, "b"))];
    for (const answer of answers) answer.catch(() => undefined);
    const developerToken = vi.fn(() => answers.shift() ?? Promise.resolve(jwt(900, "c")));
    const musicKit = kit();
    const helper = createConnect({ developerToken }, { app: APP, musicKit });
    expect(await helper.ready).toBeUndefined();
    await vi.advanceTimersByTimeAsync(451_000);
    expect(developerToken).toHaveBeenCalledTimes(2);
    expect(musicKit.instance.developerToken).toBe(first);
    await vi.advanceTimersByTimeAsync(226_000);
    expect(developerToken).toHaveBeenCalledTimes(3);
    expect(musicKit.instance.developerToken).not.toBe(first);
    expect(await helper.connect()).toBe("listener");
  });

  test.each<[string, () => tMusicKitInstance]>([
    ["whose developerToken cannot be set keeps its own", () => Object.defineProperty({ authorize: () => Promise.resolve("listener") }, "developerToken", { get: () => "fixed", enumerable: true })],
    ["with no developerToken is given none", () => ({ authorize: () => Promise.resolve("listener") })],
  ])("an instance %s, and the asking goes on: whether a configured instance takes a new token is a live check", async (_name, made) => {
    const doc = page();
    vi.stubGlobal("document", doc);
    const tokens = [jwt(900, "a"), jwt(900, "b"), jwt(900, "c")];
    const developerToken = vi.fn(() => Promise.resolve(tokens.shift() ?? jwt(900, "d")));
    const instance = made();
    const before = { ...instance };
    const helper = createConnect({ developerToken }, { app: APP, musicKit: { configure: () => Promise.resolve(instance) } });
    await helper.ready;
    await vi.advanceTimersByTimeAsync(451_000);
    expect(developerToken).toHaveBeenCalledTimes(2);
    expect({ ...instance }).toEqual(before);
    await vi.advanceTimersByTimeAsync(451_000);
    expect(developerToken.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("a global under Apple's name that is no script, such as an element the page shows with that id, is passed over and the script loaded", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("MusicKit", { id: "MusicKit", tagName: "A" });
    const helper = createConnect({ developerToken: provider() }, { app: APP });
    expect(doc.scripts).toHaveLength(1);
    scriptLoads(doc, kit({ musicUserToken: "restored" }));
    expect(await helper.ready).toBe("restored");
  });

  test("a configured put on Object.prototype is not the page's: the page is configured as if it had none", async () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    Object.assign(Object.prototype, { configured: { app: "other" } });
    try {
      const helper = createConnect({ developerToken: provider() }, { app: APP, musicKit: kit({ musicUserToken: "restored" }) });
      expect(await helper.ready).toBe("restored");
    } finally {
      Reflect.deleteProperty(Object.prototype, "configured");
    }
  });
});

describe("createConnect: a mistake is a TypeError when the helper is made", () => {
  test("where there is no document: on a server", () => {
    vi.stubGlobal("document", undefined);
    expect(() => createConnect({ developerToken: provider() }, { app: APP })).toThrow(new TypeError("createConnect: needs a page, and there is no document here; make it where the connect button is shown, not on a server"));
  });

  test.each<[string, unknown, unknown, string | RegExp]>([
    ["no client", undefined, { app: APP }, "createConnect: music must be a client from createBrowserClient, or anything with a developerToken provider; got undefined"],
    ["a client with no developerToken on it", { request: () => undefined }, { app: APP }, "createConnect: music must be a client from createBrowserClient, or anything with a developerToken provider; got object"],
    ["a token where the client belongs", "dev", { app: APP }, "createConnect: music must be a client from createBrowserClient, or anything with a developerToken provider; got 3 characters"],
    ["no options", { developerToken: provider() }, undefined, "createConnect: app must be an object with the app's name, such as { name: \"Vinyl Collector Simulator\" }; got undefined"],
    ["a list where the options belong", { developerToken: provider() }, [], "createConnect: expected an options object with app; got a list"],
    ["an app that is a name", { developerToken: provider() }, { app: "Vinyl Collector Simulator" }, "createConnect: app must be an object with the app's name, such as { name: \"Vinyl Collector Simulator\" }; got 25 characters"],
    ["an app with no name", { developerToken: provider() }, { app: {} }, "createConnect: app.name must be a string with something in it; got undefined"],
    ["an app with an empty name", { developerToken: provider() }, { app: { name: "" } }, "createConnect: app.name must be a string with something in it; got 0 characters"],
    ["a build that is a number", { developerToken: provider() }, { app: { name: "x", build: 3 } }, "createConnect: app.build must be a string where it is given; got 3"],
    ["a musicKit without configure", { developerToken: provider() }, { app: APP, musicKit: {} }, "createConnect: musicKit must be Apple's MusicKit, with configure; got object"],
  ])("%s", (_name, music, options, message) => {
    vi.stubGlobal("document", page());
    expect(() => createConnect(music as { developerToken: () => string }, options as tConnectOptions)).toThrow(typeof message === "string" ? new TypeError(message) : message);
  });

  test("and before any of that nothing is loaded: a page with a mistake on it has no script in it", () => {
    const doc = page();
    vi.stubGlobal("document", doc);
    expect(() => createConnect({ developerToken: provider() }, { app: {} } as tConnectOptions)).toThrow(TypeError);
    expect(doc.scripts).toHaveLength(0);
  });

  test("an app on Object.prototype is nobody's", () => {
    vi.stubGlobal("document", page());
    Object.assign(Object.prototype, { app: APP });
    try {
      expect(() => createConnect({ developerToken: provider() }, {} as tConnectOptions)).toThrow(/^createConnect: app must be an object/);
    } finally {
      Reflect.deleteProperty(Object.prototype, "app");
    }
  });
});

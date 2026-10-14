import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isAppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import { tokenEndpoint } from "@open-music-sdk/server";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createBrowserClient, type tBrowserClientOptions, type tBrowserMusic } from "./client";

const ENDPOINT = "https://app.example/api/music/token";

/** An unsigned JWT with an `exp` this many seconds ahead: what the fetcher reads of a token, which is all this suite needs of one. */
const jwt = (lifeSeconds = 900, mark = "a") => {
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64url({ alg: "ES256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + lifeSeconds, mark })}.c2ln`;
};

/** Every Response any fake handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** Two servers: the token endpoint, answering with one token, and Apple, answering every request with one song. Each records what it was asked. */
function world(token = jwt()) {
  const endpointCalls: Request[] = [];
  const appleCalls: Request[] = [];
  const answer = (body: unknown) => {
    const res = new Response(JSON.stringify(body));
    responses.push(res);
    return Promise.resolve(res);
  };
  const endpointFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    endpointCalls.push(new Request(input, init));
    return answer({ token });
  };
  const appleFetch = (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input);
    appleCalls.push(req);
    const path = new URL(req.url).pathname;
    return answer(
      path.endsWith("/me/storefront") ? { data: [{ id: "gb", type: "storefronts", href: "/v1/storefronts/gb" }] }
      : path.includes("/library/playlists") ? { data: [{ id: "p.1", type: "library-playlists", href: "/v1/me/library/playlists/p.1", attributes: { name: "Road trip", canEdit: true } }] }
      : { data: [{ id: "1", type: "songs", href: "/v1/catalog/us/songs/1", attributes: { name: "Hey Jude" } }] },
    );
  };
  const options: tBrowserClientOptions = { tokenUrl: ENDPOINT, endpoint: { fetch: endpointFetch }, fetch: appleFetch, retry: false, storefront: "us" };
  return {
    token,
    options,
    endpointCalls,
    appleCalls,
    /** Each request of Apple as its method and path, and whether it carried the Music User Token. */
    sent: () => appleCalls.map((c) => `${c.method} ${new URL(c.url).pathname} ${c.headers.get("music-user-token") ?? "-"}`),
    bearer: (at = 0) => (appleCalls[at]?.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
  };
}

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("createBrowserClient", () => {
  test("from the endpoint to a request: the token fetched from tokenUrl is the bearer sent to Apple", async () => {
    const { options, token, endpointCalls, bearer } = world();
    const music = createBrowserClient(options);
    await music.catalog.getSong("1");
    expect(endpointCalls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${ENDPOINT}`]);
    expect(bearer()).toBe(token);
  });

  test("one fetch of the token serves every request", async () => {
    const { options, endpointCalls, bearer } = world();
    const music = createBrowserClient(options);
    await Promise.all([music.catalog.getSong("1"), music.catalog.getSong("2")]);
    await music.request("v1/test");
    expect(endpointCalls).toHaveLength(1);
    expect([bearer(1), bearer(2)]).toEqual([bearer(0), bearer(0)]);
  });

  test("the endpoint's fetch and the client's are two: a header wrapped in for the endpoint never reaches Apple", async () => {
    const { options, endpointCalls, appleCalls } = world();
    const withSession = (input: RequestInfo | URL, init?: RequestInit) => options.endpoint?.fetch?.(input, { ...init, headers: { "x-session": "s3cret" } }) ?? Promise.reject(new Error("no fetch"));
    const music = createBrowserClient({ ...options, endpoint: { fetch: withSession } });
    await music.catalog.getSong("1");
    expect(endpointCalls[0]?.headers.get("x-session")).toBe("s3cret");
    expect(appleCalls[0]?.headers.get("x-session")).toBeNull();
  });

  test("the endpoint's timeoutMs and refreshAheadSeconds are the fetcher's, named by it when wrong", () => {
    const { options } = world();
    expect(() => createBrowserClient({ ...options, endpoint: { timeoutMs: 0 } })).toThrow(/^developerTokenFetcher: timeoutMs must be an integer from 1/);
    expect(() => createBrowserClient({ ...options, endpoint: { refreshAheadSeconds: -1 } })).toThrow(/^developer token: refreshAheadSeconds must be a number from 0/);
  });

  test("developerToken is on it: the provider the token endpoint is fetched through, which createConnect takes, the same on as() and forUser()", async () => {
    const { options, token } = world();
    const music = createBrowserClient(options);
    expect(await music.developerToken({})).toBe(token);
    expect(music.as("listener").developerToken).toBe(music.developerToken);
    expect(music.as("listener").as("another").developerToken).toBe(music.developerToken);
    expectTypeOf(music.as("listener")).toEqualTypeOf<tBrowserMusic>();
  });

  test("the catalog, the library and the playlist verbs are on it, and as() keeps them for a listener", async () => {
    const { options, sent } = world();
    const music = createBrowserClient(options);
    expect(await music.catalog.getSong("1")).toMatchObject({ id: "1" });
    const listener = music.as("listener");
    expect(await listener.user.getLibraryPlaylist("p.1")).toMatchObject({ id: "p.1" });
    expect(await listener.playlists.read("p.1")).toMatchObject({ id: "p.1", name: "Road trip" });
    expect(sent().slice(0, 2)).toEqual(["GET /v1/catalog/us/songs/1 -", "GET /v1/me/library/playlists/p.1 listener"]);
  });

  test("forUser() reads the store it was given, as any client's does", async () => {
    const { options, sent } = world();
    const store = { get: () => Promise.resolve("stored"), set: () => Promise.resolve(), delete: () => Promise.resolve() };
    const music = createBrowserClient({ ...options, userTokenStore: store });
    await music.forUser("u1").user.getLibraryPlaylist("p.1");
    expect(sent()).toEqual(["GET /v1/me/library/playlists/p.1 stored"]);
  });

  test("what it gives is frozen, inherits nothing, and its functions need no this", async () => {
    const { options } = world();
    const music = createBrowserClient(options);
    expect(Object.isFrozen(music)).toBe(true);
    expect(Object.getPrototypeOf(music)).toBeNull();
    expect(Object.keys(music).sort()).toEqual(["as", "catalog", "developerToken", "forUser", "paginate", "playlists", "request", "storefront", "user"]);
    const { storefront, developerToken, catalog } = music;
    expect(await storefront()).toBe("us");
    expect(typeof (await developerToken({}))).toBe("string");
    expect(await catalog.getSong("1")).toMatchObject({ id: "1" });
  });

  test("nothing is fetched until a call: not the token, and not Apple", () => {
    const { options, endpointCalls, appleCalls } = world();
    createBrowserClient(options);
    expect([endpointCalls, appleCalls]).toEqual([[], []]);
  });

  test("what the endpoint answers with that is no token is DeveloperTokenUnavailable, never mistaken for Apple's answer", async () => {
    const { options } = world();
    const endpoint = { fetch: () => Promise.resolve(new Response("<!doctype html>", { status: 200 })) };
    const error: unknown = await createBrowserClient({ ...options, endpoint }).catalog.getSong("1").catch((e: unknown) => e);
    expect(isAppleMusicError(error, "DeveloperTokenUnavailable")).toBe(true);
  });

  test("a relative tokenUrl is taken when the client is made, as a page resolves it; outside a page it fails at the first fetch", async () => {
    const { options, appleCalls } = world();
    const music = createBrowserClient({ ...options, tokenUrl: "/api/music/token", endpoint: undefined });
    await expect(music.catalog.getSong("1")).rejects.toThrow(/^developerTokenFetcher: a relative URL needs a document/);
    expect(appleCalls).toEqual([]);
  });

  test("tokenUrl is settled when the client is made, against the page as it is then: a base put in later, a route moved to later, or a URL changed later moves nothing", async () => {
    vi.stubGlobal("document", { baseURI: "https://app.example/artists/" });
    try {
      const { options, endpointCalls } = world();
      const url = new URL("https://app.example/api/music/token");
      const relative = createBrowserClient({ ...options, tokenUrl: "api/music/token" });
      const absolute = createBrowserClient({ ...options, tokenUrl: url });
      (globalThis as { document: { baseURI: string } }).document.baseURI = "https://evil.example/";
      url.pathname = "/evil";
      await relative.catalog.getSong("1");
      await absolute.catalog.getSong("1");
      expect(endpointCalls.map((c) => c.url)).toEqual(["https://app.example/artists/api/music/token", "https://app.example/api/music/token"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("a URL object with no page to resolve against is taken as it is when the client is made, and a change to it afterwards moves nothing", async () => {
    const { options, endpointCalls } = world();
    const url = new URL("https://app.example/api/music/token");
    const music = createBrowserClient({ ...options, tokenUrl: url });
    url.pathname = "/evil";
    await music.catalog.getSong("1");
    expect(endpointCalls.map((c) => c.url)).toEqual(["https://app.example/api/music/token"]);
  });

  test("a tokenUrl the page cannot read as a URL is left for the fetcher to refuse, and nothing is fetched", async () => {
    vi.stubGlobal("document", { baseURI: "https://app.example/" });
    try {
      const { options, endpointCalls, appleCalls } = world();
      const music = createBrowserClient({ ...options, tokenUrl: "http://" });
      await expect(music.catalog.getSong("1")).rejects.toThrow(/^developerTokenFetcher: /);
      expect([endpointCalls, appleCalls]).toEqual([[], []]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("the options are read once: a change to the object afterwards reaches nothing", async () => {
    const { options, sent } = world();
    const mine = { ...options };
    const music = createBrowserClient(mine);
    (mine as { storefront: string }).storefront = "jp";
    await music.catalog.getSong("1");
    expect(sent()).toEqual(["GET /v1/catalog/us/songs/1 -"]);
  });

  describe("a mistake is a TypeError before anything is made, named by what checks it", () => {
    test.each<[string, unknown, string | RegExp]>([
      ["no options at all", undefined, "createBrowserClient: expected an options object with tokenUrl; got undefined"],
      ["a list where the options belong", [], "createBrowserClient: expected an options object with tokenUrl; got a list"],
      ["a URL where the options belong", ENDPOINT, `createBrowserClient: expected an options object with tokenUrl; got ${String(ENDPOINT.length)} characters`],
      ["no tokenUrl", {}, "createBrowserClient: tokenUrl must be where your token endpoint is, as a string or a URL; got undefined"],
      ["a tokenUrl that is a number", { tokenUrl: 42 }, "createBrowserClient: tokenUrl must be where your token endpoint is, as a string or a URL; got 42"],
      ["a tokenUrl with a password in it", { tokenUrl: "https://user:pw@app.example/token" }, /^developerTokenFetcher: the URL must not carry a username or password/],
      ["a tokenUrl that is no http", { tokenUrl: "ftp://app.example/token" }, /^developerTokenFetcher: the URL must be http or https/],
      ["endpoint options that are a list", { tokenUrl: ENDPOINT, endpoint: [] }, /^createBrowserClient: endpoint must be an options object for the token endpoint, with fetch, timeoutMs or refreshAheadSeconds; got /],
      ["a fetch that is no function", { tokenUrl: ENDPOINT, fetch: 42 }, "createClient: fetch must be a function; got 42"],
      ["a user token that is no token", { tokenUrl: ENDPOINT, userToken: "" }, "createClient: userToken must be a token or a function that gives one; got 0 characters"],
    ])("%s", (_name, options, message) => {
      expect(() => createBrowserClient(options as tBrowserClientOptions)).toThrow(typeof message === "string" ? new TypeError(message) : message);
    });
  });
});

describe("on the wire: the token endpoint of @open-music-sdk/server behind node:http, and this client in front of it", () => {
  /** The server's endpoint mounted on a plain Node server. */
  async function mounted(handler: (req: Request) => Promise<Response>) {
    const server = createServer((req, res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
      void handler(new Request(`http://127.0.0.1${req.url ?? "/"}`, { method: req.method ?? "GET", headers })).then(async (answer) => {
        res.statusCode = answer.status;
        answer.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(await answer.text());
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${String(port)}/api/music/token`, close: () => new Promise((resolve) => server.close(resolve)) };
  }

  test("the page's client fetches a token the server signed for the page's origin, and sends it to Apple", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const { url, close } = await mounted(tokenEndpoint({ pem: await exportPKCS8(pair.privateKey), teamId: "DEF123GHIJ", keyId: "ABC123DEFG", origin: ["https://app.example"] }));
    try {
      const { options, bearer } = world();
      const music = createBrowserClient({ ...options, tokenUrl: url, endpoint: undefined });
      await music.catalog.getSong("1");
      const { payload } = await jwtVerify(bearer(), pair.publicKey);
      expect([payload.iss, payload.origin]).toEqual(["DEF123GHIJ", ["https://app.example"]]);
    } finally {
      await close();
    }
  });

  test("a client from here is a client to the feature packages", () => {
    const { options } = world();
    const music = createBrowserClient(options);
    const client: tAppleMusicClient = music;
    expect(typeof client.paginate).toBe("function");
    expectTypeOf(music.user.getLibraryPlaylist).parameter(0).toEqualTypeOf<string>();
    vi.restoreAllMocks();
  });
});

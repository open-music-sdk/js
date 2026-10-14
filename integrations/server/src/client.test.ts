import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { isAppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createServerClient, type tMusic, type tServerClientOptions } from "./client";

const IDS = { teamId: "DEF123GHIJ", keyId: "ABC123DEFG" } as const;

/** A key of this suite's own, with its public half to verify what was signed with it. */
async function key(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  return { pem: await exportPKCS8(pair.privateKey), publicKey: pair.publicKey };
}

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** Apple, so far as this suite asks it: a storefront, one playlist, and one song for anything else. Records every request. */
function apple() {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push(req);
    const path = new URL(req.url).pathname;
    const body =
      path.endsWith("/me/storefront") ? { data: [{ id: "gb", type: "storefronts", href: "/v1/storefronts/gb" }] }
      : path.includes("/library/playlists") ? { data: [{ id: "p.1", type: "library-playlists", href: "/v1/me/library/playlists/p.1", attributes: { name: "Road trip", canEdit: true } }] }
      : { data: [{ id: "1", type: "songs", href: "/v1/catalog/us/songs/1", attributes: { name: "Hey Jude" } }] };
    const res = new Response(JSON.stringify(body));
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    fetch,
    calls,
    /** Each request as its method and path, and whether it carried the Music User Token. */
    sent: () => calls.map((c) => `${c.method} ${new URL(c.url).pathname} ${c.headers.get("music-user-token") ?? "-"}`),
    /** The developer token the request at `at` carried. */
    bearer: (at = 0) => (calls[at]?.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
  };
}

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("createServerClient", () => {
  test("from the key to a request: the token it sends is signed by that key, with the ids given, one hour of life and no origin", async () => {
    const { pem, publicKey } = await key();
    const { fetch, bearer } = apple();
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us" });
    await music.request("v1/test");
    const { payload, protectedHeader } = await jwtVerify(bearer(), publicKey);
    expect([payload.iss, protectedHeader.kid, (payload.exp ?? 0) - (payload.iat ?? 0), payload.origin]).toEqual([IDS.teamId, IDS.keyId, 3600, undefined]);
  });

  test("ttlSeconds and refreshAheadSeconds are the minter's", async () => {
    const { pem, publicKey } = await key();
    const { fetch, bearer } = apple();
    await createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us", ttlSeconds: 60, refreshAheadSeconds: 10 }).request("v1/test");
    const { payload } = await jwtVerify(bearer(), publicKey);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
  });

  test("one token serves every request: it is minted once and reused", async () => {
    const { pem } = await key();
    const { fetch, bearer } = apple();
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us" });
    await Promise.all([music.catalog.getSong("1"), music.catalog.getSong("2")]);
    await music.request("v1/test");
    expect(bearer(0)).not.toBe("");
    expect([bearer(1), bearer(2)]).toEqual([bearer(0), bearer(0)]);
  });

  test("the catalog, the library and the playlist verbs are on it, made for it", async () => {
    const { pem } = await key();
    const { fetch, sent } = apple();
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us", userToken: "listener" });
    expect(await music.catalog.getSong("1")).toMatchObject({ id: "1" });
    expect(await music.user.getLibraryPlaylist("p.1")).toMatchObject({ id: "p.1" });
    expect(Object.keys(music.playlists).sort()).toEqual(["apply", "plan", "read", "resolve"]);
    expect(await music.playlists.read("p.1")).toMatchObject({ id: "p.1", name: "Road trip" });
    expect(sent().slice(0, 2)).toEqual(["GET /v1/catalog/us/songs/1 -", "GET /v1/me/library/playlists/p.1 listener"]);
  });

  test("as() and forUser() give the same client for a listener, namespaces and all", async () => {
    const { pem } = await key();
    const { fetch, sent } = apple();
    const store = { get: () => Promise.resolve("stored"), set: () => Promise.resolve(), delete: () => Promise.resolve() };
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us", userTokenStore: store });
    await music.as("listener").user.getLibraryPlaylist("p.1");
    await music.forUser("u1").user.getLibraryPlaylist("p.1");
    await music.forUser("u1").catalog.getSong("1");
    expect(sent()).toEqual(["GET /v1/me/library/playlists/p.1 listener", "GET /v1/me/library/playlists/p.1 stored", "GET /v1/catalog/us/songs/1 -"]);
    expectTypeOf(music.as("listener")).toEqualTypeOf<tMusic>();
    expectTypeOf(music.forUser("u1").playlists.apply).toBeFunction();
  });

  test("the rest of the options are the client's: a storefront, the hooks, a limiter, no retry", async () => {
    const { pem } = await key();
    const { fetch, sent } = apple();
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "gb", onRequest, onResponse });
    await music.catalog.getSong("1");
    expect(sent()).toEqual(["GET /v1/catalog/gb/songs/1 -"]);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  test("without a storefront, the listener's is looked up once and kept for that client", async () => {
    const { pem } = await key();
    const { fetch, sent } = apple();
    const listener = createServerClient({ pem, ...IDS, fetch, retry: false }).as("listener");
    await listener.catalog.getSong("1");
    await listener.catalog.getSong("2");
    expect(sent()).toEqual(["GET /v1/me/storefront listener", "GET /v1/catalog/gb/songs/1 -", "GET /v1/catalog/gb/songs/2 -"]);
  });

  test("what it gives is frozen, inherits nothing, and its functions need no this", async () => {
    const { pem } = await key();
    const { fetch } = apple();
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us" });
    expect(Object.isFrozen(music)).toBe(true);
    expect(Object.getPrototypeOf(music)).toBeNull();
    expect(Object.keys(music).sort()).toEqual(["as", "catalog", "forUser", "paginate", "playlists", "request", "storefront", "user"]);
    const { storefront, catalog } = music;
    expect(await storefront()).toBe("us");
    expect(await catalog.getSong("1")).toMatchObject({ id: "1" });
  });

  test("nothing is asked of Apple, and no key is imported, until a call: a key that is no key fails at the first request", async () => {
    const { fetch, calls } = apple();
    const music = createServerClient({ pem: "not a key", ...IDS, fetch, retry: false, storefront: "us" });
    expect(calls).toEqual([]);
    await expect(music.catalog.getSong("1")).rejects.toThrow(/^developer token: pem is not a PKCS8 P-256 private key/);
    expect(calls).toEqual([]);
  });

  test("what Apple answers with is an AppleMusicError, as from any client", async () => {
    const { pem } = await key();
    const fetch = () => {
      const res = new Response(JSON.stringify({ errors: [] }), { status: 403 });
      responses.push(res);
      return Promise.resolve(res);
    };
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us", userToken: "listener" });
    const error: unknown = await music.user.getLibraryPlaylist("p.1").catch((e: unknown) => e);
    expect(isAppleMusicError(error, "UserTokenInvalid")).toBe(true);
  });

  test("the options are read once: a change to the object afterwards reaches nothing", async () => {
    const { pem } = await key();
    const { fetch, sent } = apple();
    const options: tServerClientOptions = { pem, ...IDS, fetch, retry: false, storefront: "us" };
    const music = createServerClient(options);
    (options as { storefront: string }).storefront = "jp";
    await music.catalog.getSong("1");
    expect(sent()).toEqual(["GET /v1/catalog/us/songs/1 -"]);
  });

  test("origin is not an option of the client: the token it mints is its own, and never meets a browser", () => {
    expectTypeOf<tServerClientOptions>().not.toHaveProperty("origin");
    expectTypeOf<tServerClientOptions>().toHaveProperty("userTokenStore");
  });

  describe("a mistake is a TypeError before anything is made, named by what checks it", () => {
    test.each<[string, unknown, string | RegExp]>([
      ["no options at all", undefined, "createServerClient: expected an options object with pem, teamId and keyId; got undefined"],
      ["a list where the options belong", [], "createServerClient: expected an options object with pem, teamId and keyId; got a list"],
      ["a key where the options belong", "-----BEGIN PRIVATE KEY-----", "createServerClient: expected an options object with pem, teamId and keyId; got 27 characters"],
      ["no pem", { ...IDS }, /^developer token: pem must be the contents of the \.p8 file, as a string; got undefined$/],
      ["a team id that is no id", { pem: "x", teamId: "team", keyId: IDS.keyId }, /^developer token: teamId must be ten capital letters and digits/],
      ["a lifetime below a minute", { pem: "x", ...IDS, ttlSeconds: 10 }, /^developer token: ttlSeconds must be an integer from 60/],
      ["a fetch that is no function", { pem: "x", ...IDS, fetch: 42 }, "createClient: fetch must be a function; got 42"],
      ["a store without delete", { pem: "x", ...IDS, userTokenStore: { get: () => undefined, set: () => undefined } }, "createClient: userTokenStore must be a store with get, set and delete; got object"],
      ["an origin, which is the endpoint's and would otherwise be dropped", { pem: "x", ...IDS, origin: ["https://app.example"] }, "createServerClient: origin is not an option of the server's client, whose token never meets a browser; a token for a page is tokenEndpoint's, which takes origin"],
    ])("%s", (_name, options, message) => {
      expect(() => createServerClient(options as tServerClientOptions)).toThrow(typeof message === "string" ? new TypeError(message) : message);
    });

    test("and no error repeats the key: it is described by its length", () => {
      const pem = "-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----";
      const error: unknown = (() => {
        try {
          createServerClient({ pem, teamId: "bad", keyId: IDS.keyId });
        } catch (e) {
          return e;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).not.toContain("BEGIN");
    });
  });
});

describe("what a server is sent, from a verb to the wire", () => {
  /** A server that answers every request with one song and records what it was asked, standing in for Apple. */
  async function wire() {
    const asked: { method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders }[] = [];
    const server = createServer((req, res) => {
      asked.push({ method: req.method, url: req.url, headers: req.headers });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "1", type: "songs", href: "/v1/catalog/us/songs/1" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname, search } = new URL(request.url);
      return globalThis.fetch(`http://127.0.0.1:${String(port)}${pathname}${search}`, { method: request.method, headers: request.headers });
    };
    return { asked, fetch, close: () => new Promise((resolve) => server.close(resolve)) };
  }

  test("the developer token arrives as a bearer the key verifies, and the listener's token beside it under /v1/me", async () => {
    const { pem, publicKey } = await key();
    const { asked, fetch, close } = await wire();
    try {
      const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us" });
      await music.catalog.getSong("1");
      await music.as("listener").user.getLibrarySong("l.1");
      expect(asked.map((each) => `${each.method ?? ""} ${each.url ?? ""}`)).toEqual(["GET /v1/catalog/us/songs/1", "GET /v1/me/library/songs/l.1"]);
      const bearer = (asked[0]?.headers.authorization ?? "").replace(/^Bearer /, "");
      expect((await jwtVerify(bearer, publicKey)).payload.iss).toBe(IDS.teamId);
      expect(asked.map((each) => each.headers["music-user-token"])).toEqual([undefined, "listener"]);
    } finally {
      await close();
    }
  });

  test("a client from here is a client to the feature packages: the namespaces are theirs, bound to it", async () => {
    const { pem } = await key();
    const { fetch } = apple();
    const music = createServerClient({ pem, ...IDS, fetch, retry: false, storefront: "us" });
    const client: tAppleMusicClient = music;
    expect(typeof client.request).toBe("function");
    expectTypeOf(music.catalog.getSong).parameter(0).toEqualTypeOf<string>();
  });
});

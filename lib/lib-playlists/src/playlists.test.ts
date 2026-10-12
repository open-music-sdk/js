import { createClient, type tAppleMusicClient } from "@open-music-sdk/core";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import type { apply } from "./apply";
import { plan } from "./plan";
import { playlists, type tPlaylists } from "./playlists";
import type { read } from "./read";
import type { resolve } from "./resolve";

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A fetch that answers every request with one song, or one track, or one playlist, by where it was sent, and records what it saw. */
function apple() {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    const { pathname } = new URL(request.url);
    const body = pathname.includes("/catalog/")
      ? { data: [{ id: "900", type: "songs", attributes: { isrc: "GBAYE0601498", name: "Hey Jude" } }] }
      : pathname.endsWith("/tracks")
        ? { data: [{ id: "i.1", type: "library-songs", attributes: { playParams: { catalogId: "900" } } }] }
        : { data: [{ id: "p.1", type: "library-playlists", attributes: { name: "Road trip", canEdit: true } }] };
    const res = new Response(request.method === "POST" ? null : JSON.stringify(body), { status: request.method === "POST" ? 204 : 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return { fetch, calls, music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false }), lines: () => calls.map((c) => `${c.method} ${new URL(c.url).pathname}`) };
}

afterEach(() => {
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("playlists(client): the four verbs for one client", () => {
  test("it gives the four verbs and nothing else, frozen and inheriting nothing", () => {
    const lists = playlists(apple().music);
    expect(Object.keys(lists).sort()).toEqual(["apply", "plan", "read", "resolve"]);
    expect(Object.isFrozen(lists)).toBe(true);
    expect(Object.getPrototypeOf(lists)).toBeNull();
    expect("toString" in lists).toBe(false);
  });

  test("making it asks nothing of the client: not Apple, and not the client either", () => {
    const client = { request: vi.fn(), paginate: vi.fn(), storefront: vi.fn() };
    playlists(client as unknown as tAppleMusicClient);
    expect([client.request, client.paginate, client.storefront].every((each) => each.mock.calls.length === 0)).toBe(true);
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["a token, where the client goes", "a-token-put-where-the-client-goes"],
    ["an object with no methods", {}],
    ["a client that cannot walk pages", { request: () => undefined, storefront: () => undefined }],
    ["the options of a client", { developerToken: "dev" }],
  ])("a client that is %s is refused when the noun is called, and no error repeats it", (_name, client) => {
    expect(() => playlists(client as tAppleMusicClient)).toThrow(/^playlists: client must be a client from createClient; got (undefined|33 characters|object)$/);
  });

  test("a client is known by its methods: one that wraps another is a client", async () => {
    const { music, lines } = apple();
    // Another object with the client's functions on it, as code that wraps a client hands on.
    const wrapped: tAppleMusicClient = { ...music };
    expect((await playlists(wrapped).read("p.1")).id).toBe("p.1");
    expect(lines()).toHaveLength(2);
  });

  test("resolve asks the catalog, through the client the noun was given", async () => {
    const { music, lines } = apple();
    expect((await playlists(music).resolve([{ isrc: "GBAYE0601498" }])).tracks.map((song) => song.id)).toEqual(["900"]);
    expect(lines()).toEqual(["GET /v1/catalog/us/songs"]);
  });

  test("read asks the listener's library", async () => {
    const { music, lines } = apple();
    expect(await playlists(music).read("p.1")).toEqual({ id: "p.1", name: "Road trip", canEdit: true, tracks: [{ id: "i.1", type: "library-songs", catalogId: "900" }] });
    expect(lines()).toEqual(["GET /v1/me/library/playlists/p.1", "GET /v1/me/library/playlists/p.1/tracks"]);
  });

  test("plan is the package's own function, and asks nothing", () => {
    const { music, calls } = apple();
    expect(playlists(music).plan).toBe(plan);
    expect(playlists(music).plan({ name: "Road trip" }, [{ id: "900", type: "songs" }]).append).toEqual([{ id: "900", type: "songs" }]);
    expect(calls).toEqual([]);
  });

  test("apply writes to the listener's library", async () => {
    const { music, lines } = apple();
    const lists = playlists(music);
    await lists.apply(lists.plan({ id: "p.1", tracks: [] }, [{ id: "901", type: "songs" }]), { settle: { tries: 1 } });
    expect(lines().filter((line) => line.startsWith("POST"))).toEqual(["POST /v1/me/library/playlists/p.1/tracks"]);
  });

  test("its functions need no `this`: each can be handed on by itself", async () => {
    const { music } = apple();
    const { read: reading, resolve: resolving } = playlists(music);
    expect((await reading("p.1")).id).toBe("p.1");
    expect((await resolving([{ isrc: "GBAYE0601498" }])).tracks).toHaveLength(1);
  });

  test("two of them over two clients are two: each asks through its own", async () => {
    const [one, other] = [apple(), apple()];
    await playlists(one.music).read("p.1");
    expect(other.calls).toEqual([]);
  });

  test("a mistake in what a verb is handed is named for the noun and the verb, and rejects where the verb waits on Apple", async () => {
    const { music, calls } = apple();
    const lists = playlists(music);
    await expect(lists.read("")).rejects.toThrow(/^playlists\.read: id must be /);
    await expect(lists.resolve("songs" as unknown as [])).rejects.toThrow(/^playlists\.resolve: descriptions must be /);
    await expect(lists.apply(undefined as never)).rejects.toThrow(/^playlists\.apply: plan must be /);
    expect(() => lists.plan(undefined as never, [])).toThrow(/^playlists\.plan: playlist must be /);
    expect(calls).toEqual([]);
  });
});

describe("the types: a verb of the noun takes what the package's function takes, without the client", () => {
  type tWithoutClient<F> = F extends (client: tAppleMusicClient, ...args: infer A) => unknown ? A : never;

  test("read and apply", () => {
    expectTypeOf<Parameters<tPlaylists["read"]>>().toEqualTypeOf<tWithoutClient<typeof read>>();
    expectTypeOf<Parameters<tPlaylists["apply"]>>().toEqualTypeOf<tWithoutClient<typeof apply>>();
    expectTypeOf<ReturnType<tPlaylists["read"]>>().toEqualTypeOf<ReturnType<typeof read>>();
    expectTypeOf<ReturnType<tPlaylists["apply"]>>().toEqualTypeOf<ReturnType<typeof apply>>();
  });

  test("resolve hands back a description as the kind of thing it was handed", async () => {
    const lists = playlists(apple().music);
    const { skipped } = await lists.resolve([{ name: "Unknown", row: 3 }]);
    expectTypeOf(skipped).items.toHaveProperty("track").toEqualTypeOf<{ name: string; row: number }>();
    expectTypeOf<Parameters<tPlaylists["resolve"]>[1]>().toEqualTypeOf<tWithoutClient<typeof resolve>[1]>();
  });

  test("plan is the function itself", () => {
    expectTypeOf<tPlaylists["plan"]>().toEqualTypeOf<typeof plan>();
  });

  test("the noun takes a client and nothing else", () => {
    expectTypeOf(playlists).parameters.toEqualTypeOf<[client: tAppleMusicClient]>();
  });
});

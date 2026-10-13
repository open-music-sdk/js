import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createClient, type tAppleMusicClient } from "./client";
import { endpointNamespace, resourceGetter } from "./endpoint";
import { withNamespaces } from "./namespaces";
import type { tSongsResponse } from "@open-music-sdk/types";

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A client over a fetch that answers every request with one song, and records what it saw. */
function apple() {
  const calls: Request[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    calls.push(input instanceof Request ? input : new Request(input));
    const res = new Response(JSON.stringify({ data: [{ id: "1", type: "songs", href: "/v1/catalog/us/songs/1" }] }));
    responses.push(res);
    return Promise.resolve(res);
  };
  const music = createClient({ developerToken: "dev", storefront: "us", fetch, retry: false, userTokenStore: { get: () => Promise.resolve("stored"), set: () => Promise.resolve(), delete: () => Promise.resolve() } });
  return { music, calls, userTokens: () => calls.map((call) => call.headers.get("music-user-token")) };
}

const getSong = resourceGetter<tSongsResponse>("getSong", () => "v1/catalog/us/songs");
const getLibrarySong = resourceGetter<tSongsResponse>("getLibrarySong", () => "v1/me/library/songs");
const catalog = (client: tAppleMusicClient) => endpointNamespace("catalog", client, { getSong });
const user = (client: tAppleMusicClient) => endpointNamespace("user", client, { getLibrarySong });

afterEach(() => {
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("withNamespaces", () => {
  test("gives the client with each namespace on it, made for that client", async () => {
    const { music, calls } = apple();
    const made = withNamespaces(music, { catalog, user });
    expect(await made.catalog.getSong("1")).toMatchObject({ id: "1" });
    expect(await made.request("v1/test")).toMatchObject({ data: [{ id: "1" }] });
    expect(await made.storefront()).toBe("us");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/catalog/us/songs/1", "/v1/test"]);
    expectTypeOf(made.catalog.getSong).parameter(0).toEqualTypeOf<string>();
  });

  test("is frozen, inherits nothing, and its functions need no this", async () => {
    const made = withNamespaces(apple().music, { catalog });
    expect(Object.isFrozen(made)).toBe(true);
    expect(Object.getPrototypeOf(made)).toBeNull();
    expect(Object.keys(made).sort()).toEqual(["as", "catalog", "forUser", "paginate", "request", "storefront"]);
    const { storefront, catalog: songs } = made;
    expect(await storefront()).toBe("us");
    expect(await songs.getSong("1")).toMatchObject({ id: "1" });
  });

  test("as() gives a listener's client with the same namespaces, which send the listener's token", async () => {
    const { music, userTokens } = apple();
    const listener = withNamespaces(music, { catalog, user }).as("listener");
    expect(Object.isFrozen(listener)).toBe(true);
    await listener.user.getLibrarySong("1");
    await listener.catalog.getSong("1");
    expect(userTokens()).toEqual(["listener", null]);
    expectTypeOf(listener.user.getLibrarySong).toBeFunction();
  });

  test("forUser() does the same with the token from the store, and as() on the result derives once more", async () => {
    const { music, userTokens } = apple();
    const made = withNamespaces(music, { user });
    await made.forUser("u1").user.getLibrarySong("1");
    await made.forUser("u1").as("another").user.getLibrarySong("1");
    expect(userTokens()).toEqual(["stored", "another"]);
  });

  test("each factory is called once per client made: for the client, and again for each one derived", () => {
    const factory = vi.fn(catalog);
    const { music } = apple();
    const made = withNamespaces(music, { catalog: factory });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(music);
    made.as("listener");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  test("the namespaces are read once: a factory added to the object afterwards is not on the client", () => {
    const namespaces: Record<string, (client: tAppleMusicClient) => object> = { catalog };
    const made = withNamespaces(apple().music, namespaces);
    namespaces.user = user;
    expect(Object.keys(made.as("x"))).not.toContain("user");
  });

  test("a client whose functions need this works through it: they are bound", async () => {
    class Music {
      readonly #storefront = "gb";
      request(): Promise<unknown> {
        return Promise.resolve(this.#storefront);
      }
      paginate(): AsyncIterable<unknown> {
        const storefront = this.#storefront;
        return (async function* () {
          yield await Promise.resolve(storefront);
        })();
      }
      storefront(): Promise<string> {
        return Promise.resolve(this.#storefront);
      }
      as(): tAppleMusicClient {
        return this as unknown as tAppleMusicClient;
      }
      forUser(): tAppleMusicClient {
        return this as unknown as tAppleMusicClient;
      }
    }
    const made = withNamespaces(new Music() as unknown as tAppleMusicClient, {});
    const { storefront } = made;
    expect(await storefront()).toBe("gb");
  });

  test.each<[string, unknown, string]>([
    ["no client", undefined, "withNamespaces: client must be a client from createClient; got undefined"],
    ["a token where the client belongs", "dev", "withNamespaces: client must be a client from createClient; got 3 characters"],
    ["a client without as and forUser", { request: () => undefined, paginate: () => undefined, storefront: () => undefined }, "withNamespaces: client must be a client from createClient; got object"],
  ])("%s is a TypeError naming withNamespaces", (_name, client, message) => {
    expect(() => withNamespaces(client as tAppleMusicClient, { catalog })).toThrow(new TypeError(message));
  });

  test.each<[string, unknown, string]>([
    ["no namespaces", undefined, "withNamespaces: namespaces must be a plain object of functions, each taking a client, such as { catalog }; got undefined"],
    ["a list", [catalog], "withNamespaces: namespaces must be a plain object of functions, each taking a client, such as { catalog }; got a list"],
    ["a factory that is no function", { catalog: "catalog" }, "withNamespaces: namespaces.catalog must be a function taking a client; got 7 characters"],
    ["a namespace named for a function of the client", { request: catalog }, "withNamespaces: request is a function of the client, and cannot be the name of a namespace"],
  ])("%s is a TypeError naming withNamespaces and the namespace", (_name, namespaces, message) => {
    expect(() => withNamespaces(apple().music, namespaces as Record<string, never>)).toThrow(new TypeError(message));
  });

  test("a factory on Object.prototype is nobody's namespace", () => {
    Object.assign(Object.prototype, { planted: catalog });
    try {
      expect(Object.keys(withNamespaces(apple().music, {}))).not.toContain("planted");
    } finally {
      Reflect.deleteProperty(Object.prototype, "planted");
    }
  });

  test("what a factory throws is thrown from here, and nothing is given", () => {
    expect(() =>
      withNamespaces(apple().music, {
        broken: () => {
          throw new TypeError("broken: client must be a client from createClient; got object");
        },
      }),
    ).toThrow(new TypeError("broken: client must be a client from createClient; got object"));
  });
});

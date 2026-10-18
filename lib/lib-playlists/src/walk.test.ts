import { isAppleMusicError, type tAppleMusicClient } from "@open-music-sdk/core";
import { describe, expect, test, vi } from "vitest";
import { pagesOf, type tWalk } from "./walk";

const WALK: tWalk = { fn: "playlists.read", signal: undefined, maxPages: undefined };

/** A client that answers each link from a table of pages, and records what it was asked. */
function linked(pages: Record<string, unknown>) {
  const request = vi.fn<(path: string, init?: unknown) => Promise<unknown>>((path) => Promise.resolve(pages[path]));
  return { request, client: { request, paginate: vi.fn(), storefront: vi.fn() } as unknown as tAppleMusicClient };
}

const all = async (walk: AsyncIterable<readonly unknown[]>): Promise<unknown[][]> => {
  const out: unknown[][] = [];
  for await (const page of walk) out.push([...page]);
  return out;
};

describe("pagesOf", () => {
  test("the first page is the one it is given a way to ask for, and each one after is asked for by the link the last one named", async () => {
    const { client, request } = linked({ "/v1/me/x?offset=2": { data: ["c", "d"], next: "/v1/me/x?offset=4" }, "/v1/me/x?offset=4": { data: ["e"] } });
    const first = vi.fn(() => Promise.resolve({ data: ["a", "b"], next: "/v1/me/x?offset=2" }));
    expect(await all(pagesOf(client, first, WALK))).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/v1/me/x?offset=2", "/v1/me/x?offset=4"]);
  });

  test("a page that names no further one is the last: nothing more is asked for", async () => {
    const { client, request } = linked({});
    expect(await all(pagesOf(client, () => Promise.resolve({ data: ["a"] }), WALK))).toEqual([["a"]]);
    expect(request).not.toHaveBeenCalled();
  });

  test("the signal goes with every page that is asked for by its link", async () => {
    const { signal } = new AbortController();
    const { client, request } = linked({ "/next": { data: [] } });
    await all(pagesOf(client, () => Promise.resolve({ data: [], next: "/next" }), { ...WALK, signal }));
    expect(request).toHaveBeenCalledWith("/next", expect.objectContaining({ signal }));
  });

  test("what the first page was asked to include is asked for again with every page after it, and nothing where it named none", async () => {
    const { client, request } = linked({ "/2": { data: [], next: "/3" }, "/3": { data: [] } });
    await all(pagesOf(client, () => Promise.resolve({ data: [], next: "/2" }), { ...WALK, include: ["catalog"] }));
    expect(request.mock.calls.map(([, init]) => init)).toEqual([
      { signal: undefined, params: { include: ["catalog"] } },
      { signal: undefined, params: { include: ["catalog"] } },
    ]);
    request.mockClear();
    await all(pagesOf(client, () => Promise.resolve({ data: [], next: "/2" }), WALK));
    expect(request.mock.calls.map(([, init]) => init)).toEqual([
      { signal: undefined, params: { include: undefined } },
      { signal: undefined, params: { include: undefined } },
    ]);
  });

  test.each<[string, unknown]>([
    ["no data", {}],
    ["data that is no list", { data: "none" }],
    ["nothing at all", undefined],
    ["a list where a page should be", ["a"]],
  ])("a page with %s holds nothing, and is not an error", async (_name, page) => {
    expect(await all(pagesOf(linked({}).client, () => Promise.resolve(page), WALK))).toEqual([[]]);
  });

  test.each<[string, unknown]>([
    ["a number", 2],
    ["an empty string", ""],
    ["null", null],
    ["an object", { href: "/next" }],
  ])("a next link that is %s is no link: the walk ends there", async (_name, next) => {
    const { client, request } = linked({});
    expect(await all(pagesOf(client, () => Promise.resolve({ data: ["a"], next }), WALK))).toEqual([["a"]]);
    expect(request).not.toHaveBeenCalled();
  });

  test("a next link found on Object.prototype is not the page's", async () => {
    const polluted = Object.prototype as { next?: unknown };
    polluted.next = "/planted";
    try {
      const { client, request } = linked({});
      expect(await all(pagesOf(client, () => Promise.resolve({ data: ["a"] }), WALK))).toEqual([["a"]]);
      expect(request).not.toHaveBeenCalled();
    } finally {
      delete polluted.next;
    }
  });

  test("with no maxPages a walk goes on for as long as each page names another", async () => {
    const pages = Object.fromEntries(Array.from({ length: 50 }, (_, at) => [`/p${String(at)}`, { data: [at], next: at < 49 ? `/p${String(at + 1)}` : undefined }]));
    expect(await all(pagesOf(linked(pages).client, () => Promise.resolve({ data: ["first"], next: "/p0" }), WALK))).toHaveLength(51);
  });

  test("a walk that reaches maxPages with another page named does not end early: it fails, and says for which verb", async () => {
    const { client, request } = linked({ "/2": { data: ["b"], next: "/3" }, "/3": { data: ["c"] } });
    const seen: unknown[][] = [];
    const error: unknown = await (async () => {
      for await (const page of pagesOf(client, () => Promise.resolve({ data: ["a"], next: "/2" }), { ...WALK, fn: "playlists.apply", maxPages: 2 })) seen.push([...page]);
    })().catch((e: unknown) => e);
    expect(isAppleMusicError(error, "ApiError")).toBe(true);
    expect((error as Error).message).toBe("playlists.apply: Apple names another page after the 2 that maxPages allows, so what was read is not all there is");
    expect(seen).toEqual([["a"], ["b"]]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("a walk that ends on the page maxPages allows is a whole walk", async () => {
    const { client } = linked({ "/2": { data: ["b"] } });
    expect(await all(pagesOf(client, () => Promise.resolve({ data: ["a"], next: "/2" }), { ...WALK, maxPages: 2 }))).toEqual([["a"], ["b"]]);
  });

  test("a link that names its own page is walked no further than maxPages allows", async () => {
    const { client, request } = linked({ "/again": { data: ["a"], next: "/again" } });
    await expect(all(pagesOf(client, () => Promise.resolve({ data: ["a"], next: "/again" }), { ...WALK, maxPages: 5 }))).rejects.toThrow(/after the 5 that maxPages allows/);
    expect(request).toHaveBeenCalledTimes(4);
  });

  test("what asking for a page rejects with is what the walk rejects with", async () => {
    const down = new Error("down");
    const client = { request: () => Promise.reject(down) } as unknown as tAppleMusicClient;
    await expect(all(pagesOf(client, () => Promise.resolve({ data: [], next: "/2" }), WALK))).rejects.toBe(down);
    await expect(all(pagesOf(client, () => Promise.reject(down), WALK))).rejects.toBe(down);
  });

  test("a loop that is left asks for no further page", async () => {
    const { client, request } = linked({ "/2": { data: ["b"], next: "/3" } });
    for await (const page of pagesOf(client, () => Promise.resolve({ data: ["a"], next: "/2" }), WALK)) if (page[0] === "a") break;
    expect(request).not.toHaveBeenCalled();
  });
});

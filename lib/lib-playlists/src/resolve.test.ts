import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import type { tSong } from "@open-music-sdk/types";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { fold, resolve, type tTrackDescription } from "./resolve";

interface tReply {
  status?: number;
  body?: unknown;
}

/** Every Response the fake Apple handed out, so the suite can insist each body was read. */
const responses: Response[] = [];

/** A catalog song, with what a description is matched against. */
const song = (id: string, attributes: { isrc?: string; name?: string; artistName?: string; albumName?: string; durationInMillis?: number } = {}): tSong =>
  ({ id, type: "songs", href: `/v1/catalog/us/songs/${id}`, attributes }) as unknown as tSong;

const HEY_JUDE = song("900", { isrc: "GBAYE0601498", name: "Hey Jude", artistName: "The Beatles", albumName: "1", durationInMillis: 425_653 });
const YESTERDAY = song("901", { isrc: "GBAYE0601477", name: "Yesterday", artistName: "The Beatles", albumName: "1", durationInMillis: 125_000 });

/**
 * A fetch that answers as the catalog does: songs by ISRC from `catalog`, and a search with what `search` gives
 * for its term, which is every song of the catalog unless a test says otherwise. `override` answers in its place
 * where it gives anything.
 */
function apple(catalog: readonly tSong[] = [HEY_JUDE, YESTERDAY], options: { search?: (term: string) => readonly unknown[]; override?: (url: URL) => tReply | undefined } = {}) {
  const calls: Request[] = [];
  const answer = (url: URL): tReply => {
    const given = options.override?.(url);
    if (given !== undefined) return given;
    if (url.pathname.endsWith("/songs")) {
      const codes = (url.searchParams.get("filter[isrc]") ?? "").split(",");
      return { body: { data: catalog.filter((each) => codes.includes(each.attributes?.isrc ?? "")) } };
    }
    if (url.pathname.endsWith("/search")) return { body: { results: { songs: { data: (options.search ?? (() => catalog))(url.searchParams.get("term") ?? "") } } } };
    return { status: 404, body: { errors: [] } };
  };
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    if (request.signal.aborted) return Promise.reject(request.signal.reason as Error);
    const reply = answer(new URL(request.url));
    const res = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
    responses.push(res);
    return Promise.resolve(res);
  };
  return {
    music: createClient({ developerToken: "dev", userToken: "listener", storefront: "us", fetch, retry: false }),
    calls,
    /** Each request as its method, path and query. */
    lines: () => calls.map((c) => `${c.method} ${new URL(c.url).pathname}${decodeURIComponent(new URL(c.url).search).replaceAll("+", " ")}`),
  };
}

afterEach(() => {
  vi.useRealTimers();
  // An unread body holds its connection until garbage collection, so no code path may drop one.
  expect(responses.filter((r) => r.body !== null && !r.bodyUsed)).toEqual([]);
  responses.length = 0;
});

describe("fold: text as it is compared", () => {
  test.each<[string, string]>([
    ["Hey Jude", "hey jude"],
    ["HEY JUDE", "hey jude"],
    ["  Hey   Jude ", "hey jude"],
    ["Beyoncé", "beyonce"],
    ["Beyoncé", "beyonce"],
    ["Sigur Rós", "sigur ros"],
    ["Mötley Crüe", "motley crue"],
    ["Don't Stop Me Now", "dont stop me now"],
    ["Don’t Stop Me Now", "dont stop me now"],
    ["Rock 'n' Roll", "rock n roll"],
    ["AC/DC", "ac dc"],
    ["AC-DC", "ac dc"],
    ["Mr. Brightside", "mr brightside"],
    ["Hello, Goodbye!", "hello goodbye"],
    ["Ｈｅｌｌｏ", "hello"],
    ["東京", "東京"],
    ["99 Luftballons", "99 luftballons"],
  ])("%j is compared as %j", (text, folded) => {
    expect(fold(text)).toBe(folded);
  });

  test.each<[string, string, string]>([
    ["the two dots that make a Japanese to a do", "\u30cf\u30fc\u30c9", "\u30cf\u30fc\u30c8"],
    ["the same in hiragana", "\u304c\u3089\u3059", "\u304b\u3089\u3059"],
    ["a Thai vowel", "\u0e1d\u0e31\u0e19", "\u0e1d\u0e19"],
    ["a Devanagari vowel sign", "\u0926\u093f\u0932", "\u0926\u0932"],
    ["the breve that tells one Russian letter from another", "\u043c\u043e\u0439", "\u043c\u043e\u0438"],
    ["a Greek accent", "\u03b3\u03ad\u03c1\u03bf\u03c2", "\u03b3\u03b5\u03c1\u03bf\u03c2"],
    ["a Hebrew point", "\u05e9\u05c1\u05dc\u05d5\u05dd", "\u05e9\u05c2\u05dc\u05d5\u05dd"],
  ])("a mark that is part of a letter is kept: %s makes another word, and the two are not the same", (_name, one, other) => {
    expect(fold(one)).not.toBe(fold(other));
  });

  test.each<[string, string, string]>([
    ["a Japanese letter", "\u30c9", "\u30c8\u3099"],
    ["a Russian letter", "\u0439", "\u0438\u0306"],
    ["a Korean syllable", "\ud55c", "\u1112\u1161\u11ab"],
  ])("%s written as one character and as a letter with its mark are the same text", (_name, one, two) => {
    expect(one).not.toBe(two);
    expect(fold(one)).toBe(fold(two));
  });

  test("what a recording was later called is left in: it is not for a rule to say those are the same song", () => {
    expect(fold("Hey Jude (Remastered 2015)")).toBe("hey jude remastered 2015");
    expect(fold("Hey Jude - Live")).not.toBe(fold("Hey Jude"));
    expect(fold("The Beatles")).not.toBe(fold("Beatles"));
    expect(fold("Simon & Garfunkel")).not.toBe(fold("Simon and Garfunkel"));
  });

  test("text that is punctuation and nothing else is compared as it is, so one such name is not another", () => {
    expect(fold("!!!")).toBe("!!!");
    expect(fold(" ??? ")).toBe("???");
    expect(fold("!!!")).not.toBe(fold("???"));
  });
});

describe("resolve: by ISRC first, which names a recording whoever sells it", () => {
  test("a description with an ISRC the catalog has is that song, found in one request", async () => {
    const { music, lines } = apple();
    const { tracks, skipped } = await resolve(music, [{ isrc: "GBAYE0601498" }, { isrc: "GBAYE0601477" }]);
    expect(tracks).toEqual([HEY_JUDE, YESTERDAY]);
    expect(skipped).toEqual([]);
    expect(lines()).toEqual(["GET /v1/catalog/us/songs?filter[isrc]=GBAYE0601498,GBAYE0601477"]);
  });

  test("the ISRCs go 25 to a request, which is the most Apple documents taking", async () => {
    const catalog = Array.from({ length: 60 }, (_, at) => song(String(at), { isrc: `CODE${String(at).padStart(8, "0")}` }));
    const { music, calls } = apple(catalog);
    const { tracks } = await resolve(music, catalog.map((each) => ({ isrc: each.attributes?.isrc })));
    expect(tracks).toEqual(catalog);
    expect(calls.map((c) => (new URL(c.url).searchParams.get("filter[isrc]") ?? "").split(",").length)).toEqual([25, 25, 10]);
  });

  test("an ISRC that several descriptions have is asked for once, and each of them gets the song", async () => {
    const { music, lines } = apple();
    const { tracks } = await resolve(music, [{ isrc: "GBAYE0601498" }, { isrc: "GBAYE0601477" }, { isrc: "GBAYE0601498" }]);
    expect(tracks).toEqual([HEY_JUDE, YESTERDAY, HEY_JUDE]);
    expect(lines()).toEqual(["GET /v1/catalog/us/songs?filter[isrc]=GBAYE0601498,GBAYE0601477"]);
  });

  test("an ISRC in small letters, or with space around it, is the same ISRC", async () => {
    const { music, lines } = apple();
    expect((await resolve(music, [{ isrc: " gbaye0601498\n" }])).tracks).toEqual([HEY_JUDE]);
    expect(lines()).toEqual(["GET /v1/catalog/us/songs?filter[isrc]=GBAYE0601498"]);
  });

  test("of several songs with one ISRC, the one on the album named is taken", async () => {
    const [single, album] = [song("1", { isrc: "A", albumName: "Hey Jude - Single" }), song("2", { isrc: "A", albumName: "1 (2015 Version)" })];
    const { music } = apple([single, album]);
    expect((await resolve(music, [{ isrc: "A", albumName: "1 (2015 version)" }])).tracks).toEqual([album]);
  });

  test("of several songs with one ISRC and no album to go by, the one nearest the length given is taken", async () => {
    const [short, long] = [song("1", { isrc: "A", durationInMillis: 180_000 }), song("2", { isrc: "A", durationInMillis: 425_000 })];
    const { music } = apple([short, long, song("3", { isrc: "A" })]);
    expect((await resolve(music, [{ isrc: "A", durationInMillis: 420_000 }])).tracks).toEqual([long]);
    expect((await resolve(music, [{ isrc: "A", durationInMillis: 1 }])).tracks).toEqual([short]);
  });

  test("of several songs with one ISRC and nothing to decide by, Apple's first is taken", async () => {
    const [first, second] = [song("1", { isrc: "A" }), song("2", { isrc: "A" })];
    const { music } = apple([first, second]);
    expect((await resolve(music, [{ isrc: "A" }])).tracks).toEqual([first]);
    expect((await resolve(music, [{ isrc: "A", albumName: "On no album Apple has" }])).tracks).toEqual([first]);
  });

  test("a song Apple sends for another ISRC than the one asked is not the track", async () => {
    const { music } = apple([], { override: (url) => (url.pathname.endsWith("/songs") ? { body: { data: [YESTERDAY] } } : undefined) });
    expect((await resolve(music, [{ isrc: "GBAYE0601498" }])).tracks).toEqual([]);
  });
});

describe("resolve: then by a search, for what the ISRCs did not find", () => {
  test("a description with no ISRC is searched for by its name and artist, and no request by ISRC is made", async () => {
    const { music, lines } = apple();
    const { tracks } = await resolve(music, [{ name: "Hey Jude", artistName: "The Beatles" }]);
    expect(tracks).toEqual([HEY_JUDE]);
    expect(lines()).toEqual(["GET /v1/catalog/us/search?term=Hey Jude The Beatles&types=songs"]);
  });

  test("a description whose ISRC the catalog does not have is searched for as well", async () => {
    const { music, lines } = apple();
    const { tracks } = await resolve(music, [{ isrc: "XX0000000000", name: "Yesterday", artistName: "The Beatles" }]);
    expect(tracks).toEqual([YESTERDAY]);
    expect(lines()).toEqual(["GET /v1/catalog/us/songs?filter[isrc]=XX0000000000", "GET /v1/catalog/us/search?term=Yesterday The Beatles&types=songs"]);
  });

  test("a description the ISRCs found is not searched for", async () => {
    const { music, lines } = apple();
    await resolve(music, [{ isrc: "GBAYE0601498", name: "Hey Jude", artistName: "The Beatles" }]);
    expect(lines()).toHaveLength(1);
  });

  test.each<[string, tTrackDescription]>([
    ["other case", { name: "HEY JUDE", artistName: "the beatles" }],
    ["accents the catalog does not have", { name: "Héy Júde", artistName: "Thé Beatles" }],
    ["other punctuation and spacing", { name: " Hey, Jude! ", artistName: "The  Beatles." }],
  ])("a name and an artist that differ from a song's only in %s are that song", async (_name, description) => {
    const { music } = apple();
    expect((await resolve(music, [description])).tracks).toEqual([HEY_JUDE]);
  });

  test.each<[string, tTrackDescription]>([
    ["a name with more in it", { name: "Hey Jude (Remastered 2015)", artistName: "The Beatles" }],
    ["another artist", { name: "Hey Jude", artistName: "Wilson Pickett" }],
    ["an artist with less in it", { name: "Hey Jude", artistName: "Beatles" }],
    ["no artist at all, which a name alone is not enough without", { name: "Hey Jude" }],
  ])("a description with %s is not matched, and is handed back with what the search found", async (_name, description) => {
    const { music } = apple();
    const { tracks, skipped } = await resolve(music, [description]);
    expect(tracks).toEqual([]);
    expect(skipped).toEqual([{ index: 0, track: description, reason: "no-match", candidates: [HEY_JUDE, YESTERDAY] }]);
  });

  test.each<[string, string, string]>([
    ["an accent", "Papa", "Pap\u00e1"],
    ["punctuation", "Why", "Why?"],
    ["case", "hello", "Hello"],
  ])("of two songs that differ only by %s, the one written as the description is written is the one taken, whichever Apple puts first", async (_name, plain, marked) => {
    const [first, second] = [song("1", { name: plain, artistName: "Artist" }), song("2", { name: marked, artistName: "Artist" })];
    expect((await resolve(apple([first, second]).music, [{ name: marked, artistName: "Artist" }])).tracks).toEqual([second]);
    expect((await resolve(apple([second, first]).music, [{ name: plain, artistName: "Artist" }])).tracks).toEqual([first]);
  });

  test("where none is written as the description is, they are all the track still, and Apple's first is taken", async () => {
    const [first, second] = [song("1", { name: "Papa", artistName: "Artist" }), song("2", { name: "Pap\u00e1", artistName: "Artist" })];
    expect((await resolve(apple([first, second]).music, [{ name: "PAPA", artistName: "artist" }])).tracks).toEqual([first]);
  });

  test("being written the same comes before the album and the length: a song on the album named is not taken over one that is the title asked for", async () => {
    const [other, asked] = [song("1", { name: "Papa", artistName: "Artist", albumName: "Greatest" }), song("2", { name: "Pap\u00e1", artistName: "Artist", albumName: "Single" })];
    expect((await resolve(apple([other, asked]).music, [{ name: "Pap\u00e1", artistName: "Artist", albumName: "Greatest" }])).tracks).toEqual([asked]);
  });

  test("a title that differs from a song's by a mark that is part of a letter is another title, and is not matched", async () => {
    const heart = song("5", { name: "\u30cf\u30fc\u30c8", artistName: "Artist" });
    const { music } = apple([heart]);
    const { tracks, skipped } = await resolve(music, [{ name: "\u30cf\u30fc\u30c9", artistName: "Artist" }]);
    expect(tracks).toEqual([]);
    expect(skipped[0]?.candidates).toEqual([heart]);
  });

  test("of several songs with the name and the artist, the album and then the length decide, as they do for an ISRC", async () => {
    const [studio, live] = [song("1", { name: "Hey Jude", artistName: "The Beatles", albumName: "1", durationInMillis: 425_000 }), song("2", { name: "Hey Jude", artistName: "The Beatles", albumName: "Anthology 3", durationInMillis: 260_000 })];
    const { music } = apple([studio, live]);
    expect((await resolve(music, [{ name: "Hey Jude", artistName: "The Beatles", albumName: "Anthology 3" }])).tracks).toEqual([live]);
    expect((await resolve(music, [{ name: "Hey Jude", artistName: "The Beatles", durationInMillis: 250_000 }])).tracks).toEqual([live]);
    expect((await resolve(music, [{ name: "Hey Jude", artistName: "The Beatles" }])).tracks).toEqual([studio]);
  });

  test("a description with nothing to search for is asked about nowhere, and is handed back with no candidates", async () => {
    const { music, calls } = apple();
    const descriptions = [{ albumName: "1" }, { artistName: "The Beatles" }, {}];
    const { skipped } = await resolve(music, descriptions);
    expect(calls).toEqual([]);
    expect(skipped).toEqual(descriptions.map((track, index) => ({ index, track, reason: "no-match", candidates: [] })));
  });

  test("a name and an artist too long to search for together are searched for as far as a term may go", async () => {
    const { music, calls } = apple();
    await resolve(music, [{ name: "a".repeat(200), artistName: "b".repeat(200) }]);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("term")).toBe(`${"a".repeat(200)} ${"b".repeat(55)}`);
  });
});

describe("resolve: only the catalog is asked", () => {
  test("no request carries the Music User Token, though the client has one", async () => {
    const { music, calls } = apple();
    await resolve(music, [{ isrc: "GBAYE0601498" }, { name: "Yesterday", artistName: "The Beatles" }]);
    expect(calls.map((c) => [c.headers.get("authorization"), c.headers.get("music-user-token")])).toEqual([
      ["Bearer dev", null],
      ["Bearer dev", null],
    ]);
  });

  test("it is the client's storefront that is asked, unless the call names another", async () => {
    const { music, lines } = apple();
    await resolve(music, [{ isrc: "A", name: "B" }], { storefront: "gb" });
    expect(lines()).toEqual(["GET /v1/catalog/gb/songs?filter[isrc]=A", "GET /v1/catalog/gb/search?term=B&types=songs"]);
  });
});

describe("resolve: what it answers with", () => {
  test("the songs in the order of the descriptions they were found for, and each one left over with where it was", async () => {
    const descriptions = [{ name: "Unknown", artistName: "Nobody" }, { isrc: "GBAYE0601477" }, { name: "Nothing" }, { name: "hey jude", artistName: "the beatles" }];
    const { music } = apple();
    const { tracks, skipped } = await resolve(music, descriptions);
    expect(tracks).toEqual([YESTERDAY, HEY_JUDE]);
    expect(skipped.map((each) => [each.index, each.reason])).toEqual([
      [0, "no-match"],
      [2, "no-match"],
    ]);
  });

  test("a description is handed back as it was handed over, with whatever else it held", async () => {
    const mine = { name: "Unknown", artistName: "Nobody", row: 17 };
    const { music } = apple();
    const { skipped } = await resolve(music, [mine]);
    expect(skipped[0]?.track).toBe(mine);
    expectTypeOf(skipped[0]?.track).toEqualTypeOf<{ name: string; artistName: string; row: number } | undefined>();
  });

  test("a song is handed over as Apple sent it, clip and all", async () => {
    const withClip = song("1", { isrc: "A" });
    (withClip.attributes as unknown as { previews: unknown }).previews = [{ url: "https://audio-ssl.itunes.apple.com/a.m4a" }];
    const { music } = apple([withClip]);
    expect((await resolve(music, [{ isrc: "A" }])).tracks[0]).toEqual(withClip);
  });

  test("the answer is frozen: the two lists, each one left over, and its candidates", async () => {
    const { music } = apple();
    const answer = await resolve(music, [{ name: "Unknown", artistName: "Nobody" }]);
    expect([answer, answer.tracks, answer.skipped, answer.skipped[0], answer.skipped[0]?.candidates].every((each) => Object.isFrozen(each))).toBe(true);
  });

  test("no descriptions is no songs, and nothing asked", async () => {
    const { music, calls } = apple();
    expect(await resolve(music, [])).toEqual({ tracks: [], skipped: [] });
    expect(calls).toEqual([]);
  });
});

describe("resolve: a field that is a string and of no use is data that did not help, and not a mistake", () => {
  test.each<[string, tTrackDescription]>([
    ["an empty ISRC", { isrc: "", name: "Hey Jude", artistName: "The Beatles" }],
    ["an ISRC that is only space", { isrc: "   ", name: "Hey Jude", artistName: "The Beatles" }],
    ["an ISRC with a comma, which would be sent as two", { isrc: "GBAYE0601498,GBAYE0601477", name: "Hey Jude", artistName: "The Beatles" }],
    ["an ISRC longer than one can be sent", { isrc: "A".repeat(65), name: "Hey Jude", artistName: "The Beatles" }],
  ])("%s is no ISRC: the track is looked for by its name and artist alone", async (_name, description) => {
    const { music, lines } = apple();
    expect((await resolve(music, [description])).tracks).toEqual([HEY_JUDE]);
    expect(lines()).toEqual(["GET /v1/catalog/us/search?term=Hey Jude The Beatles&types=songs"]);
  });

  test("an empty name is no name, and an empty artist no artist", async () => {
    const { music, calls } = apple();
    expect((await resolve(music, [{ name: " ", artistName: "The Beatles" }])).skipped).toHaveLength(1);
    expect(calls).toEqual([]);
    expect((await resolve(music, [{ name: "Hey Jude", artistName: "" }])).skipped).toHaveLength(1);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("a length of %s is no length: Apple's first of the songs that fit is taken", async (durationInMillis) => {
    const [first, second] = [song("1", { isrc: "A", durationInMillis: 500_000 }), song("2", { isrc: "A", durationInMillis: 1 })];
    const { music } = apple([first, second]);
    expect((await resolve(music, [{ isrc: "A", durationInMillis }])).tracks).toEqual([first]);
  });
});

describe("resolve: an answer that is not what Apple documents is an answer that found nothing", () => {
  test.each<[string, unknown]>([
    ["no data", {}],
    ["data that is no list", { data: "none" }],
    ["songs with no attributes, and things that are no songs", { data: [{ id: "1", type: "songs" }, null, "song", 7] }],
  ])("for an ISRC, %s", async (_name, body) => {
    const { music } = apple([], { override: (url) => (url.pathname.endsWith("/songs") ? { body } : undefined) });
    expect((await resolve(music, [{ isrc: "A" }])).tracks).toEqual([]);
  });

  test.each<[string, unknown]>([
    ["no results", {}],
    ["results of no type asked for", { results: {} }],
    ["results that are no results", { results: "none" }],
    ["songs with nothing under them", { results: { songs: {} } }],
  ])("for a search, %s", async (_name, body) => {
    const { music } = apple([], { override: (url) => (url.pathname.endsWith("/search") ? { body } : undefined) });
    expect(await resolve(music, [{ name: "Hey Jude", artistName: "The Beatles" }])).toMatchObject({ tracks: [], skipped: [{ index: 0, candidates: [] }] });
  });

  test("what a search found that is no song is left out of the candidates", async () => {
    const { music } = apple([], { search: () => [null, HEY_JUDE, "song"] });
    expect((await resolve(music, [{ name: "Something else", artistName: "Someone" }])).skipped[0]?.candidates).toEqual([HEY_JUDE]);
  });
});

describe("resolve: what a song says of itself is what it holds itself", () => {
  const polluted = Object.prototype as Record<string, unknown>;

  afterEach(() => {
    for (const key of ["attributes", "isrc", "name", "artistName"]) Reflect.deleteProperty(polluted, key);
  });

  test("a song Apple sent with no attributes is not given a name and an artist by what other code planted", async () => {
    const bare = { id: "666", type: "songs", href: "/666" } as unknown as tSong;
    const { music } = apple([], { search: () => [bare] });
    polluted.attributes = { name: "Hey Jude", artistName: "The Beatles" };
    const answer = await resolve(music, [{ name: "Hey Jude", artistName: "The Beatles" }]);
    Reflect.deleteProperty(polluted, "attributes");
    expect(answer.tracks).toEqual([]);
  });

  test("a song with no ISRC, or no name, is not given one either", async () => {
    const nameless = song("667", { albumName: "1" });
    const { music } = apple([], { override: (url) => (url.pathname.endsWith("/songs") ? { body: { data: [nameless] } } : undefined), search: () => [nameless] });
    polluted.isrc = "GBAYE0601498";
    polluted.name = "Hey Jude";
    polluted.artistName = "The Beatles";
    const answer = await resolve(music, [Object.assign(Object.create(null) as object, { isrc: "GBAYE0601498", name: "Hey Jude", artistName: "The Beatles" })]);
    for (const key of ["isrc", "name", "artistName"]) Reflect.deleteProperty(polluted, key);
    expect(answer.tracks).toEqual([]);
  });
});

describe("resolve: progress, pace and stopping", () => {
  test("it is told how many descriptions are done with, of how many, each time more are: several at once for an ISRC, one at a time for a search", async () => {
    const { music } = apple();
    const heard = vi.fn();
    await resolve(music, [{ isrc: "GBAYE0601498" }, { isrc: "GBAYE0601477" }, { name: "Unknown", artistName: "Nobody" }, {}], { onProgress: heard });
    expect(heard.mock.calls).toEqual([[{ done: 2, total: 4 }], [{ done: 3, total: 4 }], [{ done: 4, total: 4 }]]);
  });

  test("a request by ISRC that found nothing is not progress: its descriptions are still to be searched for", async () => {
    const { music } = apple();
    const heard = vi.fn();
    await resolve(music, [{ isrc: "XX0000000000", name: "Hey Jude", artistName: "The Beatles" }], { onProgress: heard });
    expect(heard.mock.calls).toEqual([[{ done: 1, total: 1 }]]);
  });

  test("what onProgress throws stops the resolving, and is what resolve rejects with", async () => {
    const { music, calls } = apple();
    const stop = new Error("enough");
    await expect(
      resolve(music, [{ isrc: "GBAYE0601498" }, { name: "Yesterday", artistName: "The Beatles" }], {
        onProgress: () => {
          throw stop;
        },
      }),
    ).rejects.toBe(stop);
    expect(calls).toHaveLength(1);
  });

  test("delayMs is waited between one request and the next, and neither before the first nor after the last", async () => {
    vi.useFakeTimers();
    const { music, calls } = apple();
    const answered = vi.fn();
    void resolve(music, [{ isrc: "XX0000000000", name: "Hey Jude", artistName: "The Beatles" }, { name: "Yesterday", artistName: "The Beatles" }], { delayMs: 500 }).then(answered);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(3);
    expect(answered).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("with no delayMs, one request follows another with no timer between", async () => {
    vi.useFakeTimers();
    const { music, calls } = apple();
    await resolve(music, [{ isrc: "XX0000000000", name: "Hey Jude", artistName: "The Beatles" }, { name: "Yesterday", artistName: "The Beatles" }]);
    expect(calls).toHaveLength(3);
  });

  test("a signal already aborted asks for nothing, and its reason is what resolve rejects with", async () => {
    const { music, calls } = apple();
    const reason = new Error("gone");
    await expect(resolve(music, [{ isrc: "A" }], { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(calls).toEqual([]);
  });

  test("an abort during the wait between requests stops the wait, and nothing more is asked", async () => {
    const controller = new AbortController();
    const { music, calls } = apple();
    const reason = new Error("gone");
    const resolving = resolve(music, [{ name: "Hey Jude", artistName: "The Beatles" }, { name: "Yesterday", artistName: "The Beatles" }], {
      delayMs: 60_000,
      signal: controller.signal,
      onProgress: () => {
        controller.abort(reason);
      },
    });
    await expect(resolving).rejects.toBe(reason);
    expect(calls).toHaveLength(1);
  });

  test.each([401, 404, 429, 500])("a request Apple answers with %s rejects the call with that error, and nothing found so far is handed over", async (status) => {
    const { music, calls } = apple(undefined, { override: (url) => (url.pathname.endsWith("/search") ? { status, body: { errors: [] } } : undefined) });
    const error: unknown = await resolve(music, [{ isrc: "GBAYE0601498" }, { name: "Yesterday", artistName: "The Beatles" }, { name: "Never asked", artistName: "Nobody" }]).catch((e: unknown) => e);
    expect(isAppleMusicError(error) && error.status).toBe(status);
    expect(calls).toHaveLength(2);
  });
});

describe("resolve: what it is handed is checked before Apple is asked, and a mistake names the verb and where it is", () => {
  test.each<[string, unknown, RegExp]>([
    ["descriptions that are one description", { isrc: "A" }, /^playlists\.resolve: descriptions must be a list of descriptions of tracks, each a plain object such as \{ isrc: "USUM71703861" \} or \{ name: "Hey Jude", artistName: "The Beatles" \}; got object$/],
    ["no descriptions at all", undefined, /^playlists\.resolve: descriptions must be a list .*; got undefined$/],
    ["a description that is an ISRC alone", [{ isrc: "A" }, "GBAYE0601498"], /^playlists\.resolve: descriptions\[1\] must be a plain object that describes a track; got 12 characters$/],
    ["a description that is nothing", [null], /^playlists\.resolve: descriptions\[0\] must be a plain object that describes a track; got null$/],
    ["an ISRC that is a number", [{ isrc: 601498 }], /^playlists\.resolve: descriptions\[0\]\.isrc must be a string; got 601498$/],
    ["a name that is a list", [{}, {}, { name: ["Hey Jude"] }], /^playlists\.resolve: descriptions\[2\]\.name must be a string; got object$/],
    ["an artist that is an object", [{ name: "Hey Jude", artistName: { name: "The Beatles" } }], /^playlists\.resolve: descriptions\[0\]\.artistName must be a string; got object$/],
    ["an album that is true", [{ albumName: true }], /^playlists\.resolve: descriptions\[0\]\.albumName must be a string; got boolean$/],
    ["a length that is a string", [{ durationInMillis: "425653" }], /^playlists\.resolve: descriptions\[0\]\.durationInMillis must be a number; got 6 characters$/],
  ])("%s", async (_name, descriptions, message) => {
    const { music, calls } = apple();
    await expect(resolve(music, descriptions as tTrackDescription[])).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  test.each<[string, unknown, RegExp]>([
    ["options that are a list", [], /^playlists\.resolve: expected an options object; got a list$/],
    ["a signal that is none", { signal: {} }, /^playlists\.resolve: signal must be an AbortSignal; got object$/],
    ["an onProgress that is no function", { onProgress: true }, /^playlists\.resolve: onProgress must be a function; got boolean$/],
    ["a delayMs below zero", { delayMs: -1 }, /^playlists\.resolve: delayMs must be a number of milliseconds from 0 to 2147483647; got -1$/],
    ["a storefront that would leave the catalog", { storefront: "../me/library" }, /^playlists\.resolve: storefront must be a string of 1 to 64 characters, with no slash/],
    ["a storefront that is no string", { storefront: 44 }, /^playlists\.resolve: storefront must be /],
  ])("%s", async (_name, options, message) => {
    const { music, calls } = apple();
    await expect(resolve(music, [{ isrc: "A" }], options as object)).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  test("the descriptions are checked before the options, in the order they were handed over", async () => {
    const { music } = apple();
    await expect(resolve(music, undefined as unknown as tTrackDescription[], [] as object)).rejects.toThrow(/^playlists\.resolve: descriptions must be /);
  });

  test("no error repeats what it was handed", async () => {
    const { music } = apple();
    const secret = "a-token-put-where-a-description-goes";
    const error = (await resolve(music, [secret as unknown as tTrackDescription]).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain(`${String(secret.length)} characters`);
    expect(error.message).not.toContain(secret);
  });

  test("the list is this call's own: each description is read once, as the call is made", async () => {
    const reads = vi.fn(() => "GBAYE0601498");
    const description = Object.defineProperty({}, "isrc", { get: reads, enumerable: true }) as tTrackDescription;
    const { music } = apple();
    expect((await resolve(music, [description])).tracks).toEqual([HEY_JUDE]);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});

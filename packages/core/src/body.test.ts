import { describe, expect, test } from "vitest";
import { readBounded } from "./body";

/** A body stream of the given chunks that records whether it was cancelled and how often it was pulled. */
function streamOf(...chunks: (string | Uint8Array)[]) {
  const seen = { cancelled: false, pulls: 0 };
  const queue = chunks.map((c) => (typeof c === "string" ? new TextEncoder().encode(c) : c));
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulls++;
        const next = queue.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, seen };
}

type tMake = (body: ReadableStream<Uint8Array> | null, headers?: Record<string, string>) => Request | Response;

/** Both kinds of message carry a body the other side chose the size of: an endpoint's answer, and a caller's post. */
const kinds: [string, tMake][] = [
  ["a Response", (body, headers = {}) => new Response(body, { headers })],
  ["a Request", (body, headers = {}) => new Request("https://app.example/", { method: "POST", body, headers, duplex: "half" } as RequestInit)],
];

describe.each(kinds)("readBounded: %s", (_kind, make) => {
  test("no body is the empty string", async () => {
    expect(await readBounded(make(null), 10)).toBe("");
  });

  test.each<[string, string[]]>([
    ["an empty stream", []],
    ["one chunk", ['{"token":"abc"}']],
    ["several chunks, in order", ['{"tok', 'en":"', 'abc"}']],
    ["an empty chunk among others", ["ab", "", "cd"]],
  ])("%s is read whole", async (_name, chunks) => {
    expect(await readBounded(make(streamOf(...chunks).body), 100)).toBe(chunks.join(""));
  });

  test.each([
    ["one chunk", ["a".repeat(10)]],
    ["several chunks", ["aaaa", "aaaa", "aa"]],
  ])("exactly the limit in %s is read", async (_name, chunks) => {
    expect(await readBounded(make(streamOf(...chunks).body), 10)).toBe("a".repeat(10));
  });

  test.each([
    ["one chunk", ["a".repeat(11)]],
    ["several chunks", ["aaaa", "aaaa", "aaa"]],
    ["a first chunk already far past it", ["a".repeat(1000), "a"]],
  ])("one byte past the limit in %s is undefined", async (_name, chunks) => {
    expect(await readBounded(make(streamOf(...chunks).body), 10)).toBeUndefined();
  });

  test("a limit of zero takes only an empty body", async () => {
    expect(await readBounded(make(streamOf().body), 0)).toBe("");
    expect(await readBounded(make(streamOf("a").body), 0)).toBeUndefined();
  });

  test("the limit counts bytes, not characters", async () => {
    expect(await readBounded(make(streamOf("é".repeat(5)).body), 10)).toBe("é".repeat(5));
    expect(await readBounded(make(streamOf("é".repeat(6)).body), 10)).toBeUndefined();
  });

  test("going past the limit cancels the stream, and what lies beyond is never asked for", async () => {
    const { body, seen } = streamOf("aaaa", "aaaa", "aaaa", "aaaa", "aaaa");
    expect(await readBounded(make(body), 10)).toBeUndefined();
    expect(seen).toEqual({ cancelled: true, pulls: 3 });
  });

  test("a stream within the limit is read to its end and not cancelled", async () => {
    const { body, seen } = streamOf("aaaa", "aaaa");
    await readBounded(make(body), 10);
    expect(seen).toEqual({ cancelled: false, pulls: 3 });
  });

  test.each([
    ["two bytes", "é"],
    ["three bytes", "€"],
    ["four bytes", "\u{1f3b5}"],
  ])("a character of %s split across chunks is decoded whole", async (_name, char) => {
    const bytes = new TextEncoder().encode(`a${char}b`);
    for (let cut = 1; cut < bytes.length; cut++) expect(await readBounded(make(streamOf(bytes.slice(0, cut), bytes.slice(cut)).body), 100)).toBe(`a${char}b`);
  });

  test("a byte order mark is dropped", async () => {
    expect(await readBounded(make(streamOf(new Uint8Array([0xef, 0xbb, 0xbf]), "{}").body), 100)).toBe("{}");
  });

  test.each([
    ["a lone continuation byte", [0x61, 0x80, 0x62], "a�b"],
    ["a sequence cut short by the end", [0x61, 0xe2, 0x82], "a�"],
  ])("%s becomes U+FFFD rather than an error", async (_name, bytes, text) => {
    expect(await readBounded(make(streamOf(new Uint8Array(bytes)).body), 100)).toBe(text);
  });

  test("a stream that fails part way rejects with its error", async () => {
    const failed = new Error("connection reset");
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new Uint8Array([0x61]));
        else controller.error(failed);
      },
    });
    await expect(readBounded(make(body), 100)).rejects.toBe(failed);
  });

  test("a body something else has already read rejects, rather than reading as empty", async () => {
    const message = make(streamOf("abc").body);
    await message.text();
    await expect(readBounded(message, 100)).rejects.toThrow(TypeError);
  });

  describe("a declared length", () => {
    test("past the limit is taken at its word: undefined, with not a byte read and the rest cancelled", async () => {
      const { body, seen } = streamOf("a".repeat(11));
      expect(await readBounded(make(body, { "content-length": "11" }), 10)).toBeUndefined();
      expect(seen).toEqual({ cancelled: true, pulls: 0 });
    });

    test.each(["10", "3", "0"])("of %s, within the limit, does not excuse a body that runs past it", async (declared) => {
      const { body, seen } = streamOf("aaaa", "aaaa", "aaaa", "aaaa");
      expect(await readBounded(make(body, { "content-length": declared }), 10)).toBeUndefined();
      expect(seen.cancelled).toBe(true);
    });

    test.each(["10", "999", "-1", "ten", ""])("of %j changes nothing for a body that is within the limit, unless it claims too much", async (declared) => {
      const out = await readBounded(make(streamOf("abc").body, { "content-length": declared }), 10);
      expect(out).toBe(declared === "999" ? undefined : "abc");
    });
  });
});

describe("readBounded: where a message has no body stream to count, as on some runtimes", () => {
  /** What such a runtime hands over: the text is there to be read whole, and nothing to read it by. */
  const streamless = (text: string, headers: Record<string, string> = {}) => ({ body: undefined, headers: new Headers(headers), text: () => Promise.resolve(text) }) as unknown as Response;

  test.each([0, 1, 9, 10])("an answer of %i characters is read whole", async (length) => {
    expect(await readBounded(streamless("a".repeat(length)), 10)).toBe("a".repeat(length));
  });

  test.each([11, 1_000_000])("an answer of %i characters is undefined all the same", async (length) => {
    expect(await readBounded(streamless("a".repeat(length)), 10)).toBeUndefined();
  });

  test("a declared length past the limit is refused without the text being asked for", async () => {
    let asked = false;
    const message = { body: undefined, headers: new Headers({ "content-length": "11" }), text: () => ((asked = true), Promise.resolve("a")) } as unknown as Response;
    expect(await readBounded(message, 10)).toBeUndefined();
    expect(asked).toBe(false);
  });
});

describe("readBounded: the limit", () => {
  test.each([0, 1, 8192, 16_384, 2 ** 31])("%i is accepted", async (maxBytes) => {
    expect(await readBounded(new Response(""), maxBytes)).toBe("");
  });

  test.each<[string, unknown]>([
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a number written as a string", "10"],
    ["undefined", undefined],
    ["null", null],
  ])("%s is a TypeError naming maxBytes, before anything is read", async (_name, maxBytes) => {
    const { body, seen } = streamOf("abc");
    await expect(readBounded(new Response(body), maxBytes as number)).rejects.toThrow(/^readBounded: maxBytes must be a whole number from 0, got /);
    expect(seen).toEqual({ cancelled: false, pulls: 0 });
  });
});

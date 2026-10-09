import type { tArtwork } from "@open-music-sdk/types";
import { describe, expect, test } from "vitest";
import { artworkSrcSet, artworkUrl, normalise, type tArtworkSource } from "./artwork.js";

const TEMPLATE = "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/ef/cover.jpg/{w}x{h}bb.jpg";
/** A square cover as the API gives it, `side` pixels at its largest. */
const cover = (side = 3000): tArtworkSource => ({ url: TEMPLATE, width: side, height: side });
/** The `{w}x{h}` a URL was filled in with. */
const size = (url: string) => /\/(\d+x\d+)bb\.jpg$/.exec(url)?.[1];

/**
 * A srcset as a browser reads it: the URL and descriptors of each candidate. This follows the steps of
 * "parse a srcset attribute" in the HTML Standard, so a URL that would be split, cut short or taken for a
 * descriptor there is here too.
 */
function parseSrcset(input: string): { url: string; descriptors: string[] }[] {
  const space = (c: string | undefined) => c !== undefined && "\t\n\f\r ".includes(c);
  const candidates: { url: string; descriptors: string[] }[] = [];
  let i = 0;
  for (;;) {
    while (i < input.length && (space(input[i]) || input[i] === ",")) i++;
    if (i >= input.length) return candidates;
    const start = i;
    while (i < input.length && !space(input[i])) i++;
    let url = input.slice(start, i);
    const descriptors: string[] = [];
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      let [current, state] = ["", "in descriptor"];
      for (;;) {
        const c = input[i];
        if (state === "in descriptor") {
          if (c === undefined || c === ",") {
            if (current !== "") descriptors.push(current);
            i++;
            break;
          }
          if (space(c)) {
            if (current !== "") [current, state] = [(descriptors.push(current), ""), "after descriptor"];
          } else {
            current += c;
            if (c === "(") state = "in parens";
          }
        } else if (state === "in parens") {
          if (c === undefined) {
            descriptors.push(current);
            break;
          }
          current += c;
          if (c === ")") state = "in descriptor";
        } else {
          if (c === undefined) break;
          if (!space(c)) {
            state = "in descriptor";
            continue;
          }
        }
        i++;
      }
    }
    candidates.push({ url, descriptors });
  }
}

/**
 * The image a browser fetches for an `<img>` on a screen of `dpr` device pixels to the CSS pixel, by the HTML
 * Standard's steps for a srcset of densities: a candidate whose descriptors are not one density is dropped, one
 * with none counts as 1x, a `src` stands in as the 1x candidate where there is no other, and a density given
 * twice keeps its first image. Of what is left the browser takes the least dense that is dense enough for the
 * screen, or failing that the densest. That last step is the browser's own to decide: this is what Chrome and
 * Firefox both did when this package was reviewed.
 */
function fetched(srcset: string, dpr: number, src?: string): string | undefined {
  const sources: { url: string; density: number }[] = [];
  for (const { url, descriptors } of parseSrcset(srcset)) {
    const [descriptor = "1x", ...more] = descriptors;
    const density = more.length === 0 && /^(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?x$/i.test(descriptor) ? Number.parseFloat(descriptor) : Number.NaN;
    if (density > 0 && !sources.some((source) => source.density === density)) sources.push({ url, density });
  }
  if (src !== undefined && !sources.some((source) => source.density === 1)) sources.push({ url: src, density: 1 });
  sources.sort((a, b) => a.density - b.density);
  return (sources.find((source) => source.density >= dpr) ?? sources.at(-1))?.url;
}

describe("the srcset reader these tests check against", () => {
  test.each([
    ["a.jpg 1x, b.jpg 2x", [["a.jpg", "1x"], ["b.jpg", "2x"]]],
    ["a.jpg, b.jpg 2x", [["a.jpg"], ["b.jpg", "2x"]]],
    ["a.jpg 300w,b.jpg 600w", [["a.jpg", "300w"], ["b.jpg", "600w"]]],
    ["a,b.jpg 1x", [["a,b.jpg", "1x"]]],
    ["  a.jpg   1.5x  ", [["a.jpg", "1.5x"]]],
  ])("reads %j as a browser does", (srcset, expected) => {
    expect(parseSrcset(srcset).map((c) => [c.url, ...c.descriptors])).toEqual(expected);
  });

  test.each([
    ["a space inside a URL", "a b.jpg 1x", [["a", "b.jpg", "1x"]]],
    ["a comma ending a URL", "a.jpg, 1x", [["a.jpg"], ["1x"]]],
    ["a comma starting a URL", ",a.jpg 1x", [["a.jpg", "1x"]]],
  ])("is thrown by %s, which is why a URL is normalised", (_name, srcset, expected) => {
    expect(parseSrcset(srcset).map((c) => [c.url, ...c.descriptors])).toEqual(expected);
  });
});

describe("the browser these tests check against", () => {
  test.each([
    [1, "a"],
    [1.5, "b"],
    [2, "b"],
    [2.5, "c"],
    [3, "c"],
    [4, "c"],
  ])("on a screen of density %s, takes the least dense image that is dense enough, or the densest there is: %s", (dpr, expected) => {
    expect(fetched("a 1x, b 2x, c 3x", dpr)).toBe(expected);
  });

  test("takes them in order of density, not in the order written", () => {
    expect(fetched("c 3x, a 1x, b 2x", 2)).toBe("b");
  });

  test("passes over an image labelled a hair short of the screen, however close: this is what a wrong label costs", () => {
    expect(fetched("small 0.99x, large 2x", 1)).toBe("large");
    expect(fetched("small 1x, large 2x", 1)).toBe("small");
  });

  test.each([
    ["no descriptor is 1x", "a, b 2x", 1, undefined, "a"],
    ["a density given twice keeps its first image", "a 1x, b 1x, c 2x", 1, undefined, "a"],
    ["a descriptor that is no number is dropped", "a Infinityx, b 2x", 1, undefined, "b"],
    ["a descriptor of zero is dropped", "a 0x, b 2x", 1, undefined, "b"],
    ["two descriptors on one candidate drop it", "a 1x 2x, b 3x", 1, undefined, "b"],
    ["a density written with an exponent is read", "a 1e-3x, b 1x", 0.001, undefined, "a"],
    ["a src stands in for a missing 1x", "small 0.67x", 1, "from-src", "from-src"],
    ["a src is ignored where there is a 1x", "a 1x, b 2x", 1, "from-src", "a"],
    ["without a src, the only candidate is taken whatever it says", "small 0.67x", 1, undefined, "small"],
  ])("%s", (_name, srcset, dpr, src, expected) => {
    expect(fetched(srcset, dpr, src)).toBe(expected);
  });
});

/** What is requested for a URL on a page at BASE: where a URL parser says it points, without the fragment, which is never sent. */
const BASE = "https://app.example/music/album/1";
const requested = (url: string) => new URL(url, BASE).href.split("#")[0];
/** Characters by code, so that none of the invisible ones has to appear in this file. */
const [NBSP, LINE_SEPARATOR, IDEOGRAPHIC_SPACE, VERTICAL_TAB, NUL, UNIT_SEPARATOR] = [0xa0, 0x2028, 0x3000, 0x0b, 0x00, 0x1f].map((code) => String.fromCharCode(code)) as [
  string,
  string,
  string,
  string,
  string,
  string,
];

describe("normalise", () => {
  test.each([
    ["an ordinary artwork URL", "https://is1-ssl.mzstatic.com/image/thumb/a.jpg/{w}x{h}bb.jpg"],
    ["commas, escapes, a query and a fragment", "https://example.com/a,b/a%20b%2Cc/{w}x{h}bb.jpg?x=1,2&sig=a+b%2F#f,g"],
    ["a relative URL", "/img/{w}x{h}.jpg"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["white space a URL parser keeps and a srcset does not split on", `https://example.com/a${NBSP}b${LINE_SEPARATOR}c${IDEOGRAPHIC_SPACE}d/x.jpg`],
    ["a control character inside that is not white space", `https://example.com/a${VERTICAL_TAB}b${NUL}c/x.jpg`],
    ["a lone percent sign", "https://example.com/100%/x.jpg"],
    ["a comma next to an escaped space inside", "https://example.com/a,%20b/x.jpg"],
  ])("%s is left exactly as it is", (_name, url) => {
    expect(normalise(url)).toBe(url);
  });

  test.each([
    ["a space at the start", " https://example.com/x.jpg", "https://example.com/x.jpg"],
    ["a space at the end", "https://example.com/x.jpg ", "https://example.com/x.jpg"],
    ["tabs and line breaks at both ends", "\t\r\nhttps://example.com/x.jpg\n\t", "https://example.com/x.jpg"],
    ["control characters at both ends", `${NUL}${UNIT_SEPARATOR}https://example.com/x.jpg${UNIT_SEPARATOR}${NUL}`, "https://example.com/x.jpg"],
    ["a tab inside", "https://example.com/a\tb.jpg", "https://example.com/ab.jpg"],
    ["a line break inside", "https://example.com/a\r\nb.jpg", "https://example.com/ab.jpg"],
    ["a tab inside the scheme", "ht\ttps://example.com/x.jpg", "https://example.com/x.jpg"],
    ["a space inside", "https://example.com/a b.jpg", "https://example.com/a%20b.jpg"],
    ["a run of spaces inside", "https://example.com/a   b.jpg", "https://example.com/a%20%20%20b.jpg"],
    ["a form feed inside", "https://example.com/a\fb.jpg", "https://example.com/a%0Cb.jpg"],
    ["a space between tabs inside", "https://example.com/a\t \tb.jpg", "https://example.com/a%20b.jpg"],
    ["a comma at the start", ",a.jpg", "./,a.jpg"],
    ["commas at the start", ",,a.jpg", "./,,a.jpg"],
    ["a comma at the end", "https://example.com/x.jpg?ids=1,2,", "https://example.com/x.jpg?ids=1,2,#"],
    ["commas at the end", "https://example.com/x.jpg,,,", "https://example.com/x.jpg,,,#"],
    ["a comma at the end of the fragment", "https://example.com/x.jpg#a,", "https://example.com/x.jpg#a%2C"],
    ["commas at the end of the fragment", "https://example.com/x.jpg?a,#b,,", "https://example.com/x.jpg?a,#b%2C%2C"],
    ["a comma at each end", ",a,", "./,a,#"],
    ["a comma then a space at the end", "https://example.com/x.jpg, ", "https://example.com/x.jpg,#"],
    ["a space then a comma at the start", " ,a.jpg", "./,a.jpg"],
    ["nothing but a comma", ",", "./,#"],
    ["nothing but white space", " \t\r\n\f", ""],
    ["nothing at all", "", ""],
  ])("%s: %j becomes %j", (_name, url, expected) => {
    expect(normalise(url)).toBe(expected);
  });

  const awkward = [
    " https://img.example/../../api/logout?via=1",
    "\thttps://img.example/a/300.jpg",
    "ht\ttps://img.example/a/300.jpg",
    "https://img.example/a/300.jpg?ids=1,2,",
    "https://img.example/a/300.jpg,,",
    "https://img.example/a/300.jpg#frag,",
    "https://img.example/a b/300.jpg?q=a b#c d",
    "https://img.example/a\fb/300.jpg",
    "https://img.example/a\r\n\tb/300.jpg ",
    ",relative.jpg",
    ",,/odd//path,",
    " ,relative.jpg, ",
    "//other.example/x.jpg ",
    "/rooted/x.jpg\n",
    "../up/x.jpg,",
    "?only=query,",
    "#only-fragment,",
    "data:image/png;base64,AAAA,",
    `${NUL}https://img.example/x.jpg${UNIT_SEPARATOR}`,
  ];

  test.each(awkward)("%j still requests what a browser would request for it as a src", (url) => {
    expect(requested(normalise(url))).toBe(requested(url));
  });

  test.each(awkward)("%j comes out as something a srcset reads as one URL, the same one", (url) => {
    const out = normalise(url);
    expect(parseSrcset(`${out} 1x, other.jpg 2x`)).toEqual([
      { url: out, descriptors: ["1x"] },
      { url: "other.jpg", descriptors: ["2x"] },
    ]);
  });

  test("the control: left as they are, most of the same URLs are split, cut short, or sent somewhere else by a srcset", () => {
    const broken = awkward.filter((url) => {
      const [first] = parseSrcset(`${url} 1x`);
      return first?.descriptors.join() !== "1x" || requested(first.url) !== requested(url);
    });
    expect(broken.length).toBeGreaterThan(awkward.length / 2);
  });

  test("normalising twice changes nothing more", () => {
    for (const url of awkward) expect(normalise(normalise(url))).toBe(normalise(url));
  });

  // A pattern that retries inside each run takes four times as long for twice the length: about fifteen seconds
  // here, where walking the ends takes a millisecond.
  test.each([
    ["commas inside the URL", (n: number) => `https://example.com/${",".repeat(n)}/{w}x{h}.jpg`],
    ["commas inside it, then one more character", (n: number) => `https://example.com/?${",".repeat(n)}x`],
    ["commas at the end of the fragment", (n: number) => `https://example.com/{w}x{h}.jpg#${",".repeat(n)}`],
    ["spaces inside it", (n: number) => `https://example.com/${" ".repeat(n)}/{w}x{h}.jpg`],
    ["spaces inside it, then one more character", (n: number) => `https://example.com/?${" ".repeat(n)}x`],
    ["commas at both ends", (n: number) => `${",".repeat(n)}{w}x{h}${",".repeat(n)}`],
    ["white space at both ends", (n: number) => `${" \t".repeat(n / 2)}{w}x{h}${"\n ".repeat(n / 2)}`],
    ["commas and spaces by turns", (n: number) => `https://example.com/${", ".repeat(n / 2)}{w}x{h}`],
  ])("100 KB of %s costs time in step with its length, not with its square", (_name, make) => {
    const url = make(100_000);
    const start = performance.now();
    artworkSrcSet({ url }, 300);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("artworkUrl: the template", () => {
  test.each([
    [1, "1x1"],
    [44, "44x44"],
    [300, "300x300"],
    [1200, "1200x1200"],
    [3000, "3000x3000"],
  ])("a width of %i on a square cover asks for %s", (width, expected) => {
    expect(artworkUrl(cover(), width)).toBe(TEMPLATE.replace("{w}x{h}", expected));
  });

  test("everything around the placeholders is left as the API gave it", () => {
    const url = "https://example.com/a%20b/{w}x{h}bb.jpg?sig=a+b%2F&x={y}#frag";
    expect(artworkUrl({ url }, 100)).toBe("https://example.com/a%20b/100x100bb.jpg?sig=a+b%2F&x={y}#frag");
  });

  test("every occurrence of a placeholder is filled in, not only the first", () => {
    expect(artworkUrl({ url: "https://example.com/{w}/{h}/{w}x{h}.jpg" }, 20, { height: 10 })).toBe("https://example.com/20/10/20x10.jpg");
  });

  test.each([
    ["no placeholders at all", "https://example.com/fixed.jpg"],
    ["placeholders of some other name", "https://example.com/{x}x{y}.jpg"],
    ["placeholders in capitals", "https://example.com/{W}x{H}.jpg"],
  ])("a URL with %s comes back unchanged", (_name, url) => {
    expect(artworkUrl({ url, width: 600, height: 600 }, 300)).toBe(url);
  });

  test.each<[string, object, string]>([
    ["neither option", {}, "300x300bb.jpg"],
    ["a format", { format: "webp" }, "300x300bb.webp"],
    ["a crop", { crop: "cc" }, "300x300cc.jpg"],
    ["both", { format: "png", crop: "sr" }, "300x300sr.png"],
    ["both undefined", { format: undefined, crop: undefined }, "300x300bb.jpg"],
  ])("a template with {c} and {f}, given %s, ends in %s", (_name, options, expected) => {
    expect(artworkUrl({ url: "https://example.com/{w}x{h}{c}.{f}" }, 300, options)).toBe(`https://example.com/${expected}`);
  });

  test("format and crop change nothing in a template without their placeholders", () => {
    expect(artworkUrl(cover(), 300, { format: "webp", crop: "cc" })).toBe(artworkUrl(cover(), 300));
  });

  test("a tArtwork from the generated types is accepted as it is", () => {
    const artwork: tArtwork = { url: TEMPLATE, width: 3000, height: 3000, bgColor: "1a1a1a", textColor1: "ffffff" };
    expect(size(artworkUrl(artwork, 300))).toBe("300x300");
  });

  test("the artwork object is only read: a frozen one works and is not changed", () => {
    const artwork = Object.freeze({ url: TEMPLATE, width: 3000, height: 3000 });
    artworkUrl(artwork, 300);
    artworkSrcSet(artwork, 300);
    expect(artwork).toEqual({ url: TEMPLATE, width: 3000, height: 3000 });
  });
});

describe("artworkUrl: the image keeps the artwork's shape unless a height says otherwise", () => {
  test.each([
    ["landscape 16:9", 1920, 1080, 320, "320x180"],
    ["portrait 2:3", 2000, 3000, 300, "300x450"],
    ["a wide banner", 4320, 1080, 400, "400x100"],
    ["a shape that does not divide evenly", 1000, 333, 100, "100x33"],
    ["a shape that rounds up", 1000, 667, 100, "100x67"],
  ])("%s artwork (%i by %i) at width %i is %s", (_name, width, height, wanted, expected) => {
    expect(size(artworkUrl({ url: TEMPLATE, width, height }, wanted))).toBe(expected);
  });

  test.each([
    [300, 300, "300x300"],
    [300, 150, "300x150"],
    [150, 300, "150x300"],
  ])("an explicit box of %i by %i is asked for as %s, whatever the artwork's shape", (width, height, expected) => {
    expect(size(artworkUrl({ url: TEMPLATE, width: 1920, height: 1080 }, width, { height }))).toBe(expected);
  });

  test.each<[string, Partial<tArtworkSource>]>([
    ["no size", {}],
    ["a null size, as the library gives for some playlists", { width: null, height: null }],
    ["only a width", { width: 1920 }],
    ["only a height", { height: 1080 }],
    ["a zero size", { width: 0, height: 0 }],
    ["a negative size", { width: -1920, height: -1080 }],
    ["a size that is not a number", { width: Number.NaN, height: Number.NaN }],
    ["an infinite size", { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }],
    ["a size given as text", { width: "1920", height: "1080" } as unknown as Partial<tArtworkSource>],
  ])("artwork with %s has no known shape: the image is square and its size is not capped", (_name, known) => {
    expect(size(artworkUrl({ url: TEMPLATE, ...known }, 5000))).toBe("5000x5000");
  });
});

describe("artworkUrl: nothing larger than the artwork comes is asked for", () => {
  test.each([
    ["exactly the largest", 600, 600, 600, undefined, "600x600"],
    ["one pixel more", 600, 600, 601, undefined, "600x600"],
    ["far more", 600, 600, 10_000, undefined, "600x600"],
    ["more, on landscape artwork", 1920, 1080, 4000, undefined, "1920x1080"],
    ["a box too wide only", 1000, 1000, 2000, 500, "1000x250"],
    ["a box too tall only", 1000, 1000, 500, 2000, "250x1000"],
    ["a box too large both ways, by different amounts", 1000, 500, 4000, 1000, "1000x250"],
  ])("%s: artwork %i by %i asked for at %i by %s is %s", (_name, maxWidth, maxHeight, width, height, expected) => {
    expect(size(artworkUrl({ url: TEMPLATE, width: maxWidth, height: maxHeight }, width, { height }))).toBe(expected);
  });

  test("across many artworks and boxes, what is asked for fits inside the artwork and keeps the box's shape", () => {
    for (const [maxWidth, maxHeight] of [[3000, 3000], [1920, 1080], [600, 900], [1, 1], [7, 3]] as const)
      for (const width of [1, 2, 37, 300, 1000, 4096])
        for (const height of [undefined, 1, 50, 300, 5000]) {
          const [w, h] = (size(artworkUrl({ url: TEMPLATE, width: maxWidth, height: maxHeight }, width, { height })) ?? "").split("x").map(Number) as [number, number];
          expect(w).toBeGreaterThanOrEqual(1);
          expect(h).toBeGreaterThanOrEqual(1);
          expect(w).toBeLessThanOrEqual(maxWidth);
          expect(h).toBeLessThanOrEqual(maxHeight);
          // The shape asked for, to within the pixel that rounding costs each side.
          const shape = height === undefined ? maxWidth / maxHeight : width / height;
          expect(Math.abs(w - h * shape)).toBeLessThanOrEqual(Math.max(1, shape));
        }
  });
});

describe("artworkUrl: sizes are whole pixels", () => {
  test.each([
    [0.4, "1x1"],
    [0.5, "1x1"],
    [1.4, "1x1"],
    [1.5, "2x2"],
    [299.5, "300x300"],
    [33.3333, "33x33"],
  ])("a width of %s asks for %s", (width, expected) => {
    expect(size(artworkUrl(cover(), width))).toBe(expected);
  });

  test("a height that rounds to nothing is one pixel, not zero", () => {
    expect(size(artworkUrl({ url: TEMPLATE, width: 3000, height: 1 }, 100))).toBe("100x1");
  });

  test.each([1e15, 2 ** 53, 1e21, 1e300, Number.MAX_VALUE])("a width of %s is filled in as digits or refused, never written with an exponent", (width) => {
    let url = "";
    try {
      url = artworkUrl({ url: "{w}x{h}" }, width);
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
    }
    expect(url).toMatch(/^(\d+x\d+)?$/);
  });
});

describe("artworkUrl: what it refuses", () => {
  const bad: [string, unknown][] = [
    ["zero", 0],
    ["a negative number", -300],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["a string", "300"],
    ["null", null],
    ["an object", { width: 300 }],
  ];

  test.each([...bad, ["undefined", undefined]])("a width of %s is a TypeError naming width", (_name, width) => {
    expect(() => artworkUrl(cover(), width as number)).toThrow(/^artwork: width must be a number above 0/);
    expect(() => artworkUrl(cover(), width as number)).toThrow(TypeError);
  });

  test.each(bad)("a height of %s is a TypeError naming height", (_name, height) => {
    expect(() => artworkUrl(cover(), 300, { height: height as number })).toThrow(/^artwork: height must be a number above 0/);
  });

  test.each([
    ["empty", ""],
    ["with a dot", "tar.gz"],
    ["with a slash", "jpg/../x"],
    ["with a space", "jpg 2x"],
    ["with a comma", "jpg,"],
    ["with a query", "jpg?x=1"],
    ["with a placeholder", "{w}"],
    ["with a replacement pattern", "$&"],
    ["not a string", 42],
    ["null", null],
  ])("a format or crop that is %s is a TypeError: it goes into the URL as it is", (_name, value) => {
    expect(() => artworkUrl(cover(), 300, { format: value as string })).toThrow(/^artwork: format must be letters and digits/);
    expect(() => artworkUrl(cover(), 300, { crop: value as string })).toThrow(/^artwork: crop must be letters and digits/);
  });

  test("a bad format or crop is refused even when the template has no place for it", () => {
    expect(() => artworkUrl(cover(), 300, { format: "a/b" })).toThrow(TypeError);
  });

  test.each<[string, unknown]>([
    ["undefined, as a resource without artwork gives", undefined],
    ["null", null],
    ["the template itself", TEMPLATE],
    ["a number", 42],
    ["an object without a url", { width: 300, height: 300 }],
    ["an object whose url is not a string", { url: new URL("https://example.com/{w}x{h}.jpg") }],
    ["an object whose url is empty", { url: "" }],
  ])("%s in place of the artwork is a TypeError", (_name, artwork) => {
    expect(() => artworkUrl(artwork as tArtworkSource, 300)).toThrow(/^artwork: expected an artwork object with a url/);
    expect(() => artworkSrcSet(artwork as tArtworkSource, 300)).toThrow(/^artwork: expected an artwork object with a url/);
  });

  test.each([null, "jpg", 42])("%j in place of the options is a TypeError", (options) => {
    expect(() => artworkUrl(cover(), 300, options as unknown as object)).toThrow(TypeError);
    expect(() => artworkSrcSet(cover(), 300, options as unknown as object)).toThrow(TypeError);
  });
});

/** `["300 1x", "600 2x"]` as the srcset of square images those sizes and densities. */
const squares = (...short: string[]) => short.map((c) => `${TEMPLATE.replace("{w}x{h}", `${c.split(" ")[0] ?? ""}x${c.split(" ")[0] ?? ""}`)} ${c.split(" ")[1] ?? ""}`).join(", ");

describe("artworkSrcSet: one candidate per density, labelled with the density asked for", () => {
  test("by default offers 1x, 2x and 3x", () => {
    expect(artworkSrcSet(cover(), 300)).toBe(squares("300 1x", "600 2x", "900 3x"));
  });

  test.each<[string, number, number[], string[]]>([
    ["one density", 300, [2], ["600 2x"]],
    ["two", 300, [1, 2], ["300 1x", "600 2x"]],
    ["fractional densities", 300, [1, 1.5, 2.25], ["300 1x", "450 1.5x", "675 2.25x"]],
    ["densities below one", 300, [0.5, 1], ["150 0.5x", "300 1x"]],
    ["densities in an order of the caller's choosing", 300, [3, 1, 2], ["900 3x", "300 1x", "600 2x"]],
    ["a density given twice", 300, [1, 2, 2, 1], ["300 1x", "600 2x"]],
    ["densities a hair apart", 1000, [1, 1.001, 2], ["1000 1x", "1001 1.001x", "2000 2x"]],
    ["a width that rounds down", 50.4, [1, 2, 3], ["50 1x", "101 2x", "151 3x"]],
    ["a width that rounds up", 66.6667, [1, 2, 3], ["67 1x", "133 2x", "200 3x"]],
    ["a width and density whose product rounds down", 45, [1, 1.25, 2], ["45 1x", "56 1.25x", "90 2x"]],
    ["a width below one pixel", 0.2, [1, 2, 3], ["1 1x"]],
  ])("with %s (width %s, densities %j) the candidates are %j", (_name, width, densities, expected) => {
    expect(artworkSrcSet(cover(), width, { densities })).toBe(squares(...expected));
  });

  test("whatever the width, each label is the density asked for and a screen of that density is given the image made for it", () => {
    for (let width = 20; width < 120; width += 0.37)
      for (const densities of [[1, 2, 3], [1, 1.25, 1.5, 2], [0.5, 1, 4]]) {
        const srcset = artworkSrcSet(cover(), width, { densities });
        const candidates = parseSrcset(srcset);
        expect(candidates.map((c) => c.descriptors.join())).toEqual(densities.map((density) => `${String(density)}x`));
        densities.forEach((density, i) => {
          expect(fetched(srcset, density)).toBe(candidates[i]?.url);
          expect(fetched(srcset, density, artworkUrl(cover(), width))).toBe(candidates[i]?.url);
        });
      }
  });

  test("the 1x candidate is the URL artworkUrl gives for the same width and options", () => {
    const options = { height: 200, format: "webp", crop: "cc" };
    const artwork = { url: "https://example.com/{w}x{h}{c}.{f}", width: 3000, height: 3000 };
    expect(parseSrcset(artworkSrcSet(artwork, 300, options))[0]?.url).toBe(artworkUrl(artwork, 300, options));
    expect(artworkSrcSet(artwork, 300, options)).toBe("https://example.com/300x200cc.webp 1x, https://example.com/600x400cc.webp 2x, https://example.com/900x600cc.webp 3x");
  });

  test("each candidate keeps the artwork's shape", () => {
    expect(artworkSrcSet({ url: "{w}x{h}", width: 1920, height: 1080 }, 320, { densities: [1, 2] })).toBe("320x180 1x, 640x360 2x");
  });

  test.each<[string, unknown]>([
    ["an empty list", []],
    ["a number, not a list", 2],
    ["a string", "1x, 2x"],
    ["null", null],
  ])("densities given as %s: %j is a TypeError, except null, which means the default", (_name, densities) => {
    const build = () => artworkSrcSet(cover(), 300, { densities: densities as number[] });
    if (densities === null) expect(build()).toBe(artworkSrcSet(cover(), 300));
    else expect(build).toThrow(/^artwork: densities must be a non-empty array/);
  });

  test.each<[string, unknown[]]>([
    ["a zero", [1, 0]],
    ["a negative", [-1]],
    ["NaN", [1, Number.NaN]],
    ["infinity", [Number.POSITIVE_INFINITY]],
    ["a string", [1, "2"]],
    ["a hole", new Array<number>(2)],
  ])("a density list holding %s is a TypeError naming the entry", (_name, densities) => {
    expect(() => artworkSrcSet(cover(), 300, { densities: densities as number[] })).toThrow(/^artwork: densities\[\d\] must be a number above 0/);
  });
});

describe("artworkSrcSet: where the artwork does not come large enough for a density", () => {
  test.each<[string, number, number, string[]]>([
    ["large enough for every density", 900, 300, ["300 1x", "600 2x", "900 3x"]],
    ["large enough for two", 600, 300, ["300 1x", "600 2x"]],
    ["between two densities", 500, 300, ["300 1x", "500 1.67x"]],
    ["exactly the width shown", 300, 300, ["300 1x"]],
    ["smaller than the width shown", 200, 300, ["200 0.667x"]],
    ["far smaller than the width shown", 1, 1000, ["1 0.001x"]],
    ["just large enough for a width that is not a whole number", 100, 33.3333, ["33 1x", "67 2x", "100 3x"]],
    ["a hair short of three times a width that is not a whole number", 100, 100 / 3, ["33 1x", "67 2x", "100 3x"]],
  ])("artwork %s (%i wide, shown at %s) offers %j: its largest once, under the density that image amounts to", (_name, side, width, expected) => {
    expect(artworkSrcSet(cover(side), width)).toBe(squares(...expected));
  });

  test.each([
    [1, "300x300"],
    [1.5, "500x500"],
    [2, "500x500"],
    [3, "500x500"],
  ])("a 500 pixel cover shown at 300: a screen of density %s is given the %s image", (dpr, expected) => {
    expect(size(fetched(artworkSrcSet(cover(500), 300), dpr) ?? "")).toBe(expected);
  });

  test.each<[string, number[], string]>([
    ["the image made for it first", [2, 3], "600 2x"],
    ["the artwork's largest first", [3, 2], "601 2x"],
  ])("two images that amount to one density are offered as one, the first: with %s, %j gives %s", (_name, densities, expected) => {
    // A 601 pixel cover at 300: the 3x box shrinks to 601 pixels, which is 2x to three figures, as the 600 pixel image is.
    expect(artworkSrcSet(cover(601), 300, { densities })).toBe(squares(expected));
  });

  test("a URL with no placeholders is offered once: every density would be the same image", () => {
    expect(artworkSrcSet({ url: "https://example.com/fixed.jpg" }, 300)).toBe("https://example.com/fixed.jpg 1x");
  });

  test("whatever the artwork, width and densities: no two candidates share a density or an image, and a browser accepts every one", () => {
    for (const side of [1, 7, 199, 300, 601, 3000])
      for (const width of [0.3, 1, 33, 100 / 3, 300, 1234])
        for (const densities of [[1, 2, 3], [0.3, 1, 1.5, 2, 3, 4.75], [3, 2, 1], [2, 2.0001, 2.0002]]) {
          const candidates = parseSrcset(artworkSrcSet(cover(side), width, { densities }));
          expect(candidates.length).toBeGreaterThan(0);
          expect(new Set(candidates.map((c) => c.url)).size).toBe(candidates.length);
          expect(new Set(candidates.map((c) => c.descriptors.join())).size).toBe(candidates.length);
          for (const { url, descriptors } of candidates) {
            expect(descriptors).toHaveLength(1);
            // What the browser model takes for a density: this candidate alone is fetched, so its label was read.
            expect(fetched(`${url} ${descriptors.join()}`, 1)).toBe(url);
          }
        }
  });
});

describe("one URL, whatever it holds: what artworkUrl gives is what the srcset carries and what a browser requests", () => {
  const hostile: [string, string][] = [
    ["a space", "https://example.com/a b/{w}x{h}.jpg"],
    ["several spaces", "https://example.com/a   b/{w}x{h}.jpg"],
    ["a space before a second URL and descriptor", "https://example.com/{w}x{h}.jpg 1x, https://evil.example/x.jpg 9x"],
    ["a tab", "https://example.com/a\tb/{w}x{h}.jpg"],
    ["a line feed", "https://example.com/a\nb/{w}x{h}.jpg"],
    ["a carriage return and line feed", "https://example.com/a\r\nb/{w}x{h}.jpg"],
    ["a form feed", "https://example.com/a\fb/{w}x{h}.jpg"],
    ["a space at the start", " https://example.com/{w}x{h}.jpg"],
    ["a space at the start and a way up out of the path", " https://example.com/../../api/logout?via={w}"],
    ["a tab inside the scheme", "ht\ttps://example.com/{w}x{h}.jpg"],
    ["a space at the end", "https://example.com/{w}x{h}.jpg "],
    ["a comma at the end", "https://example.com/{w}x{h}.jpg?ids=1,2,"],
    ["commas at the end", "https://example.com/{w}x{h}.jpg,,,"],
    ["a comma at the end of a fragment", "https://example.com/{w}x{h}.jpg#a,"],
    ["a comma at the start", ",https://example.com/{w}x{h}.jpg"],
    ["a comma then a space at the end", "https://example.com/{w}x{h}.jpg, "],
    ["a space then a comma at the start", " ,https://example.com/{w}x{h}.jpg"],
    ["a comma in the middle", "https://example.com/w_{w},h_{h}/cover.jpg"],
    ["an open parenthesis", "https://example.com/{w}x{h}(1.jpg"],
    ["a data URL", "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}'/>"],
    ["nothing but a comma", ","],
  ];
  const filled = (url: string) => url.replaceAll("{w}", "300").replaceAll("{h}", "300");

  test.each(hostile)("a URL with %s is one candidate per density, each with one density descriptor", (_name, url) => {
    const candidates = parseSrcset(artworkSrcSet({ url }, 300, { densities: [1, 2] }));
    expect(candidates.map((c) => c.descriptors)).toEqual([["1x"], ["2x"]].slice(0, candidates.length));
    expect(candidates).toHaveLength(url.includes("{w}") ? 2 : 1);
  });

  test.each(hostile)("a URL with %s is carried by the srcset character for character as artworkUrl gives it", (_name, url) => {
    expect(parseSrcset(artworkSrcSet({ url }, 300, { densities: [1] }))[0]?.url).toBe(artworkUrl({ url }, 300));
  });

  test.each(hostile.filter(([name]) => name !== "a data URL"))("a URL with %s requests, as src and as srcset, what a browser would request for the URL as given", (_name, url) => {
    expect(requested(artworkUrl({ url }, 300))).toBe(requested(filled(url)));
  });

  test("a data URL holds the same data, its spaces written as a URL writes them", () => {
    const url = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}'/>";
    expect(decodeURIComponent(artworkUrl({ url }, 300))).toBe(filled(url));
  });

  test("a URL that would pass a check of its host as given cannot point a srcset somewhere else", () => {
    const url = " https://img.example/../../api/logout?via={w}";
    expect(new URL(url).host).toBe("img.example");
    for (const candidate of parseSrcset(artworkSrcSet({ url }, 300))) expect(new URL(candidate.url, BASE).host).toBe("img.example");
  });

  test.each([
    ["nothing but white space", " \t\n"],
    ["nothing but control characters", `${NUL}${UNIT_SEPARATOR}`],
  ])("a URL of %s is no URL: a TypeError, as for an artwork without one", (_name, url) => {
    expect(() => artworkUrl({ url }, 300)).toThrow(/^artwork: expected an artwork object with a url/);
    expect(() => artworkSrcSet({ url }, 300)).toThrow(/^artwork: expected an artwork object with a url/);
  });
});

describe("the artwork and the options are each read once, so an object that changes its answer cannot change the result", () => {
  /** An object whose properties count how often they are read, and answer `later` from the second time on. */
  function counted<T extends object>(first: T, later: Partial<Record<keyof T, unknown>> = {}) {
    const reads: Partial<Record<keyof T, number>> = {};
    const object = {} as T;
    for (const key of Object.keys(first) as (keyof T)[])
      Object.defineProperty(object, key, {
        enumerable: true,
        get: () => {
          const count = (reads[key] ?? 0) + 1;
          reads[key] = count;
          return count > 1 && key in later ? later[key] : first[key];
        },
      });
    return { object, reads };
  }
  const smuggled = { replaceAll: () => smuggled, replace: () => "x 1x, https://evil.example/smuggled.gif 9x", toString: () => "https://evil.example/" };

  test.each([
    ["artworkUrl", (artwork: tArtworkSource, options: object) => artworkUrl(artwork, 300, options)],
    ["artworkSrcSet", (artwork: tArtworkSource, options: object) => artworkSrcSet(artwork, 300, options)],
  ])("%s reads each property of the artwork and of the options exactly once", (_name, call) => {
    const artwork = counted<tArtworkSource>({ url: TEMPLATE, width: 3000, height: 3000 });
    const options = counted({ height: 300, format: "jpg", crop: "bb", densities: [1, 2] });
    call(artwork.object, options.object);
    expect(artwork.reads).toEqual({ url: 1, width: 1, height: 1 });
    for (const count of Object.values(options.reads)) expect(count).toBe(1);
  });

  test("a url that is a template when checked and something else afterwards is used as it was when checked", () => {
    const { object } = counted<tArtworkSource>({ url: TEMPLATE, width: 3000, height: 3000 }, { url: smuggled });
    expect(artworkUrl(object, 300)).toBe(TEMPLATE.replace("{w}x{h}", "300x300"));
    const again = counted<tArtworkSource>({ url: TEMPLATE, width: 3000, height: 3000 }, { url: smuggled });
    expect(artworkSrcSet(again.object, 300, { densities: [1] })).toBe(`${TEMPLATE.replace("{w}x{h}", "300x300")} 1x`);
  });

  test("a size that is usable when checked and absurd afterwards does not reach the URL", () => {
    const { object } = counted<tArtworkSource>({ url: TEMPLATE, width: 600, height: 600 }, { width: 1e9, height: 1e9 });
    expect(size(artworkUrl(object, 5000))).toBe("600x600");
  });

  test("a density list that grows as it is read is read to the length it had, and no further", () => {
    let lengthReads = 0;
    // Six densities, behind a length that says two the first time it is asked and one more each time after.
    const growing = new Proxy([1, 2, 3, 4, 5, 6], {
      get: (list, key, receiver): unknown => (key === "length" ? ++lengthReads + 1 : Reflect.get(list, key, receiver)),
    });
    expect(parseSrcset(artworkSrcSet(cover(), 100, { densities: growing })).map((c) => c.descriptors[0])).toEqual(["1x", "2x"]);
    expect(lengthReads).toBe(1);
  });
});

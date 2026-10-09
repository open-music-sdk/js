import type { tArtwork } from "@open-music-sdk/types";
import { describe, expect, test, vi } from "vitest";
import { artworkImage, artworkSrcSet, artworkUrl, fit, normalise, type tArtworkOptions, type tArtworkSource, type tArtworkSrcSetOptions } from "./artwork.js";

const TEMPLATE = "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/ef/cover.jpg/{w}x{h}bb.jpg";
/** A square cover as the API gives it, `side` pixels at its largest. */
const cover = (side = 3000): tArtworkSource => ({ url: TEMPLATE, width: side, height: side });
/** The `{w}x{h}` a URL's file name was filled in with. */
const size = (url: string) => /\/(\d+x\d+)[^/]*$/.exec(url)?.[1];

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

  // What a template becomes if it is put through a URL parser on its way here: new URL(template).href.
  test.each([
    ["every brace encoded", "https://example.com/%7Bw%7Dx%7Bh%7Dbb.jpg", "https://example.com/300x300bb.jpg"],
    ["the hex in small letters", "https://example.com/%7bw%7dx%7bh%7dbb.jpg", "https://example.com/300x300bb.jpg"],
    ["one placeholder encoded and one not", "https://example.com/%7Bw%7Dx{h}bb.jpg", "https://example.com/300x300bb.jpg"],
    ["the open crop and format encoded too", "https://example.com/%7Bw%7Dx%7Bh%7D%7Bc%7D.%7Bf%7D", "https://example.com/300x300bb.jpg"],
    ["an encoded placeholder in the query", "https://example.com/cover.jpg?w=%7Bw%7D", "https://example.com/cover.jpg?w=300"],
  ])("a template with %s is the same template, and is filled in", (_name, url, expected) => {
    expect(artworkUrl({ url, width: 3000, height: 3000 }, 300)).toBe(expected);
  });

  test("a template as a URL parser writes it is filled in exactly as the template itself is, format and crop included", () => {
    const options: tArtworkOptions = { format: "webp", crop: "cc", height: 150 };
    expect(new URL(TEMPLATE).href).not.toBe(TEMPLATE);
    expect(artworkUrl({ ...cover(), url: new URL(TEMPLATE).href }, 300, options)).toBe(artworkUrl(cover(), 300, options));
    expect(artworkSrcSet({ ...cover(), url: new URL(TEMPLATE).href }, 300, options)).toBe(artworkSrcSet(cover(), 300, options));
  });

  test.each([
    ["a capital letter", "https://example.com/%7BW%7Dx%7BH%7D.jpg"],
    ["another letter", "https://example.com/%7Bx%7D.jpg"],
    ["the percent signs encoded as well", "https://example.com/%257Bw%257D.jpg"],
    ["one brace of the pair encoded", "https://example.com/%7Bw}.jpg"],
    ["other encoded characters around a real name", "https://example.com/%5Bw%5D.jpg"],
  ])("what only looks like an encoded placeholder, with %s, is left as it is", (_name, url) => {
    expect(artworkUrl({ url }, 300)).toBe(url);
  });

  test("a tArtwork from the generated types is accepted as it is", () => {
    const artwork: tArtwork = { url: TEMPLATE, width: 3000, height: 3000, bgColor: "1a1a1a", textColor1: "ffffff" };
    expect(size(artworkUrl(artwork, 300))).toBe("300x300");
  });

  test("the artwork and the options are only read: frozen ones give what unfrozen ones do", () => {
    const [artwork, options] = [{ url: TEMPLATE, width: 3000, height: 3000 }, { height: 150, format: "webp", crop: "cc", densities: [1, 2], hosts: ["mzstatic.com"] }] as const;
    const frozen = [Object.freeze({ ...artwork }), Object.freeze({ ...options, densities: Object.freeze([...options.densities]), hosts: Object.freeze([...options.hosts]) })] as const;
    expect(artworkUrl(frozen[0], 300, frozen[1])).toBe(artworkUrl(artwork, 300, options));
    expect(artworkSrcSet(frozen[0], 300, frozen[1])).toBe(artworkSrcSet(artwork, 300, options));
    expect(artworkImage(frozen[0], 300, frozen[1])).toEqual(artworkImage(artwork, 300, options));
  });

  test("an artwork whose properties cannot be written still works, and any write to it would have thrown", () => {
    const written = vi.fn(() => true);
    const artwork = new Proxy<tArtworkSource>({ url: TEMPLATE, width: 3000, height: 3000 }, { set: written, defineProperty: written, deleteProperty: written });
    artworkImage(artwork, 300);
    expect(written).not.toHaveBeenCalled();
  });
});

describe("artworkUrl: format and crop say how the image is encoded and cut, wherever the template says it", () => {
  const HOST = "https://example.com/thumb/cover.jpg/";
  type tCase = [template: string, options: tArtworkOptions, expected: string];

  test.each<tCase>([
    ["{w}x{h}bb.jpg", {}, "300x300bb.jpg"],
    ["{w}x{h}bb.jpg", { format: "webp" }, "300x300bb.webp"],
    ["{w}x{h}bb.jpg", { crop: "cc" }, "300x300cc.jpg"],
    ["{w}x{h}bb.jpg", { format: "png", crop: "sr" }, "300x300sr.png"],
    ["{w}x{h}bb.jpg", { format: undefined, crop: undefined }, "300x300bb.jpg"],
    ["{w}x{h}bb.jpeg", { format: "heic" }, "300x300bb.heic"],
    ["{w}x{h}bb.png", {}, "300x300bb.png"],
    ["{w}x{h}cc.jpg", { crop: "bb" }, "300x300bb.jpg"],
    ["{w}x{h}SC.DN01.jpg", { format: "webp" }, "300x300SC.DN01.webp"],
    ["{w}x{h}SC.DN01.jpg", { crop: "bb" }, "300x300bb.jpg"],
    ["{w}x{h}bb-60.jpg", { crop: "bb" }, "300x300bb.jpg"],
    ["{w}x{h}.jpg", { crop: "bb", format: "webp" }, "300x300bb.webp"],
  ])("a template that names them, %s, given %j, is %s", (template, options, expected) => {
    expect(artworkUrl({ url: HOST + template }, 300, options)).toBe(HOST + expected);
  });

  test.each<tCase>([
    ["{w}x{h}{c}.{f}", {}, "300x300bb.jpg"],
    ["{w}x{h}{c}.{f}", { format: "webp" }, "300x300bb.webp"],
    ["{w}x{h}{c}.{f}", { crop: "cc" }, "300x300cc.jpg"],
    ["{w}x{h}{c}.{f}", { format: "png", crop: "sr" }, "300x300sr.png"],
    ["{w}x{h}bb.{f}", {}, "300x300bb.jpg"],
    ["{w}x{h}bb.{f}", { format: "webp", crop: "cc" }, "300x300cc.webp"],
    ["{w}x{h}{c}.jpg", { format: "webp", crop: "cc" }, "300x300cc.webp"],
    ["{w}x{h}SC.DN01.{f}?l=en-US", {}, "300x300SC.DN01.jpg?l=en-US"],
    ["{w}x{h}SC.DN01.{f}?l=en-US", { format: "webp", crop: "bb" }, "300x300bb.webp?l=en-US"],
    ["{w}x{h}{c}-60.{f}", { crop: "cc" }, "300x300cc-60.jpg"],
  ])("a template that leaves them open, %s, given %j, is %s", (template, options, expected) => {
    expect(artworkUrl({ url: HOST + template }, 300, options)).toBe(HOST + expected);
  });

  test.each<tCase>([
    ["{w}x{h}bb.jpg?size=1.5&next=/a/b.png#top.left", { format: "webp" }, "300x300bb.webp?size=1.5&next=/a/b.png#top.left"],
    ["{w}x{h}bb.jpg#a/b.c", { crop: "cc" }, "300x300cc.jpg#a/b.c"],
    ["{w}x{h}bb.jpg?w={w}&f={f}&c={c}", { format: "png", crop: "sr" }, "300x300sr.png?w=300&f=png&c=sr"],
  ])("only the file name is written over: what follows it in %s is kept, and filled in where it has placeholders", (template, options, expected) => {
    expect(artworkUrl({ url: HOST + template }, 300, options)).toBe(HOST + expected);
  });

  test.each([
    ["no size at all", "https://example.com/fixed.jpg", "https://example.com/fixed.jpg"],
    ["its size in an earlier part of the path", "https://example.com/{w}x{h}/cover.jpg", "https://example.com/300x300/cover.jpg"],
    ["its size after the start of the file name", "https://example.com/cover-{w}x{h}bb.jpg", "https://example.com/cover-300x300bb.jpg"],
    ["its width and height apart", "https://example.com/w_{w},h_{h}/cover.jpg", "https://example.com/w_300,h_300/cover.jpg"],
    ["no dot after the size", "https://example.com/{w}x{h}bb", "https://example.com/300x300bb"],
    ["nothing after the dot", "https://example.com/{w}x{h}bb.", "https://example.com/300x300bb."],
    ["its size only in the query", "https://example.com/cover.jpg?size={w}x{h}bb.jpg", "https://example.com/cover.jpg?size=300x300bb.jpg"],
  ])("a URL with %s does not say how the image is cut or encoded, so format and crop leave it as it is", (_name, url, expected) => {
    expect(artworkUrl({ url }, 300, { format: "webp", crop: "cc" })).toBe(expected);
  });

  test("a srcset is cut and encoded the same way in every candidate", () => {
    expect(artworkSrcSet(cover(), 300, { format: "webp", crop: "cc", densities: [1, 2] })).toBe(squares("300 1x", "600 2x").replaceAll("bb.jpg", "cc.webp"));
  });

  test.each(["jpg", "jpeg", "png", "webp", "heic", "heif"] as const)("%s is a format the image server converts to", (format) => {
    expect(artworkUrl(cover(), 300, { format })).toBe(TEMPLATE.replace("{w}x{h}bb.jpg", `300x300bb.${format}`));
  });

  test.each([
    ["one the server answers 400 to", "avif"],
    ["another", "bmp"],
    ["one it answers with a JPEG under that name", "gif"],
    ["another", "tiff"],
    ["a known one in capitals", "JPG"],
    ["a known one with a dot", ".jpg"],
    ["a known one with a space", "jpg "],
    ["empty", ""],
    ["a placeholder", "{f}"],
    ["a replacement pattern", "$&"],
    ["a path", "jpg/../x"],
    ["a number", 42],
    ["null", null],
    ["a list holding a known one", ["jpg"]],
  ])("a format that is %s, %j, is a TypeError that lists the formats", (_name, format) => {
    expect(() => artworkUrl(cover(), 300, { format: format as "jpg" })).toThrow(/^artwork: format must be one of jpg, jpeg, png, webp, heic, heif$/);
  });

  test.each(["bb", "cc", "sr", "w", "h", "bf", "FA01", "bb-60", "cc-60", "SC.DN01", "SH.FPTSW02", "SC.FPESS04"])("%s is accepted as a crop code, as Apple's own are", (crop) => {
    expect(artworkUrl(cover(), 300, { crop })).toBe(TEMPLATE.replace("{w}x{h}bb", `300x300${crop}`));
  });

  test.each([
    ["empty", ""],
    ["a lone dot", "."],
    ["ending in a dot", "bb."],
    ["starting with a dot", ".bb"],
    ["with two dots together", "SC..DN01"],
    ["with two hyphens together", "bb--60"],
    ["with a slash", "bb/../x"],
    ["with a space", "bb 2x"],
    ["with a comma", "bb,"],
    ["with a query", "bb?x=1"],
    ["with a fragment", "bb#x"],
    ["with a percent sign", "bb%2F"],
    ["with a letter outside ASCII", "bé"],
    ["a placeholder", "{w}"],
    ["a replacement pattern", "$&"],
    ["a number", 42],
    ["null", null],
  ])("a crop that is %s, %j, is a TypeError: it goes into the file name as it is", (_name, crop) => {
    expect(() => artworkUrl(cover(), 300, { crop: crop as string })).toThrow(/^artwork: crop must be a crop code/);
  });

  test.each([1, 2, 10, 32])("a crop code of %i characters is accepted", (count) => {
    const crop = "a".repeat(count);
    expect(artworkUrl(cover(), 300, { crop })).toBe(TEMPLATE.replace("{w}x{h}bb", `300x300${crop}`));
  });

  test.each([33, 1000, 10_000_000])("a crop code of %i characters is refused, and quickly", (count) => {
    const start = performance.now();
    expect(() => artworkUrl(cover(), 300, { crop: "a".repeat(count) })).toThrow(/^artwork: crop must be a crop code: at most 32/);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("a URL grows by no more than the crop and format it is given: a template of nothing but placeholders comes out eleven times its length at most", () => {
    const url = `https://example.com/${"{c}{f}{w}{h}".repeat(10_000)}`;
    const out = artworkUrl({ url }, 9_999_999, { crop: "a".repeat(32), format: "jpeg" });
    expect(out.length).toBeLessThanOrEqual(url.length * 11);
    expect(out.length).toBeGreaterThan(url.length);
  });

  test.each([{ format: "a/b" }, { crop: "a/b" }])("%j is refused even for a URL with no place for it", (options) => {
    expect(() => artworkUrl({ url: "https://example.com/fixed.jpg" }, 300, options as tArtworkOptions)).toThrow(TypeError);
  });
});

describe("artworkUrl: the image keeps the artwork's shape unless a height says otherwise", () => {
  test.each([
    ["landscape 16:9", 1920, 1080, 320, "320x180"],
    ["portrait 2:3", 2000, 3000, 300, "300x450"],
    ["a wide banner", 4320, 1080, 400, "400x100"],
    ["a shape whose height falls just above a whole pixel", 1000, 333, 100, "100x34"],
    ["a shape whose height falls just below one", 1000, 667, 100, "100x67"],
    ["a wide still, as Apple's server was asked for it", 3701, 1912, 150, "150x78"],
    ["the same still, wider", 3701, 1912, 320, "320x166"],
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
    ["a zero size", { width: 0, height: 0 }],
    ["a negative size", { width: -1920, height: -1080 }],
    ["a size that is not a number", { width: Number.NaN, height: Number.NaN }],
    ["an infinite size", { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }],
    ["a size given as text", { width: "1920", height: "1080" } as unknown as Partial<tArtworkSource>],
  ])("artwork with %s has no known shape or size: the image is square, and held only to what the image server gives", (_name, known) => {
    expect(size(artworkUrl({ url: TEMPLATE, ...known }, 5000))).toBe("5000x5000");
    expect(size(artworkUrl({ url: TEMPLATE, ...known }, 50_000))).toBe("10000x10000");
  });

  test.each<[string, Partial<tArtworkSource>, string]>([
    ["only its width", { width: 1920 }, "1920x1920"],
    ["only its height", { height: 1080 }, "1080x1080"],
    ["its width, and a height that is no size", { width: 1920, height: null }, "1920x1920"],
    ["its height, and a width that is no size", { width: 0, height: 1080 }, "1080x1080"],
  ])("artwork that says %s has no known shape, so the image is square, but it is not asked for larger than that side", (_name, known, expected) => {
    expect(size(artworkUrl({ url: TEMPLATE, ...known }, 5000))).toBe(expected);
    expect(size(artworkUrl({ url: TEMPLATE, ...known }, 300))).toBe("300x300");
  });

  test("a srcset for artwork with no size stops at the image server's limit, under the density that amounts to", () => {
    expect(artworkSrcSet({ url: TEMPLATE }, 4000)).toBe(squares("4000 1x", "8000 2x", "10000 2.5x"));
  });
});

describe("fit", () => {
  type tCase = [name: string, box: [number, number], max: [number, number] | undefined, expected: string, shrunk: boolean];
  const run = ([, [width, height], max, expected, shrunk]: tCase, placement: "inside" | "fill") => {
    const got = fit({ width, height }, max ? { width: max[0], height: max[1] } : {}, placement);
    expect(`${String(got.width)}x${String(got.height)}`).toBe(expected);
    if (shrunk) expect(got.scale).toBeLessThan(1);
    else expect(got.scale).toBe(1);
  };

  test.each<tCase>([
    ["a box well inside the artwork", [300, 300], [1000, 1000], "300x300", false],
    ["a box exactly the artwork's size", [1000, 1000], [1000, 1000], "1000x1000", false],
    ["a box of another shape, inside the artwork", [800, 200], [1000, 1000], "800x200", false],
    ["artwork with no size", [5000, 3000], undefined, "5000x3000", false],
  ])("%s is asked for as it is, whichever way the image is cut", (...row) => {
    run(row, "fill");
    run(row, "inside");
  });

  test.each<tCase>([
    ["one pixel too large each way", [1001, 1001], [1000, 1000], "1000x1000", true],
    ["twice too large", [2000, 2000], [1000, 1000], "1000x1000", true],
    ["too large, on landscape artwork", [3840, 2160], [1920, 1080], "1920x1080", true],
    ["too large, on portrait artwork", [4000, 6000], [2000, 3000], "2000x3000", true],
  ])("a box of the artwork's own shape, %s, shrinks to the artwork, whichever way the image is cut", (...row) => {
    run(row, "fill");
    run(row, "inside");
  });

  test.each<tCase>([
    ["too wide only", [2000, 500], [1000, 1000], "1000x250", true],
    ["too tall only", [500, 2000], [1000, 1000], "250x1000", true],
    ["too large both ways, by different amounts", [4000, 1000], [1000, 500], "1000x250", true],
    ["a square on landscape artwork, too tall only", [1500, 1500], [1920, 1080], "1080x1080", true],
  ])("an image that fills a box %s: the box shrinks, in its own shape, until the artwork covers it", (...row) => {
    run(row, "fill");
  });

  // Each of these was asked of Apple's image server for a 1500 pixel square cover, and one for a 3701 by 1912 still.
  test.each<tCase>([
    ["a wide box the image stands inside at 300 pixels", [1200, 300], [1500, 1500], "1200x300", false],
    ["the same at twice the density", [2400, 600], [1500, 1500], "2400x600", false],
    ["the same at three times", [3600, 900], [1500, 1500], "3600x900", false],
    ["a wide box the image stands inside at exactly its full size", [6000, 1500], [1500, 1500], "6000x1500", false],
    ["a wide box that would hold the image larger than it comes", [7200, 1800], [1500, 1500], "6000x1500", true],
    ["a tall box that would", [1800, 7200], [1500, 1500], "1500x6000", true],
    ["a square box on a wide still, too tall only", [2000, 2000], [3701, 1912], "2000x2000", false],
    ["a square box on a wide still, too large both ways", [4000, 4000], [3701, 1912], "3701x3701", true],
  ])("an image fitted inside %s: the box shrinks only once the image inside it would be larger than the artwork", (...row) => {
    run(row, "inside");
  });

  test.each<[string, number, [number, number], string]>([
    ["a square", 300, [3000, 3000], "300x300"],
    ["16:9, where the height is a whole number", 320, [1920, 1080], "320x180"],
    ["16:9, where it is not", 300, [1920, 1080], "300x169"],
    ["2:3", 300, [2000, 3000], "300x450"],
    ["a wide still", 150, [3701, 1912], "150x78"],
    ["a wide still, larger", 1000, [3701, 1912], "1000x517"],
    ["a width that is not a whole number", 33.3, [1920, 1080], "33x19"],
    ["a width that rounds up", 150.6, [3701, 1912], "151x79"],
  ])("with no height, the box takes the artwork's shape (%s): %s wide on %j is %s", (_name, width, [maxWidth, maxHeight], expected) => {
    for (const placement of ["fill", "inside"] as const) {
      const got = fit({ width }, { width: maxWidth, height: maxHeight }, placement);
      expect(`${String(got.width)}x${String(got.height)}`).toBe(expected);
    }
  });

  test.each<[string, number, [number, number], string]>([
    ["wider than a wide still", 4000, [3701, 1912], "3701x1912"],
    ["far wider than a cover", 99_999, [1500, 1500], "1500x1500"],
    ["wider than tall artwork", 5000, [600, 900], "600x900"],
    ["a hair wider than a still whose shape does not divide evenly", 3702, [3701, 1912], "3701x1912"],
    // 1400 times 933/1400 is 933.0000000000001 in floating point, which rounded up as it stands is 934.
    ["exactly as wide as artwork whose height the arithmetic lands a hair above", 1400, [1400, 933], "1400x933"],
    ["twice as wide as that artwork", 2800, [1400, 933], "1400x933"],
  ])("with no height, a box %s shrinks to exactly the artwork's size: %s on %j is %s", (_name, width, [maxWidth, maxHeight], expected) => {
    for (const placement of ["fill", "inside"] as const) {
      const got = fit({ width }, { width: maxWidth, height: maxHeight }, placement);
      expect(`${String(got.width)}x${String(got.height)}`).toBe(expected);
    }
  });

  test("with no height and no shape to take, the box is square", () => {
    expect(fit({ width: 300 }, {}, "inside")).toMatchObject({ width: 300, height: 300 });
    expect(fit({ width: 300 }, { width: 1920 }, "fill")).toMatchObject({ width: 300, height: 300 });
    expect(fit({ width: 299.6 }, {}, "fill")).toMatchObject({ width: 300, height: 300 });
  });

  test.each([
    [100.4, 50.4, "100x50"],
    [100.5, 50.5, "101x51"],
    [100, 49.5, "100x50"],
    [100, 50.49, "100x50"],
  ])("a height that was asked for is rounded to the nearest pixel, like the width: %s by %s is %s", (width, height, expected) => {
    const got = fit({ width, height }, {}, "inside");
    expect(`${String(got.width)}x${String(got.height)}`).toBe(expected);
  });

  // 150x77bb comes back from Apple's server 149 by 77, and 150x78bb comes back 150 by 77.
  test("whatever the artwork and the width, a height that follows from the width never makes the image narrower than the width", () => {
    for (const [maxWidth, maxHeight] of [[3701, 1912], [1920, 1080], [600, 900], [1000, 333], [1000, 667], [4320, 1080], [7, 3]] as const)
      for (let wanted = 1; wanted < 700; wanted += 6.31) {
        const { width, height } = fit({ width: wanted }, { width: maxWidth, height: maxHeight }, "inside");
        // Fitted inside width by height, the artwork is as wide as the box unless the box is too short for that.
        expect(height / maxHeight).toBeGreaterThanOrEqual(width / maxWidth - 1e-9);
        // And the height is the least that does it, so nothing is asked for that is not shown.
        if (height > 1 && width < maxWidth) expect((height - 1) / maxHeight).toBeLessThan(width / maxWidth);
      }
  });

  // 150x300cc and 300x150cc both come back from Apple's server 300 by 300, and 400x100cc comes back 400 by 400,
  // from a square cover and from a 3701 by 1912 still alike; 1600x1600cc of a 1500 pixel cover comes back enlarged.
  test.each<[string, { width: number; height?: number }, { width?: number; height?: number }, string, boolean]>([
    ["a wide box", { width: 300, height: 150 }, { width: 1500, height: 1500 }, "300x300", false],
    ["a tall box", { width: 150, height: 300 }, { width: 1500, height: 1500 }, "300x300", false],
    ["a banner", { width: 400, height: 100 }, { width: 3701, height: 1912 }, "400x400", false],
    ["a width alone, on artwork that is not square", { width: 320 }, { width: 3701, height: 1912 }, "320x320", false],
    ["a width alone, on artwork with no size", { width: 320 }, {}, "320x320", false],
    ["a square the artwork's shorter side can just give", { width: 1912, height: 1000 }, { width: 3701, height: 1912 }, "1912x1912", false],
    ["a box longer than the artwork's shorter side", { width: 3000, height: 1000 }, { width: 3701, height: 1912 }, "1912x1912", true],
    ["a box longer than a tall artwork's shorter side", { width: 800 }, { width: 600, height: 900 }, "600x600", true],
    ["a box longer than a cover", { width: 2000 }, { width: 1500, height: 1500 }, "1500x1500", true],
    ["a box longer than the one side the artwork gives", { width: 5000, height: 100 }, { width: 1920 }, "1920x1920", true],
    ["a box longer than the one side it gives, the other way", { width: 100, height: 5000 }, { height: 1080 }, "1080x1080", true],
    ["a box longer than the image server gives", { width: 100, height: 12_000 }, {}, "10000x10000", true],
  ])("a crop that makes a square: %s, %j on %j, is asked for as the square %s", (_name, box, max, expected, shrunk) => {
    const got = fit(box, max, "square");
    expect(`${String(got.width)}x${String(got.height)}`).toBe(expected);
    expect(got.scale < 1).toBe(shrunk);
  });

  test("a crop that makes a square is never asked for longer than the artwork's shorter side, whatever the box", () => {
    for (const [maxWidth, maxHeight] of artworks)
      for (const box of boxes) {
        const { width, height } = fit({ width: box[0], height: box[1] }, { width: maxWidth, height: maxHeight }, "square");
        expect(width).toBe(height);
        expect(width).toBe(Math.min(Math.max(...box), maxWidth, maxHeight));
      }
  });

  test("a box shrunk to nothing is one pixel a side, not none", () => {
    expect(fit({ width: 3000, height: 1 }, { width: 100, height: 100 }, "fill")).toMatchObject({ width: 100, height: 1 });
    expect(fit({ width: 0.2, height: 0.2 }, {}, "inside")).toMatchObject({ width: 1, height: 1 });
  });

  test.each<[string, [number, number], { width?: number; height?: number }, string]>([
    ["only its width, and a box too wide", [5000, 5000], { width: 1920 }, "1920x1920"],
    ["only its width, and a box too wide by less", [3000, 1000], { width: 1500 }, "1500x500"],
    ["only its width, and a box that is only tall", [1000, 9000], { width: 1920 }, "1000x9000"],
    ["only its height, and a box too tall", [5000, 5000], { height: 1080 }, "1080x1080"],
    ["only its height, and a box that is only wide", [9000, 1000], { height: 1080 }, "9000x1000"],
    ["only its width, and a box inside it", [300, 300], { width: 1920 }, "300x300"],
  ])("artwork that says %s: the box %j is held to the side that is known, whichever way the image is cut", (_name, [width, height], max, expected) => {
    for (const placement of ["fill", "inside"] as const) {
      const got = fit({ width, height }, max, placement);
      expect(`${String(got.width)}x${String(got.height)}`).toBe(expected);
      expect(got.scale < 1).toBe(expected !== `${String(width)}x${String(height)}`);
    }
  });

  // Apple's image server answers 10000x100 and refuses 10001x100, and 100x10001.
  test.each<[string, [number, number], { width?: number; height?: number }, "inside" | "fill", string]>([
    ["exactly the limit, on artwork with no size", [10_000, 10_000], {}, "fill", "10000x10000"],
    ["one pixel past it", [10_001, 10_001], {}, "fill", "10000x10000"],
    ["far past it", [120_000, 120_000], {}, "fill", "10000x10000"],
    ["past it one way only", [20_000, 5000], {}, "fill", "10000x2500"],
    ["past it the other way only", [5000, 20_000], {}, "inside", "2500x10000"],
    ["past it, on artwork that says it comes larger still", [15_000, 15_000], { width: 20_000, height: 20_000 }, "fill", "10000x10000"],
    ["past it one way, around an image that would fit inside", [40_000, 10_000], { width: 9000, height: 9000 }, "inside", "10000x2500"],
    ["inside it, around an image at its full size", [9000, 3000], { width: 3000, height: 3000 }, "inside", "9000x3000"],
  ])("no side is asked for past the 10,000 pixels the image server gives: %s", (_name, [width, height], max, placement, expected) => {
    const got = fit({ width, height }, max, placement);
    expect(`${String(got.width)}x${String(got.height)}`).toBe(expected);
    expect(got.scale < 1).toBe(expected !== `${String(width)}x${String(height)}`);
  });

  /** Whether `w` by `h` is the box `[width, height]` scaled by some one factor, to within the half pixel that rounding costs each side. */
  const sameShape = (w: number, h: number, [width, height]: readonly [number, number]) => (w - 0.5) / width <= (h + 0.5) / height && (h - 0.5) / height <= (w + 0.5) / width;

  test("the check of shape used below can fail: a square is not the shape of a banner", () => {
    expect(sameShape(100, 100, [400, 100])).toBe(false);
    expect(sameShape(400, 100, [4000, 1000])).toBe(true);
    expect(sameShape(7, 1, [4096, 1])).toBe(false);
  });

  const artworks = [[3000, 3000], [1920, 1080], [600, 900], [3701, 1912], [50, 40]] as const;
  const boxes = [[1, 1], [37, 37], [300, 150], [150, 300], [1000, 1000], [4096, 512], [512, 4096], [9000, 9000]] as const;

  test("across artworks and boxes, an image that fills the box is never asked for larger than the artwork either way, and the box keeps its shape", () => {
    for (const [maxWidth, maxHeight] of artworks)
      for (const box of boxes) {
        const { width, height } = fit({ width: box[0], height: box[1] }, { width: maxWidth, height: maxHeight }, "fill");
        expect(width).toBeLessThanOrEqual(maxWidth);
        expect(height).toBeLessThanOrEqual(maxHeight);
        if (width > 1 && height > 1) expect(sameShape(width, height, box)).toBe(true);
      }
  });

  test("across artworks and boxes, an image fitted inside the box comes back no larger than the artwork, at its full size if the box had to shrink, and the box keeps its shape", () => {
    for (const [maxWidth, maxHeight] of artworks)
      for (const box of boxes) {
        const { width, height, scale } = fit({ width: box[0], height: box[1] }, { width: maxWidth, height: maxHeight }, "inside");
        // What the server sends back is the artwork scaled to stand inside the box asked for: this is by how much.
        const sent = Math.min(width / maxWidth, height / maxHeight);
        const pixel = 1 / Math.min(maxWidth, maxHeight);
        expect(sent).toBeLessThanOrEqual(1 + pixel);
        if (scale < 1) expect(sent).toBeGreaterThanOrEqual(1 - pixel);
        else expect([width, height]).toEqual(box);
        if (width > 1 && height > 1) expect(sameShape(width, height, box)).toBe(true);
      }
  });
});

describe("artworkUrl and artworkSrcSet: nothing larger than the artwork comes is asked for", () => {
  test.each([
    ["exactly the largest", 600, "600x600"],
    ["one pixel more", 601, "600x600"],
    ["far more", 10_000, "600x600"],
  ])("%s: a 600 pixel cover asked for at %i is %s", (_name, width, expected) => {
    expect(size(artworkUrl(cover(600), width))).toBe(expected);
  });

  test("more, on landscape artwork, is the artwork's own size", () => {
    expect(size(artworkUrl({ url: TEMPLATE, width: 1920, height: 1080 }, 4000))).toBe("1920x1080");
  });

  // Under bb, Apple's server answers 1200x300 for a 1500 pixel cover with a 300 pixel image, and 3600x900 with a 900 pixel one.
  test("a wide slot for a square cover gets the sharper images the artwork has, not a box shrunk as if the cover filled it", () => {
    expect(artworkSrcSet(cover(1500), 1200, { height: 300 })).toBe(
      ["1200x300 1x", "2400x600 2x", "3600x900 3x"].map((c) => `${TEMPLATE.replace("{w}x{h}", c.split(" ")[0] ?? "")} ${c.split(" ")[1] ?? ""}`).join(", "),
    );
    expect(size(artworkUrl(cover(1500), 3000, { height: 750 }))).toBe("3000x750");
  });

  test("past the artwork's full size, the slot's largest image is offered once, under the density it amounts to", () => {
    const candidates = parseSrcset(artworkSrcSet(cover(1500), 1200, { height: 300, densities: [4, 5, 6, 8] }));
    expect(candidates.map((c) => `${size(c.url) ?? ""} ${c.descriptors.join()}`)).toEqual(["4800x1200 4x", "6000x1500 5x"]);
  });

  test.each<[string, string, tArtworkOptions, string]>([
    ["names bb", "{w}x{h}bb.jpg", {}, "3000x750"],
    ["names bb at a JPEG quality", "{w}x{h}bb-60.jpg", {}, "3000x750"],
    ["names no crop code", "{w}x{h}.jpg", {}, "3000x750"],
    ["leaves the crop open, which then is bb", "{w}x{h}{c}.{f}", {}, "3000x750"],
    ["names a crop that fills, with bb asked for", "{w}x{h}cc.jpg", { crop: "bb" }, "3000x750"],
    ["names a crop that fills", "{w}x{h}sr.jpg", {}, "1500x375"],
    ["names another", "{w}x{h}bf.jpg", {}, "1500x375"],
    ["names a code that only starts like cc", "{w}x{h}ccx.jpg", {}, "1500x375"],
    ["names the crop that makes a square", "{w}x{h}cc.jpg", {}, "1500x1500"],
    ["names it at a JPEG quality", "{w}x{h}cc-60.jpg", {}, "1500x1500"],
    ["names bb, with the square crop asked for", "{w}x{h}bb.jpg", { crop: "cc" }, "1500x1500"],
    ["leaves the crop open, with the square crop asked for", "{w}x{h}{c}.{f}", { crop: "cc" }, "1500x1500"],
    ["names an editorial crop", "{w}x{h}SC.DN01.jpg", {}, "1500x375"],
    ["names a code that only starts like bb", "{w}x{h}bbq.jpg", {}, "1500x375"],
    ["names bb, with a crop that fills asked for", "{w}x{h}bb.jpg", { crop: "sr" }, "1500x375"],
    ["leaves the crop open, with one that fills asked for", "{w}x{h}{c}.{f}", { crop: "sr" }, "1500x375"],
  ])("a template that %s, %s with %j: a 3000 by 750 box on a 1500 pixel cover is asked for as %s", (_name, name, options, expected) => {
    expect(size(artworkUrl({ url: `https://example.com/${name}`, width: 1500, height: 1500 }, 3000, { height: 750, ...options }))).toBe(expected);
  });

  test("a URL that does not say how the image is cut is taken to fill the box, which never asks for an enlargement", () => {
    expect(artworkUrl({ url: "https://example.com/w_{w},h_{h}/cover.jpg", width: 1500, height: 1500 }, 3000, { height: 750 })).toBe("https://example.com/w_1500,h_375/cover.jpg");
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

  const LARGEST = Number.MAX_SAFE_INTEGER;

  test.each([
    ["the smallest number there is", Number.MIN_VALUE, "1x1"],
    ["a width in the millions, as people ask for 'the largest'", 9_999_999, "10000x10000"],
    ["a width with an exponent to its name", 1e15, "10000x10000"],
    ["the largest whole number that is exact", LARGEST, "10000x10000"],
  ])("%s is a width: %s on artwork with no size is %s, in digits", (_name, width, expected) => {
    expect(artworkUrl({ url: "{w}x{h}" }, width)).toBe(expected);
    expect(artworkUrl({ url: "{w}x{h}" }, 300, { height: width })).toMatch(/^\d+x\d+$/);
  });

  test("the largest numbers there are, all at once, still give whole pixels and a density a browser reads", () => {
    for (const artwork of [{ url: "{w}x{h}" }, { url: "{w}x{h}", width: LARGEST, height: 1 }, { url: "{w}x{h}", width: 1, height: LARGEST }, { url: "{w}x{h}cc.jpg", width: LARGEST, height: LARGEST }])
      for (const [width, height] of [[LARGEST, LARGEST], [LARGEST, Number.MIN_VALUE], [Number.MIN_VALUE, LARGEST], [Number.MIN_VALUE, undefined], [LARGEST, undefined]] as const)
        for (const density of [Number.MIN_VALUE, 1, LARGEST]) {
          const [candidate] = parseSrcset(artworkSrcSet(artwork, width, { height, densities: [density] }));
          expect(candidate?.url).toMatch(/^[1-9]\d{0,4}x[1-9]\d{0,4}(cc\.jpg)?$/);
          expect(fetched(`${candidate?.url ?? ""} ${candidate?.descriptors.join(" ") ?? ""}`, 1)).toBe(candidate?.url);
        }
  });
});

describe("what the artwork says of its size is data, not an argument: a size that is no size is one the artwork did not give", () => {
  test.each<[string, unknown, unknown, number, string]>([
    ["a height past what a number can count", 1, 1e16, 300, "1x1"],
    ["a width past it", 1e16, 1, 300, "1x1"],
    ["both past it", 1e300, 1e300, 300, "300x300"],
    ["both the largest number there is", Number.MAX_VALUE, Number.MAX_VALUE, 300, "300x300"],
    ["both below one pixel", 0.5, 0.5, 300, "300x300"],
    ["both the smallest number there is", Number.MIN_VALUE, Number.MIN_VALUE, 300, "300x300"],
    ["both negative", -3000, -3000, 300, "300x300"],
    ["both infinite", Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 300, "300x300"],
    ["both not a number", Number.NaN, Number.NaN, 300, "300x300"],
    ["both text", "3000", "3000", 300, "300x300"],
    ["both objects", { valueOf: () => 3000 }, [3000], 300, "300x300"],
    ["a shape as thin as numbers go", Number.MAX_SAFE_INTEGER, 1, 300, "300x1"],
    ["a shape as tall as numbers go", 1, Number.MAX_SAFE_INTEGER, 300, "1x10000"],
  ])("artwork with %s (%s by %s) asked for at %i gives %s, and never throws", (_name, width, height, wanted, expected) => {
    const artwork = { url: TEMPLATE, width, height } as tArtworkSource;
    expect(size(artworkUrl(artwork, wanted))).toBe(expected);
    expect(() => artworkSrcSet(artwork, wanted)).not.toThrow();
  });

  test.each([
    [1000.6, 5000, "1000x1000"],
    [1000.4, 5000, "1000x1000"],
    [1.9, 5000, "1x1"],
    [999.999, 300, "300x300"],
  ])("a size that is not a whole number counts for the whole pixels in it: %s square, asked for at %i, is %s", (side, wanted, expected) => {
    expect(size(artworkUrl(cover(side), wanted))).toBe(expected);
    expect(size(artworkUrl({ ...cover(side), url: TEMPLATE.replace("bb", "cc") }, wanted))).toBe(expected);
  });
});

describe("the numbers a caller gives are checked once, where they come in", () => {
  const LARGEST = Number.MAX_SAFE_INTEGER;
  const bad: [string, unknown][] = [
    ["zero", 0],
    ["a negative number", -300],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["one more than the largest whole number that is exact", 2 ** 53],
    ["a number that prints with an exponent", 1e21],
    ["the largest number there is", Number.MAX_VALUE],
    ["a string", "300"],
    ["null", null],
    ["an object", { width: 300 }],
    ["a number object", new Number(300)],
    ["a bigint", 300n],
  ];
  const message = (name: string) => new RegExp(`^artwork: ${name.replaceAll("[", "\\[").replaceAll("]", "\\]")} must be a number above 0 and at most ${String(LARGEST)}, got `);

  test.each([...bad, ["undefined", undefined]])("a width of %s is a TypeError naming width and its bounds", (_name, width) => {
    expect(() => artworkUrl(cover(), width as number)).toThrow(TypeError);
    expect(() => artworkUrl(cover(), width as number)).toThrow(message("width"));
    expect(() => artworkSrcSet(cover(), width as number)).toThrow(message("width"));
  });

  test.each(bad)("a height of %s is a TypeError naming height and its bounds", (_name, height) => {
    expect(() => artworkUrl(cover(), 300, { height: height as number })).toThrow(message("height"));
    expect(() => artworkSrcSet(cover(), 300, { height: height as number })).toThrow(message("height"));
  });

  test.each([...bad, ["undefined", undefined]])("a density of %s is a TypeError naming its place in the list", (_name, density) => {
    expect(() => artworkSrcSet(cover(), 300, { densities: [1, density as number] })).toThrow(message("densities[1]"));
  });

  test.each([
    ["a number", 0, "got 0"],
    ["a number out of range", 2 ** 53, "got 9007199254740992"],
    ["NaN", Number.NaN, "got NaN"],
    ["a string", "300", "got string"],
    ["null", null, "got object"],
    ["nothing", undefined, "got undefined"],
  ])("the error says what it got: for %s, %j, it ends %j", (_name, width, ending) => {
    expect(() => artworkUrl(cover(), width as number)).toThrow(new RegExp(`${ending}$`));
  });

  test.each([Number.MIN_VALUE, 0.001, 1, 300, 10_000, 1e15, LARGEST])("%s is accepted as a width, a height and a density", (value) => {
    expect(() => artworkSrcSet(cover(), value, { height: value, densities: [value] })).not.toThrow();
  });
});

describe("an artwork that is no artwork, and options that are no options, are refused", () => {
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
    const options: tArtworkOptions = { height: 200, format: "webp", crop: "sr" };
    const artwork = { url: "https://example.com/{w}x{h}{c}.{f}", width: 3000, height: 3000 };
    expect(parseSrcset(artworkSrcSet(artwork, 300, options))[0]?.url).toBe(artworkUrl(artwork, 300, options));
    expect(artworkSrcSet(artwork, 300, options)).toBe("https://example.com/300x200sr.webp 1x, https://example.com/600x400sr.webp 2x, https://example.com/900x600sr.webp 3x");
  });

  test("each candidate keeps the artwork's shape", () => {
    expect(artworkSrcSet({ url: "{w}x{h}", width: 1920, height: 1080 }, 320, { densities: [1, 2] })).toBe("320x180 1x, 640x360 2x");
  });

  test.each<[string, unknown]>([
    ["an empty list", []],
    ["a number, not a list", 2],
    ["a string", "1x, 2x"],
    ["null", null],
    ["a typed array", new Float64Array([1, 2])],
    ["a set", new Set([1, 2])],
    ["something with a length and no more", { length: 2, 0: 1, 1: 2 }],
    ["a list of seventeen", Array.from({ length: 17 }, (_, i) => i + 1)],
    ["a list of a million", Array.from({ length: 1_000_000 }, (_, i) => i + 1)],
  ])("densities given as %s is a TypeError saying what a density list is", (_name, densities) => {
    expect(() => artworkSrcSet(cover(), 300, { densities: densities as number[] })).toThrow(/^artwork: densities must be an array of 1 to 16 numbers above 0$/);
  });

  test("only leaving densities out, or undefined, means the default", () => {
    expect(artworkSrcSet(cover(), 300, { densities: undefined })).toBe(artworkSrcSet(cover(), 300));
    expect(artworkSrcSet(cover(), 300, {})).toBe(artworkSrcSet(cover(), 300));
  });

  test.each([1, 2, 15, 16])("a list of %i densities is offered in full", (count) => {
    const densities = Array.from({ length: count }, (_, i) => 1 + i / 4);
    expect(parseSrcset(artworkSrcSet(cover(), 100, { densities })).map((c) => c.descriptors.join())).toEqual(densities.map((density) => `${String(density)}x`));
  });

  test("a list too long is refused before any of it is read, however long", () => {
    const list = new Proxy(Array.from({ length: 5 }, () => 1), {
      get: (target, key, receiver): unknown => {
        if (key === "length") return 2 ** 32 - 1;
        if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("an entry was read");
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() => artworkSrcSet(cover(), 300, { densities: list })).toThrow(/^artwork: densities must be an array of 1 to 16/);
  });

  test.each<[string, unknown[], number]>([
    ["first", [0, 1, 2], 0],
    ["last", [1, 2, Number.NaN], 2],
    ["a hole in the list", [1, , 2], 1], // eslint-disable-line no-sparse-arrays -- a hole is the case
    ["every entry of a list that is all holes, of which the first is named", new Array<number>(3), 0],
  ])("a density that is no density, %s, is a TypeError naming where in the list it is", (_name, densities, at) => {
    expect(() => artworkSrcSet(cover(), 300, { densities: densities as number[] })).toThrow(new RegExp(`^artwork: densities\\[${String(at)}\\] must be a number above 0`));
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

  const FIXED = "https://example.com/fixed.jpg";

  test.each<[string, number[] | undefined]>([
    ["the default densities", undefined],
    ["one density", [2]],
    ["densities that do not start at one", [2, 3]],
    ["densities in another order", [3, 1]],
  ])("a URL with no size in it is offered alone and unlabelled, with %s: it is one image, of a size nobody here knows", (_name, densities) => {
    expect(artworkSrcSet({ url: FIXED }, 300, { densities })).toBe(FIXED);
    expect(artworkSrcSet({ url: FIXED, width: 200, height: 200 }, 300, { densities, height: 150, format: "webp", crop: "cc" })).toBe(FIXED);
  });

  test.each([1, 2, 3])("on a screen of density %s a browser fetches that one image, with a src or without", (dpr) => {
    expect(fetched(artworkSrcSet({ url: FIXED }, 300, { densities: [2, 3] }), dpr)).toBe(FIXED);
    expect(fetched(artworkSrcSet({ url: FIXED }, 300, { densities: [2, 3] }), dpr, artworkUrl({ url: FIXED }, 300))).toBe(FIXED);
  });

  test("the control: labelled with whichever density came first, the same image would be laid out at half or a third its size", () => {
    expect(parseSrcset(`${FIXED} 2x`)[0]?.descriptors).toEqual(["2x"]);
    expect(parseSrcset(artworkSrcSet({ url: FIXED }, 300, { densities: [2, 3] }))[0]?.descriptors).toEqual([]);
  });

  test.each([
    ["only a width", "https://example.com/w{w}.jpg", "https://example.com/w300.jpg 1x, https://example.com/w600.jpg 2x"],
    ["only a height", "https://example.com/h{h}.jpg", "https://example.com/h300.jpg 1x, https://example.com/h600.jpg 2x"],
    ["its size in the query", "https://example.com/cover.jpg?w={w}", "https://example.com/cover.jpg?w=300 1x, https://example.com/cover.jpg?w=600 2x"],
  ])("a URL with %s to fill in does have a size, and is offered at each density", (_name, url, expected) => {
    expect(artworkSrcSet({ url }, 300, { densities: [1, 2] })).toBe(expected);
  });

  test("a URL with no size is still checked like any other: a bad density is refused before it is found not to matter", () => {
    expect(() => artworkSrcSet({ url: FIXED }, 300, { densities: [0] })).toThrow(/^artwork: densities\[0\]/);
    expect(() => artworkSrcSet({ url: FIXED }, 0)).toThrow(/^artwork: width/);
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

describe("artworkImage: everything an <img> needs, worked out together", () => {
  const STILL: tArtworkSource = { url: TEMPLATE, width: 3701, height: 1912 };

  test("gives the src, the srcset, and the width and height to lay the image out by", () => {
    expect(artworkImage(cover(), 300)).toEqual({
      src: TEMPLATE.replace("{w}x{h}", "300x300"),
      srcset: squares("300 1x", "600 2x", "900 3x"),
      width: 300,
      height: 300,
    });
  });

  const calls: [string, tArtworkSource, number, tArtworkSrcSetOptions][] = [
    ["a cover", cover(), 300, {}],
    ["a cover, at a width that is not a whole number", cover(), 50.4, {}],
    ["a cover smaller than it is shown", cover(200), 300, {}],
    ["a cover with other densities", cover(), 300, { densities: [2, 3] }],
    ["a cover in another format and crop", cover(), 300, { format: "webp", crop: "cc" }],
    ["a cover in a wide slot", cover(1500), 1200, { height: 300 }],
    ["a wide still", STILL, 320, {}],
    ["a wide still in a square slot", STILL, 300, { height: 300 }],
    ["artwork with no size", { url: TEMPLATE }, 300, {}],
    ["artwork with no size, larger than the server gives", { url: TEMPLATE }, 4000, {}],
    ["a URL with no size in it", { url: "https://example.com/fixed.jpg" }, 300, { densities: [2, 3] }],
    ["a URL a srcset could not carry as given", { url: " https://example.com/a b/{w}x{h}.jpg?ids=1,2," }, 300, {}],
  ];

  test.each(calls)("for %s, src is what artworkUrl gives and srcset what artworkSrcSet gives, for the same call", (_name, artwork, width, options) => {
    const image = artworkImage(artwork, width, options);
    expect(image.src).toBe(artworkUrl(artwork, width, options));
    expect(image.srcset).toBe(artworkSrcSet(artwork, width, options));
  });

  test.each(calls)("for %s, a screen of each density on offer is given the image labelled for it, and a plain screen the src where no 1x is on offer", (_name, artwork, width, options) => {
    const { src, srcset } = artworkImage(artwork, width, options);
    const candidates = parseSrcset(srcset);
    for (const { url, descriptors } of candidates) expect(fetched(srcset, Number.parseFloat(descriptors[0] ?? "1"), src)).toBe(url);
    if (!candidates.some((c) => (c.descriptors[0] ?? "1x") === "1x")) expect(fetched(srcset, 1, src)).toBe(src);
    for (const dpr of [0.5, 1, 1.25, 1.5, 2, 2.625, 3, 4]) expect([src, ...candidates.map((c) => c.url)]).toContain(fetched(srcset, dpr, src));
  });

  test.each(calls)("for %s, width and height are whole numbers of pixels, at least one", (_name, artwork, width, options) => {
    const image = artworkImage(artwork, width, options);
    for (const side of [image.width, image.height]) {
      expect(Number.isInteger(side)).toBe(true);
      expect(side).toBeGreaterThanOrEqual(1);
    }
  });

  test.each<[string, tArtworkSource, number, tArtworkSrcSetOptions, [number, number]]>([
    ["a cover is laid out square", cover(), 300, {}, [300, 300]],
    ["a width that is not a whole number is rounded", cover(), 50.4, {}, [50, 50]],
    ["a width below a pixel is one", cover(), 0.2, {}, [1, 1]],
    ["a wide still takes its own shape", STILL, 320, {}, [320, 165]],
    ["16:9 artwork takes its own shape", { url: TEMPLATE, width: 1920, height: 1080 }, 320, {}, [320, 180]],
    ["artwork with no size is laid out square", { url: TEMPLATE }, 300, {}, [300, 300]],
    ["artwork with one side known is laid out square", { url: TEMPLATE, width: 1920 }, 300, {}, [300, 300]],
    ["a cover smaller than it is shown is still laid out at the size asked for", cover(200), 300, {}, [300, 300]],
    ["artwork too small for the box is laid out at the size asked for, past what the server gives", { url: TEMPLATE }, 20_000, {}, [20_000, 20_000]],
    ["a crop that fills the box is laid out as the box", cover(), 300, { height: 150, crop: "sr" }, [300, 150]],
    ["the crop that makes a square is laid out square, as long as the box is wide", cover(), 300, { height: 150, crop: "cc" }, [300, 300]],
    ["the same, as long as the box is tall where that is more", cover(), 150, { height: 300, crop: "cc" }, [300, 300]],
    ["the same, on artwork that is not square and with no height", STILL, 320, { crop: "cc" }, [320, 320]],
    ["the same, on artwork with no size", { url: TEMPLATE }, 300, { crop: "cc" }, [300, 300]],
    ["a crop that fills, with no height, is laid out in the artwork's shape", { url: TEMPLATE, width: 1920, height: 1080 }, 320, { crop: "sr" }, [320, 180]],
    ["a URL that does not say how it is cut, with no height, likewise", { url: "https://example.com/w_{w},h_{h}/still.jpg", width: 1920, height: 1080 }, 320, {}, [320, 180]],
    ["a URL that does not say how it is cut is laid out as the box", { url: "https://example.com/fixed.jpg", width: 600, height: 600 }, 300, { height: 150 }, [300, 150]],
    ["a cover fitted inside a wide slot is laid out as the cover standing in it", cover(1500), 1200, { height: 300 }, [300, 300]],
    ["a cover fitted inside a tall slot likewise", cover(1500), 300, { height: 1200 }, [300, 300]],
    ["a wide still fitted inside a square slot is laid out as the still", STILL, 300, { height: 300 }, [300, 155]],
    ["a box of the artwork's own shape is laid out as the box", STILL, 3701, { height: 1912 }, [3701, 1912]],
    ["artwork with no shape, fitted inside a slot, is laid out as the slot: there is nothing else to go by", { url: TEMPLATE }, 300, { height: 150 }, [300, 150]],
  ])("%s", (_name, artwork, width, options, [expectedWidth, expectedHeight]) => {
    expect(artworkImage(artwork, width, options)).toMatchObject({ width: expectedWidth, height: expectedHeight });
  });

  // 300x300bb for this still comes back from Apple's server 300 by 155.
  test("the size it is laid out at is the shape of what the server sends back, so the image is never stretched", () => {
    const { width, height, src } = artworkImage(STILL, 300, { height: 300 });
    expect(size(src)).toBe("300x300");
    expect(width / height).toBeCloseTo(3701 / 1912, 1);
  });

  test("it can be assigned to an element as it is: its names are the element's own, and there are no others", () => {
    expect(Object.keys(artworkImage(cover(), 300)).sort()).toEqual(["height", "src", "srcset", "width"]);
    const img = { src: "", srcset: "", width: 0, height: 0, alt: "kept" };
    expect(Object.assign(img, artworkImage(cover(), 300))).toMatchObject({ alt: "kept", width: 300, src: TEMPLATE.replace("{w}x{h}", "300x300") });
  });

  test("a cover smaller than it is shown: the one image there is, laid out at the size asked for, whichever of src and srcset a browser goes by", () => {
    const { src, srcset, width, height } = artworkImage(cover(200), 300);
    expect(srcset).toBe(squares("200 0.667x"));
    expect(size(src)).toBe("200x200");
    for (const dpr of [1, 2, 3]) expect(fetched(srcset, dpr, src)).toBe(src);
    expect([width, height]).toEqual([300, 300]);
  });

  test.each<[string, unknown, number, unknown, RegExp]>([
    ["no artwork", undefined, 300, {}, /^artwork: expected an artwork object with a url/],
    ["a width of zero", cover(), 0, {}, /^artwork: width must be/],
    ["a bad height", cover(), 300, { height: -1 }, /^artwork: height must be/],
    ["a bad format", cover(), 300, { format: "avif" }, /^artwork: format must be/],
    ["a bad crop", cover(), 300, { crop: "a/b" }, /^artwork: crop must be/],
    ["a bad density", cover(), 300, { densities: [1, 0] }, /^artwork: densities\[1\] must be/],
    ["no densities", cover(), 300, { densities: [] }, /^artwork: densities must be/],
    ["options that are no object", cover(), 300, null, /^artwork: options must be an object/],
  ])("it refuses what the other two refuse: %s", (_name, artwork, width, options, message) => {
    expect(() => artworkImage(artwork as tArtworkSource, width, options as tArtworkSrcSetOptions)).toThrow(message);
    expect(() => artworkImage(artwork as tArtworkSource, width, options as tArtworkSrcSetOptions)).toThrow(TypeError);
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

  test.each(hostile)("a URL with %s is one candidate per density, each with its one density, or one candidate alone where it has no size", (_name, url) => {
    const candidates = parseSrcset(artworkSrcSet({ url }, 300, { densities: [1, 2] }));
    expect(candidates.map((c) => c.descriptors)).toEqual(url.includes("{w}") ? [["1x"], ["2x"]] : [[]]);
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

describe("hosts: where the artwork may come from, for a caller who says", () => {
  const APPLE = ["mzstatic.com"];
  const REFUSED = /^artwork: the artwork's url is not https on one of the hosts allowed$/;
  /** The three functions, each given the same artwork and options. */
  const every = (artwork: tArtworkSource, options: tArtworkSrcSetOptions) => [() => artworkUrl(artwork, 300, options), () => artworkSrcSet(artwork, 300, options), () => artworkImage(artwork, 300, options)];

  test.each([
    ["a catalog cover", TEMPLATE],
    ["another of Apple's image hosts", "https://is5-ssl.mzstatic.com/image/thumb/a.jpg/{w}x{h}bb.jpg"],
    ["the host itself, with nothing before it", "https://mzstatic.com/{w}x{h}bb.jpg"],
    ["a host written in capitals", "https://IS1-SSL.MZSTATIC.COM/image/{w}x{h}bb.jpg"],
    ["the port https has anyway", "https://is1-ssl.mzstatic.com:443/image/{w}x{h}bb.jpg"],
    ["a query and a fragment", "https://is1-ssl.mzstatic.com/{w}x{h}bb.jpg?l=en-US#top"],
    ["a URL with no size in it", "https://is1-ssl.mzstatic.com/image/fixed.jpg"],
    ["white space around it", "  https://is1-ssl.mzstatic.com/image/{w}x{h}bb.jpg\n"],
    ["a placeholder in the host that fills to a name under it", "https://{c}.mzstatic.com/{w}x{h}.jpg"],
  ])("%s on an allowed host is filled in exactly as it would be with no hosts named", (_name, url) => {
    const artwork = { url, width: 3000, height: 3000 };
    expect(artworkUrl(artwork, 300, { hosts: APPLE })).toBe(artworkUrl(artwork, 300));
    expect(artworkSrcSet(artwork, 300, { hosts: APPLE })).toBe(artworkSrcSet(artwork, 300));
    expect(artworkImage(artwork, 300, { hosts: APPLE })).toEqual(artworkImage(artwork, 300));
  });

  test("any host on the list will do, and a subdomain of one at any depth", () => {
    const hosts = ["example.org", "blobstore.apple.com", "mzstatic.com"];
    for (const host of ["mzstatic.com", "a.mzstatic.com", "a.b.c.mzstatic.com", "store-032.blobstore.apple.com", "example.org"])
      expect(artworkUrl({ url: `https://${host}/{w}x{h}bb.jpg` }, 300, { hosts })).toBe(`https://${host}/300x300bb.jpg`);
  });

  const elsewhere: [string, string][] = [
    ["another host", "https://evil.example/{w}x{h}bb.jpg"],
    ["a host that ends with an allowed one's letters but is not under it", "https://evilmzstatic.com/{w}x{h}bb.jpg"],
    ["a host that starts with an allowed one", "https://is1-ssl.mzstatic.com.evil.example/{w}x{h}bb.jpg"],
    ["an allowed host over http", "http://is1-ssl.mzstatic.com/image/{w}x{h}bb.jpg"],
    ["an allowed host on another port", "https://is1-ssl.mzstatic.com:8443/image/{w}x{h}bb.jpg"],
    ["an allowed host with a user name and password", "https://user:pass@is1-ssl.mzstatic.com/{w}x{h}bb.jpg"],
    ["an allowed host with a user name alone", "https://user@is1-ssl.mzstatic.com/{w}x{h}bb.jpg"],
    ["an allowed host with a password alone", "https://:pass@is1-ssl.mzstatic.com/{w}x{h}bb.jpg"],
    ["an allowed host as the user name of another", "https://is1-ssl.mzstatic.com@evil.example/{w}x{h}bb.jpg"],
    ["an allowed host after backslashes a parser reads as slashes", "https:\\\\evil.example\\@is1-ssl.mzstatic.com/{w}x{h}bb.jpg"],
    ["an allowed host in the fragment", "https://evil.example/#@is1-ssl.mzstatic.com/{w}x{h}bb.jpg"],
    ["an allowed host in the path", "https://evil.example/is1-ssl.mzstatic.com/{w}x{h}bb.jpg"],
    ["an allowed host with a dot after it", "https://is1-ssl.mzstatic.com./{w}x{h}bb.jpg"],
    ["a space in front and a way up out of the path", " https://evil.example/../../api/logout?via={w}"],
    ["no scheme, so the page's own", "//is1-ssl.mzstatic.com/{w}x{h}bb.jpg"],
    ["no host, so the page's own", "/api/logout?via={w}"],
    ["a path of its own only", "covers/{w}x{h}bb.jpg"],
    ["script for a scheme", "javascript:alert(document.domain)//{w}"],
    ["a document of its own", "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)' width='{w}'/>"],
    ["a blob, even one made on an allowed host", "blob:https://is1-ssl.mzstatic.com/0b2d6f3e-{w}"],
    ["a file", "file:///etc/passwd#{w}"],
    ["a cloud metadata address", "http://169.254.169.254/latest/meta-data/{w}"],
    ["this machine", "http://localhost:6379/{w}"],
    ["this machine by number", "https://[::1]/{w}x{h}bb.jpg"],
    ["a placeholder in the host that fills to a name elsewhere", "https://{c}.evil.example/{w}x{h}.jpg"],
    ["a size in the host", "https://{w}.example/{h}.jpg"],
  ];

  test.each(elsewhere)("artwork on %s is refused by all three functions, with an error that does not show the URL", (_name, url) => {
    for (const call of every({ url, width: 3000, height: 3000 }, { hosts: APPLE })) {
      expect(call).toThrow(REFUSED);
      expect(call).toThrow(TypeError);
    }
  });

  test.each(elsewhere)("the control: with no hosts named, artwork on %s is filled in like any other", (_name, url) => {
    for (const call of every({ url, width: 3000, height: 3000 }, {})) expect(call).not.toThrow();
  });

  test("what was checked is what is handed back: every URL that comes out stands on an allowed host by a URL parser's reading", () => {
    for (const url of [TEMPLATE, "  https://IS1-SSL.MZSTATIC.COM:443/a b/{w}x{h}bb.jpg?ids=1,2,", "https://{c}.mzstatic.com/{w}x{h}.jpg"]) {
      const { src, srcset } = artworkImage({ url, width: 3000, height: 3000 }, 300, { hosts: APPLE });
      for (const out of [src, ...parseSrcset(srcset).map((c) => c.url)]) {
        // Read with the page as its base, as a browser would: a URL that only looked whole would land on app.example.
        const read = new URL(out, BASE);
        expect([read.protocol, read.port, read.username]).toEqual(["https:", "", ""]);
        expect(read.hostname.endsWith(".mzstatic.com")).toBe(true);
      }
    }
  });

  test("a srcset is refused whole: it is never returned with some of its candidates left out", () => {
    expect(() => artworkSrcSet({ url: "https://{w}.mzstatic.com.evil.example/{h}.jpg" }, 300, { hosts: APPLE, densities: [1, 2, 3] })).toThrow(REFUSED);
  });

  test.each<[string, unknown]>([
    ["an empty list", []],
    ["a host on its own, not in a list", "mzstatic.com"],
    ["null", null],
    ["a set", new Set(["mzstatic.com"])],
    ["a list of seventeen", Array.from({ length: 17 }, (_, i) => `host${String(i)}.example`)],
    ["a host in capitals, which no URL's host would equal", ["MzStatic.com"]],
    ["a URL, not a host", ["https://mzstatic.com"]],
    ["a wildcard", ["*.mzstatic.com"]],
    ["a host with a port", ["mzstatic.com:443"]],
    ["a host with a path", ["mzstatic.com/image"]],
    ["a host with a dot in front", [".mzstatic.com"]],
    ["a host with a dot after", ["mzstatic.com."]],
    ["a host with a space", ["mzstatic.com "]],
    ["an empty host", [""]],
    ["a host longer than a host name can be", [`${"a".repeat(250)}.com`]],
    ["a host that is not a string", [42]],
    ["one bad host after a good one", ["mzstatic.com", "*.example"]],
  ])("hosts given as %s is a TypeError that says what a host list is, whatever the artwork", (_name, hosts) => {
    for (const call of every(cover(), { hosts: hosts as string[] })) expect(call).toThrow(/^artwork: hosts must be an array of 1 to 16 host names in small letters, such as mzstatic\.com$/);
  });

  test.each([["mzstatic.com"], ["localhost"], ["xn--bcher-kva.example"], ["a-b.c-d.example"], ["10.0.0.1"], Array.from({ length: 16 }, (_, i) => `host${String(i)}.example`)])(
    "%j is a host list",
    (...hosts) => {
      expect(() => artworkUrl({ url: `https://${hosts[0] ?? ""}/{w}x{h}bb.jpg` }, 300, { hosts })).not.toThrow();
    },
  );

  test("leaving hosts out, or undefined, checks nothing: that is the default, and it is the caller's to change", () => {
    expect(artworkUrl({ url: "javascript:alert({w})" }, 300, { hosts: undefined })).toBe("javascript:alert(300)");
    expect(artworkUrl({ url: "javascript:alert({w})" }, 300)).toBe("javascript:alert(300)");
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
    ["artworkImage", (artwork: tArtworkSource, options: object) => artworkImage(artwork, 300, options)],
  ])("%s reads each property of the artwork and of the options exactly once", (_name, call) => {
    const artwork = counted<tArtworkSource>({ url: TEMPLATE, width: 3000, height: 3000 });
    const options = counted({ height: 300, format: "jpg", crop: "bb", densities: [1, 2], hosts: ["mzstatic.com"] });
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

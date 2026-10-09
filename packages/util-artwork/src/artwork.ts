/** What is read from an artwork object. Any `tArtwork` from `@open-music-sdk/types` fits. */
export interface tArtworkSource {
  /** The URL template. `{w}` and `{h}` stand for the pixel size. */
  readonly url: string;
  /** The widest the image comes, in pixels. Nothing larger is asked for. */
  readonly width?: number | null | undefined;
  /** The tallest the image comes, in pixels. */
  readonly height?: number | null | undefined;
}

/**
 * The formats Apple's image server converts to. It answers 400 to `avif`, `bmp` and others, and to `gif` and
 * `tiff` it sends a JPEG under that name, so those are not here.
 */
const FORMATS = ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const;

/** A file format the image server converts artwork to. */
export type tArtworkFormat = (typeof FORMATS)[number];

export interface tArtworkOptions {
  /** Height in CSS pixels. Default: the height that keeps the artwork's own shape at `width`, or `width` where its shape is unknown. */
  readonly height?: number | undefined;
  /** The file format. Default: the one the template names, or `"jpg"` where it leaves that open as `{f}`. */
  readonly format?: tArtworkFormat | undefined;
  /**
   * Apple's code for how the image is cut to the box, such as `"bb"`, the whole image fitted inside it, or
   * `"cc"`, a square cut from its centre. Default: the one the template names, or `"bb"` where it leaves that
   * open as `{c}`.
   */
  readonly crop?: string | undefined;
}

export interface tArtworkSrcSetOptions extends tArtworkOptions {
  /** The pixel densities to offer. Default 1, 2 and 3. */
  readonly densities?: readonly number[] | undefined;
}

/**
 * A length or density the caller gave. The upper bound is where whole numbers stop being exact; nothing near it
 * is a real size, but below it the arithmetic that follows cannot overflow, so no number here ever needs a
 * second check.
 */
function length(name: string, value: unknown): number {
  if (typeof value === "number" && value > 0 && value <= Number.MAX_SAFE_INTEGER) return value;
  throw new TypeError(`artwork: ${name} must be a number above 0 and at most ${String(Number.MAX_SAFE_INTEGER)}, got ${typeof value === "number" ? String(value) : typeof value}`);
}

/**
 * How large the artwork says it comes, one way, in whole pixels, or nothing where what it says is no size. That
 * is data from somewhere else, so a bad one is not an error: the artwork is treated as not having said.
 */
const pixels = (value: unknown): number | undefined => (typeof value === "number" && value >= 1 && value <= Number.MAX_SAFE_INTEGER ? Math.floor(value) : undefined);

function formatOf(value: unknown): tArtworkFormat | undefined {
  if (value === undefined || (FORMATS as readonly unknown[]).includes(value)) return value as tArtworkFormat | undefined;
  throw new TypeError(`artwork: format must be one of ${FORMATS.join(", ")}`);
}

/**
 * A crop code goes into the file name as it is, so it may hold nothing that could end the name or change the URL
 * around it. Apple's own run from `bb` to `SC.DN01` and `bb-60`: letters and digits, with a dot or hyphen between.
 */
function cropOf(value: unknown): string | undefined {
  if (value === undefined || (typeof value === "string" && value.length <= MAX_CROP_LENGTH && /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(value))) return value;
  throw new TypeError(`artwork: crop must be a crop code: at most ${String(MAX_CROP_LENGTH)} letters and digits, with single dots or hyphens between them`);
}

const SIZE = "{w}x{h}";
const DEFAULT_CROP = "bb";
/** The most pixels Apple's image server gives on a side. It answers 400 to a request for one more. */
const MAX_SIDE = 10_000;
/** Three times the longest crop code seen from Apple. A code fills every `{c}` in a template, so its length is what a URL can grow by. */
const MAX_CROP_LENGTH = 32;
/** More densities than screens come in. Each one is a candidate built and a URL written, so the list is not left open. */
const MAX_DENSITIES = 16;
/** What arithmetic on sizes this small can be off by, with room to spare: a height of 180.0000000001 is 180, not 181. */
const ROUNDING = 1e-6;

/**
 * Whether a crop code fits the whole image inside the box, never enlarging it: `bb`, `bb` at a given JPEG
 * quality, and a file name with no code at all. Every other code Apple's image server was tried with fills the
 * box, enlarging the image if it must.
 */
const fitsInside = (cut: string) => cut === "" || /^bb(?:-|$)/.test(cut);

/**
 * The template with a crop or format that was asked for written where the template names one.
 *
 * Apple documents the template as `{w}x{h}` and then the rest of a file name: in `{w}x{h}bb.jpg` the image is
 * cut `bb` and encoded `jpg`. Some templates leave those open as `{c}` and `{f}`, which are filled in like the
 * size. Most name them, and asking for another means writing over what is there. A URL whose file name is not of
 * that form says nothing about cut or encoding, and is left as it is.
 *
 * `cut` is the crop code the file name ends up with, where it has the form to name one.
 */
function tailored(template: string, crop: string | undefined, format: string | undefined): { template: string; cut: string | undefined } {
  const end = /[?#]/.exec(template)?.index ?? template.length;
  const start = template.lastIndexOf("/", end) + 1;
  const name = template.slice(start, end);
  const dot = name.lastIndexOf(".");
  if (!name.startsWith(SIZE) || dot < SIZE.length || dot === name.length - 1) return { template, cut: undefined };
  const [cut, encoding] = [name.slice(SIZE.length, dot), name.slice(dot + 1)];
  const [newCut, newEncoding] = [crop !== undefined && !cut.includes("{c}") ? crop : cut, format !== undefined && !encoding.includes("{f}") ? format : encoding];
  return { template: `${template.slice(0, start)}${SIZE}${newCut}.${newEncoding}${template.slice(end)}`, cut: newCut.replaceAll("{c}", crop ?? DEFAULT_CROP) };
}

/**
 * The pixel size to ask for, given the box wanted in device pixels and how large the artwork comes, and how far
 * the box had to shrink to get there. A `scale` of 1 is a box that got what it asked for.
 *
 * A box never asks for more than the artwork has, nor for more than the image server gives at all, and it
 * shrinks in its own shape. What "more than the artwork has" means depends on the crop. An image that fills the box needs the artwork to cover the box both ways. An image fitted `inside`
 * the box touches two of its sides and leaves the others clear unless the shapes match, so the box may run past
 * the artwork one way and still hold a smaller image: it shrinks only once the image inside it would be larger
 * than the artwork comes. Shrinking it sooner gets a smaller image back, not the same one.
 */
export function fit(
  box: { readonly width: number; readonly height?: number | undefined },
  max: { readonly width?: number | undefined; readonly height?: number | undefined },
  inside: boolean,
): { width: number; height: number; scale: number } {
  // With no height, the box takes the artwork's shape, or is square where the artwork does not say both ways.
  const shape = max.width !== undefined && max.height !== undefined ? max.height / max.width : 1;
  const boxHeight = box.height ?? box.width * shape;
  const across = max.width === undefined ? Infinity : max.width / box.width;
  const down = max.height === undefined ? Infinity : max.height / boxHeight;
  // The image inside the box can only be worked out from the artwork's whole shape. With one side known, that
  // side is all there is to go by, and the box is held to it as if the image filled it.
  const artwork = inside && max.width !== undefined && max.height !== undefined ? Math.max(across, down) : Math.min(across, down);
  const scale = Math.min(1, artwork, MAX_SIDE / box.width, MAX_SIDE / boxHeight);
  const whole = (pixels: number) => Math.max(1, Math.min(MAX_SIDE, pixels));
  const width = whole(Math.round(box.width * scale));
  // A height that was asked for is rounded like the width. One that follows from the width is worked out from
  // the width's whole pixels and rounded up, so that it is the width that decides the image: 150 by 77.49
  // rounded to 150x77 comes back 149 pixels wide, where 150x78 comes back 150.
  const height = whole(box.height === undefined ? Math.ceil(width * shape - ROUNDING) : Math.round(box.height * scale));
  return { width, height, scale };
}

/** What one call was given, read once and checked. Nothing is read from the artwork or the options after this. */
interface tRequest {
  readonly template: string;
  /** Whether the template has a size to fill in. A URL without one is one image, whatever is asked of it. */
  readonly sized: boolean;
  /** How large the artwork comes, each way, where it says. */
  readonly max: { readonly width: number | undefined; readonly height: number | undefined };
  /** The box wanted, in CSS pixels. With no height, the box takes the artwork's shape. */
  readonly width: number;
  readonly height: number | undefined;
  readonly format: string;
  readonly crop: string;
  /** Whether the image is fitted inside the box and never enlarged, so far as the template says how it is cut. */
  readonly inside: boolean;
}

/**
 * Reads the artwork and the options, each property once, and checks them. What the artwork holds is data from
 * somewhere else: an object that answers differently the second time it is asked is never asked a second time.
 */
function read(artwork: tArtworkSource, width: number, options: tArtworkOptions): tRequest {
  if (typeof artwork !== "object" || (artwork as unknown) === null) throw new TypeError("artwork: expected an artwork object with a url");
  const { url, width: maxWidth, height: maxHeight } = artwork;
  // A template that has been through a URL parser has its braces percent-encoded. It is the same template.
  const template = typeof url === "string" ? normalise(url).replace(/%7[Bb]([whcf])%7[Dd]/g, "{$1}") : "";
  if (template === "") throw new TypeError("artwork: expected an artwork object with a url");
  if (typeof options !== "object" || (options as unknown) === null) throw new TypeError("artwork: options must be an object");
  const { height } = options;
  const [format, crop] = [formatOf(options.format), cropOf(options.crop)];
  const named = tailored(template, crop, format);
  return {
    template: named.template,
    sized: named.template.includes("{w}") || named.template.includes("{h}"),
    max: { width: pixels(maxWidth), height: pixels(maxHeight) },
    width: length("width", width),
    height: height === undefined ? undefined : length("height", height),
    format: format ?? "jpg",
    crop: crop ?? DEFAULT_CROP,
    // A URL that does not say how the image is cut is taken to fill the box: that never asks for an enlargement.
    inside: named.cut !== undefined && fitsInside(named.cut),
  };
}

/** The template filled in for the box at `density`, and how far the box had to shrink to what the artwork has. */
function image({ template, max, width, height, format, crop, inside }: tRequest, density: number): { url: string; scale: number } {
  const { width: w, height: h, scale } = fit({ width: width * density, height: height === undefined ? undefined : height * density }, max, inside);
  const url = template.replaceAll("{w}", String(w)).replaceAll("{h}", String(h)).replaceAll("{f}", format).replaceAll("{c}", crop);
  return { url, scale };
}

/**
 * The URL as a browser reads it from `src`, spelled so that a `srcset` carries it unchanged.
 *
 * Before it looks at anything, a URL parser drops white space and control characters from both ends and tabs
 * and line breaks from anywhere. The same go here, or a `src` and a `srcset` given one URL would disagree
 * about where it points. A space or form feed inside, which would end the URL in a `srcset`, is written the
 * way the parser would write it. A comma at either end would be taken for a separator: a leading one is kept
 * by saying `./` first, a trailing one by closing with an empty fragment, or by encoding it where it is in the
 * fragment already. None of this changes what is requested.
 *
 * The ends are walked, not matched. A pattern that looks for something at the end starts over inside every run
 * of it, which takes time by the square of the run's length, and the URL is not ours to trust with that.
 */
export function normalise(url: string): string {
  let [start, end] = [0, url.length];
  while (start < end && url.charCodeAt(start) <= 0x20) start++;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end--;
  const out = url.slice(start, end).replace(/[\t\n\r]/g, "").replace(/ /g, "%20").replace(/\f/g, "%0C");
  const led = out.startsWith(",") ? `./${out}` : out;
  if (!led.endsWith(",")) return led;
  if (!led.includes("#")) return `${led}#`;
  let cut = led.length;
  while (led.charCodeAt(cut - 1) === 0x2c) cut--;
  return led.slice(0, cut) + "%2C".repeat(led.length - cut);
}

/**
 * The URL of an artwork image `width` CSS pixels wide: the template with `{w}` and `{h}` filled in.
 *
 * The image keeps the artwork's own shape unless `height` says otherwise, and is never asked for larger than
 * the artwork comes. The URL is the one the API gave, spelled as a browser would read it, with numbers put in:
 * where it points is not checked.
 */
export function artworkUrl(artwork: tArtworkSource, width: number, options: tArtworkOptions = {}): string {
  return image(read(artwork, width, options), 1).url;
}

/**
 * A `srcset` for an image shown `width` CSS pixels wide: one candidate per pixel density, so a dense screen
 * gets a sharper image and a plain one a smaller file.
 *
 * Each candidate carries the density it was asked for. Where the artwork does not come large enough for one,
 * the largest it has is offered once, under the density that image amounts to.
 */
export function artworkSrcSet(artwork: tArtworkSource, width: number, options: tArtworkSrcSetOptions = {}): string {
  const request = read(artwork, width, options);
  const { densities = [1, 2, 3] } = options as { readonly densities?: unknown };
  // The length is read once too: a list that grows as it is read cannot keep this going.
  const count = Array.isArray(densities) ? densities.length : 0;
  if (count === 0 || count > MAX_DENSITIES) throw new TypeError(`artwork: densities must be an array of 1 to ${String(MAX_DENSITIES)} numbers above 0`);
  const candidates: string[] = [];
  const [urls, descriptors] = [new Set<string>(), new Set<string>()];
  for (let i = 0; i < count; i++) {
    const density = length(`densities[${String(i)}]`, (densities as unknown[])[i]);
    const { url, scale } = image(request, density);
    // The density as it was asked for, never worked back from the pixels: those are rounded, and 50 pixels for
    // a width of 50.4 would say 0.99x, which a 1x screen passes over for the next size up. Only a box that had
    // to shrink says something else, and then to three figures, which is as fine as a screen's density gets.
    const descriptor = `${String(scale < 1 ? Number((density * scale).toPrecision(3)) : density)}x`;
    // A browser keeps the first candidate of each density, and an image offered twice is offered once.
    if (urls.has(url) || descriptors.has(descriptor)) continue;
    urls.add(url);
    descriptors.add(descriptor);
    candidates.push(`${url} ${descriptor}`);
  }
  // A URL with no size in it is one image of a size nobody here knows, so it is offered alone and unlabelled:
  // any density put on it would be a guess, and a browser would lay the image out by the guess.
  if (!request.sized) return image(request, 1).url;
  return candidates.join(", ");
}

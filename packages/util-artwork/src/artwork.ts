/** What is read from an artwork object. Any `tArtwork` from `@open-music-sdk/types` fits. */
export interface tArtworkSource {
  /** The URL template. `{w}` and `{h}` stand for the pixel size. */
  readonly url: string;
  /** The widest the image comes, in pixels. Nothing larger is asked for. */
  readonly width?: number | null | undefined;
  /** The tallest the image comes, in pixels. */
  readonly height?: number | null | undefined;
}

export interface tArtworkOptions {
  /** Height in CSS pixels. Default: the height that keeps the artwork's own shape at `width`, or `width` where its shape is unknown. */
  readonly height?: number | undefined;
  /** What replaces `{f}` in a template that has it: the file format. Default `"jpg"`. */
  readonly format?: string | undefined;
  /** What replaces `{c}` in a template that has it: the crop code. Default `"bb"`, the whole image fitted inside the box. */
  readonly crop?: string | undefined;
}

export interface tArtworkSrcSetOptions extends tArtworkOptions {
  /** The pixel densities to offer. Default 1, 2 and 3. */
  readonly densities?: readonly number[] | undefined;
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function length(name: string, value: unknown): number {
  if (positive(value)) return value;
  throw new TypeError(`artwork: ${name} must be a number above 0, got ${typeof value === "number" ? String(value) : typeof value}`);
}

/** A word that goes into the URL as it is, so it may be nothing that could change what the URL means. */
function word(name: string, value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value === "string" && /^[a-z0-9]+$/i.test(value)) return value;
  throw new TypeError(`artwork: ${name} must be letters and digits`);
}

/** What one call was given, read once and checked. Nothing is read from the artwork or the options after this. */
interface tRequest {
  readonly template: string;
  /** How large the artwork comes, where it says. */
  readonly max: { readonly width: number; readonly height: number } | undefined;
  /** The box wanted, in CSS pixels. With no height, the box takes the artwork's shape. */
  readonly width: number;
  readonly height: number | undefined;
  readonly format: string;
  readonly crop: string;
}

/**
 * Reads the artwork and the options, each property once, and checks them. What the artwork holds is data from
 * somewhere else: an object that answers differently the second time it is asked is never asked a second time.
 */
function read(artwork: tArtworkSource, width: number, options: tArtworkOptions): tRequest {
  if (typeof artwork !== "object" || (artwork as unknown) === null) throw new TypeError("artwork: expected an artwork object with a url");
  const { url, width: maxWidth, height: maxHeight } = artwork;
  const template = typeof url === "string" ? normalise(url) : "";
  if (template === "") throw new TypeError("artwork: expected an artwork object with a url");
  if (typeof options !== "object" || (options as unknown) === null) throw new TypeError("artwork: options must be an object");
  const { height, format, crop } = options;
  return {
    template,
    max: positive(maxWidth) && positive(maxHeight) ? { width: maxWidth, height: maxHeight } : undefined,
    width: length("width", width),
    height: height === undefined ? undefined : length("height", height),
    format: word("format", format, "jpg"),
    crop: word("crop", crop, "bb"),
  };
}

/**
 * The template filled in for the box at `density`, and how many pixels wide the image asked for is. The box
 * keeps its shape and shrinks to what the artwork has when it asks for more.
 */
function image({ template, max, width, height, format, crop }: tRequest, density: number): { url: string; pixels: number } {
  const boxWidth = width * density;
  const boxHeight = height === undefined ? (max ? (boxWidth * max.height) / max.width : boxWidth) : height * density;
  const scale = max ? Math.min(1, max.width / boxWidth, max.height / boxHeight) : 1;
  const [w, h] = [Math.max(1, Math.round(boxWidth * scale)), Math.max(1, Math.round(boxHeight * scale))];
  // Past this a number prints with an exponent, and what goes into the URL has to be digits.
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h)) throw new TypeError("artwork: the size asked for is too large");
  const url = template.replaceAll("{w}", String(w)).replaceAll("{h}", String(h)).replaceAll("{f}", format).replaceAll("{c}", crop);
  return { url, pixels: w };
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
 * gets a sharper image and nobody downloads more than their screen can show.
 *
 * Each candidate says the density it really has. Where the artwork does not come large enough for a density,
 * the largest it has is offered once, under the density that image amounts to.
 */
export function artworkSrcSet(artwork: tArtworkSource, width: number, options: tArtworkSrcSetOptions = {}): string {
  const request = read(artwork, width, options);
  const densities: unknown = options.densities ?? [1, 2, 3];
  // The length is read once too: a list that grows as it is read cannot keep this going.
  const count = Array.isArray(densities) ? densities.length : 0;
  if (count === 0) throw new TypeError("artwork: densities must be a non-empty array of numbers above 0");
  const candidates = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const { url, pixels } = image(request, length(`densities[${String(i)}]`, (densities as unknown[])[i]));
    const descriptor = `${String(Math.max(0.01, Number((pixels / request.width).toFixed(2))))}x`;
    // A browser keeps the first candidate of each density, and an image offered twice is offered once.
    if (!candidates.has(url) && ![...candidates.values()].includes(descriptor)) candidates.set(url, descriptor);
  }
  return [...candidates].map(([url, descriptor]) => `${url} ${descriptor}`).join(", ");
}

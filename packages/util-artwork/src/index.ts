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

/**
 * The template filled in for a box of `width` by `height` CSS pixels at `density`, and how many pixels wide the
 * image asked for is. The box keeps its shape and shrinks to what the artwork has when it asks for more.
 */
function image(artwork: tArtworkSource, width: number, options: tArtworkOptions, density: number): { url: string; pixels: number } {
  if (typeof artwork !== "object" || (artwork as unknown) === null || typeof artwork.url !== "string" || artwork.url === "")
    throw new TypeError("artwork: expected an artwork object with a url");
  if (typeof options !== "object" || (options as unknown) === null) throw new TypeError("artwork: options must be an object");
  const [format, crop] = [word("format", options.format, "jpg"), word("crop", options.crop, "bb")];
  const [maxWidth, maxHeight] = [artwork.width, artwork.height];
  const shapeKnown = positive(maxWidth) && positive(maxHeight);
  const boxWidth = length("width", width) * density;
  const boxHeight = options.height === undefined ? (shapeKnown ? (boxWidth * maxHeight) / maxWidth : boxWidth) : length("height", options.height) * density;
  const scale = shapeKnown ? Math.min(1, maxWidth / boxWidth, maxHeight / boxHeight) : 1;
  const [w, h] = [Math.max(1, Math.round(boxWidth * scale)), Math.max(1, Math.round(boxHeight * scale))];
  // Past this a number prints with an exponent, and what goes into the URL has to be digits.
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h)) throw new TypeError("artwork: the size asked for is too large");
  const url = artwork.url.replaceAll("{w}", String(w)).replaceAll("{h}", String(h)).replaceAll("{f}", format).replaceAll("{c}", crop);
  return { url, pixels: w };
}

/**
 * The URL of an artwork image `width` CSS pixels wide: the template with `{w}` and `{h}` filled in.
 *
 * The image keeps the artwork's own shape unless `height` says otherwise, and is never asked for larger than
 * the artwork comes. The URL is the one the API gave, with numbers put in: it is not checked or rewritten.
 */
export function artworkUrl(artwork: tArtworkSource, width: number, options: tArtworkOptions = {}): string {
  return image(artwork, width, options, 1).url;
}

/**
 * A `srcset` for an image shown `width` CSS pixels wide: one candidate per pixel density, so a dense screen
 * gets a sharper image and nobody downloads more than their screen can show.
 *
 * Each candidate says the density it really has. Where the artwork does not come large enough for a density,
 * the largest it has is offered once, under the density that image amounts to.
 */
export function artworkSrcSet(artwork: tArtworkSource, width: number, options: tArtworkSrcSetOptions = {}): string {
  const densities: unknown = (options as tArtworkSrcSetOptions | null)?.densities ?? [1, 2, 3];
  if (!Array.isArray(densities) || densities.length === 0) throw new TypeError("artwork: densities must be a non-empty array of numbers above 0");
  const candidates = new Map<string, string>();
  for (let i = 0; i < densities.length; i++) {
    const { url, pixels } = image(artwork, width, options, length(`densities[${String(i)}]`, densities[i]));
    const descriptor = `${String(Math.max(0.01, Number((pixels / width).toFixed(2))))}x`;
    // In a srcset white space ends a URL and a comma at either end of one is a separator, so those are escaped.
    const candidate = url.replace(/[\t\n\f\r ]+|^,+|,+$/g, encodeURIComponent);
    // A browser keeps the first candidate of each density, and an image offered twice is offered once.
    if (!candidates.has(candidate) && ![...candidates.values()].includes(descriptor)) candidates.set(candidate, descriptor);
  }
  return [...candidates].map(([url, descriptor]) => `${url} ${descriptor}`).join(", ");
}

// Shows: artworkUrl, next/image. Guide: /guides/artwork
// #region artwork
"use client";
// Apple Music artwork through next/image. Nothing here is the sample's own, so
// the file can be taken into another app as it is.
//
// A client component, since a loader is a function, which a server component
// cannot hand to the page. A server component can still render it.
import {
  artworkUrl,
  type tArtwork,
  type tArtworkFormat,
} from "@open-music-sdk/react";
import Image, { type ImageLoader } from "next/image";
import type { ComponentProps } from "react";

/**
 * What next/image takes, but the props the artwork decides and those only
 * Next's own optimizer, which is never used, would read.
 */
type tImageProps = Omit<
  ComponentProps<typeof Image>,
  "src" | "loader" | "quality" | "unoptimized"
>;

export interface tArtworkProps extends tImageProps {
  /** A resource's `attributes.artwork`. With none, the box is left empty. */
  readonly artwork: tArtwork | undefined;
  /** The file format, such as `"webp"`. Default: the one the URL names. */
  readonly format?: tArtworkFormat | undefined;
  /**
   * The hosts the artwork may come from, such as `["mzstatic.com"]`. Pass it
   * for artwork that didn't come straight from Apple's API.
   */
  readonly hosts?: readonly string[] | undefined;
}

/**
 * An artwork laid out as next/image lays out any image: `width` CSS pixels
 * wide, or filling its parent with `fill`. Without a `height`, the artwork's
 * own shape decides it.
 *
 * next/image asks the loader for each width its `srcset` offers, and Apple's
 * image server makes each one, so Next's own optimizer is never used. The
 * artwork's own colour fills the box while the image loads.
 */
export function Artwork({
  artwork,
  format,
  hosts,
  ...props
}: tArtworkProps) {
  const width = props.width === undefined ? undefined : Number(props.width);
  const height = props.height ?? heightOf(artwork, width);
  // An image that fills its parent takes no height, so it is given none.
  const size = height === undefined ? {} : { height };
  if (artwork === undefined) {
    return <Image {...props} {...size} src={BLANK} />;
  }
  const options = { format, hosts };
  const loader: ImageLoader = ({ width }) =>
    artworkUrl(artwork, width, options);
  // A URL with no size to fill in, as the artwork of a listener's own
  // playlist has, is one image at every width: next/image is told so, rather
  // than handed a loader that cannot honour a width. It then uses `src` as it
  // is, so that comes from artworkUrl too, where `hosts` is checked. Any width
  // gives the same URL.
  const sized = SIZED.test(artwork.url);
  return (
    <Image
      {...props}
      {...size}
      loader={loader}
      unoptimized={!sized}
      src={sized ? artwork.url : artworkUrl(artwork, 1, options)}
      style={{ backgroundColor: colourOf(artwork), ...props.style }}
    />
  );
}

/**
 * Whether a URL has a size to fill in, as artworkUrl reads one: `{w}` or
 * `{h}`, with the braces percent-encoded or not.
 */
const SIZED = /\{[wh]\}|%7[Bb][wh]%7[Dd]/;

/** An image of nothing, for a box with no artwork to show. */
const BLANK = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";

/**
 * The height that keeps the artwork's own shape at `width`: `width` itself
 * where the artwork doesn't say how large it comes, and none with no width.
 */
function heightOf(
  artwork: tArtwork | undefined,
  width: number | undefined,
): number | undefined {
  if (width === undefined) return undefined;
  if (artwork === undefined || !(artwork.width > 0 && artwork.height > 0)) {
    return width;
  }
  return Math.round((width * artwork.height) / artwork.width);
}

/**
 * The artwork's average colour, as CSS. It is checked, as the server writes
 * a style into the page's HTML as it is: anything but six hex digits could
 * add declarations of its own.
 */
function colourOf({ bgColor }: tArtwork): string | undefined {
  if (bgColor === undefined) return undefined;
  return /^[0-9a-f]{6}$/i.test(bgColor) ? `#${bgColor}` : undefined;
}
// #endregion artwork

"use client";
// Shows: artworkUrl, next/image. Guide: /guides/artwork
//
// A client component, since a loader is a function, which a server component
// cannot hand to the page.
import { artworkUrl, type tArtwork } from "@open-music-sdk/react";
import Image, { type ImageLoader } from "next/image";

interface tCoverProps {
  readonly artwork: tArtwork | undefined;
  /** How wide the cover is shown, in CSS pixels. */
  readonly size: number;
  /** Loaded only once it nears the screen. */
  readonly lazy?: boolean;
}

// #region artwork
/**
 * A cover shown `size` CSS pixels wide. next/image asks the loader for each
 * width its `srcset` offers, and Apple's image server makes each one, so
 * Next's own optimizer is never used. A resource with no artwork gets an empty
 * box of the same size.
 */
export function Cover({ artwork, size, lazy = false }: tCoverProps) {
  const loading = lazy ? "lazy" : "eager";
  if (artwork === undefined) {
    return <img alt="" width={size} height={size} loading={loading} />;
  }
  const loader: ImageLoader = ({ width }) => artworkUrl(artwork, width);
  // A URL with no size to fill in, as the artwork of a listener's own
  // playlist has, is one image at every width: next/image is told so, rather
  // than handed a loader that cannot honour a width. It then uses `src` as it
  // is, so that comes from artworkUrl too, where a `hosts` check would run.
  const sized = artwork.url.includes("{w}");
  return (
    <Image
      loader={loader}
      unoptimized={!sized}
      src={sized ? artwork.url : artworkUrl(artwork, size)}
      alt=""
      width={size}
      height={size}
      loading={loading}
    />
  );
}
// #endregion artwork

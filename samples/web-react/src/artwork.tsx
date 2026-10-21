// Shows: artworkImage. Guide: /guides/artwork
import { artworkImage, type tArtwork } from "@open-music-sdk/react";

interface tCoverProps {
  readonly artwork: tArtwork | undefined;
  /** How wide the cover is shown, in CSS pixels. */
  readonly size: number;
  /** Loaded only once it nears the screen. */
  readonly lazy?: boolean;
}

// #region artwork
/**
 * An `<img>` for an artwork shown `size` CSS pixels wide, with a `srcSet` for
 * screens of higher density. A resource with no artwork gets an empty box of
 * the same size.
 */
export function Cover({ artwork, size, lazy = false }: tCoverProps) {
  const loading = lazy ? "lazy" : undefined;
  if (artwork === undefined) {
    return <img alt="" width={size} height={size} loading={loading} />;
  }
  // React spells the attribute srcSet.
  const { srcset, ...image } = artworkImage(artwork, size);
  return <img alt="" {...image} srcSet={srcset} loading={loading} />;
}
// #endregion artwork

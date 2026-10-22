// Shows: artworkImage. Guide: /guides/artwork
// #region cover
import { artworkImage, type tArtwork } from "@open-music-sdk/browser";
import { h } from "./dom";

/**
 * An `<img>` for an artwork shown `size` CSS pixels wide, with a `srcset` for
 * screens of higher density. A resource with no artwork gets an empty box of
 * the same size.
 */
export function cover(
  artwork: tArtwork | undefined,
  size: number,
): HTMLImageElement {
  if (artwork === undefined) {
    return h("img", { alt: "", width: size, height: size });
  }
  return h("img", { alt: "", ...artworkImage(artwork, size) });
}
// #endregion cover

# @open-music-sdk/util-artwork

Artwork in the Apple Music API is not an image URL but a template for one:
`https://…/{w}x{h}bb.jpg`, with the pixel size left for you to fill in. This package fills it in, and
builds the `srcset` that gives a dense screen a sharper image. Two functions, strings in and strings
out, no dependencies.

You probably want one of the integrations instead (`browser`, `react`, `next`) once they exist. Use
this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/util-artwork
```

```ts
import { artworkSrcSet, artworkUrl } from "@open-music-sdk/util-artwork";

const { artwork } = song.attributes; // { url: "https://…/{w}x{h}bb.jpg", width: 3000, height: 3000, … }

img.src = artworkUrl(artwork, 300); // https://…/300x300bb.jpg
img.srcset = artworkSrcSet(artwork, 300); // https://…/300x300bb.jpg 1x, https://…/600x600bb.jpg 2x, https://…/900x900bb.jpg 3x
img.width = img.height = 300;
```

Some resources have no artwork. Check before you call: `artwork && artworkUrl(artwork, 300)`.

## What is in it

| Export | Does |
| --- | --- |
| `artworkUrl(artwork, width, options?)` | The URL of the image `width` CSS pixels wide |
| `artworkSrcSet(artwork, width, options?)` | A `srcset` for an image shown `width` CSS pixels wide: one candidate per pixel density |

`artwork` is the object the API gives: anything with a `url`, and a `width` and `height` if it has
them. Every `tArtwork` from `@open-music-sdk/types` fits.

| Option | |
| --- | --- |
| `height` | Height in CSS pixels. Default: the height that keeps the artwork's own shape at `width`. |
| `format` | What replaces `{f}` in a template that has it. Default `"jpg"`. |
| `crop` | What replaces `{c}` in a template that has it. Default `"bb"`, the whole image fitted inside the box. |
| `densities` | For `artworkSrcSet`: the pixel densities to offer. Default `[1, 2, 3]`. |

A `width`, `height` or density that is not a number above zero is a `TypeError`, as is a `format` or
`crop` that is anything but letters and digits, and an `artwork` without a `url`.

## Size

- **Shape.** With no `height`, the image keeps the artwork's own shape: a 1920 by 1080 still at width
  320 is asked for as `320x180`. Artwork that does not say how large it comes is taken to be square.
- **Never larger than it comes.** The artwork's `width` and `height` are the largest Apple has. A box
  that asks for more is shrunk to fit, keeping its shape. Artwork with no size is not capped.
- **Whole pixels.** Sizes are rounded, and never below one.

## srcset

Each candidate is the image at `width` times a density, labelled with that density. Where the
artwork does not come large enough for one, the largest it has is offered once, under the density
that image amounts to: a 500 pixel cover shown at 300 gives
`…/300x300bb.jpg 1x, …/500x500bb.jpg 1.67x`, so a browser neither downloads the same image twice nor
mistakes its size.

Give the `<img>` its `width` and `height` as well. The `srcset` says which file to fetch; the
attributes say how much room to keep for it.

## One URL

`artworkUrl` and `artworkSrcSet` give the same URL, character for character, spelled the way a
browser reads a `src`: white space is dropped from its ends, tabs and line breaks from anywhere, and
a space inside is written `%20`. A comma at either end, which a `srcset` would take for a separator,
is kept by writing `./` before it or an empty `#` after it. None of this changes what is requested,
so a `src` and a `srcset` never point at different places, and a check you make on the URL
`artworkUrl` returns holds for the `srcset` too.

## The URL is the API's

`artworkUrl` puts numbers into the URL the API returned and, apart from that spelling, changes nothing. It does not check
where the URL points, what scheme it has, or whether it is a URL at all. If your artwork objects can
come from anywhere but Apple's API, vet them before they reach an `<img>`.

`{f}` and `{c}` are not in Apple's reference, which documents only `{w}x{h}`. They appear in some of
the templates the API returns, and a template that has them does not work until they are filled in.

## Not here

- **Screen density detection.** `srcset` is how a browser picks; nothing here reads `devicePixelRatio`.
- **Width descriptors** (`300w` with `sizes`), for images whose shown width depends on the layout.
- **Colours.** `bgColor` and `textColor1` to `textColor4` are hex without the `#`; prefix one and it
  is a CSS colour.
- **Loading, caching, or placeholders.** That is the `<img>` element's job.

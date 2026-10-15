# @open-music-sdk/util-artwork

Image URLs from Apple's [artwork templates](https://open-music-sdk.github.io/js/glossary#artwork-template). Apple
sends a URL such as `https://…/{w}x{h}bb.jpg`, with the pixel size left for you to fill in. This package fills it
in, and builds the `srcset` that gives a dense screen a sharper image. Strings and numbers go in, and strings and
numbers come out.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which re-export this package's functions. Use this one to
build your own client.

```
pnpm add @open-music-sdk/util-artwork
```

Its one dependency is [`core`](../core/README.md), for the check on where a URL points, and that check is all of
`core` an app carries because of this package.

## Example

Anywhere: in a page, on a server, or wherever you write HTML. Nothing here touches the page or the network:

```ts
import { artworkImage } from "@open-music-sdk/util-artwork";

const artwork = song.attributes?.artwork; // some resources have none: check before you call

if (artwork) Object.assign(img, artworkImage(artwork, 300));
// img.src     https://…/300x300bb.jpg
// img.srcset  https://…/300x300bb.jpg 1x, https://…/600x600bb.jpg 2x, https://…/900x900bb.jpg 3x
// img.width   300
// img.height  300
```

## What's in it

Each function is named for what it gives back.

| Export | What it does |
| --- | --- |
| `artworkImage(artwork, width, options?)` | Everything an `<img>` needs, `{ src, srcset, width, height }`, worked out together so they agree |
| `artworkUrl(artwork, width, options?)` | The URL of the image `width` CSS pixels wide: the `src` alone |
| `artworkSrcSet(artwork, width, options?)` | A `srcset` with one candidate for each pixel density: the `srcset` alone |
| `FORMATS` | The file formats Apple's image server converts to, which `format` takes |
| `tArtworkSource`, `tArtworkOptions`, `tArtworkSrcSetOptions`, `tArtworkImage`, `tArtworkFormat` | What the functions take and give |

Use `artworkImage` unless you need only one of the parts. Every `tArtwork` from `@open-music-sdk/types` is an
artwork these functions take.

The package doesn't read `devicePixelRatio`, since a `srcset` is how a browser picks. It doesn't offer width
descriptors (`300w` with `sizes`), and it doesn't load or cache an image or show a placeholder: that's the `<img>`
element's job.

## Learn more

- [Show artwork](https://open-music-sdk.github.io/js/guides/artwork): sizes, crops and formats, the `srcset`, and
  checking where a URL points with `hosts`
- [Security model](https://open-music-sdk.github.io/js/concepts/security#urls-in-apple-s-answers), for what a URL
  from outside your app can do
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences#util-artwork), for what
  Apple documents of artwork and what was seen
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/util-artwork/)

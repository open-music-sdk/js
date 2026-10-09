# @open-music-sdk/util-artwork

Artwork in the Apple Music API is not an image URL but a template for one:
`https://…/{w}x{h}bb.jpg`, with the pixel size left for you to fill in. This package fills it in, and
builds the `srcset` that gives a dense screen a sharper image. Strings and numbers in, strings and
numbers out, no dependencies.

You probably want one of the integrations instead (`browser`, `react`, `next`) once they exist. Use
this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/util-artwork
```

```ts
// In a browser, or anywhere that writes HTML: nothing here touches the DOM or the network.
import { artworkImage } from "@open-music-sdk/util-artwork";

const artwork = song.attributes?.artwork; // { url: "https://…/{w}x{h}bb.jpg", width: 3000, height: 3000, … }

if (artwork) Object.assign(img, artworkImage(artwork, 300));
// img.src     https://…/300x300bb.jpg
// img.srcset  https://…/300x300bb.jpg 1x, https://…/600x600bb.jpg 2x, https://…/900x900bb.jpg 3x
// img.width   300
// img.height  300
```

```tsx
// In React, where the attribute is spelled srcSet.
const { srcset, ...image } = artworkImage(artwork, 300);
return <img {...image} srcSet={srcset} alt={song.attributes?.name} />;
```

Some resources have no artwork, and a resource may come without its attributes. Check before you
call, as above.

## What is in it

| Export | Does |
| --- | --- |
| `artworkImage(artwork, width, options?)` | Everything an `<img>` needs: `{ src, srcset, width, height }`, worked out together |
| `artworkUrl(artwork, width, options?)` | The URL of the image `width` CSS pixels wide: the `src` alone |
| `artworkSrcSet(artwork, width, options?)` | A `srcset` for an image shown `width` CSS pixels wide, one candidate per pixel density: the `srcset` alone |

Reach for `artworkImage` unless you need only one of the parts. The four belong together: a browser
takes `src` for the 1x image wherever the `srcset` does not offer one, and sizes an image that has
no `width` and `height` by the density of whichever candidate it took. Worked out separately they
can disagree; from one call they cannot.

`artwork` is the object the API gives: anything with a `url`, and a `width` and `height` if it has
them. Every `tArtwork` from `@open-music-sdk/types` fits. A template that has been through a URL
parser on its way to you, and has `%7Bw%7D` for `{w}`, is the same template and is filled in.

| Option | |
| --- | --- |
| `height` | Height in CSS pixels. Default: the height that keeps the artwork's own shape at `width`. |
| `format` | The file format: `"jpg"`, `"jpeg"`, `"png"`, `"webp"`, `"heic"` or `"heif"`. Default: the one the template names. |
| `crop` | Apple's code for how the image is cut to the box. Default: the one the template names, usually `"bb"`, the whole image fitted inside the box. |
| `densities` | For `artworkImage` and `artworkSrcSet`: the pixel densities to offer, 16 at most. Default `[1, 2, 3]`. |
| `hosts` | The hosts the artwork may come from, such as `["mzstatic.com"]`. Default: the URL is not checked. See [Where the URL points](#where-the-url-points). |

A `width`, `height` or density that is not a number above zero, and no more than
`Number.MAX_SAFE_INTEGER`, is a `TypeError`, as is a `format`
that is not one of the six, a `crop` that is not shaped like a crop code, and an `artwork` without a
`url`.

## Format and crop

A template says how the image is cut and encoded in its file name: `{w}x{h}bb.jpg` is cut `bb` and
encoded `jpg`. `format` and `crop` write over those, so `artworkUrl(artwork, 300, { format: "webp" })`
gives `…/300x300bb.webp`, about a third of the bytes of the JPEG. Some templates leave them open as
`{c}` and `{f}` instead; those are filled in the same way, with `bb` and `jpg` if you do not say.

- **Formats** are the six Apple's image server was seen to convert to. It refuses `avif` and `bmp`,
  and for `gif` and `tiff` it sends a JPEG under another name, so those are a `TypeError` here.
- **Crop codes** are Apple's and undocumented, so any code of the right shape is accepted: letters
  and digits, with single dots or hyphens between, case kept. `bb` fits the whole image inside the
  box and never enlarges it; `cc` cuts a square from the centre; `sr` fills the box; `bb-60` is
  `bb` at a lower JPEG quality. Codes such as `SC.DN01` come with some editorial artwork.
- **A URL that is not a template of this form**, such as a fixed URL for a playlist's own artwork,
  says nothing about cut or encoding and is returned as it is.

## Size

- **Shape.** With no `height`, the image keeps the artwork's own shape: a 1920 by 1080 still at width
  320 is asked for as `320x180`. Artwork that does not say how large it comes is taken to be square.
  What the artwork says of its size is data, never an error: a `width` or `height` on it that is
  no size, such as `null`, zero or text, is one it did not give.
- **Never larger than it comes.** The artwork's `width` and `height` are the largest Apple has. A box
  that asks for more is shrunk, keeping its shape. Artwork that gives only one of the two is held to
  that one. No side is ever asked for past 10,000 pixels, where Apple's image server stops.
- **A box of another shape.** With `height`, what "more" means depends on the crop. A crop that fills
  the box needs the artwork to cover it both ways. `bb` stands the whole image inside the box, so the
  box is shrunk only once the image inside it would be larger than the artwork: a 1500 pixel cover
  in a 1200 by 300 slot is offered boxes up to `6000x1500`, which holds it at full size.
- **Whole pixels.** Sizes are rounded, and never below one. A height that follows from the width is
  rounded up, so that the image comes back the full width that was asked for.

## srcset

Each candidate is the image at `width` times a density, labelled with that density. Where the
artwork does not come large enough for one, the largest it has is offered once, under the density
that image amounts to: a 500 pixel cover shown at 300 gives
`…/300x300bb.jpg 1x, …/500x500bb.jpg 1.67x`, so a browser neither downloads the same image twice nor
mistakes its size.

A URL with no size to fill in, such as a fixed URL for a playlist's own artwork, is one image of a
size nobody here knows. It is offered alone, with no density on it, since any would be a guess.

If you use `artworkSrcSet` on its own, give the `<img>` its `width` and `height` as well, and know
what a browser does with `src`: where the `srcset` has no 1x candidate, `src` is taken as one. A
200 pixel cover shown at 300 has a `srcset` of `…/200x200bb.jpg 0.667x` and the same URL as its
`src`, so with both set the browser reads that image as 1x, and without `width` and `height` lays it
out 200 pixels wide, not 300. `artworkImage` gives all four for that reason.

## Layout

`artworkImage` gives `width` and `height` in whole CSS pixels: the size the image itself is shown at,
whatever resolution was fetched for it.

- With no `height` option, that is `width` and the height the artwork's shape gives it.
- With a `height` and a crop that fills the box, it is the box.
- With a `height` and `bb`, which stands the whole image inside the box, it is the image standing
  there: a square cover in a 1200 by 300 slot is laid out 300 by 300. Setting the box's own size on
  the `<img>` would stretch it.

## One URL

`artworkUrl` and `artworkSrcSet` give the same URL, character for character, spelled the way a
browser reads a `src`: white space is dropped from its ends, tabs and line breaks from anywhere, and
a space inside is written `%20`. A comma at either end, which a `srcset` would take for a separator,
is kept by writing `./` before it or an empty `#` after it. None of this changes what is requested,
so a `src` and a `srcset` never point at different places, and a check you make on the URL
`artworkUrl` returns holds for the `srcset` too.

## Where the URL points

These functions fill in the URL the API gave. Unless you ask, they do not look at where it points:
not its scheme, not its host, not whether it is a URL at all. That is enough for artwork that came
from Apple's API a moment ago. It is not enough for artwork that could have come from anywhere
else: a cache or a database that others can write to, a link someone shared, another service.

What a bad URL can do depends on where you put it:

- **An `<img>`.** No script runs, but the browser makes the request: to someone else's host, who
  learns your visitor was there, or, for a URL with no host, to your own site with your visitor's
  cookies.
- **A link, `window.open` or `location`**, as for "open the artwork full size": a `javascript:` URL
  runs.
- **A request your server makes**, as in an image proxy or a social card: it goes wherever the URL
  says, from inside your network.

Pass `hosts` to have it checked:

```ts
artworkImage(artwork, 300, { hosts: ["mzstatic.com"] });
```

With `hosts`, a URL that is not `https` on one of those hosts or a subdomain of one, with no port
and no credentials, is a `TypeError`, and no URL is returned. The check is made on the URL as it is
returned, read by the parser a browser reads it with. Apple serves catalog artwork from
`is1-ssl.mzstatic.com` and its numbered siblings; artwork a listener gave a playlist of their own
may be served from elsewhere, so look at what your app receives before you settle the list.

What comes back is a URL, not markup. Assigned to an element, or given to React, it is escaped for
you. Written into HTML by hand it needs escaping like any other attribute value, and it is not safe
to put inside a CSS `url(…)` as it is.

## What Apple documents, and what it does not

Apple's reference documents `{w}x{h}` and nothing else. `{f}` and `{c}`, the formats, the crop codes,
how each crop fills or fits the box, and the limit of 10,000 pixels a side are what Apple's own pages
and image server were seen to do when this was written. A template that has `{c}` or `{f}` does not
work until they are filled in.

## Not here

- **Screen density detection.** `srcset` is how a browser picks; nothing here reads `devicePixelRatio`.
- **Width descriptors** (`300w` with `sizes`), for images whose shown width depends on the layout.
- **Colours.** `bgColor` and `textColor1` to `textColor4` are hex without the `#`; prefix one and it
  is a CSS colour.
- **Loading, caching, or placeholders.** That is the `<img>` element's job.

# Show artwork

Apple doesn't send an image URL for artwork. It sends an [artwork template](../glossary#artwork-template): a URL
such as `https://…/{w}x{h}bb.jpg`, with the pixel size left for you to fill in. In this guide you turn one into an
`<img>` that is sharp on a dense screen and laid out at the right size.

Before you start, you need:

- a resource with its attributes, such as a song or an album you fetched with a client.

The artwork functions come from `@open-music-sdk/browser`, `@open-music-sdk/react` and `@open-music-sdk/server`
alike. They run anywhere: in a page, on a server, or wherever you write HTML. They touch neither the page nor the
network.

## 1. Check that the resource has artwork

Anywhere, read the artwork from the resource's attributes:

```ts
const artwork = song.attributes?.artwork;
// { url: "https://…/{w}x{h}bb.jpg", width: 3000, height: 3000, bgColor: "…", … }
```

Some resources have no artwork, and a resource can come without its attributes. The functions take an artwork,
not the lack of one, so check before you call them. Every example below does.

`width` and `height` are the largest the image comes, in pixels. The artwork also carries colours you can use
while the image loads: `bgColor` and `textColor1` to `textColor4`, each a hex colour without the `#`.

## 2. Fill in an `<img>` with `artworkImage`

In your page, give `artworkImage` the artwork and the width you show the image at, in CSS pixels:

```ts
import { artworkImage } from "@open-music-sdk/browser";

if (artwork) Object.assign(img, artworkImage(artwork, 300));
// img.src     https://…/300x300bb.jpg
// img.srcset  https://…/300x300bb.jpg 1x, https://…/600x600bb.jpg 2x, https://…/900x900bb.jpg 3x
// img.width   300
// img.height  300
```

In a React component, the attribute is spelled `srcSet`:

```tsx
import { artworkImage, type tSong } from "@open-music-sdk/react";

export function Cover({ song }: { song: tSong }) {
  const artwork = song.attributes?.artwork;
  if (!artwork) return null;
  const { srcset, ...image } = artworkImage(artwork, 300);
  return <img {...image} srcSet={srcset} alt={song.attributes?.name} />;
}
```

`artworkImage` works out `src`, `srcset`, `width` and `height` together, and they have to agree. A browser takes
`src` as the 1x image wherever the `srcset` doesn't offer one, and lays out an image that has no `width` and
`height` by the density of whichever candidate it chose. Use it unless you need only one of the parts.

How the size is chosen:

- With no `height` option, the image keeps the artwork's own shape: a 1920 by 1080 still shown at 320 is asked
  for as `320x180`. Artwork that doesn't say how large it comes is taken to be square.
- No image is asked for larger than the artwork comes. A box that asks for more shrinks in its own shape. No side
  is asked for past 10,000 pixels, where Apple's image server stops.
- `width` and `height` are the size the image is shown at, in whole CSS pixels, whatever resolution was fetched.

## 3. Get one URL with `artworkUrl`

Anywhere, `artworkUrl` gives the URL of the image at one width, the `src` alone:

```ts
import { artworkUrl } from "@open-music-sdk/server";

const url = artworkUrl(artwork, 1200); // https://…/1200x1200bb.jpg
```

Use it where you need a single URL, such as an image for a link preview.

All three functions give the same URL, character for character. It is spelled the way a browser reads a `src`:
white space dropped from its ends, tabs and line breaks dropped from anywhere, and a space inside written `%20`.
None of this changes what is requested, so a check you make on the URL from `artworkUrl` holds for the `srcset`
too.

## 4. Build a `srcset` alone with `artworkSrcSet`

In your page, `artworkSrcSet` gives the `srcset` alone. Set the image's `width` and `height` yourself:

```ts
import { artworkSrcSet } from "@open-music-sdk/browser";

img.srcset = artworkSrcSet(artwork, 300, { densities: [1, 2] });
img.width = 300;
img.height = 300;
```

Each candidate is the image at the width times a density, labelled with that density. `densities` takes up to 16
numbers, and defaults to `[1, 2, 3]`.

Where the artwork doesn't come large enough for a density, the largest image it has is offered once, under the
density it amounts to. A 500-pixel cover shown at 300 gives `…/300x300bb.jpg 1x, …/500x500bb.jpg 1.67x`, so the
browser doesn't download the same image twice or mistake its size.

That is why you set `width` and `height`. A 200-pixel cover shown at 300 has the `srcset`
`…/200x200bb.jpg 0.667x`. Without `width` and `height`, a browser lays that image out 200 pixels wide, not 300.

A URL with no size to fill in, such as a fixed URL for a listener's own playlist artwork, is one image of unknown
size. It comes back alone, with no density.

## 5. Choose the format and the crop

Anywhere, `format` and `crop` write over what the template names. A template's file name says both:
`{w}x{h}bb.jpg` is cut `bb` and encoded `jpg`.

```ts
artworkUrl(artwork, 300, { format: "webp" }); // https://…/300x300bb.webp
```

`format` is one of `"jpg"`, `"jpeg"`, `"png"`, `"webp"`, `"heic"` or `"heif"`, the formats Apple's image server
was seen to convert to. For the one cover measured, WebP was a third of the JPEG's bytes.

`crop` is Apple's code for how the image is cut to the box. Apple doesn't document the codes, so any code of the
right shape is accepted: letters and digits, with single dots or hyphens between them. The ones seen:

| `crop` | What comes back |
| --- | --- |
| `bb` | The whole image, fitted inside the box and never enlarged. Most templates name it. |
| `cc` | A square as long as the box's longer side, whatever the box's shape |
| `sr` | The box, filled exactly |
| `bb-60` | `bb` at a lower JPEG quality |

Every code but `bb` that was tried enlarged the image when asked for more than there was. A code the SDK doesn't
know is taken to fill the box exactly.

To fit artwork into a box of another shape, pass `height` as well:

```ts
const image = artworkImage(artwork, 1200, { height: 300 });
```

What you get depends on the crop:

- With `bb`, the image stands inside the box. A square cover in a 1200 by 300 slot is laid out 300 by 300.
  Don't set the box's own size on the `<img>`, or the image is stretched.
- With a crop that fills the box, such as `sr`, the image is the box.
- With `cc`, it's a square as long as the longer of the two sides.

Some templates leave the crop and the format open, as `{c}` and `{f}`. They're filled in the same way, with `bb`
and `jpg` if you don't say. A URL that isn't a template of this form, such as a fixed URL for a listener's own
playlist artwork, is returned as it is.

Apple documents `{w}x{h}` and nothing else. `{c}`, `{f}`, the formats, the crop codes and the 10,000-pixel limit
are what Apple's image server was seen to do when the SDK was written.

## 6. Check where the URL points

The functions fill in the URL the API gave. Unless you ask, they don't look at where it points: not its scheme,
not its host, not whether it's a URL at all. That is enough for artwork that came from Apple's API a moment ago.

::: warning Artwork from anywhere else can point anywhere
Artwork from a cache, a database that others can write to, a shared link or another service can hold any URL.
What a bad URL can do depends on where you put it:

- In an `<img>`, no script runs, but the browser requests the URL. Someone else's host learns your visitor was
  there, or a URL with no host is requested from your own site, with your visitor's cookies.
- In a link, `window.open` or `location`, as for "open the artwork full size", a `javascript:` URL runs.
- In a request your server makes, as in an image proxy or a link preview, the request goes wherever the URL says,
  from inside your network.
:::

For artwork like that, pass `hosts`:

```ts
artworkImage(artwork, 300, { hosts: ["mzstatic.com"] });
```

With `hosts`, a URL that isn't `https` on one of those hosts or a subdomain of one, with no port and no
credentials, is a `TypeError`, and no URL is returned. `hosts` takes 1 to 16 bare host names, in lowercase. The check is made on
the URL as it is returned, read by the same parser a browser uses.

Apple serves catalog artwork from `is1-ssl.mzstatic.com` and its numbered siblings. Artwork a listener gave a
playlist of their own may come from elsewhere, so look at what your app receives before you settle the list.

What comes back is a URL, not markup. Assigned to an element, or given to React, it's escaped for you. Written
into HTML by hand, it needs escaping like any other attribute value, and it isn't safe to put inside a CSS
`url(…)` as it is.

## When something goes wrong

Each of these is a `TypeError`:

- an `artwork` that isn't an object with a `url`;
- a `width`, `height` or density that isn't a number above 0 and at most `Number.MAX_SAFE_INTEGER`;
- a `format` that isn't one of the six, or a `crop` that isn't shaped like a crop code;
- `densities` that isn't a list of 1 to 16 numbers, or `hosts` that isn't a list of host names;
- with `hosts`, an artwork whose URL isn't on one of them.

No error shows the URL. The message says which argument was wrong, and for a number, what it was.

## Next steps

- [Play song previews](./previews), with the artwork of the track that is playing.
- The reference for [`artworkImage`](../reference/@open-music-sdk/util-artwork/functions/artworkImage),
  [`artworkUrl`](../reference/@open-music-sdk/util-artwork/functions/artworkUrl),
  [`artworkSrcSet`](../reference/@open-music-sdk/util-artwork/functions/artworkSrcSet) and their
  [options](../reference/@open-music-sdk/util-artwork/interfaces/tArtworkSrcSetOptions).

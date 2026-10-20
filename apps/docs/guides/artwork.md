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
// { url: "https://…/{w}x{h}bb.jpg", width: 3000, height: 3000,
//   bgColor: "…", … }
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
// img.srcset  https://…/300x300bb.jpg 1x, https://…/600x600bb.jpg 2x,
//             https://…/900x900bb.jpg 3x
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

The [vanilla sample](../samples) draws every cover with one function. A resource with no artwork gets an empty box
of the same size, which the sample's crates draw as a plain sleeve with the name written on it:

<<< @/../../samples/web-vanilla/src/artwork.ts#artwork{ts}

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

`crop` is Apple's code for how the image is cut to the box, such as the `bb` most templates name. Apple doesn't
document the codes, so any code of the right shape is accepted: see
[`tArtworkOptions`](../reference/@open-music-sdk/util-artwork/interfaces/tArtworkOptions).

To fit artwork into a box of another shape, pass `height` as well:

```ts
const image = artworkImage(artwork, 1200, { height: 300 });
```

What you get depends on the crop:

- With `bb`, the whole image stands inside the box, never enlarged. A square cover in a 1200 by 300 slot is laid
  out 300 by 300. Don't set the box's own size on the `<img>`, or the image is stretched.
- With `sr`, the image fills the box exactly, enlarged if it must be. A code the SDK doesn't know is taken to do
  the same.
- With `cc`, it's a square as long as the longer of the two sides, enlarged if it must be.

Some templates leave the crop and the format open, as `{c}` and `{f}`. They're filled in the same way, with `bb`
and `jpg` if you don't say. A URL that isn't a template of this form, such as a fixed URL for a listener's own
playlist artwork, is returned as it is.

Apple documents `{w}x{h}` and nothing else. The rest is what its image server was seen to do: see
[Differences from Apple's documentation](../differences#util-artwork).

## 6. Check where the URL points

The functions fill in the URL the API gave, and don't look at where it points unless you ask. That is enough for
artwork that came from Apple's API a moment ago.

::: warning Artwork from anywhere else can point anywhere
Artwork from a cache, a database that others can write to, a shared link or another service can hold any URL.
Pass `hosts` for it. [URLs in Apple's answers](../concepts/security#urls-in-apple-s-answers) says what a bad URL
can do.
:::

Anywhere, pass the hosts the artwork may come from:

```ts
artworkImage(artwork, 300, { hosts: ["mzstatic.com"] });
```

With `hosts`, a URL that isn't `https` on one of those hosts or a subdomain of one is a `TypeError`, and no URL is
returned. Apple serves catalog artwork from `is1-ssl.mzstatic.com` and its numbered siblings. Artwork a listener
gave a playlist of their own may come from elsewhere, so look at what your app receives before you settle the
list.

What comes back is a URL, not markup. Assigned to an element, or given to React, it's escaped for you. Written
into HTML by hand, escape it like any other attribute value, and don't put it inside a CSS `url(…)` as it is.

## With `next/image`

In a Next.js app, `next/image` can take `artworkUrl` as its loader. It asks the loader for each width its `srcset`
offers, and Apple's image server makes each one, so Next's own optimizer is never used. A loader is a function, so
the component that holds it is a client component. The [Next sample](../samples)'s, in `app/artwork.tsx`:

<<< @/../../samples/web-nextjs/app/artwork.tsx#artwork{tsx}

What the sample showed, on 20 October 2026, in Next 16:

- Next picks the widths from its own list, not from the width you show the image at. A cover shown at 240 asks
  for `256x256`, labelled `1x`, and `640x640`, labelled `2x`: for each density, the first of Next's `imageSizes`
  and `deviceSizes` at least that wide. `artworkImage` asks for exactly `240x240` and `480x480`.
- `remotePatterns` in your Next config doesn't apply under a loader of your own, so nothing checks where the URL
  points but `hosts`, as in step 6. Pass it to `artworkUrl` for artwork from anywhere but Apple's API.
- A URL with no size to fill in, as the artwork of a listener's own playlist has, is the same image at every width.
  Next warns about a loader that can't honour a width, so the sample passes `unoptimized` for such a URL, and Next
  uses it as it is.

## When something goes wrong

An argument that isn't what the function takes is a `TypeError`, and so, with `hosts`, is an artwork whose URL
isn't on one of them. The message says which argument was wrong, and for a number, what it was. No error shows
the URL. Each function's reference, linked below, lists every case.

## Next steps

- [Play song previews](./previews), with the artwork of the track that is playing.
- [Next.js](./nextjs), for the rest of a Next app.
- The reference for [`artworkImage`](../reference/@open-music-sdk/util-artwork/functions/artworkImage),
  [`artworkUrl`](../reference/@open-music-sdk/util-artwork/functions/artworkUrl),
  [`artworkSrcSet`](../reference/@open-music-sdk/util-artwork/functions/artworkSrcSet) and their
  [options](../reference/@open-music-sdk/util-artwork/interfaces/tArtworkSrcSetOptions).

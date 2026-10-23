<div align="center">

<img src="https://raw.githubusercontent.com/open-music-sdk/js/main/assets/open-music-app-logo.svg" alt="open-music-sdk" width="200">

# Open Music SDK Types

`@open-music-sdk/types`

[![npm](https://img.shields.io/npm/v/@open-music-sdk/types)](https://www.npmjs.com/package/@open-music-sdk/types)
[![test coverage](https://codecov.io/gh/open-music-sdk/js/graph/badge.svg)](https://codecov.io/gh/open-music-sdk/js)

</div>

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

> **You probably don't want this package.** Most apps install one integration and import everything from it: see
> [Which package to install](https://github.com/open-music-sdk/js#which-package-to-install) in the repository's README.

TypeScript types for every object in the Apple Music API, generated from Apple's documentation. The package has no
dependencies and no runtime: it ships type declarations and nothing that runs.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which re-export every type. Use this one to build your own
client, or to type code that holds Apple's objects.

## Installation

```
pnpm add -D @open-music-sdk/types
```

## Documentation

- [The documentation site](https://open-music-sdk.github.io/js/): guides for each client and server, concepts,
  and the reference
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/types/)
- [Validate Apple's responses](https://open-music-sdk.github.io/js/guides/validation), for checking a value against
  its type at runtime
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences#types)
- [Which package to install](https://open-music-sdk.github.io/js/concepts/packages)

## Example

Anywhere, since it's types only:

```ts
import type { tAnyResource } from "@open-music-sdk/types";

function title(resource: tAnyResource): string {
  switch (resource.type) {
    case "songs":
    case "albums":
      return resource.attributes?.name ?? "";
    // ...every other resource type is a member of the union
    default:
      return "";
  }
}
```

## What's in it

| Export | What it is |
| --- | --- |
| `tSong`, `tAlbum`, ... | Resource objects: `id`, `type`, `href`, `attributes`, `relationships` |
| `tSongAttributes`, ... | Each resource's attributes |
| `tSongRelationships`, ... | Each resource's relationships, and each relationship's envelope |
| `tArtwork`, `tPlayParameters`, `tPreview`, ... | Shared dictionaries |
| `tSongsResponse`, `tErrorsResponse`, ... | Response envelopes |
| `tAnyResource` | The union of every resource, told apart by `type` |
| `tResourceType` | `tAnyResource["type"]`, the union of every resource's `type` |

Each property keeps Apple's description as its doc comment, so your editor shows Apple's wording. Where the type
differs from it, as below, the comment says so after Apple's words.

`exports` points at `dist/index.d.ts`: every type in one declaration file that imports nothing, so it reads the
same whether your `moduleResolution` is `bundler`, `node16` or `nodenext`. The `dist/index.js` beside it is empty.
To check a value at runtime, use [`@open-music-sdk/validate`](../validate/README.md).

The source is written by [`codegen`](https://github.com/open-music-sdk/js/blob/main/codegen/README.md), which says
how to regenerate it.

### Names

A name is Apple's dictionary name with the dots removed and a `t` in front, in the singular where the object is a
single thing. Apple documents one song as `Songs`, the value of its `type`, so the page `Songs.Attributes` is
`tSongAttributes` here. A collection keeps the plural: `tSongsResponse` wraps `data: tSong[]`.

### How Apple's types map

- `integer` and `number` are `number`; `object` is `Record<string, unknown>`.
- A property with an `allowedValues` list is a union of string literals, such as `"clean" | "explicit"`.
- A property Apple marks as not required is optional. Extended attributes are always optional, since they arrive
  only when you ask for them with `extend`.
- Four that Apple marks as required are optional, because Apple left them out against the live API on 18 October
  2026:
  - a view's own `attributes`, which come only when asked for, and only on the first page;
  - `durationInMillis` of a song and of a music video;
  - `artistName` of an album in the listener's library;
  - `artwork` of an album in the listener's library.
- A dictionary Apple documents with no properties is `Record<string, unknown>`.

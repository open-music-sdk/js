# @open-music-sdk/types

TypeScript types for every object in the Apple Music API, generated from Apple's documentation.
Zero dependencies, zero runtime: the package ships its `.ts` source and nothing else.

```
pnpm add -D @open-music-sdk/types
```

```ts
import type { tSong, tSongAttributes, tAnyResource } from "@open-music-sdk/types";

function title(resource: tAnyResource): string {
  switch (resource.type) {
    case "songs":
    case "albums":
      return resource.attributes?.name ?? "";
    // ...every other resource type is a member of the union
  }
}
```

## What is in it

| Export                     | Source                                                     |
| -------------------------- | ---------------------------------------------------------- |
| `tSong`, `tAlbum`, ...     | Resource objects: `id`, `type`, `href`, `attributes`, `relationships` |
| `tSongAttributes`, ...     | Each resource's attributes dictionary                      |
| `tSongRelationships`, ...  | Each resource's relationships, and each relationship's envelope |
| `tArtwork`, `tPlayParameters`, `tPreview`, ... | Shared dictionaries                    |
| `tSongsResponse`, `tErrorsResponse`, ... | Response envelopes                           |
| `tAnyResource`             | Union of every resource, discriminated by `type`           |
| `tResourceType`            | `tAnyResource["type"]`, the string union of resource types |

Names are Apple's dictionary names with the dots removed and a `t` prefix, singularized where the
object is a single thing: Apple documents one song as `Songs` (its `type` value), so the page
`Songs.Attributes` is `tSongAttributes` here. Collections keep their plural (`tSongsResponse` wraps
`data: tSong[]`). Each property keeps its description as a doc comment, so hovering in an editor shows
Apple's wording.

## Mapping rules

- `integer` and `number` are `number`; `object` is `Record<string, unknown>`.
- A property with an `allowedValues` list is a string-literal union (`"clean" | "explicit"`).
- A property Apple marks as not required is optional. Extended attributes are always optional; they
  arrive only when requested with `extend`.
- A dictionary Apple documents with no properties is `Record<string, unknown>`.

## Source-only

`exports` points at `src/index.ts`. Your TypeScript compiler (5.0 or newer, with `moduleResolution`
set to `bundler`, `node16`, or `nodenext`) reads the source directly; there is no build step and no
`.d.ts`. If you need runtime validation, see
[`@open-music-sdk/validate`](https://www.npmjs.com/package/@open-music-sdk/validate).

## Regenerating

Everything under `src/generated/` and `src/index.ts` is written by
[`codegen`](../../codegen/README.md), one file per resource family (`song.ts`, `library-playlist.ts`,
`search-response.ts`, `common.ts` for shared dictionaries). Do not edit them; re-run the crawl and the
emitter instead.

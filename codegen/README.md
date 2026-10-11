# codegen

Apple publishes no OpenAPI document for the Apple Music API, but every page of its documentation is
rendered from machine-readable DocC JSON. This directory turns that JSON into
[`@open-music-sdk/types`](../packages/types) and [`@open-music-sdk/validate`](../packages/validate).

```
pnpm crawl      docc-crawl: Apple's docs  ->  .cache/ (ignored)  ->  docc-ir/ir.json (committed)
pnpm codegen    emit:       docc-ir/ir.json  ->  packages/types/src/index.ts, src/generated/*.ts
                                             ->  packages/validate/src/index.ts, src/generated/*.ts
```

`pnpm codegen` runs as a Turborepo task before every build. `pnpm crawl` is run by hand when Apple's
release notes mention new attributes; commit the resulting `ir.json` and generated files together.

## docc-crawl

Any documentation URL maps to its JSON by inserting `/tutorials/data` and appending `.json`:

```
https://developer.apple.com/documentation/applemusicapi/songs
https://developer.apple.com/tutorials/data/documentation/applemusicapi/songs.json
```

`crawl.mjs` starts at the root page and follows every entry in each page's `references` map that
points back into `/documentation/applemusicapi`. Pages are fetched sequentially, once, and cached under
`.cache/`. Delete that directory to force a fresh crawl. The raw pages are never committed; only the
normalized IR is (see [CONTRIBUTING](../CONTRIBUTING.md)).

Two page kinds are kept:

| `metadata.symbolKind` | Example                             | Becomes            |
| --------------------- | ----------------------------------- | ------------------ |
| `dictionary`          | `Songs`, `Songs.Attributes`, `Artwork` | `ir.dictionaries` |
| `httpRequest`         | `Get a Catalog Song`                | `ir.endpoints`     |

Dictionaries are keyed by Apple's own symbol name (`metadata.externalID` minus the `data:music_api:`
prefix), so `Songs.Attributes` and `LibrarySongs.Attributes` stay distinct even when a link's text is
just "Attributes".

### Type tokens

Each property's `type` is a token list. The crawler reduces it to a small tree:

| In the docs                              | IR node                                   |
| ---------------------------------------- | ----------------------------------------- |
| `string`, `integer`, `number`, `boolean`, `object` | `{ kind: "scalar", name }`      |
| a link to another dictionary             | `{ kind: "ref", name: "Songs.Attributes" }` |
| `[X]`                                    | `{ kind: "array", of }`                   |
| `(A \| B)`                               | `{ kind: "union", of: [...] }`            |
| `[*]` with an `allowedTypes` attribute   | array of a union of those types           |

An `allowedValues` attribute is kept on the property as `allowed`. Any token shape not listed above
throws during the crawl so it is handled deliberately rather than emitted as `unknown`.

## docc-ir

`ir.json` is the only input to the emitter and the only artifact of the crawl that is committed.

```jsonc
{
  "dictionaries": [
    { "name": "Songs", "doc": "...", "properties": [
      { "name": "type", "required": true, "type": { "kind": "scalar", "name": "string" }, "allowed": ["songs"] },
      { "name": "attributes", "required": false, "type": { "kind": "ref", "name": "Songs.Attributes" } }
    ] }
  ],
  "endpoints": [
    { "title": "Get a Catalog Song", "method": "GET", "path": "v1/catalog/{storefront}/songs/{id}",
      "pathParams": [...], "queryParams": [...], "responses": [{ "status": 200, "type": { "kind": "ref", "name": "SongsResponse" } }] }
  ]
}
```

Endpoints are recorded for reference. Client functions are written by hand against this table so
their signatures can be shaped for use rather than mirroring the docs. The tests of
[`client-catalog`](../clients/client-catalog) and [`client-user`](../clients/client-user) read the
table too: every endpoint in it has to have exactly one function, or be listed as left out, and each
function is held to the method, the path, the parameters and the answer its endpoint is recorded with.

## emit

`src/emit.mjs` writes into those two packages from the IR and nothing else.

**Names.** Apple titles each resource page by its plural `type` value, so one song object is
documented as `Songs` and everything nested under it inherits the prefix. The emitter singularizes
that prefix wherever the dictionary describes a single object: `Songs.Attributes` becomes the
interface `tSongAttributes` and the validator `songAttributes`;
`Songs.Relationships.SongsAlbumsRelationship` becomes `tSongRelationshipsSongAlbumsRelationship`,
because the owner is one song while the `Albums` target is a collection. Response envelopes such as
`tSongsResponse` keep their plural because they wrap a `data` array. The `t` prefix is the repo
convention for interfaces and type aliases; the emitter fails if two dictionaries would collapse to the
same name.

**Types.** `integer` becomes `number`, `object` becomes `Record<string, unknown>`, `allowedValues`
becomes a string-literal union, and `required: false` becomes an optional property. A dictionary with
no documented properties becomes `Record<string, unknown>`. Property descriptions are carried over as
doc comments.

**Resources.** Any dictionary with an `id`, a single-valued `type`, and at least one of `href`,
`attributes`, `relationships`, `views`, or `meta` is a resource. That follows Apple's base `Resource`
dictionary, where `href` is optional ("only present in responses"); the replay objects
(`AlbumPeriodSummaries` and friends) have no `href` at all but do have relationships. A bare
`{ id, type }` object is a resource identifier inside a request body, not a resource. Resources are
collected into `tAnyResource`, a union discriminated by `type`, and `tResourceType`. (Apple also has a
dictionary literally named `Resource`, which is why the union is not called `tResource`.)

**Validators.** One per dictionary, built from the combinators in
[`packages/validate/src/runtime.ts`](../packages/validate/src/runtime.ts). References between
validators are wrapped in `r.lazy(() => ...)` because the graph is cyclic, and every export is
annotated with its `tSchema<T>` for the same reason. Unknown keys pass: Apple adds attributes without
notice.

**Files.** Output is split by family, the first segment of Apple's name, with `<Resource>Response`
folded into its resource: `song.ts` holds `tSong`, `tSongAttributes`, every `tSongRelationships*`
dictionary, and `tSongsResponse`. Families with a single dictionary (`Artwork`, `Preview`, the error
envelopes) share `common.ts`, and the resource union lives in `any-resource.ts`. Cross-family
references become imports; in the validators those imports are cyclic, which is safe because every
reference sits behind `r.lazy`. There is no barrel under `generated/`; the emitter also writes each
package's `src/index.ts`, which is the only re-export point.

Generated files carry a header, are ignored by ESLint, and are committed so that typecheck and lint
work without running the crawl. The emitter empties `src/generated/` before writing, so renamed or
removed families leave no stale files behind.

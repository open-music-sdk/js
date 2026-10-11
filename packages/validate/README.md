# @open-music-sdk/validate

Runtime validators for Apple Music API responses, generated from Apple's documentation. One validator
per object, each implementing [Standard Schema](https://standardschema.dev), so they plug into TanStack,
tRPC, and anything else that accepts a Standard Schema. Opt-in: nothing in the SDK validates unless you
ask it to.

```
pnpm add @open-music-sdk/validate
```

```ts
import { song, anyResource } from "@open-music-sdk/validate";

const result = song["~standard"].validate(await res.json());
if (result.issues) {
  // [{ message: "required", path: ["href"] }, { message: "expected string", path: ["attributes", "name"] }]
} else {
  result.value; // typed as tSong from @open-music-sdk/types
}
```

Validation is synchronous, so `result` never needs awaiting.

Within the SDK a validator is passed as `schema`: to `request` in [`@open-music-sdk/core`](../core),
or to any function of [`@open-music-sdk/client-catalog`](../../clients/client-catalog) and
[`@open-music-sdk/client-user`](../../clients/client-user). A failure there is a `ValidationError`
with the issues attached.

```ts
import { getSong } from "@open-music-sdk/client-catalog";
import { songsResponse } from "@open-music-sdk/validate";

const { data } = await getSong(music, "1613600188", { schema: songsResponse });
```

## What is in it

| Export                                  | Validates                                     |
| --------------------------------------- | --------------------------------------------- |
| `song`, `album`, `playlist`, ...        | One resource object                           |
| `songAttributes`, `artwork`, ...        | Any dictionary from the docs, by its camelCase name |
| `songsResponse`, `errorsResponse`, ...  | Response envelopes                            |
| `anyResource`                           | Any resource, discriminated by `type`         |
| `tSchema<T>`, `tStandardSchemaV1`, `tIssue`, `tResult` | Types for writing code against validators |

Names are the dictionary names from Apple's docs with dots removed, the first letter lowercased, and
the prefix singularized where the object is a single thing: `Songs.Attributes` is `songAttributes`,
and its output type is `tSongAttributes` from [`@open-music-sdk/types`](../types). Collections keep
their plural (`songsResponse`).

## What a validator checks

- Required properties are present; optional ones are checked only when present.
- Scalars have the documented type; `allowedValues` are enforced as literals.
- Arrays, nested dictionaries, and unions (`[*]` in the docs) are checked recursively.
- Unknown keys are allowed. Apple adds attributes without notice and that should not break a client.

Issues carry a `path` from the root of the value, so a bad field deep in a response is easy to find.

## Size

The runtime is a handful of combinators in about 100 lines. Validators are plain constants, so a bundler
keeps only the ones you import plus what they reference.

## Regenerating

Everything under `src/generated/` and `src/index.ts` is written by
[`codegen`](../../codegen/README.md), one file per resource family mirroring `@open-music-sdk/types`;
`src/runtime.ts` is the hand-written part. Do not edit the generated files; re-run the crawl and the
emitter instead.

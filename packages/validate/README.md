# @open-music-sdk/validate

Runtime validators for the Apple Music API's answers, generated from Apple's documentation: one for each object,
each a [Standard Schema](https://open-music-sdk.github.io/js/glossary#standard-schema), so they also work with
TanStack, tRPC and anything else that takes one. Nothing in the SDK validates unless you pass one.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which re-export every validator under `schemas`, such as
`schemas.song`. Use this one to build your own client.

```
pnpm add @open-music-sdk/validate
```

## Example

Anywhere. `music` is a client from `createClient`, and `value` is a value you got some other way:

```ts
import { getSong } from "@open-music-sdk/client-catalog";
import { song, songsResponse } from "@open-music-sdk/validate";

// As a schema: a mismatch is an AppleMusicError tagged ValidationError, with the issues attached.
const { data } = await getSong(music, "1613600188", { schema: songsResponse });

// On its own: the check is synchronous, so the result never needs awaiting.
const result = song["~standard"].validate(value);
if (result.issues) console.warn(result.issues); // [{ message: "required", path: ["href"] }, ...]
else console.log(result.value.attributes?.name); // result.value is a tSong
```

A validator is taken as `schema` by `core`'s `request` and by every function of `client-catalog` and
`client-user`.

## What's in it

| Export | What it validates |
| --- | --- |
| `song`, `album`, `playlist`, ... | One resource object |
| `songAttributes`, `artwork`, ... | Any dictionary in Apple's documentation |
| `songsResponse`, `errorsResponse`, ... | Response envelopes |
| `anyResource` | Any resource, told apart by `type` |
| `tSchema<T>`, `tStandardSchemaV1`, `tIssue`, `tResult`, `tCheck` | Types for code that works with validators, and the raw check a validator is built from |

The validators are plain constants, over a runtime of a handful of small functions, so a bundler keeps only the
ones you import and what they refer to.

### Names

A name is the dictionary's name in Apple's documentation with the dots removed, the first letter in lower case, and
in the singular where the object is a single thing: `Songs.Attributes` is `songAttributes`, and what it gives is a
`tSongAttributes` from [`@open-music-sdk/types`](../types/README.md). A collection keeps the plural:
`songsResponse`.

### What a validator checks

- A required property is there. An optional one is checked only when it's there.
- A scalar has the type Apple documents. A property with an `allowedValues` list holds one of them.
- Lists, nested dictionaries and unions (`[*]` in the documentation) are checked all the way down.
- A key Apple doesn't document is allowed. Apple adds attributes without notice, and that shouldn't break your app.

Each issue carries a `path` from the top of the value, so a bad field deep in an answer is easy to find.

### Regenerating

Everything under `src/generated/`, and `src/index.ts`, is written by
[`codegen`](https://github.com/open-music-sdk/js/blob/main/codegen/README.md), one file per resource family, as in
`@open-music-sdk/types`. `src/runtime.ts` is written by hand. Don't edit the generated files: run the crawl and the
emitter again instead.

## Learn more

- [Validate Apple's responses](https://open-music-sdk.github.io/js/guides/validation), with the validators for
  relationships and views, and a schema of your own
- [Errors](https://open-music-sdk.github.io/js/concepts/errors), for `ValidationError`
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences#validate)
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/validate/), with every
  validator's name

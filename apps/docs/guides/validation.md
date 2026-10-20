# Validate Apple's responses

The SDK types Apple's answers from Apple's documentation, but doesn't check them at runtime unless you ask. In
this guide you check an answer against a validator, handle an answer that fails, and use a schema of your own.

Before you start, you need:

- a client from an integration, or from `createClient` in `@open-music-sdk/core`. The code below calls it
  `music`.

Nothing is validated unless you pass a schema. A schema is any [Standard Schema](../glossary#standard-schema):
the validators the SDK generates from Apple's documentation, or one from a library such as Zod.

## 1. Pass a validator as `schema`

Every function of `music.catalog` and `music.user` takes a `schema` option. Each integration exports the
generated validators as `schemas`, one for each object in Apple's documentation, named as the documentation
names it: `songsResponse` for a songs response, `libraryPlaylist` for one library playlist.

On your server, or in a page with the same import from `@open-music-sdk/browser` or `@open-music-sdk/react`:

```ts
import { schemas } from "@open-music-sdk/server";

const album = await music.catalog.getAlbum("1613600183", {
  schema: schemas.albumsResponse,
});
```

The schema checks Apple's whole answer, `{ data: [album] }`, even where the function hands over only the album.
For a function that walks pages, the schema checks each page as it arrives.

Without an integration, import the validators from `@open-music-sdk/validate`, under the same names:

```ts
import { getSong } from "@open-music-sdk/client-catalog";
import { songsResponse } from "@open-music-sdk/validate";

const { data } = await getSong(music, "1613600188", { schema: songsResponse });
```

## 2. Pick the validator for a relationship or a view

A [relationship](../glossary#relationship) or a [view](../glossary#view) answers with a page of the resources it
holds. Its validator is named for the resource and the relationship or view:

- a relationship's, such as `albumRelationshipsAlbumTracksRelationship` for an album's `tracks`.
- a view's, such as `albumViewsAlbumOtherVersionsView` for an album's `other-versions`.
- a library relationship's, such as `libraryAlbumRelationshipsLibraryAlbumTracksRelationship`.

A view's own attributes, such as its title, come only when you ask for them with `with: ["attributes"]`, and only
on the first page: a view's `next` link keeps nothing but its offset. Its validator takes a page without them, so
look for them yourself on a first page you asked for them on:

```ts
const versions = music.catalog.getAlbumView("1613600183", "other-versions", {
  with: ["attributes"],
  schema: schemas.albumViewsAlbumOtherVersionsView,
});
for await (const version of versions) {
  console.log(version.attributes?.name);
}
```

Don't use `relationshipResponse` or `relationshipViewResponse`. They're the validators of the answers as Apple's
documentation names them, and they check only that a page holds resources, not which.

## 3. Handle an answer that fails

When the answer doesn't match, the request rejects with an `AppleMusicError` tagged `ValidationError`. Its
`issues` list what's wrong: each issue has a `message`, such as `required` or `expected string`, and a `path` to
the value from the top of the answer. Its `message` lists them all, and `status` is the answer's.

```ts
import { isAppleMusicError, schemas } from "@open-music-sdk/server";

try {
  const album = await music.catalog.getAlbum("1613600183", {
    schema: schemas.albumsResponse,
  });
  console.log(album.attributes?.name);
} catch (e) {
  if (!isAppleMusicError(e, "ValidationError")) throw e;
  // Such as "/v1/catalog/us/albums/1613600183: data.0.attributes.name:
  // expected string".
  console.warn(e.message);
}
```

The client doesn't retry a `ValidationError`. In a walk, the loop throws at the page that fails, after the items
of the pages before it.

A validator allows keys it doesn't know. Apple adds attributes without notice, and that doesn't make an answer
fail.

## 4. Use a validator on its own

A generated validator works without a request, for a value you got some other way, here `value`. Its check is
synchronous:

```ts
import { schemas } from "@open-music-sdk/server";

const result = schemas.song["~standard"].validate(value);
if (result.issues) {
  console.warn(result.issues); // [{ message: "required", path: ["href"] }, ...]
} else {
  console.log(result.value.attributes?.name); // result.value is a tSong
}
```

## 5. Use a schema of your own

Any Standard Schema works, such as one written with Zod. A schema that describes only the fields you use fits
`request`, whose answer takes its type from the schema. See
[Call an endpoint the clients don't cover](./direct-requests) for `request`.

```ts
import { z } from "zod";

const storefront = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        attributes: z.object({ name: z.string() }),
      }),
    )
    .min(1),
});

const { data } = await music.request("v1/storefronts/gb", {
  schema: storefront,
});
console.log(data[0]?.attributes.name);
```

A function of the two clients wants a schema that gives its answer's whole type, as the generated validators do.

What a schema gives back is what you get. When it hands back only the fields it knows, as Zod's objects do, a
walk still goes on, because the client reads the next page's link from Apple's answer, not from the schema's.

## Next steps

- [Handle errors](./errors), for the other errors a request can end in.
- The [`validate` reference](../reference/@open-music-sdk/validate/), for every validator's name.

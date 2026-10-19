# Call an endpoint the clients don't cover

`client-catalog` and `client-user` have a function for nearly every endpoint Apple documents. A few are in
neither, such as Apple's `v1/test` and the `library` relationship of a catalog resource. In this guide you call
one by its path, read what the answer itself doesn't hold, walk its pages, and declare a named function for it.

Before you start, you need:

- a client from an integration, or from `createClient` in `@open-music-sdk/core`. The code below calls it
  `music`, and `musicUserToken` is a listener's token.

Every client has `request` and `paginate`, the two functions the named ones are built on. They send each request
to `https://api.music.apple.com` and nowhere else, with the developer token, and turn every failure into the
errors [Handle errors](./errors) describes.

## 1. Make a request

`request(path, init)` sends one request and resolves to the answer's parsed JSON, or to `undefined` when the
answer has no body. Apple's endpoint for testing a connection, `v1/test`, names no resource, so no function
covers it.

On your server or in your page:

```ts
await music.request("v1/test"); // resolves when Apple accepts your developer token
```

A path is `v1/...` or `/v1/...`. In `init`, you can pass:

- `method`: `GET`, the default, `POST`, `PUT` or `DELETE`.
- `params`: the query. A list is joined with commas, and `undefined` is left out.
- `body`: sent as JSON.
- `user`: whether to send the listener's Music User Token. By default it goes on paths under `/v1/me` only.
- `schema`: a validator for the answer. See [Validate Apple's responses](./validation).
- `signal`: to abort the request.

Type the answer with a type parameter, or let a `schema` type it:

```ts
import type { tStorefrontsResponse } from "@open-music-sdk/server";

const { data } = await music.request<tStorefrontsResponse>("v1/storefronts", { params: { limit: 10 } });
```

## 2. Send the listener's token outside `/v1/me`

The `library` relationship of a catalog song, album, playlist or music video is the listener's copy of it, and
needs their token. Its path is in the catalog, not under `/v1/me`, so pass `user: true`:

```ts
import type { tAlbumRelationshipsAlbumLibraryRelationship } from "@open-music-sdk/server";

const listener = music.as(musicUserToken);
const storefront = await listener.storefront();
const page = await listener.request<tAlbumRelationshipsAlbumLibraryRelationship>(
  `v1/catalog/${storefront}/albums/1613600183/library`,
  { user: true },
);
```

`storefront()` gives the storefront the client was created with, or else the listener's, which the client asks
Apple for once.

Apple answers `404` for an album the listener doesn't hold, as it did against the live API on 18 October 2026,
and with their copy for one they hold a song of. The [vanilla sample](../samples) turns that into a yes or a no:

<<< @/../../samples/web-vanilla/src/pages.ts#in-library{ts}

Build a path from values you trust. A value from outside your app, such as an id from a URL, can hold `../` and
point the request somewhere else on Apple's API, where it carries the listener's token. `segmentOf` checks a
value as one segment of a path, as the clients check every id.

`segmentOf` comes from `@open-music-sdk/core`, which the integrations don't re-export. Install `core` beside your
integration, on [the same version](../concepts/packages#one-version-for-every-package):

```ts
import { segmentOf } from "@open-music-sdk/core";

// `albumId` came from outside your app. "../me/library" is a TypeError; anything allowed comes back encoded.
const id = segmentOf("albumLibrary", "id", albumId);
await listener.request(`v1/catalog/${storefront}/albums/${id}/library`, { user: true });
```

The first argument names your function in the error, and the second names the value.

## 3. Read the status or a header

`request` resolves to the body alone. To read the answer's status or one of its headers, pass `onResponse` in
`init`:

```ts
let status: number | undefined;
let contentType: string | null = null;
await music.request("v1/test", {
  onResponse: (res) => {
    status = res.status;
    contentType = res.headers.get("content-type");
  },
});
```

It's called once for each answer, after the client has read the body and decided what the answer means, so a
request that's retried calls it more than once. Its third argument holds the parsed body as `body`, and the error
the answer made, if any, as `error`. Read the body from there, not from `res.json()`, because the body has
already been read. In a page, the browser lets you read only the headers Apple's answer exposes to other origins.

::: warning Never print the request
`onResponse`, like the client's `onRequest`, is handed the request as its second argument, with the developer token
in its `Authorization` header and, where it's sent, the Music User Token in `Music-User-Token`. A hook that prints
requests prints both tokens.
:::

## 4. Walk pages

`paginate(from, init)` gives the items of every page, following each answer's `next` link. `from` is a path, or a
[page](../glossary#page-next-link) you already have. It asks for nothing until your loop starts, and stops asking
when the loop ends:

```ts
import type { tLibraryAlbum } from "@open-music-sdk/server";

const path = `v1/catalog/${storefront}/albums/1613600183/library`;
for await (const album of listener.paginate<tLibraryAlbum>(path, { user: true })) {
  console.log(album.id);
}
```

`init` takes what `request` takes, for each page it asks for, and `maxPages`, the most pages to ask for. Without
`maxPages`, a walk goes on for as long as each page names a next one.

`paginate` follows a `next` link anywhere on Apple's API, and sends the listener's token where the link is under
`/v1/me`. So a path or a page from outside your app is as trusted as you make it. To keep one to the catalog,
pass `user: false`, which sends no Music User Token wherever the links point, and give the walk a `maxPages`:

```ts
// `next` came from outside your app, such as a query string your page sent back.
for await (const genre of music.paginate(next, { user: false, maxPages: 5 })) {
  console.log(genre);
}
```

A search or a chart answers with its pages nested under `results`, so `paginate` can't walk it.

## 5. Declare a named function

To use an endpoint as the clients' functions are used, with its arguments checked and two ways to call it,
declare it with the builders in `@open-music-sdk/core`. The integrations don't re-export them, so install `core`
and `types` beside your integration, on the same version. Here, the `library` relationship of a catalog album:

```ts
import { inStorefront, relationshipGetter, type tAppleMusicClient, type tCollection, type tStorefrontOption } from "@open-music-sdk/core";
import type { tAlbumRelationships } from "@open-music-sdk/types";

// Where the catalog's albums are. `user: true` sends the Music User Token, though the path isn't under /v1/me.
const albums: tCollection<tStorefrontOption> = Object.assign(
  (fn: string, client: tAppleMusicClient, options: tStorefrontOption) =>
    inStorefront(fn, client, options.storefront, (storefront) => `v1/catalog/${storefront}/albums`),
  { user: true },
);

export const getAlbumLibrary = relationshipGetter<Pick<tAlbumRelationships, "library">, tStorefrontOption>("getAlbumLibrary", albums);

// Called with a client, it resolves to Apple's answer: the first page.
const page = await getAlbumLibrary(listener, "1613600183", "library");
console.log(page.data.length);

// Bound to a client, it walks every page.
for await (const copy of getAlbumLibrary.bound(listener)("1613600183", "library")) console.log(copy.id);
```

The function checks the id and the name as path segments, and the options as every client function does, before
Apple is asked. The reference for [`endpoint`](../reference/@open-music-sdk/core/functions/endpoint),
[`resourceGetter`](../reference/@open-music-sdk/core/functions/resourceGetter),
[`relationshipGetter`](../reference/@open-music-sdk/core/functions/relationshipGetter) and
[`tCollection`](../reference/@open-music-sdk/core/interfaces/tCollection) lists the other builders and what each
one checks. [`endpointNamespace`](../reference/@open-music-sdk/core/functions/endpointNamespace) binds several to
one client at once.

## Next steps

- [Build your own client from the parts](./own-client).
- [Handle errors](./errors).
- The reference for [`tAppleMusicClient`](../reference/@open-music-sdk/core/interfaces/tAppleMusicClient), with
  `request` and `paginate`, and [`tRequestInit`](../reference/@open-music-sdk/core/interfaces/tRequestInit).

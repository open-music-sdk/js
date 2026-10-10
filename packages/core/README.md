# @open-music-sdk/core

The HTTP layer every other package in the family is built on: a client factory over `fetch` that
attaches the two tokens, encodes parameters, follows `next` links, turns status codes into tagged
errors, and retries what is worth retrying. Zero runtime dependencies; runs anywhere `fetch` does.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use `core` directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/core
```

```ts
import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import type { tSongsResponse } from "@open-music-sdk/types";

const music = createClient({ developerToken: process.env.APPLE_MUSIC_TOKEN!, storefront: "us" });

const { data } = await music.request<tSongsResponse>("v1/catalog/us/songs", { params: { ids: ["1613600188"] } });

const listener = music.as(userToken); // same limiter and developer token, one listener
for await (const playlist of listener.paginate("v1/me/library/playlists")) { /* every page */ }

try {
  await listener.request("v1/me/library/playlists", { method: "POST", body: { attributes: { name: "Road trip" } } });
} catch (e) {
  if (isAppleMusicError(e, "UserTokenInvalid")) askListenerToReconnect();
  else throw e;
}
```

## What is in it

| Export | Does |
| --- | --- |
| `createClient(options)` | `request`, `paginate`, `storefront`, `as`, `forUser` |
| `AppleMusicError`, `isAppleMusicError(e, tag?)` | One error class; `_tag` is one of `DeveloperTokenInvalid`, `DeveloperTokenUnavailable`, `UserTokenInvalid`, `RateLimited`, `ApiError`, `ValidationError`, `NetworkError` |
| `retry(fn, policy?, signal?)`, `retryable` | Exponential backoff with full jitter; honours `Retry-After` |
| `createRateLimiter({ capacity, refillPerSecond })` | Token bucket to share across clients on one developer token |
| `parseRetryAfter(header)` | Seconds or HTTP date to milliseconds |
| `parseToken(value)` | The value as a token, trimmed, or `undefined` when it could not be sent as one |
| `readBounded(message, maxBytes)` | The body of a `Request` or `Response` as text, or `undefined` once it runs past the limit; the rest is cancelled, not read |
| `got(value)` | What a value is, for an error that must not show it: a string by its length, anything else by its kind, a number as it is |
| `has(value, methods)`, `optionsOf(fn, options, what)`, `clientOf(fn, client, methods)` | The checks a package makes on what it is handed: an object with those methods, an options bag, a client. A mistake is a `TypeError` naming `fn` |
| `segmentOf(fn, name, value)` | A caller's value as one segment of a path, percent-encoded, or a `TypeError` |
| `listOf(fn, name, value)` | A caller's list of ids, types or codes as the call's own copy, or a `TypeError` |
| `typedIdsOf(fn, name, value)` | A caller's ids by type, such as `{ songs: ["1"] }`, as the parameters they are sent as, or a `TypeError` |
| `initOf(fn, options, set?, also?)`, `tReadOptions` | The options every function for an endpoint takes, turned into what `request` takes |
| `walkOf(fn, options, set?, also?)`, `tWalkOptions` | The same for a function that walks pages, with the most pages its walk may ask for |
| `endpoint`, `resourceGetter`, `resourcesGetter`, `resourcesFinder`, `resourceLister`, `relationshipGetter` | Declare a function for one endpoint |
| `endpointNamespace(fn, client, endpoints)` | Every such function bound to one client, its answers unwrapped |

The rows from `segmentOf` down are for packages that put names to endpoints; see
[Declaring endpoints](#declaring-endpoints). An app has no need of them: the two that are made with
them, [`@open-music-sdk/client-catalog`](../../clients/client-catalog) and
[`@open-music-sdk/client-user`](../../clients/client-user), have a function for every endpoint, so
that `request` is for the rare path neither names.

`isAppleMusicError` and `instanceof AppleMusicError` go by shape, an `Error` named `AppleMusicError`
with a string `_tag`, not by constructor. An error is recognised whichever copy of this package made
it, so two versions installed side by side do not break your error handling.

## How a request is handled

- `path` is `v1/...`, `/v1/...`, or a `next` subpath from a previous response.
- `params` are added to the query; arrays join with commas, `undefined` is dropped.
- The Music User Token is sent under `/v1/me` by default; `user: true | false` overrides.
- `body` is JSON-encoded with `Content-Type: application/json`.
- An empty body resolves to `undefined`; otherwise the parsed JSON, run through `schema` if given.
- An option is one that was passed. `createClient`, `request` and `paginate` read what the object they
  are handed holds itself, so an option it inherits, or that other code has put on `Object.prototype`,
  is not one.

| Status | Outcome |
| --- | --- |
| 401 | The developer token provider is asked again with the rejected token. A different token is tried once; then `DeveloperTokenInvalid`. |
| 403 | `UserTokenInvalid`, never retried. |
| 429 | Retried, waiting for `Retry-After`; then `RateLimited`. |
| 5xx except 501 | Retried; then `ApiError`. |
| Other 4xx, 501 | `ApiError` with `status` and Apple's `errors` array. |
| `fetch` throws | `NetworkError`, retried. An abort is rethrown untouched. |
| No developer token | `DeveloperTokenUnavailable`, thrown by a provider that could not get one. Its `status` is the provider's own source's, never Apple's. Retried when there is no status, or it is 429 or 5xx except 501. |

The default policy makes two attempts with a 250 ms base delay and a 4 s cap, and waits for a
`Retry-After` of up to 60 s (`maxRetryAfterMs`); a longer one is not waited for, the `RateLimited`
error reaches you at once with `retryAfterMs` attached. Pass `retry: false` to make one attempt, or
a `tRetryPolicy` to tune it.

A `POST` is held back further, whatever the policy. It makes something each time it is carried out, a
playlist or a track added to one, and a 5xx or a lost connection leaves open whether Apple carried it
out. So a `POST` is sent again only after a 429, or when there was no developer token to send it with:
the two failures that say it was not. After any other, the error reaches you, and whether to try again
is yours to decide.

Rate limiting is opt-in: Apple publishes no numbers, so create a limiter with yours and share one
instance across every client on the same developer token.

## Pages

`paginate(from, init?)` gives the items of `data` across every `next` link, one page at a time, and
stops asking when the loop is left. `from` is a path, or a page already in hand:

```ts
for await (const song of listener.paginate("v1/me/library/songs", { params: { limit: 100 } })) { /* … */ }

const album = await music.request<tAlbumsResponse>("v1/catalog/us/albums/1613600183");
const tracks = album.data[0]?.relationships?.tracks; // { data, next }: the first page came with the album
if (tracks) for await (const track of music.paginate(tracks)) { /* that page's tracks, then the rest */ }
```

A page's own items come first, as they were when the walk reached the page, and Apple is not asked
until they run out. With a page, `init.params` is not sent, since its `next` link already carries the
query; `schema` and `signal` apply to the pages that are fetched.

Each page's items are what a `schema` made of them, and its `next` link is the one Apple sent. So a
schema that hands back only the fields it knows, as some libraries' do, does not end a walk at its
first page.

A page is an object with a `data` list, a `next` link or both. Anything else handed over is a
`TypeError` and nothing is asked for: a `URL`, a `Response`, a resource, or a whole search answer, none
of which holds either. The one exception is nothing at all, which is what an empty answer comes to and
is a last, empty page. A promise of a page is a `TypeError` too: await it first, so that what it
rejects with is caught where the request was made.

| Option | |
| --- | --- |
| `maxPages` | The most pages to ask Apple for: a whole number above zero. Default: no limit. A page handed over is not counted, since it was not asked for. |
| Any other | What `request` takes, used for each page that is asked for. |

With no `maxPages`, a walk goes on asking for as long as each page names a next one. At the limit it
ends, whether or not there are more.

A `next` link is held to Apple's origin like any other path, and within it is followed wherever it
points, with the Music User Token when that is under `/v1/me`. So a page or a path that comes from
outside your app is as trusted as you make it. For one that should stay in the catalog, pass
`user: false`, which sends no Music User Token wherever the links point, and give it a `maxPages`.

What a `next` link answers with has to be a page itself, with `data` at the top, as a collection's and
a relationship's are. A search or a chart answers with its pages nested under `results`, and is not
walked: `paginate` would yield the group it was handed and stop.

## Tokens

`developerToken` and `userToken` take a string or a provider `(ctx) => string | Promise<string>`.
A provider is called once per request, and once more with `ctx.rejected` set when Apple answers 401,
so a caching minter can replace a stale token. A provider that cannot get a token throws
`AppleMusicError("DeveloperTokenUnavailable", …)` to have the retry policy applied; anything else it
throws reaches the caller untouched. `as(userToken)` derives a client for one listener;
`forUser(userId)` does the same by looking the token up in `userTokenStore`.

A token is printable ASCII with no spaces or line breaks inside; whitespace around it, as a token
read from a file has, is dropped. Anything else is a `TypeError` before the request is sent, and the
error describes the value rather than repeating it.

## Hooks

`onRequest(req)` runs before each attempt with the final `Request`. `onResponse(res, req, outcome)`
runs once per response, after the client has read the body and decided what it means:
`outcome.body` is the parsed JSON (or `undefined`) and `outcome.error` is the `AppleMusicError` the
request will throw, if any; a retry may still follow. The `Response` handed over has already been
read, so take data from `outcome.body`, not from `res.json()`.

`request` and `paginate` take an `onResponse` of their own in `init`, called the same way and after
the client's, for that request alone. It is how to learn what `request` does not resolve to: the
status of an answer, or one of its headers.

## Validation

`request` accepts any [Standard Schema](https://standardschema.dev) as `schema`, including the
generated validators in [`@open-music-sdk/validate`](../validate). A failure throws `ValidationError`
with the issues attached. Nothing is validated unless a schema is passed.

## Declaring endpoints

This part is for a package that puts names to endpoints. A function for an endpoint is declared once,
and has two forms:

```ts
import { endpointNamespace, resourceGetter, resourcesGetter } from "@open-music-sdk/core";
import type { tSongsResponse } from "@open-music-sdk/types";

const songs = () => "v1/catalog/us/songs"; // where the collection is

export const getSong = resourceGetter<tSongsResponse>("getSong", songs);
export const getSongs = resourcesGetter<tSongsResponse>("getSongs", songs);

await getSong(music, "1613600188"); // what Apple answered: { data: [song] }

const catalog = endpointNamespace("catalog", music, { getSong, getSongs });
await catalog.getSong("1613600188"); // the song
```

Called with a client, a function resolves to Apple's answer as it came. Bound to a client, by
`getSong.bound(client)` or all at once by `endpointNamespace`, it takes the same arguments without the
client and hands over what the answer holds:

| Declared with | Asks for | Bound, it gives |
| --- | --- | --- |
| `resourceGetter<R, C, E>(fn, collection, also?)` | `GET {collection}/{id}` | The resource. A success that holds none is an `ApiError` with the status it came with, not `undefined`. |
| `resourcesGetter<R, C, E>(fn, collection, also?)` | `GET {collection}?ids=` | The list of them as Apple sent it, empty when Apple sent none |
| `resourcesFinder<R, C, E>(fn, filter, collection, also?)` | `GET {collection}?filter[{filter}]=` | The list, likewise. `filter` is the filter's name, such as `isrc`: lowercase words with hyphens between, in at most 64 characters. The function takes the values to look for, as `values`. |
| `resourceLister<R, C, E>(fn, collection, also?)` | `GET {collection}` | Every item of every page, as an `AsyncIterable` |
| `relationshipGetter<Rels, C>(fn, collection)` | `GET {collection}/{id}/{name}` | Every item of every page. `name` is a key of `Rels`, and decides the type of what comes back, and of a `schema` for it. |
| `endpoint(fn, unwrap, plan)` | What `plan` returns, as `[path, init]` | By `unwrap`: the `resource`, the `resources`, all `pages`, what a write has `written`, or the `answer` as it is |

`endpoint` is what the others are made with, for anything they do not cover. Its `written` is for a
function that makes or changes something: bound, it gives the resource the answer holds, and
`undefined` where a success holds none. The write happened either way, and an error there would have a
caller do it again.

### A declaration

`R` is the type of Apple's answer, and has to be said: a declaration that leaves it out does not
compile. `C` is the options the collection reads, such as a storefront. `E` is the options the
function adds that are sent as parameters under their own names, such as `views`, and `also` names
every one of them and says what it is, a `"list"` of names or one `"name"`:

```ts
import { resourceGetter, segmentOf, type tCollection } from "@open-music-sdk/core";
import type { tArtistViews, tArtistsResponse } from "@open-music-sdk/types";

interface tStorefront { readonly storefront?: string }
interface tViews { readonly views?: readonly (keyof tArtistViews)[] }

const artists: tCollection<tStorefront> = (fn, client, { storefront }) => {
  const path = (id: unknown) => `v1/catalog/${segmentOf(fn, "storefront", id)}/artists`;
  // Named by the call, the path is there at once. Otherwise the client is asked, when a request is about to be made.
  return storefront === undefined ? () => client.storefront().then(path) : path(storefront);
};

export const getArtist = resourceGetter<tArtistsResponse, tStorefront, tViews>("getArtist", artists, { views: "list" });

await getArtist(music, "178834", { storefront: "gb", views: ["top-songs"] });
```

An option of `E` that `also` leaves out, misspells, or calls a name where its type is a list, does not
compile. So an option that is typed is an option that is sent, and a call is held to the type: where a
list was declared, one string is a `TypeError`, and not a list of one. A declaration is checked as it
is made: a name with something in it, a `collection` that is a function, an `also` that says what each
option is, one of the five `unwrap`s, a `plan` that is a function. A mistake in one is a `TypeError` when its module loads, naming the function that was
called. What a declaration gives is frozen.

### The collection

`collection` is `(fn, client, options) => string`: where the collection is for one call, so that a
catalog can put a storefront in its path. It may also give a function for the path, to be called when
a request is about to be made, or a promise of the path. What it gives is checked before it is asked
for, and refused with the reason:

| A path that | Is refused because |
| --- | --- |
| holds a segment that is `.` or `..`, written out or as `%2e` | a URL reads them as "here" and "one up", so the request would go to another path |
| holds a backslash | a URL reads it as a slash, so it would begin another segment |
| holds a question mark | it begins the query, so what follows would not be part of the path |
| holds a hash | it begins a fragment, so what follows would not be sent |
| holds a space, a tab, a line break or another control character | a URL drops or trims it, joining what was on either side |
| holds a character outside ASCII | a URL rewrites it |
| holds an empty segment | two slashes together, or one at the end, leave out what was meant to be there |
| begins with a name and a colon | a URL reads it as a scheme, and the rest as another address |
| is longer than 256 characters, or is no string | no collection's path is |

So a storefront from outside cannot move a request under `/v1/me`, where the client sends the Music
User Token. The path is described by what is wrong with it and never shown. A collection that checks
its own parts with `segmentOf` gets to name the option that was wrong.

A collection also has the say on the Music User Token, as a `user` property of its own:

```ts
const genres: tCollection = Object.assign(() => "v1/catalog/us/genres", { user: false });
```

Left out, the client goes by the path and sends the token under `/v1/me`. `false` means nothing asked
of the collection carries it, and that holds for every page of a walk, wherever a next link points:
it is how a catalog says that nothing in it is the listener's. `true` sends it outside `/v1/me`.

### When a function is called

Everything a function is handed is checked before Apple or `collection` is asked, in the order it was
handed over, and a mistake is a `TypeError` naming the function and the argument.

- Called with a client, or bound and resolving to a resource or a list, a function is async, and a
  mistake is its rejection.
- Bound and walking pages, a function checks and takes what it is handed as it is called, and a
  mistake is thrown there. What it gives asks Apple for nothing until a loop starts, and can be looped
  again, each loop asking afresh.
- Where the collection has to ask the client for part of its path, as for a storefront no option named,
  it gives a function for the path in place of the path. That function is called when a request is
  about to be made: at once for a function that asks for one thing, and as each loop starts for one
  that walks pages. So a walk nobody loops over asks for nothing, and a lookup that fails in one loop
  is tried again by the next.

A function is known by its shape, a function with a `bound` method, so a namespace binds one made by
another copy of this package. A namespace is frozen, and its type holds what it holds.

### What a function is handed

| Check | Takes |
| --- | --- |
| `segmentOf(fn, name, value)` | A string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not `.` or `..`. It comes back percent-encoded, so a question mark, a hash or a space stays inside the segment. |
| `listOf(fn, name, value)` | A list of 1 to 300 strings, each of 1 to 64 characters with no comma in it, since a list is sent joined by commas. It is asked its length once and read by index, and comes back as a copy. |
| `typedIdsOf(fn, name, value)` | A plain object of 1 to 32 lists, each as `listOf` takes one, under the name of a type of resource: lowercase words with hyphens between, such as `library-songs`. It comes back as the parameters to send, `ids[library-songs]`. A type whose list is undefined is left out. Which types there are is Apple's to say. |
| `optionsOf(fn, options, what)` | A plain object, or nothing. It comes back as the call's own copy of what the object holds itself, inheriting nothing. A list, a `Map` or a class's instance is a `TypeError`: read as a bag of options each would be an empty one. |
| `clientOf(fn, client, methods)` | Anything with the client methods named |

`segmentOf` is what keeps a caller's id from moving a request: put into a path as it is,
`../../../me/library/songs` after `v1/catalog/us/songs/` is a request for the listener's library, and
under `/v1/me` the client sends the Music User Token.

A slash is refused, not encoded. Encoded, it would stay in its segment as far as a URL goes, which is
as far as this package can see: a server that decodes a path before it reads it would find the slash
there again. No id, name or code of Apple's holds a slash, a backslash, a percent sign or a control
character, so a value that does is a mistake, and is not sent.

Sixty-four characters is longer than any id, name or code Apple gives out, and well short of a token.
A token put where an id belongs is therefore refused before it is sent, and is not repeated in the
error Apple's answer to it would have become.

### Options

`tReadOptions` is the bag every function takes, and `initOf` turns it into what `request` takes, each
option read once and copied.

| Option | |
| --- | --- |
| `language` | The language to answer in, as a tag such as `"en-GB"`, of 1 to 64 characters. Sent as `l`. |
| `include`, `extend` | Lists of names, as `listOf` takes them. A list of nothing is not sent. |
| `limit` | A whole number above zero. |
| `offset` | A whole number from zero, or a cursor as Apple gave it, of 1 to 256 characters. |
| `params` | Any other query parameter, as a plain object of at most 100. A name is one as Apple writes them, such as `ids[albums]` or `limit[songs:tracks]`: letters, digits, `-`, `_`, `.` and `:`, with any part in brackets after, in at most 64 characters. A value is a string of at most 256 characters, a number, `true` or `false`, or a list of at most 300 numbers and strings, each string as `listOf` takes them. Null, undefined and a list of nothing are not sent. |
| `schema` | A Standard Schema the answer is held to: an object or a function with a `validate` under `~standard`. |
| `signal` | An `AbortSignal`. Aborts the request. |

A function that walks pages takes one more, `maxPages` (`tWalkOptions`): the most pages its walk may
ask for, a whole number above zero, with no limit by default. `walkOf` is `initOf` for such a function,
and what it gives holds the limit for `paginate`. It is the walk's alone: called with a client, the
function asks for the one page it resolves to.

Three things fill the query, and the later wins: the caller's `params`; then the options that are
given; then `set`, which is what the function itself puts there, such as the ids it was handed.
`also` names any further options a function takes, such as `views`, with what each one is,
`{ views: "list", chart: "name" }`. Each is checked as that and sent under its own name; an
option a function does not name is not sent.

`params` is held to what a query parameter can be, so that what is put there by mistake is refused
before anything is sent. A `URLSearchParams` or a `Map` is a `TypeError`, where it would have been read
as no parameters at all. A name that does not fit is described in its error and not repeated, and one
that fits is short enough to be named there. `request` itself takes `params` as they come, for a
parameter that fits none of this.

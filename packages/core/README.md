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
| `initOf(fn, options, set?, also?)`, `tReadOptions` | The options every function for an endpoint takes, turned into what `request` takes |
| `endpoint`, `resourceGetter`, `resourcesGetter`, `resourceLister`, `relationshipGetter` | Declare a function for one endpoint |
| `endpointNamespace(fn, client, endpoints)` | Every such function bound to one client, its answers unwrapped |

The rows from `segmentOf` down are for packages that put names to endpoints, as the client packages
do; see [Declaring endpoints](#declaring-endpoints). An app has no need of them.

`isAppleMusicError` and `instanceof AppleMusicError` go by shape, an `Error` named `AppleMusicError`
with a string `_tag`, not by constructor. An error is recognised whichever copy of this package made
it, so two versions installed side by side do not break your error handling.

## How a request is handled

- `path` is `v1/...`, `/v1/...`, or a `next` subpath from a previous response.
- `params` are added to the query; arrays join with commas, `undefined` is dropped.
- The Music User Token is sent under `/v1/me` by default; `user: true | false` overrides.
- `body` is JSON-encoded with `Content-Type: application/json`.
- An empty body resolves to `undefined`; otherwise the parsed JSON, run through `schema` if given.

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
a `tRetryPolicy` to tune it. Rate limiting is opt-in: Apple publishes no numbers, so
create a limiter with yours and share one instance across every client on the same developer token.

## Pages

`paginate(from, init?)` gives the items of `data` across every `next` link, one page at a time, and
stops asking when the loop is left. `from` is a path, or a page already in hand, or a promise of one:

```ts
for await (const song of listener.paginate("v1/me/library/songs", { params: { limit: 100 } })) { /* … */ }

const album = await music.request<tAlbumsResponse>("v1/catalog/us/albums/1613600183");
const tracks = album.data[0]?.relationships?.tracks; // { data, next }: the first page came with the album
if (tracks) for await (const track of music.paginate(tracks)) { /* that page's tracks, then the rest */ }
```

A page's own items come first, and Apple is not asked until they run out. With a page, `init.params`
is not sent, since its `next` link already carries the query; `schema` and `signal` apply to the pages
that are fetched. Handing over something that is neither a path nor an object is a `TypeError`. A `next`
link is held to Apple's origin like any other path.

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
| `resourceGetter(fn, collection, also?)` | `GET {collection}/{id}` | The resource. A success that holds none is an `ApiError`, not `undefined`. |
| `resourcesGetter(fn, collection, also?)` | `GET {collection}?ids=` | The list of them, empty when Apple sent none |
| `resourceLister(fn, collection, also?)` | `GET {collection}` | Every item of every page, as an `AsyncIterable` |
| `relationshipGetter<Rels>(fn, collection)` | `GET {collection}/{id}/{name}` | Every item of every page. `name` is a key of `Rels`, and decides the type of what comes back. |
| `endpoint(fn, unwrap, plan)` | What `plan` returns, as `[path, init]` | By `unwrap`: the `resource`, the `resources`, all `pages`, or the `answer` as it is |

`collection` is a function from the call's options to a path, so a catalog can put a storefront in it.
`endpoint` is what the other four are made with, for anything they do not cover.

A bound function that walks pages asks for nothing, and checks nothing, until its loop starts. Every
other mistake in what a function is handed is a `TypeError` naming the function and the argument,
raised before Apple or `collection` is asked. A function is known by its shape, a function with a
`bound` method, so a namespace binds one made by another copy of this package. A namespace is frozen.

### What a function is handed

| Check | Takes |
| --- | --- |
| `segmentOf(fn, name, value)` | A string of 1 to 256 characters, and not `.` or `..`. It comes back percent-encoded, so a slash, a question mark or a hash stays inside the segment. |
| `listOf(fn, name, value)` | A list of 1 to 300 strings, each of 1 to 256 characters with no comma in it, since a list is sent joined by commas. It comes back as a copy. |
| `optionsOf(fn, options, what)` | An object, or nothing, which is an empty bag |
| `clientOf(fn, client, methods)` | Anything with the client methods named |

`segmentOf` is what keeps a caller's id from moving a request: put into a path as it is,
`../../../me/library/songs` after `v1/catalog/us/songs/` is a request for the listener's library, and
under `/v1/me` the client sends the Music User Token.

### Options

`tReadOptions` is the bag every function takes, and `initOf` turns it into what `request` takes, each
option read once and copied.

| Option | |
| --- | --- |
| `language` | The language to answer in, as a tag such as `"en-GB"`. Sent as `l`. |
| `include`, `extend` | Lists of names. A list of nothing is not sent. |
| `limit` | A whole number above zero. |
| `offset` | A whole number from zero, or a cursor as Apple gave it. |
| `params` | Any other query parameter, sent as given: at most 100, each a string, a number, `true` or `false`, or a list of at most 300 strings and numbers. Null, undefined and a list of nothing are not sent. |
| `schema` | A Standard Schema the answer is held to. |
| `signal` | Aborts the request. |

Three things fill the query, and the later wins: the caller's `params`; then the options that are
given; then `set`, which is what the function itself puts there, such as the ids it was handed.
`also` names any further options a function takes, such as `views`, each sent under its own name; an
option a function does not name is not sent.

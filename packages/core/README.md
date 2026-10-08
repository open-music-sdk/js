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

## Tokens

`developerToken` and `userToken` take a string or a provider `(ctx) => string | Promise<string>`.
A provider is called once per request, and once more with `ctx.rejected` set when Apple answers 401,
so a caching minter can replace a stale token. A provider that cannot get a token throws
`AppleMusicError("DeveloperTokenUnavailable", …)` to have the retry policy applied; anything else it
throws reaches the caller untouched. `as(userToken)` derives a client for one listener;
`forUser(userId)` does the same by looking the token up in `userTokenStore`.

A token is printable characters with no spaces or line breaks inside; whitespace around it, as a token
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

# @open-music-sdk/user-token

Everything around a Music User Token except issuing one: taking it in, asking Apple whether it works,
and keeping it where [`core`](../core)'s `forUser(userId)` can find it. Only Apple can issue the token,
through its own sign-in flow; this package starts once you hold the string.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use `user-token` directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/user-token @open-music-sdk/core
```

Keep the two on the same version. If your app does end up with a different copy of `core` than the
one this package resolves, nothing breaks: an `AppleMusicError` is recognised whichever copy made it.

```ts
import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import { MemoryUserTokenStore, userTokenFromEnv, userTokenIntake, validateUserToken } from "@open-music-sdk/user-token";

const store = new MemoryUserTokenStore();
const music = createClient({ developerToken, userTokenStore: store });

// Intake over HTTP: a web-standard handler. Validates with GET /v1/me/storefront, then stores.
export const POST = userTokenIntake(music, { store, userId: (req) => sessionUserId(req) });

// Intake out of band: a CLI or job reads the token from the environment, if one is set.
const token = userTokenFromEnv("MUSIC_USER_TOKEN");
if (token !== undefined) {
  const storefront = await validateUserToken(music, token); // throws UserTokenInvalid before any work starts
  await store.set(userId, token);
}

// Rejection: core maps 403 to UserTokenInvalid. Forget only the token that was rejected: the
// listener may have reconnected, and a new token been stored, while the request was in flight.
const sent = await store.get(userId);
try {
  await music.forUser(userId).request("v1/me/library/playlists");
} catch (e) {
  if (!isAppleMusicError(e, "UserTokenInvalid")) throw e;
  if ((await store.get(userId)) === sent) {
    await store.delete(userId);
    askListenerToReconnect(userId);
  }
}
```

## What is in it

| Export | Does |
| --- | --- |
| `validateUserToken(client, token, { signal }?)` | Asks Apple with `GET /v1/me/storefront`; resolves to the listener's storefront, rejects with `UserTokenInvalid` |
| `userTokenFromEnv(name?, env?)` | Reads and trims `MUSIC_USER_TOKEN` from `process.env` or the object you pass; `undefined` when it is not set |
| `userTokenIntake(client, { store, userId })` | `(req: Request) => Promise<Response>` that validates and stores a posted token |
| `MemoryUserTokenStore` | A `Map`; disposing it forgets everything |
| `KvUserTokenStore(kv, { prefix }?)` | Workers KV, or anything with `get`, `put`, and `delete`; disposing it leaves the namespace alone |
| `tUserTokenStore` | The three-method interface from `core`, for a store of your own |

## Validation

A token is opaque, so the only local check is that it can be a header value: 1 to 4096 visible ASCII
characters. Anything else is `UserTokenInvalid` without a request. Then Apple decides:

| Apple answers | Outcome |
| --- | --- |
| 2xx naming a storefront | Resolves to the storefront id |
| 2xx naming none | `ApiError`; the token is not treated as accepted |
| 403 | `UserTokenInvalid`, with `status` 403 |
| 401, and the developer token works on its own | `UserTokenInvalid`, with `status` 401 |
| 401, and the developer token is refused on its own too | `DeveloperTokenRejected` |
| Anything else | The client's usual error, which says nothing about the token |

Apple documents two causes for a 401 on `/v1/me`: the developer token, or a listener who is not
signed in or has no Apple Music subscription. So after a 401, one more request is made with the
developer token alone (`GET /v1/test`). If Apple accepts it, the listener was the problem; if that
request fails in any way, its error is the one you get. No error message quotes the token.

`userTokenFromEnv` treats a missing token as no token, not as an error: an unset, empty, or blank
variable is `undefined`. A variable that is set has to pass the same header check, and throws
`UserTokenInvalid` naming the variable, never its value, when it does not.

## The intake handler

`POST` with `Content-Type: application/json` and a body of `{ "token": "..." }`.

| Status | Body | When |
| --- | --- | --- |
| 204 | none | Apple accepted the token and the store has it |
| 400 | `{ "error": "BadRequest" }` | The body is not JSON or has no string `token` |
| 401 | `{ "error": "Unauthorized" }` | `userId(req)` resolved to nothing |
| 405 | `{ "error": "MethodNotAllowed" }` | Not a `POST` |
| 413 | `{ "error": "PayloadTooLarge" }` | The body is over 8 KiB |
| 415 | `{ "error": "UnsupportedMediaType" }` | The content type is not `application/json` |
| 422 | `{ "error": "UserTokenInvalid" }` | The token is malformed, Apple answered 403, or Apple answered 401 for the listener; nothing is stored |
| 502 | `{ "error": "<tag>" }` | Apple did not confirm the token: `DeveloperTokenRejected`, `RateLimited`, `ApiError`, `NetworkError`; nothing is stored |

- **`userId` is the authentication.** It must return the signed-in user from your own session and
  nothing when there is none. The body cannot name a user.
- **Requiring JSON is the cross-site defence.** A form or a `no-cors` fetch on another site cannot send
  `application/json`, so it cannot bind its own token to your visitor. That holds only while your CORS
  policy does not allow other origins to send that header with credentials.
- **How long Apple is waited for is the client's policy, not the handler's.** Apple is asked through
  the client you pass, under its `retry` option: by default a failure is retried once, and a 429 is
  waited out for a `Retry-After` of up to 60 s before the handler answers. Pass a client with the
  policy you want on this route, or put your own timeout around the handler.
- **Every attempt is an Apple API call** against your developer token, and a 401 costs one more to
  find out whose it was. Rate-limit the route as you would a login.
- **Anything else that throws rejects the handler**, and is yours to answer: `userId`, the store, a
  body something else has already read, a request aborted part way.
- Every response is `Cache-Control: no-store`, and none carries the token or Apple's error text.

## Stores

Every store is `AsyncDisposable`, with `dispose()` beside `Symbol.asyncDispose`, so
`await using store = ...` works whichever one is behind it. Disposing releases what the store itself
holds: `MemoryUserTokenStore` forgets every token; `KvUserTokenStore` holds nothing of its own, so the
tokens in the namespace stay.

`MemoryUserTokenStore` loses everything on restart and is not shared between processes or isolates.

`KvUserTokenStore` keeps each token under `prefix + userId` (the prefix defaults to
`music-user-token:`). Workers KV is eventually consistent: a token just stored or just deleted can
take up to a minute to look that way elsewhere, and Apple's 403 remains the authority.

Neither store encrypts. `KvUserTokenStore` writes the token as given, so whoever can read the
namespace can read the token; wrap `kv` if you need more than the platform provides. A Music User
Token is as sensitive as a session cookie: keep it out of logs, URLs, and browser storage.

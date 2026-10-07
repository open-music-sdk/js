# @open-music-sdk/user-token

Everything around a Music User Token except issuing one: taking it in, asking Apple whether it works,
and keeping it where [`core`](../core)'s `forUser(userId)` can find it. Only Apple can issue the token,
through its own sign-in flow; this package starts once you hold the string.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use `user-token` directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/user-token @open-music-sdk/core
```

```ts
import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import { MemoryUserTokenStore, userTokenFromEnv, userTokenIntake, validateUserToken } from "@open-music-sdk/user-token";

const store = new MemoryUserTokenStore();
const music = createClient({ developerToken, userTokenStore: store });

// Intake over HTTP: a web-standard handler. Validates with GET /v1/me/storefront, then stores.
export const POST = userTokenIntake(music, { store, userId: (req) => sessionUserId(req) });

// Intake out of band: a CLI or job reads the token from the environment.
const token = userTokenFromEnv("MUSIC_USER_TOKEN");
await validateUserToken(music, token); // throws UserTokenInvalid before any work starts
await store.set(userId, token);

// Rejection: core maps 403 to UserTokenInvalid; the store forgets the token when you tell it to.
try {
  await music.forUser(userId).request("v1/me/library/playlists");
} catch (e) {
  if (!isAppleMusicError(e, "UserTokenInvalid")) throw e;
  await store.delete(userId);
  askListenerToReconnect(userId);
}
```

## What is in it

| Export | Does |
| --- | --- |
| `validateUserToken(client, token, { signal }?)` | Asks Apple with `GET /v1/me/storefront`; rejects with `UserTokenInvalid` |
| `userTokenFromEnv(name?, env?)` | Reads and trims `MUSIC_USER_TOKEN` from `process.env` or the object you pass |
| `userTokenIntake(client, { store, userId })` | `(req: Request) => Promise<Response>` that validates and stores a posted token |
| `MemoryUserTokenStore` | A `Map`; `dispose()` and `Symbol.asyncDispose` forget everything |
| `KvUserTokenStore(kv, { prefix }?)` | Workers KV, or anything with `get`, `put`, and `delete` |
| `tUserTokenStore` | The three-method interface from `core`; a SQL store is twenty lines |

## Validation

A token is opaque, so the only local check is that it can be a header value: 1 to 4096 visible ASCII
characters. Anything else is `UserTokenInvalid` without a request. Then Apple decides: 403 is
`UserTokenInvalid`; every other failure is the client's usual error and says nothing about the token.
A 401 is `DeveloperTokenRejected`, which under `/v1/me` can also mean the listener has no subscription.
No error message quotes the token.

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
| 422 | `{ "error": "UserTokenInvalid" }` | The token is malformed or Apple answered 403; nothing is stored |
| 502 | `{ "error": "<tag>" }` | Apple could not be asked: `DeveloperTokenRejected`, `RateLimited`, `ApiError`, `NetworkError` |

- **`userId` is the authentication.** It must return the signed-in user from your own session and
  nothing when there is none. The body cannot name a user.
- **Requiring JSON is the cross-site defence.** A form or a `no-cors` fetch on another site cannot send
  `application/json`, so it cannot bind its own token to your visitor. That holds only while your CORS
  policy does not allow other origins to send that header with credentials.
- **Each accepted request costs one Apple API call** against your developer token. Rate-limit the route
  as you would a login.
- A failing `userId` or `store` rejects the handler; your framework answers 500.
- Every response is `Cache-Control: no-store`, and none echoes the token or Apple's reply.

## Stores

`MemoryUserTokenStore` loses everything on restart and is not shared between processes or isolates.
`KvUserTokenStore` writes the token as the namespace stores it; Workers KV encrypts at rest, and for
anything else wrap `kv` to encrypt before `put`. Workers KV is eventually consistent, so a deleted
token can be read for up to a minute elsewhere; Apple's 403 remains the authority. A Music User Token
is as sensitive as a session cookie: keep it out of logs, URLs, and browser storage.

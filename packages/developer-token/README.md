# @open-music-sdk/developer-token

Where a developer token comes from: signed with your MusicKit private key on a machine that holds it, or
fetched from an endpoint you host by code that must not. Both are `developerToken` providers for
[`@open-music-sdk/core`](../core), cached and replaced when Apple rejects them.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/developer-token @open-music-sdk/core
```

`core` is a peer dependency: install it yourself, at the same version. The family is released in
lockstep, and the two must share one copy of `core` for its errors to be recognised and retried.

```ts
// On a server, a worker, or a CLI: anywhere the private key may live.
import { createClient } from "@open-music-sdk/core";
import { cachedMinter, fromEnv } from "@open-music-sdk/developer-token";

const key = fromEnv(process.env); // the key and its two IDs, from your .env file or your platform's secrets
const music = createClient({ developerToken: cachedMinter(key), storefront: "us" });

// A token endpoint for your own front end: short-lived, bound to your origin, never stored by a cache.
const forBrowsers = cachedMinter({ ...key, ttlSeconds: 3600, origin: ["https://app.example"] });
export const GET = async () => new Response(await forBrowsers(), { headers: { "cache-control": "no-store" } });
```

```sh
# .env
APPLE_MUSIC_TEAM_ID=DEF123GHIJ
APPLE_MUSIC_KEY_ID=ABC123DEFG
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----"
```

```ts
// In a browser: no key and no signing code. This entry never references jose, bundler or no bundler.
import { createClient } from "@open-music-sdk/core";
import { remoteDeveloperToken } from "@open-music-sdk/developer-token/remote";

const music = createClient({ developerToken: remoteDeveloperToken("/api/token"), storefront: "us" });
```

## What is in it

| Export | Does |
| --- | --- |
| `fromEnv(env, names?)` | Reads the private key, Team ID and key ID from an environment; the key comes back redacted |
| `mintDeveloperToken(options)` | Signs one ES256 JWT with [`jose`](https://github.com/panva/jose): `kid` in the header, `iss`, `iat`, `exp`, and `origin` if given |
| `cachedMinter(options)` | A provider that mints on first use, shares one mint between concurrent requests, and mints again before `exp` |
| `remoteDeveloperToken(url, options?)` | A provider that fetches the token from your endpoint, with the same caching. Also the only export of `@open-music-sdk/developer-token/remote`. |
| `redacted(value)` | Wraps a secret so string conversion and JSON print `<redacted>`, as does `console.log` on Node and any runtime that honours its inspect symbol; `unwrap()` returns it. Elsewhere a console shows an object of functions, never the value. |

The package has two entries. `@open-music-sdk/developer-token` is everything. `/remote` is
`remoteDeveloperToken` alone, in a file that imports neither `jose` nor the minter, for code that must
carry no signing code: a page that loads modules without a bundler gets none, and nothing there can
sign a token even if a private key were handed to it by mistake.

## The key

Apple lets you download `AuthKey_XXXXXXXXXX.p8` once. Put its contents in the environment, not in the
repository: a `.env` file that is never committed for local work, your platform's secret store in
production. `fromEnv` reads three variables and takes the environment as an argument, so it works with
whatever loaded it: `node --env-file=.env`, `process.loadEnvFile()`, a framework's own `.env` support, or
the `env` a Cloudflare Worker is handed.

| Variable | Holds |
| --- | --- |
| `APPLE_MUSIC_PRIVATE_KEY` | The contents of the `.p8`. On one line with `\n` for each line break, or across several lines inside double quotes. |
| `APPLE_MUSIC_TEAM_ID` | Your Team ID. |
| `APPLE_MUSIC_KEY_ID` | The key's ID: the ten characters in the file name. |

Other names go in the second argument: `fromEnv(env, { pem: "MUSICKIT_KEY" })`. A variable that is
missing or empty is a `TypeError` naming the variable. No error quotes a value.

## Minting

| Option | |
| --- | --- |
| `pem` | The contents of the `.p8`, as `fromEnv` returns it, or a string or `redacted` string of your own. |
| `teamId`, `keyId` | Your Team ID and the key's ID: ten capital letters and digits each. |
| `ttlSeconds` | Lifetime; default 150 days, at most 15 777 000 (Apple's six months). |
| `origin` | Web origins the token is valid for, each exactly as a browser sends it: `https://app.example`, with no path or trailing slash. Set it, with a short `ttlSeconds`, on any token a browser will see. |
| `refreshAheadSeconds` | `cachedMinter` only: how long before `exp` to mint a replacement. Default one day, never more than half the lifetime. |

Invalid options throw a `TypeError`: from `cachedMinter` when it is created, from `mintDeveloperToken`
as a rejection. A key that is not a PKCS8 P-256 private key is a `TypeError` on first use; the key is
never quoted in an error. The private key stays where you put it: only the signed token travels.

## Your token endpoint

A developer token is a bearer credential for your whole team's quota, and an endpoint that hands one
to anyone who asks is a public token dispenser. What limits the damage is yours to set:

- **A short `ttlSeconds`.** A token cannot be revoked without revoking the key, so its lifetime is
  how long a leaked one stays useful. The 150-day default suits a token that never leaves your server.
- **`origin`.** Apple honours it for requests from browsers. It does not stop a script that sets its
  own `Origin` header, so it narrows who can use a token, not who can fetch one.
- **Who may call the endpoint.** Put it behind your own session or rate limit if tokens should only
  go to your users.
- **`Cache-Control: no-store`** on the response, so no proxy or CDN keeps a copy.

Nothing in this package logs. `core`'s `onRequest` hook is handed the `Authorization` header along with
the rest of the request, so a hook that prints requests prints the token.

## Fetching

`remoteDeveloperToken(url)` expects your endpoint to answer 2xx with the JWT as text or as JSON
`{ "token": "<jwt>" }`. It reads `exp` from the token to know when to fetch again and does not verify
the signature; Apple does. The request is a plain `GET` with `cache: "no-store"` and a timeout
(`timeoutMs`, whole milliseconds, default 10 s); pass `fetch` to add credentials or headers. The timeout holds even if
your `fetch` does not pass the abort signal on.

The answer is read up to 16 KB and no further, counted after any decompression; the rest is cancelled.
A token longer than 8 KB is not believed either: a real one is a few hundred bytes. What answers at
your URL decides how much is sent, not how much is kept.

A redirect is refused, so the token only ever comes from the URL you configured. Point it at the final
URL: a framework that redirects `/api/token` to `/api/token/` will otherwise fail every fetch.

A relative URL such as `/api/token` resolves against the document's base URL on first use, exactly as
`fetch` would. Creating the provider never needs a document, so a module that a server also loads can
create it; using it where there is none throws a `TypeError`. Outside a browser, pass an absolute URL.

Whatever goes wrong at the endpoint is an `AppleMusicError` tagged `DeveloperTokenUnavailable`, so it is
never mistaken for an answer from Apple: a 404 from your endpoint is not "no such song".

| Endpoint | `status` | Retried by the client |
| --- | --- | --- |
| Unreachable, timed out, or dropped mid-body | none | Yes |
| 429, or 5xx other than 501 | The endpoint's | Yes, after its `Retry-After` if it sent one |
| Any other status that is not 2xx | The endpoint's | No |
| 2xx without a JWT that has an `exp`, or with more than 16 KB | The endpoint's | No |

## Caching

Both providers issue once and reuse the token. From `refreshAheadSeconds` before its `exp` the token
is replaced in the background: requests keep getting the old one, nobody waits, and a replacement that
fails is tried again a minute later. An outage of your token endpoint that ends before `exp` is never
seen by a request. Only when there is no usable token does a request wait for one, or fail for want of
one, and then the next request tries again.

Concurrent requests share one mint or fetch; an abort ends only the request that aborted.

When Apple answers 401, `core` asks again with the rejected token, and the provider replaces it if it
is still the current one. While a usable token is held, though, its source is asked at most once a
minute:

- A token Apple rejects within a minute of being issued is handed back, not replaced. The same key or
  endpoint would only produce the same again, so a revoked key, or a 401 that is really about the
  listener, costs each request one call to Apple rather than two and a mint.
- If a replacement cannot be had, the held token stays in service.
- A token that already looks expired when it arrives, as every token does to a browser whose clock
  runs fast, is used for a minute rather than fetched again for every request.

## Not here

Music User Tokens are a different thing entirely; see `@open-music-sdk/user-token` once it exists.

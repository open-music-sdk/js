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

// A token endpoint for your own front end: short-lived and bound to your origin.
const forBrowsers = cachedMinter({ ...key, ttlSeconds: 3600, origin: ["https://app.example"] });
export const GET = async () => new Response(await forBrowsers());
```

```sh
# .env
APPLE_MUSIC_TEAM_ID=DEF123GHIJ
APPLE_MUSIC_KEY_ID=ABC123DEFG
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----"
```

```ts
// In a browser: no key, no signing code.
import { createClient } from "@open-music-sdk/core";
import { remoteDeveloperToken } from "@open-music-sdk/developer-token";

const music = createClient({ developerToken: remoteDeveloperToken("/api/token"), storefront: "us" });
```

## What is in it

| Export | Does |
| --- | --- |
| `fromEnv(env, names?)` | Reads the private key, Team ID and key ID from an environment; the key comes back redacted |
| `mintDeveloperToken(options)` | Signs one ES256 JWT with [`jose`](https://github.com/panva/jose): `kid` in the header, `iss`, `iat`, `exp`, and `origin` if given |
| `cachedMinter(options)` | A provider that mints on first use, shares one mint between concurrent requests, and mints again before `exp` |
| `remoteDeveloperToken(url, options?)` | A provider that fetches the token from your endpoint, with the same caching |
| `redacted(value)` | Wraps a secret so logging, string conversion, and JSON print `<redacted>`; `unwrap()` returns it |

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

## Fetching

`remoteDeveloperToken(url)` expects your endpoint to answer 2xx with the JWT as text or as JSON
`{ "token": "<jwt>" }`. It reads `exp` from the token to know when to fetch again and does not verify
the signature; Apple does. The request is a plain `GET` with `cache: "no-store"` and a timeout
(`timeoutMs`, default 10 s); pass `fetch` to add credentials or headers.

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
| 2xx without a JWT that has an `exp` | The endpoint's | No |

## Caching

Both providers issue once and reuse the token until `refreshAheadSeconds` before it expires.
Concurrent requests share one mint or fetch; an abort ends only the request that aborted. A failure
is never cached: with no usable token, the next request tries again.

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

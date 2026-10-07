# @open-music-sdk/developer-token

Where a developer token comes from: signed with your MusicKit private key on a machine that holds it, or
fetched from an endpoint you host by code that must not. Both are `developerToken` providers for
[`@open-music-sdk/core`](../core), cached and replaced when Apple rejects them.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/developer-token @open-music-sdk/core
```

```ts
// On a server, a worker, or a CLI: anywhere the .p8 may live.
import { createClient } from "@open-music-sdk/core";
import { cachedMinter } from "@open-music-sdk/developer-token";
import { fromKeyFile } from "@open-music-sdk/developer-token/node";

const developerToken = cachedMinter({
  pem: await fromKeyFile("./AuthKey_ABC123DEFG.p8"), // or the PEM itself, from a secret binding or an environment variable
  teamId: "DEF123GHIJ",
  keyId: "ABC123DEFG",
});
const music = createClient({ developerToken, storefront: "us" });

// A token endpoint for your own front end: short-lived and bound to your origin.
const forBrowsers = cachedMinter({ pem, teamId, keyId, ttlSeconds: 3600, origin: ["https://app.example"] });
export const GET = async () => new Response(await forBrowsers());
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
| `mintDeveloperToken(options)` | Signs one ES256 JWT with [`jose`](https://github.com/panva/jose): `kid` in the header, `iss`, `iat`, `exp`, and `origin` if given |
| `cachedMinter(options)` | A provider that mints on first use, shares one mint between concurrent requests, and mints again before `exp` |
| `remoteDeveloperToken(url, options?)` | A provider that fetches the token from your endpoint, with the same caching |
| `redacted(value)` | Wraps a secret so logging, string conversion, and JSON print `<redacted>`; `unwrap()` returns it |
| `fromKeyFile(path)` from `./node` | Reads the `.p8` from disk, redacted |

## Minting

| Option | |
| --- | --- |
| `pem` | The contents of `AuthKey_XXXXXXXXXX.p8`, as a string or `redacted`. Escaped `\n` from an environment variable is accepted. |
| `teamId`, `keyId` | Your Team ID and the key's ID. |
| `ttlSeconds` | Lifetime; default 150 days, at most 15 777 000 (Apple's six months). |
| `origin` | Web origins the token is valid for. Set it, with a short `ttlSeconds`, on any token a browser will see. |
| `refreshAheadSeconds` | `cachedMinter` only: how long before `exp` to mint a replacement. Default one day, never more than half the lifetime. |

Invalid options throw a `TypeError`: from `cachedMinter` when it is created, from `mintDeveloperToken`
as a rejection. A key that is not a PKCS8 P-256 private key is a `TypeError` on first use; the key is
never quoted in an error. The private key stays where you put it: only the signed token travels.

## Fetching

`remoteDeveloperToken(url)` expects your endpoint to answer 2xx with the JWT as text or as JSON
`{ "token": "<jwt>" }`. It reads `exp` from the token to know when to fetch again and does not verify
the signature; Apple does. The request is a plain `GET` with `cache: "no-store"` and a timeout
(`timeoutMs`, default 10 s); pass `fetch` to add credentials or headers. A relative URL resolves
against the document, so outside a browser the URL must be absolute.

| Endpoint | Outcome |
| --- | --- |
| Unreachable, timed out, or dropped mid-body | `NetworkError`, which the client's retry policy retries |
| Not 2xx | `ApiError` with the `status`; 5xx is retried, 4xx is not |
| 2xx without a JWT that has an `exp` | `ApiError` |

## Caching

Both providers issue once and reuse the token until `refreshAheadSeconds` before it expires.
Concurrent requests share one mint or fetch; an abort ends only the request that aborted. When Apple
answers 401, `core` asks again with the rejected token, and the provider replaces it if it is still
the current one. A failure is never cached: the next request tries again.

## Not here

Loading the three settings from the environment belongs to the `server` integration. Music User
Tokens are a different thing entirely; see `@open-music-sdk/user-token` once it exists.

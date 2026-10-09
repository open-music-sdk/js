# @open-music-sdk/developer-token

Where a developer token comes from: signed with your MusicKit private key on a machine that holds it, or
fetched from an endpoint you host by code that must not. Both are `developerToken` providers for
[`@open-music-sdk/core`](../core), cached and replaced when Apple rejects them.

You probably want one of the integrations instead (`server`, `browser`, `react`, `next`) once they
exist. Use this package directly to assemble your own client or to build one of those.

```
pnpm add @open-music-sdk/developer-token @open-music-sdk/core
```

Keep the two on the same version. If your app does end up with a different copy of `core` than the
one this package resolves, nothing breaks: an `AppleMusicError` is recognised, and retried, whichever
copy made it.

```ts
// On a server, a worker, or a CLI: anywhere the private key may live.
import { createClient } from "@open-music-sdk/core";
import { developerTokenMinter } from "@open-music-sdk/developer-token";

// The key and its two IDs, from wherever your app keeps its secrets. Here, three environment variables of your naming.
const key = {
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
};

const music = createClient({ developerToken: developerTokenMinter(key), storefront: "us" });

// A token endpoint for your own front end: bound to your origin, never stored by a cache.
const forBrowsers = developerTokenMinter({ ...key, origin: ["https://app.example"] });
export const GET = async () => new Response(await forBrowsers(), { headers: { "cache-control": "no-store" } });
```

```ts
// In a browser: no key and no signing code. This entry never references jose, bundler or no bundler.
import { createClient } from "@open-music-sdk/core";
import { developerTokenFetcher } from "@open-music-sdk/developer-token/fetcher";

const music = createClient({ developerToken: developerTokenFetcher("/api/token"), storefront: "us" });
```

## What is in it

The names follow one rule. A verb does the thing once: `mintDeveloperToken` signs a token and returns it.
A `developerToken…` noun is a provider to hand to `createClient`: it keeps a token and replaces it as
needed, and is named for how it gets one.

| Export | Does |
| --- | --- |
| `mintDeveloperToken(options)` | Signs one ES256 JWT with [`jose`](https://github.com/panva/jose): `kid` in the header, `iss`, `iat`, `exp`, and `origin` if given |
| `developerTokenMinter(options)` | A provider that mints on first use, shares one mint between concurrent requests, and mints again before `exp` |
| `developerTokenFetcher(url, options?)` | A provider that fetches the token from your endpoint, with the same caching. Also the only export of `@open-music-sdk/developer-token/fetcher`. |

The package has two entries. `@open-music-sdk/developer-token` is everything. `/fetcher` is
`developerTokenFetcher` alone, in a file that imports neither `jose` nor the minter, for code that must
carry no signing code: a page that loads modules without a bundler gets none, and nothing there can
sign a token even if a private key were handed to it by mistake.

## The key

Apple lets you download `AuthKey_XXXXXXXXXX.p8` once. Keep its contents out of the repository: in a
`.env` file that is never committed for local work, in your platform's secret store in production.

This package reads no environment and no file. Loading the key and its two IDs is your app's job,
done the way it loads its other secrets; the minter takes them as `pem`, `teamId` and `keyId` and is
responsible for them from there. It checks what it is handed: an option that is missing, or is not a
string, is a `TypeError` naming the option, so an unset variable behind one of the `!` above fails
where the minter is created and not on the first request.

`pem` is the text of the file. A variable usually holds it on one line with `\n` for each line break,
and that is accepted as it is, as are Windows line endings, a byte order mark, and whitespace around it:

```sh
# .env
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----"
```

No error quotes a value: a string is described by its length and anything else by its kind. Only a
number is printed as given.

## Minting

| Option | |
| --- | --- |
| `pem` | The contents of the `.p8`, as a string. Required. |
| `teamId`, `keyId` | Your Team ID, and the key's ID (the ten characters in the file's name): ten capital letters and digits each. Required. |
| `ttlSeconds` | The token's lifetime in whole seconds. Default 3600, one hour; from 60 to 15 777 000 (Apple's six months). |
| `origin` | Web origins the token is valid for, each exactly as a browser sends it: `https://app.example`, with no path or trailing slash. Set it on any token a browser will see. |
| `refreshAheadSeconds` | For `developerTokenMinter`, not `mintDeveloperToken`: how long before `exp` to mint a replacement. Default, and at most, half the lifetime. |

Invalid options throw a `TypeError`: from `developerTokenMinter` when it is created, from `mintDeveloperToken`
as a rejection. A key that is not a PKCS8 P-256 private key is a `TypeError` on first use; the key is
never quoted in an error. The private key stays where you put it: only the signed token travels.

`developerTokenMinter` reads its options once, when it is created, so nothing you do to your object afterwards
changes what it mints. Until a token is first wanted it holds the PEM in a wrapper that prints as
`<redacted>`, opened only to import the key. The key is imported into a form that can sign and cannot
be exported, and from then on the minter holds no copy of the PEM text. The text is still wherever
you got it from, `process.env` included.

## Your token endpoint

A developer token is a bearer credential for your whole team's quota, and an endpoint that hands one
to anyone who asks is a public token dispenser. What limits the damage is yours to set:

- **`ttlSeconds`.** A token cannot be revoked without revoking the key, so its lifetime is how long a
  leaked one stays useful. The default is one hour, and since the minter replaces tokens on its own a
  longer one buys nothing. Raise it only for a token that has to be embedded where nothing can mint.
- **`origin`.** Apple honours it for requests from browsers. It does not stop a script that sets its
  own `Origin` header, so it narrows who can use a token, not who can fetch one.
- **Who may call the endpoint.** Put it behind your own session or rate limit if tokens should only
  go to your users.
- **`Cache-Control: no-store`** on the response, so no proxy or CDN keeps a copy.

Nothing in this package logs. `core`'s `onRequest` hook is handed the `Authorization` header along with
the rest of the request, so a hook that prints requests prints the token.

## Fetching

`developerTokenFetcher(url)` expects your endpoint to answer 2xx with the JWT as text or as JSON
`{ "token": "<jwt>" }`. It reads `exp` from the token to know when to fetch again and does not verify
the signature; Apple does. The request is a plain `GET` with `cache: "no-store"` and a timeout
(`timeoutMs`, whole milliseconds, default 10 s); pass `fetch` to add credentials or headers. The
timeout holds even if your `fetch` does not pass the abort signal on. `refreshAheadSeconds` works as
it does for the minter, measured against the life the token had left when it arrived.

The answer is read up to 16 KB and no further, counted after any decompression; the rest is cancelled.
A token longer than 8 KB is not believed either: a real one is a few hundred bytes. What answers at
your URL decides how much is sent, not how much is kept. The one exception is a runtime whose
responses have no body stream to count: there the answer is read whole and then held to the same limit.

A redirect is refused, so the token only ever comes from the URL you configured. Point it at the final
URL: a framework that redirects `/api/token` to `/api/token/` will otherwise fail every fetch.

A relative URL such as `/api/token` resolves against the document's base URL each time a token is
fetched, exactly as `fetch` would. Creating the provider never needs a document, so a module that a server also loads can
create it; using it where there is none throws a `TypeError`. Outside a browser, pass an absolute URL.

Whatever goes wrong at the endpoint is an `AppleMusicError` tagged `DeveloperTokenUnavailable`, so it is
never mistaken for an answer from Apple: a 404 from your endpoint is not "no such song".

| Endpoint | `status` | Retried by the client |
| --- | --- | --- |
| Unreachable, redirecting, timed out, or dropped mid-body | none | Yes |
| 429, or 5xx other than 501 | The endpoint's | Yes, after its `Retry-After` if it sent one |
| Any other status that is not 2xx | The endpoint's | No |
| 2xx without a JWT that has an `exp`, or with more than 16 KB | The endpoint's | No |

## Caching

Both providers issue once and reuse the token. Halfway through its life, or `refreshAheadSeconds`
before its `exp` if you set that and it is later, the token is replaced in the background: requests
keep getting the old one, nobody waits, and a replacement that fails is tried again a minute later. An
outage of your token endpoint that ends before `exp` is never seen by a request. Only when there is no usable token does a request wait for one, or fail for want of
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

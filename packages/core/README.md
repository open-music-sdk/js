# @open-music-sdk/core

The HTTP client every other package is built on. It sends each request to the Apple Music API with your tokens,
follows `next` links, turns Apple's status codes into errors, and retries what is worth retrying. It depends on
nothing outside the family, and runs anywhere `fetch` does.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which build their client with this package. Use `core`
to build your own client, or to call a path no function covers.

```
pnpm add @open-music-sdk/core
pnpm add -D @open-music-sdk/types
```

The second line is for the types the example imports.

## Example

Anywhere `fetch` runs. `developerToken`, `musicUserToken` and `askListenerToSignInAgain` stand for your own code:

```ts
import { createClient, isAppleMusicError } from "@open-music-sdk/core";
import type { tSongsResponse } from "@open-music-sdk/types";

const music = createClient({ developerToken, storefront: "us" }); // a token, or a provider from developer-token

const { data } = await music.request<tSongsResponse>("v1/catalog/us/songs", { params: { ids: ["1613600188"] } });

const listener = music.as(musicUserToken); // the same client, for one listener
try {
  for await (const playlist of listener.paginate("v1/me/library/playlists")) console.log(playlist);
} catch (e) {
  if (isAppleMusicError(e, "UserTokenInvalid")) askListenerToSignInAgain();
  else throw e;
}
```

## What's in it

| Export | What it does |
| --- | --- |
| `createClient(options)` | The client, with `request`, `paginate`, `storefront`, `as` and `forUser`. Its options are checked when you create it. |
| `withNamespaces(client, namespaces)` | The client with namespaces such as `catalog` on it, made again for each client `as()` and `forUser()` give. An integration's client is made this way. |
| `AppleMusicError`, `isAppleMusicError(e, tag?)` | The one class for every runtime failure, and the guard that narrows to it, or to one `_tag` |
| `retry(fn, policy?, signal?)`, `retryable` | Backoff with full jitter that honours `Retry-After`, and the default test of what is worth another attempt |
| `createRateLimiter(options)` | A token bucket to share between every client on one developer token |
| `parseRetryAfter(header)`, `sleep(ms, signal?)` | A `Retry-After` header in milliseconds, and a wait that an abort ends |
| `parseToken(value)` | The one rule for what a token is: the value trimmed, or `undefined` |
| `readBounded(message, maxBytes)` | A body read as text up to a limit, with the rest cancelled |
| `got(value)` | What a value is, for an error that must not show it |
| `hostsOf(fn, value, example)`, `isOnHost(url, hosts)` | A caller's list of allowed hosts, and whether a URL is `https` on one of them |
| The types | `tClientOptions`, `tRequestInit`, `tPaginateInit`, `tAppleMusicClient`, `tTokenProvider`, `tUserTokenStore`, `tRetryPolicy`, `tRateLimiter` and the rest |

These are for a package that names endpoints, as the clients do. An app has no need of them:

| Export | What it does |
| --- | --- |
| `endpoint`, `resourceGetter`, `resourcesGetter`, `resourcesFinder`, `resourceLister`, `relationshipGetter` | Declare a function for one endpoint, which you call with a client or bind to one |
| `endpointNamespace(fn, client, endpoints)` | Every such function, bound to one client |
| `initOf`, `walkOf`, `inStorefront`, `signalOf` | The options every such function takes, turned into what `request` takes |
| `segmentOf`, `listOf`, `textOf`, `typedIdsOf`, `optionsOf`, `clientOf` | The checks on what a function is handed. A mistake is a `TypeError` that names the function and the argument. |
| `has`, `isName`, `isPlain`, `itemsOf`, `ownOf` | What those checks are made of, for a package with a check of its own to make |

[Call an endpoint the clients don't cover](https://open-music-sdk.github.io/js/guides/direct-requests) shows how to
declare one, and each builder's reference says what it checks.

## Learn more

- [Call an endpoint the clients don't cover](https://open-music-sdk.github.io/js/guides/direct-requests), with
  `request`, `paginate` and the builders
- [Build your own client from the parts](https://open-music-sdk.github.io/js/guides/own-client)
- [Handle errors](https://open-music-sdk.github.io/js/guides/errors) and
  [Validate Apple's responses](https://open-music-sdk.github.io/js/guides/validation)
- [Errors](https://open-music-sdk.github.io/js/concepts/errors): every tag, what is retried, and why a write is
  sent once
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens), for which request
  sends which token
- [Security model](https://open-music-sdk.github.io/js/concepts/security), for where requests go and what a `next`
  link from outside your app can do
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/core/)

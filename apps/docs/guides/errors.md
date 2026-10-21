# Handle errors

In this guide you catch the errors a request can end in, act on each kind, and tune how the client retries and
paces requests. [Errors](../concepts/errors) explains how the SDK decides what each error is.

Before you start, you need:

- a client from an integration, such as `createServerClient` or `createBrowserClient`.

In the code below, `music` is your client, `key` holds your key and its two IDs as in
[Set up your MusicKit key](./musickit-key), and `show`, `showNotFound` and `showError` stand for your own code.

## 1. Catch an `AppleMusicError` by its tag

Everything that goes wrong with a request at runtime is an `AppleMusicError`, and its `_tag` says which kind.
Use `isAppleMusicError(e, tag)` to test for one kind. It narrows the error's type, and recognises an error from
any copy of the SDK.

On a server or in a page, with the same import from `@open-music-sdk/browser` or `@open-music-sdk/react`:

```ts
import { isAppleMusicError } from "@open-music-sdk/server";

async function showAlbum(id: string) {
  try {
    show(await music.catalog.getAlbum(id));
  } catch (e) {
    if (isAppleMusicError(e, "ApiError") && e.status === 404) {
      return showNotFound();
    }
    if (isAppleMusicError(e, "RateLimited")) {
      return showError("Too many requests. Try again shortly.");
    }
    throw e;
  }
}
```

Rethrow what you don't handle, as the last line does.

A function that walks pages, such as `music.user.listLibraryPlaylists()`, asks Apple only once a loop starts. Its
errors come from the loop, so put the `try` around the `for await`.

## 2. Act on each kind

Every `AppleMusicError` has a `message`, which never holds a token, so you can log it. It also has `status`,
Apple's `errors`, `issues` and `retryAfterMs`, each `undefined` where there's nothing to say.

| `_tag` | What happened | What to do |
| --- | --- | --- |
| `UserTokenInvalid` | Apple answered `403` to the listener's token, or there was no token to send | Ask the listener to sign in again. Don't retry. On a server, forget the stored token, as [Keep a listener's token on your server](./store-user-tokens) shows. |
| `RateLimited` | Apple answered `429`, and the client's retries ran out, or Apple asked for a longer wait than the client waits for | Wait at least `retryAfterMs` before you try again, when Apple sent it. Make fewer requests: see step 5. |
| `ApiError` | Apple answered another failing status, which is in `status`, with its own details in `errors` | A `404` means the resource doesn't exist, perhaps not in this [storefront](../glossary#storefront). A `5xx` is Apple's side, and the client has already retried it. Other `4xx` statuses mean Apple didn't accept the request: read `errors`. |
| `NetworkError` | `fetch` failed, or the answer couldn't be read. What `fetch` threw is in `cause`. | The client has already retried it. Tell the user, and try again later. |
| `DeveloperTokenUnavailable` | Your developer token provider couldn't get a token. In a page, that's your token route failing. `status` is your route's, never Apple's. | Check your token route and its logs. See [Serve a developer token to a page](./token-endpoint). |
| `DeveloperTokenInvalid` | Apple answered `401` to the developer token, and the client has already asked its provider for a fresh one | Check your key, key ID and team ID: the CLI's `open-music-sdk doctor` asks Apple about the key alone. Under `/v1/me`, a `401` can also mean the listener isn't signed in or has no Apple Music subscription. |
| `ValidationError` | The answer didn't match the `schema` you passed. What's wrong is in `issues`. | See [Validate Apple's responses](./validation). |

An `ApiError` can also come from a successful answer that isn't what the call needs: a body that isn't JSON, or,
from a function on `music.catalog` or `music.user` that hands over one resource, an answer that holds none. Its
`status` is then the success's, such as `200`.

::: for page=vanilla,react
The [vanilla and React samples](../samples) send every error through one function, which says each kind in words
a listener can act on:

<<< @/../../samples/web-vanilla/src/errors.ts#explain{ts}
:::

::: for page=nextjs
The [Next sample](../samples) sends every error through one function, which says each kind in words a listener
can act on. Its server actions answer with these words rather than throw, because Next keeps a thrown error's
message from the page in production:

<<< @/../../samples/web-nextjs/src/lib/errors.ts#explain{ts}
:::

### Writes that may have happened

The client sends a `POST`, such as `addToLibrary` or `createLibraryPlaylist`, again only after a `429`, when
there was no developer token to send it with, or once after a `401`, when its provider gives a fresh developer
token. Those failures mean Apple didn't carry it out. After a `5xx` or a `NetworkError`, Apple may have carried it
out before the answer was lost, so the error reaches you at once.

Only a `POST` is held back. A `PUT` or a `DELETE`, such as `setSongRating` or `deleteSongRating`, is retried after
a `5xx` or a `NetworkError` like any other request.

Before you try a `POST` again, check whether it happened. For example, read the playlist before you add the
same tracks again.

## 3. Let a `TypeError` and an abort through

A `TypeError` means your code handed a function something it can't take, such as an id with a slash in it or a
missing option. The SDK throws it before anything is sent. It's a bug to fix, not an error to catch, so don't
catch it.

When you abort a request with a `signal`, the request rejects with the signal's `reason`, as it is, and never
with an `AppleMusicError`:

```ts
const controller = new AbortController();
try {
  await music.catalog.searchCatalog(term, {
    types: ["songs"],
    signal: controller.signal,
  });
} catch (e) {
  // Aborted means you stopped it yourself, and there's nothing to report.
  if (!controller.signal.aborted) throw e;
}
```

What your own code throws also reaches you as it is: a hook, a token provider, a token store, a schema or a rate
limiter of your own.

## 4. Tune retries

By default the client tries a request once more when it fails with a `NetworkError`, a `RateLimited`, an
`ApiError` with a `5xx` status other than `501`, or a `DeveloperTokenUnavailable` whose source was unreachable or
answered `429` or such a `5xx`. It waits for a `Retry-After` of up to 60 seconds. When Apple asks for a longer
wait, the `RateLimited` error reaches you at once, with `retryAfterMs` set.

To make one attempt only, pass `retry: false`:

```ts
const music = createServerClient({ ...key, retry: false });
```

To change the policy, pass the fields you want. Each field you leave out keeps its default:

```ts
const music = createServerClient({
  ...key,
  retry: {
    // Attempts in all, the first included. Default 2.
    maxAttempts: 3,
    // The first wait is up to this long, and it doubles each attempt.
    // Default 250.
    baseDelayMs: 500,
    // The longest wait between attempts. Default 4,000.
    maxDelayMs: 8_000,
    // The longest Retry-After to wait for. Default 60,000.
    maxRetryAfterMs: 10_000,
  },
});
```

`retryOn` decides which errors get another attempt. It's handed each `AppleMusicError` and returns `true` to try
again. For a `POST`, it's asked only after the two failures that mean the write didn't happen.

A client's `as()` and `forUser()` keep its policy. For a different policy on one route, create a second client.

## 5. Pace your requests

Apple counts requests against your developer token, so all your listeners share one rate limit, and Apple
doesn't publish the numbers. To stay under it, create a rate limiter with numbers of your own and give it to the
client:

```ts
import { createRateLimiter, createServerClient } from "@open-music-sdk/server";

const limiter = createRateLimiter({ capacity: 20, refillPerSecond: 5 });
const music = createServerClient({ ...key, rateLimit: limiter });
```

`capacity` requests can go at once. After that, `refillPerSecond` requests go each second. A request waits for
its turn, and an aborted one leaves the queue.

Give the same limiter to every client that uses the same developer token. The clients `as()` and `forUser()`
give you share it already. A limiter paces the requests of one process: two servers, or two pages, each have
their own.

## Next steps

- [Errors](../concepts/errors), for how the SDK turns Apple's answers into errors.
- [Validate Apple's responses](./validation).
- The reference for [`AppleMusicError`](../reference/@open-music-sdk/core/classes/AppleMusicError),
  [`isAppleMusicError`](../reference/@open-music-sdk/core/functions/isAppleMusicError),
  [`tRetryPolicy`](../reference/@open-music-sdk/core/interfaces/tRetryPolicy) and
  [`createRateLimiter`](../reference/@open-music-sdk/core/functions/createRateLimiter).

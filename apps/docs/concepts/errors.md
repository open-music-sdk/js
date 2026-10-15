# Errors

The SDK throws two kinds of error, and they mean different things:

- A `TypeError` means your code called a function the wrong way. It's raised before anything is sent, and the fix
  is in your code.
- An `AppleMusicError` means something happened at runtime: Apple refused a request, the network failed, or your
  token endpoint couldn't hand over a token. Its `_tag` says which, so you can switch on it.

This page explains each kind, what the SDK retries before you see an error, and what an error does and doesn't
contain. [Handle errors](../guides/errors) shows how to act on them in your app.

## A mistake is a `TypeError`

Every function checks what it's handed before Apple is asked, in the order of its arguments. A mistake is a
`TypeError` that names the function and the argument:

```
getSong: id must be a string of 1 to 64 characters, with no slash, backslash, percent sign or control character in it, and not "." or ".."; got 228 characters
searchCatalog: types must be a list of 1 to 300 strings, each of 1 to 64 characters with no comma in it; got undefined
```

Where the error is raised depends on what you got wrong:

- Options are checked when the thing that takes them is created: a client, a token minter, a token endpoint, the
  intake handler, a preview player. A mistake fails there, not on the first request.
- A function that returns a promise rejects with the mistake.
- A function bound to a client that walks pages, such as `music.catalog.listGenres()`, throws the mistake when
  you call it, before any loop starts.

A few mistakes are about where a request would go or what it would carry. A path that leaves
`https://api.music.apple.com` is a `TypeError`, and so is a token, from you or from a token provider, that isn't
printable ASCII with no spaces or line breaks inside.

One mistake can only show up later. A private key that's a string but not a valid key is a `TypeError` when the
key is first used, which is on the first request that needs a token.

A `TypeError` isn't something to retry or recover from at runtime. The same call fails the same way every time.

## Everything at runtime is an `AppleMusicError`

[`AppleMusicError`](../reference/@open-music-sdk/core/classes/AppleMusicError) is one class for every runtime
failure. Besides its `message`, it carries:

| Field | What it holds |
| --- | --- |
| `_tag` | Which kind of failure it is. See the table below. |
| `status` | The HTTP status of the answer it came from, or `undefined` when there was none, as for a `NetworkError` |
| `errors` | Apple's own `errors` list, when its answer had one |
| `issues` | What a validator found wrong, on a `ValidationError` |
| `retryAfterMs` | How long Apple's `Retry-After` header asked to wait, in milliseconds |
| `cause` | What went wrong underneath, such as what `fetch` rejected with |

Each tag is one kind of failure:

| `_tag` | When it happens | Retried by default |
| --- | --- | --- |
| `DeveloperTokenInvalid` | Apple answers `401`. Before you see it, the developer token provider gets one chance to replace the token, and if it gives a different one, the request is sent once more with it. | No |
| `DeveloperTokenUnavailable` | A developer token provider couldn't get a token at all: your token endpoint was unreachable, timed out, redirected, or didn't answer with a token. Its `status` is your endpoint's, never Apple's. | When there's no `status`, or it's `429`, or a `5xx` other than `501` |
| `UserTokenInvalid` | Apple answers `403`. It's also raised before Apple is asked when a request needs a Music User Token and the client has none. | No |
| `RateLimited` | Apple answers `429`. | Yes, after waiting for `Retry-After` |
| `ApiError` | Apple answers any other failing status, such as `404`, with `status` and Apple's `errors`. Also an answer that isn't what was expected: a success whose body isn't JSON, or a bound function's answer that holds no resource. | A `5xx` other than `501` |
| `ValidationError` | You passed a `schema`, and Apple's answer doesn't match it. The `issues` say where. | No |
| `NetworkError` | `fetch` failed, or the connection dropped while the answer was being read. | Yes |

A few tags have more than one source:

- `UserTokenInvalid` also comes from `validateUserToken` with `status` `401`. Apple documents two causes for a
  `401` on the listener's paths: the developer token, or a listener who isn't signed in or has no subscription.
  After a `401`, `validateUserToken` asks Apple once more with the developer token alone, and if that works, the
  listener was the problem.
- `UserTokenInvalid` is also what a catalog call rejects with when neither the call nor the client names a
  [storefront](../glossary#storefront), and the client has no Music User Token to look the listener's up with.
- `DeveloperTokenUnavailable` is never made by the client itself. It comes from a token provider, so a provider of
  your own can throw one to have the retry policy applied to it.
- `NetworkError` is also how `createConnect` reports that Apple's sign-in script couldn't be loaded.

## What's retried

Before an error reaches you, the client may already have tried again. The default policy is:

- Two attempts in all: the first, and one more.
- Between them, a random wait of up to 250 milliseconds, doubling with each attempt, and never more than 4
  seconds.
- When Apple sends a `Retry-After` header, the client waits that long instead, for up to 60 seconds. A longer
  `Retry-After` isn't waited for: you get the `RateLimited` error at once, with `retryAfterMs` set, and decide for
  yourself.

Only a failure that might go away is retried: a `NetworkError`, a `RateLimited`, an `ApiError` with a `5xx` other
than `501`, and a `DeveloperTokenUnavailable` as the table says. A refusal, a missing resource or a schema that
doesn't match fails the same way the second time, so it isn't retried.

To change the policy, pass `retry` when you create the client: `retry: false` makes one attempt, and a
[`tRetryPolicy`](../reference/@open-music-sdk/core/interfaces/tRetryPolicy) sets the number of attempts, the
waits, and which errors are retried.

A `401` is handled outside this policy. The developer token provider gets one chance to replace a stale token,
whatever the policy says. [Developer tokens and Music User Tokens](./tokens#the-developer-token) explains how the
SDK keeps tokens fresh.

Every retry is another request against your rate limit, which all your listeners share. See
[One rate limit for all your listeners](./tokens#one-rate-limit-for-all-your-listeners).

## A `POST` is sent once

A `POST` makes something each time Apple carries it out: a playlist, or a track added to one. After a `5xx` or a
lost connection, you can't tell whether Apple carried it out before the answer was lost. Sending it again could
make a second playlist.

So the client sends a `POST` again only after a failure that says it wasn't carried out:

- a `RateLimited`, or a `DeveloperTokenUnavailable` when there was no token to send it with, and only if the
  policy would retry that error anyway;
- a `401`, once, when the developer token provider hands over a new token, as for every request.

After any other failure, the error reaches you, and whether to try again is your decision.

A `PUT` or a `DELETE`, which sets or deletes a rating, comes out the same however many times Apple carries it out.
The policy retries it as it does a read, after a `5xx` or a `NetworkError` too.

`lib-playlists` doesn't send a write again either. When it can't tell whether a write was carried out, it reads
the playlist back, and what the playlist holds decides. Calling `apply` again with the same plan carries on from
where it stopped. See [Import a playlist](../guides/import-playlist).

## An abort is rethrown as it is

Every function that asks Apple takes a `signal`. When the signal aborts, you get the reason it aborted with, as it
is: by default a `DOMException` named `AbortError`. It isn't wrapped in an `AppleMusicError`, and no retry or wait
goes on after it.

## What an error message shows

A value in the wrong place may be a key or a token, so a `TypeError` describes it rather than repeating it:

- a string by its length, such as `got 228 characters`;
- a number as it is, since a number can't be a secret;
- anything else by its kind, such as `got object` or `got undefined`.

Some messages do quote what you passed, where it's a name you chose rather than a value:

- An error about `params` names the parameter, as in `params.limit`.
- A function that takes ids by type, such as `getCatalogResources`, names the type, as in `ids.songs`.
- `withNamespaces` names the namespace.
- `developerTokenFetcher` quotes the protocol of a URL that isn't `http` or `https`, and nothing else of the URL.
- The `TypeError` for a path that leaves Apple's origin quotes the path.

An `AppleMusicError`'s message says what happened and names the path that was asked for. That path holds the ids
and the storefront you passed. They can't carry a token there: an id, a name or a storefront longer than 64
characters is refused as a mistake first, and a token is longer than that. Some messages carry more:

- An answer from Apple adds the title of Apple's first error, and its `detail` when it has one.
- A `NetworkError` quotes the message of what failed underneath: what `fetch` rejected with, or what reading the
  answer failed with. With a `fetch` of your own, what that message holds is up to it.
- The `UserTokenInvalid` of `forUser` names the user id that has no stored token.

See the [security model](./security#what-errors-and-logs-contain) for what else is kept out of errors and logs.

## Not every error is one of these two

Some errors pass through the SDK unchanged:

- What your own code throws: a token provider, a user token store, a schema's `validate`, a request hook, a rate
  limiter or an `onProgress` callback. It reaches you as it was thrown.
- What Apple's sign-in script throws, from `connect()`. Its shape is Apple's, and undocumented.
- What the browser throws when the preview player can't start a clip, such as a `DOMException` named
  `NotAllowedError` when sound doesn't follow a click. The player asks Apple for nothing, so it never throws an
  `AppleMusicError`.

## Recognising an `AppleMusicError`

`isAppleMusicError(e)` tells you whether a caught error is an `AppleMusicError`, and `isAppleMusicError(e, tag)`
whether it's one kind. Either narrows the type, so `e.retryAfterMs` and the other fields are typed after the
check. `e instanceof AppleMusicError` gives the same answer.

Both go by shape, not by constructor: an `Error` named `"AppleMusicError"` with a string `_tag`. An error is
recognised whichever copy of `core` made it, so two versions of `core` installed side by side don't break your
error handling. See [One version for every package](./packages#one-version-for-every-package).

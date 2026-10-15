# Design principles

Every package in the SDK holds to the same rules. They were settled while the foundation packages were built, the
two clients keep them, and every package still to come follows them. Knowing them tells you what to expect from a
function before you read its reference.

## Nothing reads an environment or a file

Keys, IDs and tokens arrive as arguments. Loading them is your app's job, done the way it loads its other
secrets. The SDK never goes looking for a secret, so where yours are kept is your decision alone. See
[Your private key](./security#your-private-key).

## Two kinds of error

A mistake in how you call a function is a `TypeError` that says which argument was wrong, raised before anything
is sent. What happens at runtime, with Apple or with your own token endpoint, is an `AppleMusicError` with a
`_tag` to switch on. See [Errors](./errors).

## Strict about what a function is handed, and no stricter

A value in the wrong place is refused. What your app does with the SDK is yours to decide. How many pages a walk
asks for, how fast requests are made and where an artwork URL points aren't checked by default. `maxPages`, a rate
limiter and the `hosts` check are there for you to turn on. See
[What is read from outside](./security#what-is-read-from-outside).

## An error doesn't repeat a value that may be a secret

A value that should have been a key or a token, or that may be one, is described by its length or its kind,
never repeated. A message quotes only names you chose, such as a parameter's, and what Apple or your `fetch` said.
See [What an error message shows](./errors#what-an-error-message-shows).

## Options are checked and taken when a thing is created

A mistake in an option fails where you create the client, the minter or the handler, not on the first request.
The SDK takes its own copy of what it needs, so nothing you do to your options object afterwards changes what
happens.

## Credentials only go to `https://api.music.apple.com`

`core` refuses a path that resolves anywhere else, before a token is asked for or a request is made. See
[Where requests go](./security#where-requests-go).

## The Music User Token goes only where the listener's things are

No function of `client-catalog` sends it, whichever client it's handed and wherever a `next` link points. Every
function of `client-user` does. See [Which requests send which token](./tokens#which-requests-send-which-token).

## A `POST` is sent once, unless Apple says it wasn't carried out

A `POST` is sent again only after a `429`, a `401` that a new developer token may fix, or when there was no
developer token to send it with. A lost answer can't make a playlist twice. A `PUT` or a `DELETE`, which comes out
the same however often it's carried out, is retried as a read is. `lib-playlists` doesn't send a write again
either: it reads the playlist back, and what the playlist holds decides. See
[A `POST` is sent once](./errors#a-post-is-sent-once).

## A function for nearly every endpoint, held to Apple's documentation

The types and validators are generated from Apple's documentation. Each client's tests hold every function to the
method, the path, the parameters and the answer its endpoint documents. The few endpoints with no function are
reached through `core`'s `request`: see [Call an endpoint the clients don't cover](../guides/direct-requests).
Where a package differs from the documentation, [Differences from Apple's documentation](../differences) says how.

## What is read from outside is bounded

The answer from your token endpoint, and a body posted to the intake handler, are read up to a limit and no
further. See [What is read from outside](./security#what-is-read-from-outside).

## Signing code stays where a key may live

`jose` is the only third-party runtime dependency. The entry a browser imports,
`@open-music-sdk/developer-token/fetcher`, has none of it. See [Your private key](./security#your-private-key).

## ESM only, Node 24 or newer, no framework runtime

See [Module format and runtimes](./packages#module-format-and-runtimes).

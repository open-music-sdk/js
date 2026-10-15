# Developer tokens and Music User Tokens

Every request to the Apple Music API answers one question, and some answer two:

1. Is this request from a registered developer? A developer token answers that, on every request.
2. May this app act for this listener? A Music User Token answers that, on requests for the listener's own
   things.

Most of how the SDK is split into packages, and most of what it asks of you, follows from these two tokens.

| | Developer token | Music User Token |
| --- | --- | --- |
| Who makes it | You, by signing a [JWT](../glossary#jwt) with your MusicKit private key | Apple, after the listener signs in |
| Needed for | Every request | Requests for the listener's own things: their library, ratings, recommendations and history under `/v1/me`, their personal station, and a catalog resource's `library` relationship |
| Sent as | `Authorization: Bearer <token>` | `Music-User-Token: <token>`, always beside a developer token |
| How long it lasts | You choose, up to six months | Apple doesn't say. It ends when the listener changes their password or subscription, or removes your app's access. |
| Who it belongs to | Your whole developer team, whose rate limit it spends | One listener |
| When Apple refuses it | `DeveloperTokenInvalid`, on a `401` | `UserTokenInvalid`, on a `403`. A `401` for a listener who isn't signed in or subscribed arrives as `DeveloperTokenInvalid`. |

## The developer token

You sign a developer token with three things from your Apple Developer account: the MusicKit private key (a
`.p8` file), its key ID, and your team ID. [Set up your MusicKit key](../guides/musickit-key) shows how to get
them.

Signing needs the private key, so it happens only where the key can be kept secret: on a server, in a worker, or
in a command-line tool. A web page can't sign a token. Instead, it fetches a short-lived one from a route on your
server, called a token endpoint. [Serve a developer token to a page](../guides/token-endpoint) sets one up.

The SDK keeps the token fresh for you, whether it signs the token or fetches it:

- It gets a token the first time a request needs one, and reuses it for every request after that.
- Halfway through the token's life, it gets a new one in the background. Your requests keep using the old token
  until the new one arrives, so they never wait.
- If getting a new token fails, it tries again a minute later. A short outage of your token endpoint is never
  seen by a request, as long as it ends before the token expires.
- If Apple rejects a token, the SDK gets a new one and sends the request once more. It asks for a new token at
  most once a minute while the one it holds hasn't expired, because a revoked key would only sign another token
  Apple rejects. The same rule covers a `401` that's really about the listener, which a new developer token
  wouldn't fix.

Because the SDK replaces tokens on its own, the tokens it signs are short-lived, and a token can name the web
origins it's for. [The developer token](./security#the-developer-token) in the security model says how long they
last, and what an origin does and doesn't stop.

## The Music User Token

Only Apple can issue a Music User Token. The listener signs in on Apple's own sign-in window, which Apple's
MusicKit on the Web script opens. Apple publishes no endpoint for it, and the SDK doesn't imitate one. Instead,
it runs Apple's script for you: `createConnect` in `browser`, or `useConnect` in `react`.
[Sign a listener in](../guides/sign-in) shows how.

Once your page has the token, you decide where it goes next. There are three ways to set an app up:

| | Where the token goes | Checked | Kept | Suits |
| --- | --- | --- | --- | --- |
| Server only | Whoever runs the program supplies it | On the server | In the process | A command-line tool, a job, a script |
| Client only | Stays in the page | In the page | In the page's memory | A site that calls Apple straight from the page |
| Hybrid | The page posts it to your server | On the server | In a store on the server | A full-stack app |

For the hybrid setup, [Keep a listener's token on your server](../guides/store-user-tokens) shows the route
that takes the token in and the store that keeps it.

Wherever it goes, treat it like a session cookie:

- In a page, keep it in memory. Never write it to `localStorage`, `sessionStorage` or a cookie.
- On a server, keep it out of logs and URLs. A request hook that prints requests prints both tokens: see
  [What errors and logs contain](./security#what-errors-and-logs-contain).
- When Apple refuses it with a `403`, you get a `UserTokenInvalid` error. Ask the listener to sign in again. Don't
  retry.

A listener who isn't signed in, or has no Apple Music subscription, gets a `401` instead. Apple answers a bad
developer token with a `401` too, so the client can't tell the two apart, and you get `DeveloperTokenInvalid`.
`validateUserToken` asks Apple whether a token works before you rely on it, and does tell them apart: after a
`401`, it asks once more with the developer token alone. See [Handle errors](../guides/errors).

## Which requests send which token

You rarely choose which token a request carries. The package you call decides:

- Every function in `client-catalog` sends the developer token alone. That holds for every page of a list too,
  wherever a `next` link points.
- Every function in `client-user` sends both tokens.
- `core`'s `request` sends the Music User Token to paths under `/v1/me`, and you can override it with
  `user: true` or `user: false`.

There's one exception. To read the catalog, a client needs a [storefront](../glossary#storefront). If neither the
call nor the client names one, but the client holds a Music User Token, the client asks Apple for the listener's
storefront once, with that token. It then reads the catalog without it.

## One rate limit for all your listeners

Apple counts requests against your developer token, so all your listeners share one rate limit. Apple doesn't
publish the numbers. When you go over, Apple answers `429`, and the SDK waits and retries before it gives you a
`RateLimited` error. To pace requests yourself, make one limiter with `createRateLimiter` and give it to every
client that uses the same developer token.

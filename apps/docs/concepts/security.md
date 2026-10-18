# Security model

An app built on the SDK holds three secrets, and sends requests to Apple with them:

| | If it leaks | Where it belongs |
| --- | --- | --- |
| Your [MusicKit private key](../glossary#musickit-private-key) | Anyone can sign developer tokens for your team until you revoke the key | On your server, and nowhere else |
| A [developer token](../glossary#developer-token) | Anyone can make requests on your team's rate limit until the token expires | Your server, and for minutes at a time, your pages |
| A listener's [Music User Token](../glossary#music-user-token) | Anyone can read and change that listener's library until the token ends | The page's memory, or a store on your server |

This page goes through each secret, then where requests go, what errors and logs contain, and what is read from
outside your app. For each, it says what the SDK does and what's left to you.

## Your private key

The private key signs developer tokens. Whoever holds it can sign tokens for your team, with any lifetime Apple
allows, until you revoke the key.

Apple lets you download the `.p8` file once. Keep its contents out of your repository: in a `.env` file that's
never committed for local work, and in your platform's secret store in production.
[Set up your MusicKit key](../guides/musickit-key) shows how.

What the SDK does:

- It reads no environment variable and no file. The key arrives as an argument, loaded the way your app loads its
  other secrets.
- Signing code is only in the packages for a server, a worker or a command-line tool: `server`, and the main
  entry of `developer-token`. Nothing a page loads from `browser` or `react` has signing code in it, and neither
  does `@open-music-sdk/developer-token/fetcher`. A test holds the browser bundle to that, so nothing in a page can
  sign a token even if a key were handed to it by mistake.
- Until it first signs a token, the minter holds the key text in a wrapper that prints as `<redacted>`. It then
  imports the key into a form that can sign and can't be exported, and keeps no copy of the text. Only the signed
  token travels.
- No error quotes the key. A key that isn't valid is a `TypeError` that says so without showing it.
- `jose`, which does the signing, is the only third-party runtime dependency in the family.

What's left to you: the key text is still wherever you got it from, `process.env` included. Keep it out of
anything a browser loads.

## The developer token

A developer token is a bearer credential: whoever holds it can use it. It spends your whole team's rate limit,
which all your listeners share, and it can't be revoked without revoking the key. Its lifetime is how long a
leaked one stays useful.

The SDK keeps lifetimes short, because it replaces tokens on its own and a longer life buys nothing:

- A token that `createServerClient` or `developerTokenMinter` signs lasts one hour by default. The minter accepts
  up to Apple's six months. Raise it only for a token that has to be embedded where nothing can sign one.
- A token `tokenEndpoint` hands to a page lasts fifteen minutes by default, and `tokenEndpoint` refuses a lifetime
  over one day. Anyone who can read a page can read its token, so a page's token should live for minutes, not
  hours.

A token can name the web origins it's for. Apple honours that `origin` claim for requests from browsers. It
doesn't stop a script that sets its own `Origin` header, so it narrows who can use a token, not who can fetch one.

::: warning Your token endpoint is a public dispenser
Anyone can fetch a token from your [token endpoint](../glossary#token-endpoint), read the catalog with it, and
spend your team's rate limit for as long as it lives. The `origin` in the token doesn't prevent this, because a
script can send any `Origin` header it likes.
:::

What `tokenEndpoint` does:

- Every answer says `cache-control: no-store` and `vary: origin`, so no proxy or CDN keeps a copy, and none hands
  one page's answer to another.
- A request from one of your origins gets the CORS header for that origin. No other request gets one, no answer
  carries a credentials header, and none allows a header of the page's own. A page on another origin can fetch the
  token and nothing more.
- If the key is wrong, the route fails with a `TypeError` your framework logs. Nothing of the error is sent to the
  page.
- `createServerClient` refuses an `origin` option. The server's own token never meets a browser; the one that does
  is the endpoint's.

What's left to you is who takes tokens, and how often: rate-limiting the route, putting it behind your session
where tokens are for your signed-in users only, keeping a CDN from caching it, and running one endpoint per
deployment, since anyone who fetches a token can read every origin in it.

Two more things are yours:

- Make sure your framework never builds the route ahead of time. A token signed at build time would be served to
  everyone. [Next.js](../guides/nextjs) shows the line that prevents it there.
- If you write your own endpoint with `developerTokenMinter` instead, set `origin` on every token a browser will
  see, and send `Cache-Control: no-store` with it.

On the page's side, the client that fetches the token:

- refuses a redirect, so a token only ever comes from the URL you gave it;
- asks with `cache: "no-store"`;
- reads the token's expiry to know when to fetch again, but doesn't verify its signature: Apple does;
- resolves a relative `tokenUrl` once, when `createBrowserClient` is called, so a `<base>` element added to the
  page later can't move where the token is fetched from;
- keeps your endpoint's `fetch` apart from Apple's, so a header you add for one never reaches the other;
- reports anything that goes wrong at your endpoint as `DeveloperTokenUnavailable`, never as an answer from
  Apple. A `404` from your endpoint isn't "no such song".

[Serve a developer token to a page](../guides/token-endpoint) sets the endpoint up, and limits who can take
tokens from it.

## The Music User Token

A Music User Token lets your app read and change one listener's library, ratings and history. Treat it like a
session cookie: keep it out of logs, out of URLs, and out of browser storage.

Only Apple issues it. The listener signs in on Apple's own window, which Apple's
[MusicKit on the Web](../glossary#musickit-on-the-web) script opens. The SDK issues no token and re-implements no
sign-in: `createConnect` runs Apple's script for you.

### In a page

What the SDK does:

- Nothing in `browser` reads or writes the page's storage. `music.as(token)` keeps the token in memory.
- In React, `MusicProvider` keeps the token in React state and nowhere else, so it's gone with the page. It is in
  the provider's state and context value, where React DevTools, and a browser extension that uses its hook, can
  show it.
- `MusicProvider` takes no token as a prop, because a prop handed down from a server component is written into
  the page. A token arrives through `useConnect`, or through `setToken` after an authenticated `no-store` fetch of
  one your server stored.
- A query key from `musicQueries` never holds a token. With `useMusicQueries`, each sign-in gets a scope of its
  own, so what one listener cached, persisted or not, is never under another listener's keys.

What's left to you: never write the token to `localStorage`, `sessionStorage` or a cookie.

::: warning Apple's script keeps a copy of the token
Apple's script keeps its own copy of the token in the browser's storage, under a key ending `media-user-token` as
seen on 10 October 2026. That's how a returning listener is still signed in. The SDK leaves that copy alone,
except through `disconnect()`.

Any script running on your origin can read that copy. A cross-site scripting hole therefore exposes the
listener's token on any later visit, not only while a page that holds it is open.

While you develop on `localhost`, keep in mind that a cookie there is shared by every port. If the script keeps a
copy in a cookie, every server you run on your machine is sent it.
:::

Signing out is `disconnect()`. It's Apple's own sign-out, through the script, and it ends the sign-in in the script
and the copy it kept, so the next page load restores nothing. It does nothing where the script has no sign-out, or
where the page holds no configuration of the script because loading or configuring it failed. Forgetting the token
in your page alone isn't a sign-out: the script would restore it next time.

::: info Still open
Whether `disconnect()` also ends the token at Apple, and with it a copy your server stored, wasn't settled by the
first live sign-in: see [Differences from Apple's documentation](../differences#browser).
:::

### Apple's script

`createConnect` loads Apple's script from `js-cdn.music.apple.com`, the address in `MUSICKIT_SCRIPT`. It's one
download per page, made only when a page creates the helper. It runs with your page's access, as it does on every
site that uses MusicKit. It can't be pinned, bundled or re-hosted: Apple serves one unversioned URL, and its
licence forbids the rest.

Your security headers have to let it in, with `MUSICKIT_SCRIPT`'s host in `script-src`. Set `base-uri 'self'` as
well, so that no `<base>` element put into the page can move where anything is fetched from.
[Sign a listener in](../guides/sign-in) gives the headers, what `Cross-Origin-Opener-Policy` does to the sign-in
window, and how to load the script yourself under a nonce or Trusted Types.

::: info Run once against the live API
The policy in [Sign a listener in](../guides/sign-in) let the first live sign-in through, in one browser on
Windows. What each `Cross-Origin-Opener-Policy` does to the sign-in window is still open: see
[Differences from Apple's documentation](../differences#browser).
:::

The helper guards against a few more things:

- It's one per page. A second helper for another app is a `TypeError`, because Apple's script is one global and
  the second app would silently win.
- A global under Apple's name that can't be configured, such as an element with that id in content the page
  shows, is passed over, and the script is loaded.
- What Apple's script throws is handed on as it came. Its shape is Apple's, and undocumented. Catch it and show
  it, but never print it where a token might be.

### On your server

In a hybrid app, the page posts the token to your server, and `userTokenIntake` takes it in. The handler checks
the token with Apple and stores it only after Apple accepts it.

- `userId` is the authentication. It must return the signed-in user from your own session, and nothing when
  there is none. The body can't name a user.
- Requiring JSON is the cross-site defence. A form or a `no-cors` fetch on another site can't send
  `application/json`, so it can't bind its own token to your visitor. That holds only while your CORS policy
  doesn't allow other origins to send that header with credentials.
- Every attempt is a request to Apple on your developer token, and a `401` costs one more to find out whose it
  was. Rate-limit the route as you would a login.
- How long Apple is waited for is the client's retry policy, not the handler's. By default a failure is retried
  once, and a `429` is waited out for a `Retry-After` of up to 60 seconds. Pass a client with the policy you want
  on this route, or put your own timeout around the handler.
- Anything else that throws rejects the handler, and is yours to answer: your `userId` function, the store, a body
  something else already read, a request aborted part way.
- Every answer says `cache-control: no-store`, and none carries the token or Apple's error text.
- Its options are checked and taken when you create it. Nothing done to your options object afterwards changes
  where a token goes or whose it is.

The stores:

- Neither store encrypts. `KvUserTokenStore` writes the token as given, so whoever can read the namespace can
  read the token. Wrap the namespace if you need more than your platform provides.
- `MemoryUserTokenStore` loses every token on restart, and isn't shared between processes or isolates.
- Workers KV is eventually consistent. A token just stored or just deleted can take up to a minute to look that
  way elsewhere, and Apple's `403` remains the authority.

When Apple refuses a stored token, forget only the token that was rejected: the listener may have signed in again
while the request was in flight. [Keep a listener's token on your server](../guides/store-user-tokens) sets up the
route and the store, and shows how.

### On your machine, with the CLI

The CLI's `login` keeps your own token in one file in your user profile. It is readable by you alone, and not
encrypted. `logout` forgets it, but doesn't tell Apple, so a copy you handed to another program keeps working until
Apple ends it. Only `token` prints it, so a script gets it from `$(open-music-sdk token)` and not from a file you
copy around. The CLI's [README](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme) says where the file
is.

The CLI takes your key from its flag, its variable or a question, and keeps none of them. It takes
`APPLE_MUSIC_PRIVATE_KEY` out of its own environment before it starts anything, so the browser it opens doesn't get
the key. Whatever started the CLI, your shell or `npx`, had the variable already. On Linux and macOS the CLI's
starting environment stays readable, by you and root, while it runs.

`login` serves its own sign-in page, made of the SDK: `browser`'s sign-in, `server`'s `tokenEndpoint` for the
page's developer token, and `server`'s `userTokenIntake` for the token Apple gives. Here is what keeps that page
safe:

- Loopback only, on both addresses. The server listens on `127.0.0.1` and `::1`, on one port. A browser may try
  either for `localhost`, and holding both means no other program can take the one left free. It answers only
  requests whose `Host` is `localhost:<port>`, and refuses any whose `Origin` is another page's.
- An address that works once. The page's address carries a random ticket, fresh each run, and it reaches the
  browser in a command line that other users of the machine may read. So the ticket is used up when the page
  opens, and a second opening is told to press Ctrl+C if it wasn't you.
- A second secret for the routes. The page carries a secret of its own, never in an address or a command line, and
  sends it with every request for a token and with its post. A post without it is refused before Apple is asked.
  The post needs a JSON body and a header of the CLI's own, so another site's page would have to ask the browser
  first, and nothing answers that asking.
- One token, and a short wait. One token is taken, and a second post is turned away. The server closes once it
  has a token, or after five minutes, or on Ctrl+C, and the token route exists only while `login` waits. Its
  developer tokens live fifteen minutes and are bound to the page's origin.
- Apple's copy doesn't outlive the page. A cookie set on `localhost` is shared by every port, so after every try,
  and when the tab closes, the page deletes the cookies and storage entries Apple's script added, and puts back the
  ones it overwrote. It doesn't call `disconnect()`, since whether that ends the token at Apple isn't known yet.
- Its headers. `cache-control: no-store`, `x-content-type-options: nosniff`, and a content security policy that
  lets in Apple's script and nothing but Apple's hosts.
- No secret in a message. No message repeats the key, a token, or anything that might be one, such as an argument
  that looks like neither a command nor a flag. Text from Apple, and paths, are printed without control characters.
- A pinned version is pinned throughout. The SDK is bundled into the command, and `jose` is pinned to the exact
  version the SDK is tested with, so `npx @open-music-sdk/cli@<version>` runs exactly the code of that version.
  The page has no signing code, which a test of the build holds it to.

## Where requests go

Both tokens are sent only to Apple, and the Music User Token only where it's needed.

- Credentials only go to `https://api.music.apple.com`. `core` refuses a path that resolves anywhere else, such
  as an absolute URL, a scheme-relative one or a downgrade to `http`, with a `TypeError`. It does so before a
  token is asked for or a request is made.
- An answer can't send a request on. `core` refuses a redirect, which fails as a `NetworkError`. Followed, a
  redirect to another origin would lose the developer token, but `fetch` would send the Music User Token on with
  it, and to an `http` address in the clear.
- The Music User Token goes only where the listener's things are. By default it's sent under `/v1/me` and
  nowhere else. No function of `client-catalog` sends it, whichever client it's handed and wherever a `next` link
  points. Every function of `client-user` does. [Which requests send which token](./tokens#which-requests-send-which-token)
  has the one exception.
- A value you pass can't move a request. An id, a name or a storefront is one segment of a path. One that holds
  a slash, a backslash, a percent sign or a control character is refused, as are `.` and `..`. Everything else is
  percent-encoded. Without this, an id of `../../../me/library/songs` after `v1/catalog/us/songs/` would be a
  request for the listener's library, which carries their token. A slash is refused rather than encoded, because
  a server that decodes a path before reading it would find the slash again.
- A token can't pass for an id. An id, a name or a storefront is at most 64 characters: longer than any of
  Apple's, and shorter than a token. A token put where an id belongs is refused before it's sent.
- Only what you pass is an option. The client reads what an options object holds itself. An option it inherits,
  or one that other code has put on `Object.prototype`, isn't one, and neither is a `next` link put there.

### Pages from outside your app

`core` follows a `next` link wherever it points on Apple's origin, and sends the Music User Token when the link is
under `/v1/me`. A page or a path that comes from outside your app, such as from a cache or from a user, is as
trusted as you make it. For one that should stay in the catalog, pass `user: false`, which sends no Music User
Token wherever the links point, and a `maxPages`. Without `maxPages`, a walk goes on for as long as each page
names a next one.

### URLs in Apple's answers

Artwork and preview clips come with URLs, and the SDK doesn't check where they point unless you ask. That's
enough for a URL that came from Apple's API a moment ago. It isn't enough for one that could have come from
anywhere else: a cache or a database that others can write to, a link someone shared, another service.

What a bad URL can do depends on where you put it:

- In an `<img>`, no script runs, but the browser makes the request: to someone else's host, who learns your
  visitor was there, or, for a URL with no host, to your own site with your visitor's cookies. An audio element
  playing a preview clip requests whatever URL it's given, too.
- In a link, `window.open` or `location`, as for "open the artwork full size", a `javascript:` URL runs.
- In a request your server makes, as in an image proxy or a social card, the request goes wherever the URL says,
  from inside your network.

Pass `hosts` to have the URL checked. With `hosts`, a URL that isn't `https` on one of those hosts or a subdomain
of one, with no port and no credentials, is refused:

- The artwork functions throw a `TypeError` and return no URL. The check is made on the URL as returned, read the
  way a browser reads it. Apple serves catalog artwork from `is1-ssl.mzstatic.com` and its numbered siblings.
  Artwork a listener gave a playlist of their own may be served from elsewhere, so look at what your app receives
  before you settle the list. See [Show artwork](../guides/artwork).
- The preview player skips the track, with the reason `"host"`. See [Play song previews](../guides/previews).

::: info Not yet run against the live API
Apple doesn't document which host preview clips come from, so look at what your own answers hold before you set
`hosts`: see [Differences from Apple's documentation](../differences#lib-preview-player).
:::

An artwork function returns a URL, not markup. Assigned to an element's property, or given to React, it's escaped
for you. Written into HTML by hand, it needs escaping like any other attribute value, and it isn't safe inside a
CSS `url(…)` as it is.

## What errors and logs contain

- A value in the wrong place, which may be a key or a token, is described by its length or its kind, never
  repeated. A `NetworkError` quotes what your `fetch` failed with, so what it holds is up to that `fetch`.
  [Errors](./errors#what-an-error-message-shows) has the details, and what an error's message does include.
- Nothing in the SDK logs.
- What Apple's sign-in script throws is passed on as it came. Never print it where a token might be.
- What your routes send back carries no secret: the token endpoint echoes nothing of an error to the page, and
  the intake handler's answers carry neither the token nor Apple's error text.

::: warning A hook that logs requests logs both tokens
The client's `onRequest` and `onResponse` hooks, and the `onResponse` you can pass to a single request, are handed
the whole request, with the `Authorization` and `Music-User-Token` headers on it. A hook that prints requests
prints both tokens. Never print the request's headers.
:::

## What is read from outside

The SDK reads two things whose size someone else chooses, and bounds both. Whoever sends decides how much is sent,
not how much is kept:

- The answer from your token endpoint is read up to 16 KB, counted after any decompression, and the rest is
  cancelled. A token longer than 8 KB isn't believed either: a real one is a few hundred bytes.
- A body posted to the intake handler is read up to 8 KiB, counted as it arrives, and the rest is cancelled.

On a runtime whose requests or responses have no body stream to count, both are read whole and then held to the
same limit: the token endpoint's answer, and the body posted to the intake handler.

Apple's answers aren't checked unless you ask. The types describe what Apple documents. To hold an answer to it at
runtime, pass a `schema`: see [Validate Apple's responses](../guides/validation).

The SDK is strict about what a function is handed, and no stricter. Some limits are yours to turn on, because only
your app knows what's right for it:

- How many pages a walk asks for: `maxPages`. There's no limit by default.
- How fast requests are made: a rate limiter from `createRateLimiter`, shared by every client on one developer
  token.
- Where an artwork or a clip URL may point: `hosts`.
- How much a playlist you create holds: nothing limits its size. If it comes from outside your app, limit it
  yourself.

See [Design principles](./principles) for the reasoning.

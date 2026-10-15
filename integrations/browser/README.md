# @open-music-sdk/browser

The Apple Music API for a page, with or without a framework. One import gives a client that fetches
its developer token from your server, with the catalog, the listener's library and the playlist verbs
on it; Apple's sign-in, run for you, for the listener's Music User Token; the preview player; and the
rest of the family a page uses. Nothing a page bundles from it signs, holds a key or touches the page's
storage.

```
pnpm add @open-music-sdk/browser
```

**Runs in a page.** The developer token comes from an endpoint your server hosts:
[`tokenEndpoint`](../server/README.md) of `@open-music-sdk/server` is that endpoint. For a React app, use
[`@open-music-sdk/react`](../react/README.md), which is this package with a provider and hooks.

```ts
import { createBrowserClient, createConnect, previewPlayer } from "@open-music-sdk/browser";

const music = createBrowserClient({ tokenUrl: "/api/music/token" }); // fetched when first needed, replaced before it expires

const { results } = await music.catalog.searchCatalog("james brown", { types: ["songs"], limit: 5 }); // the developer token alone

// Sign-in, through Apple's script. Make the helper where the button is shown, so the script is there before the click.
const signIn = createConnect(music, { app: { name: "Crate Digger" } });
button.disabled = true;
signIn.ready.then(
  (restored) => {
    button.disabled = false;
    if (restored) signedIn(music.as(restored)); // a returning listener: Apple's script kept their token
  },
  (e) => showWhyNot(e), // the script could not be loaded, or the token not fetched; connect() tries again
);
button.onclick = async () => {
  try {
    const token = await signIn.connect(); // Apple's window, inside the click; undefined when the script answers with nothing
    if (token) signedIn(music.as(token));
  } catch (e) {
    showWhyNot(e); // what Apple's script threw, as it came: show it, never print it, since its shape is Apple's
  }
};
signOutButton.onclick = () => void signIn.disconnect(); // Apple's own sign-out, so the next page load restores nothing

function signedIn(listener: typeof music) {
  // Client only: the page keeps the token in memory and asks Apple itself.
  for await (const playlist of listener.user.listLibraryPlaylists()) { /* every page */ }
  // Or hybrid: post it to your intake, and the server keeps it and makes the calls.
  // await fetch("/api/music/user-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
}

// Previews: what the catalog gave is what the player takes.
const player = previewPlayer();
player.load(results.songs?.data ?? []);
playButton.onclick = () => void player.play().catch(showWhyNot); // sound starts from a click
```

## What is in it

| Export | Does |
| --- | --- |
| `createBrowserClient(options)` | A client that fetches its developer token from `tokenUrl`, with `catalog`, `user` and `playlists` on it, and `as()` and `forUser()` that give the same again for a listener |
| `createConnect(music, options)` | Apple's sign-in, for the listener's Music User Token: `{ ready, connect, disconnect, dispose }` |
| `MUSICKIT_SCRIPT` | Where Apple serves its script, for a content security policy |
| The feature tier, from one path | What a page uses of each package, under the names its README gives: see [What is re-exported](#what-is-re-exported) |

## The client

`createBrowserClient` takes where the token endpoint is, and every option of
[`createClient`](../../packages/core/README.md) but the developer token, which the endpoint provides:

| Option | |
| --- | --- |
| `tokenUrl` | Where `tokenEndpoint` is mounted. Required. A relative URL resolves against the page as it is when the client is made, and stays there: a route the page moves to later, a `<base>` put into it later, or a `URL` changed later moves nothing. |
| `endpoint` | The endpoint's own options, as [`developerTokenFetcher`](../../packages/developer-token/README.md) takes them: a `fetch` for it, with the credentials or headers it needs; `timeoutMs`; `refreshAheadSeconds`. |
| `userToken`, `userTokenStore` | One listener's token, or a store `forUser(userId)` reads. A page usually has neither, and binds a client with `as(token)` once the listener signed in. |
| `storefront`, `fetch`, `retry`, `rateLimit`, `onRequest`, `onResponse` | As `createClient` takes them. |

The client's `fetch` is for Apple, and the endpoint's is for the endpoint: a header wrapped in for one
never reaches the other.

What it gives is core's client, `request`, `paginate`, `storefront`, `as` and `forUser`, with three
namespaces on it: `catalog` is [`catalog(client)`](../../clients/client-catalog/README.md), `user` is
[`user(client)`](../../clients/client-user/README.md), and `playlists` is
[`playlists(client)`](../../lib/lib-playlists/README.md), each made for this client; and `developerToken`, the
provider the endpoint is fetched through, which `createConnect` takes. `as(token)` and
`forUser(userId)` give a listener's client with all of that made for it. The object is frozen,
inherits nothing, and each of its functions can be handed on by itself.

The options are checked and read once, when the client is made. A mistake is a `TypeError` naming the
function that checks it: `createBrowserClient` for the options object and `tokenUrl`,
`developerTokenFetcher` for the endpoint's, `createClient` for the rest. Nothing is fetched until a
call. The token is fetched once and replaced in the background halfway through its life, and fetched
again when Apple rejects it; whatever goes wrong at the endpoint is a `DeveloperTokenUnavailable`,
never mistaken for Apple's answer.

A developer token in a page can be read by anyone who can read the page, and so should live for
minutes, not hours: `tokenEndpoint` mints fifteen-minute tokens bound to your origin, and this client
replaces them as they go. A Music User Token is as sensitive as a session cookie: hold it in memory,
as `as(token)` does, and never write it to storage.

## Sign-in

Apple publishes no endpoint for the Music User Token: it is issued by Apple's own script, after the
listener signs in on Apple's own window. So `createConnect` loads that script from Apple's CDN and runs
its sign-in for you. The SDK issues no token and re-implements no sign-in.

| Option | |
| --- | --- |
| `app` | `{ name, build? }`: what Apple's sign-in window shows of your app. Required. |
| `musicKit` | The page's own `MusicKit`, when it loaded Apple's script itself: under a content security policy with a nonce, or Trusted Types. Default: loaded from Apple's CDN. |

| Member | Does |
| --- | --- |
| `ready` | Settles once the script is loaded and configured: with the token the script restored for a returning listener, or with `undefined`. Rejects with a `NetworkError` when the script cannot be loaded, and with a `DeveloperTokenUnavailable` when the token cannot be fetched. |
| `connect()` | Opens Apple's sign-in window, to be called inside the listener's click, and resolves to the Music User Token, or to `undefined` when the script answers with nothing. After a `ready` that failed, it loads and configures the script afresh first. |
| `disconnect()` | Apple's own sign-out, through the script: ends the sign-in in the script and the copy of the token it kept, so a later page load restores nothing. Does nothing where the script has no sign-out. |
| `dispose()` | Stops keeping the developer token fresh. The script stays: it is the page's. |

What a page has to know:

- **The script has to be there before the click.** A browser opens a window only inside a click, and
  a download that starts after the click can outlast it. Make the helper when the button is shown, and
  enable the button on `ready`.
- **The developer token has to be fresh at the click too.** While the helper lives it asks the
  provider again halfway to the token's end, and when the tab comes back, and sets a changed token on
  Apple's script, so `connect()` waits on nothing before the window. Whether a configured instance
  takes a new token is a live check; the helper sets it where the instance has the property.
- **It is one download from Apple**, about 140 kB compressed as measured on 10 October 2026, from
  `js-cdn.music.apple.com`, made once per page however many helpers are made. A page that never makes
  the helper never fetches it. It cannot be pinned, bundled or re-hosted: Apple serves one unversioned
  URL, and its licence forbids the rest. Apple's script runs with your page's access, as it does on
  every site that uses MusicKit.
- **Your security headers have to let it in.** Allow `MUSICKIT_SCRIPT`'s host in `script-src`, and set
  `base-uri 'self'`, so that no `<base>` put into the page can move where anything is fetched from.
  Expect a strict `connect-src` to need Apple's hosts too, and a `Cross-Origin-Opener-Policy` of
  `same-origin` to cut the sign-in window off, where `same-origin-allow-popups` keeps it. Both are still
  to be confirmed live. Under a nonce or Trusted Types, load the script yourself and pass `musicKit`.
- **It is one per page.** A second helper for another app is a `TypeError`: Apple's script is one
  global, and the second would silently win. A second helper for the same app shares the first's load
  and configuration. A global under Apple's name that cannot configure, such as an element with that id
  in content the page shows, is passed over and the script loaded.
- **A decline is taken from the script answering with nothing**, and `connect()` resolves to
  `undefined` then. What Apple's script throws for anything else is handed on as it came: its shape is
  Apple's, and undocumented, so catch it and show it, and never print it where a token might be.
- **A returning listener is expected to need no click.** Apple's script restores the token it kept on
  the last visit when it is configured, and `ready` resolves to it.
- **Signing out is `disconnect()`.** It is Apple's own sign-out, through the script, so the next page
  load restores nothing. Forgetting the token in your page alone is not a sign-out: the script would
  restore it next time.
- **Apple's script keeps a copy of the token.** The rule everywhere else in the family is that a page
  holds a Music User Token in memory and never in storage. Apple's script keeps its own copy in the
  browser's storage, under a key ending `media-user-token` as seen on 10 October 2026, which is how a
  returning listener is still signed in. This helper reads and writes no storage, and leaves that copy
  alone but for `disconnect()`: whether the script's own sign-out also ends the token at Apple, and
  with it a copy your server stored, is not established. Any script running on your origin can read
  the copy, so a cross-site scripting hole exposes the listener's token on any later visit, not only
  while a page that holds it is open.

Nothing of this has met Apple's live script yet. Whether loading and configuring it ahead of the click
keeps the window inside the click in every browser, Safari first; whether a decline is the script
answering with nothing, or a rejection, and with what; what a configured instance holds for a returning
listener, and whether it takes a new developer token; and whether a `MusicKit` global the page loaded
itself may be configured before its `musickitloaded` event, are what the first live sign-in has to
settle.

## What is re-exported

What a page uses of the feature tier, under the names each package's README gives, so one import is
enough:

| From | Names |
| --- | --- |
| [`core`](../../packages/core/README.md) | `AppleMusicError`, `isAppleMusicError`, `createRateLimiter`, and the types. Not `createClient`, nor the builders and checks the clients are declared with. |
| [`developer-token`](../../packages/developer-token/README.md) | `developerTokenFetcher`, from the entry with no signing code. Not the minter. |
| [`user-token`](../../packages/user-token/README.md) | `validateUserToken`, for a page that holds the token itself. Not the stores and the intake, which are a server's. |
| [`util-artwork`](../../packages/util-artwork/README.md) | `artworkImage`, `artworkUrl`, `artworkSrcSet`, `FORMATS` |
| [`client-catalog`](../../clients/client-catalog/README.md), [`client-user`](../../clients/client-user/README.md) | Every function, and `catalog` and `user` |
| [`lib-playlists`](../../lib/lib-playlists/README.md) | `playlists` |
| [`lib-preview-player`](../../lib/lib-preview-player/README.md) | `previewPlayer` |
| [`validate`](../../packages/validate/README.md) | Every validator, under `schemas`: `schemas.song`, `schemas.libraryPlaylist`, to pass as `schema` |
| [`types`](../../packages/types/README.md) | Every generated type: `tSong`, `tAlbum`, `tLibraryPlaylist` |

A bundle made from this package holds no signing code, no key, and no reach into the page's storage; a
test holds it to that.

## Not here

The private key, and the endpoint that hands a page its token: [`@open-music-sdk/server`](../server/README.md).
A provider and hooks for React: [`@open-music-sdk/react`](../react/README.md).

# Differences from Apple's documentation

The types and validators are generated from Apple's documentation, and each client's tests hold every function
to it: the method, the path, every documented parameter and the answer of each endpoint. Little has been run
against the live API yet: one sign-in, through the CLI, and the requests around it. So what Apple does where its
documentation is silent is mostly not known. This page lists, package by package, where the SDK differs from the
documentation, and what it takes on trust.

## [browser](./reference/@open-music-sdk/browser/)

Sign-in runs Apple's own script, whose behaviour Apple doesn't fully document:

- What the script throws is undocumented, so `createConnect` hands it on as it came.
- The script keeps a copy of the Music User Token in the browser's storage, under a key ending `media-user-token`
  as seen on 10 October 2026. See the [security model](./concepts/security#in-a-page).

The first live sign-in, on 16 October 2026, ran from the CLI's page on `localhost`, on Windows, in one browser.
It settled these:

- Apple's sign-in takes a page on `http://localhost:<port>`, with a developer token bound to that origin, and the
  token it gives is one `userTokenIntake` accepts.
- The sign-in window names the app by the page's host, `window.location.host`, not by the `app` the script is
  configured with.
- The window's icon comes from the page's `apple-music-app-icon` link, and shows once that is an HTTPS address.
- The content security policy in [Sign a listener in](./guides/sign-in#_6-let-apple-s-script-through-your-security-headers)
  let everything the sign-in needed through.

These are still open:

- how sign-in goes in other browsers, Safari first, and on macOS and Linux, including whether loading the script
  ahead of the click keeps the window inside the click everywhere;
- whether a listener who declines is the script answering with nothing, or a rejection, and with what;
- what a configured instance holds for a returning listener, and whether it takes a new developer token;
- whether a `MusicKit` global the page loaded itself may be configured before its `musickitloaded` event;
- where else Apple's script keeps its copy of the token, beside the storage key seen above: whether in cookies,
  which on `localhost` every port shares, or in IndexedDB;
- whether a `Cross-Origin-Opener-Policy` of `same-origin` cuts the sign-in window off, as expected, where
  `same-origin-allow-popups` keeps it;
- whether `disconnect()`, which runs the script's own sign-out, also ends the token at Apple, and with it a copy
  your server stored;
- whether, after a token Apple wouldn't take, a second try in the same tab asks Apple again or hands back the same
  token.

## [cli](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme)

The CLI's `login` is where the first live sign-in above ran, and its `doctor` asked both its questions of the live
API, `GET /v1/test` and `GET /v1/me/storefront`. Still open for the CLI itself:

- how `login` goes in other browsers, and on macOS and Linux;
- whether Apple's script keeps a copy where the page doesn't look: the page puts back cookies, `localStorage` and
  `sessionStorage` after a sign-in, not IndexedDB;
- with `--port` fixed and a second `login`, what the page restores for a returning listener;
- whether, after a token Apple wouldn't take, a second try in the same tab asks Apple again or hands back the same
  token;
- whether a browser ever asks for the page twice of its own accord, which the one-time address would turn away.

The CLI's `check` asks the live API what this page lists that a server can ask, and prints what Apple did:
`open-music-sdk check`, or `open-music-sdk check <name>` for one question. Its findings go here. It hasn't been run
yet.

## [client-catalog](./reference/@open-music-sdk/client-catalog/)

- Every function takes the same options, so most take some that their endpoint isn't documented with: `limit` and
  `offset` where resources are asked for by id or by a filter, `offset` on a relationship or a view, and
  `include` and `extend` on a search or the charts. Only the three `list…` functions are documented with all of
  them. An option you give is sent, and Apple decides what to make of it.
- `getCharts` takes any name as its `chart`. The documentation lists `most-played` alone, and says the others are
  the names an answer gives its charts.
- The `library` relationship of a song, an album, a playlist and a music video is documented with the others, and
  is left out. It's the listener's copy of the resource, and needs their token. It's in neither client yet:
  `listener.request(path, { user: true })` reaches it.
- The answer of `getLanguageTag` is typed `tLangageTagResponse`. The spelling is the documentation's.
- Apple's endpoint for testing a connection, `v1/test`, names no resource and has no function.
  `client.request("v1/test")` reaches it.

## [client-user](./reference/@open-music-sdk/client-user/)

What Apple answers for a rating that was never set, or for ids it has no rating of, isn't known. Neither is how
long an addition takes to show: `addToLibrary` and `addToFavorites` resolve once Apple has accepted the request,
which is before the resources appear.

- Every function takes the same options, so most take some that their endpoint isn't documented with: `limit` and
  `offset` where resources are asked for by id or by a filter, `offset` on a relationship, `include` and `extend`
  on a search, and all four on a write and on `listRecentlyAdded`, which are documented with `language` alone. An
  option you give is sent, and Apple decides what to make of it.
- `types` is optional for `listRecentlyPlayed` and `listRecentlyPlayedTracks`. The documentation marks it as
  required, while its own example asks without one and its sample answer holds several types. A call without it
  is sent as it is.
- `getUserStorefront` resolves to a `tStorefrontsResponse`. The documentation names a collection of any resource
  as its answer, and what that holds is the listener's storefront.
- `delete<X>Rating`, `addToLibrary` and `addToFavorites` resolve to nothing. The documentation names an empty
  object as their answer, which holds nothing to hand over.
- `addLibraryPlaylistTracks` resolves to nothing as well. The documentation names the playlist's tracks as its
  answer, for a `204`, which is a success with no body.
- `addToLibrary` and `addToFavorites` take ids of any type. The documentation lists no types for either, so a
  type is any name that could be one, and Apple says whether it is.
- The generated type for a playlist to create wants `tracks` and `parent` together under `relationships`, because
  the documentation marks both as required there.

## [lib-playlists](./reference/@open-music-sdk/lib-playlists/)

Apple documents making a library playlist, adding tracks to the end of one, and reading one and its tracks. It
documents that `filter[isrc]` takes 25 values at most, and that one ISRC may come back as several songs. It
documents no way to take a track out, move one, or rename or delete a playlist, so this package can't do those.

It takes these on trust:

- That a playlist's tracks can be asked for with `include=catalog`, and that each then carries its catalog song,
  which is where the ISRC is. Where an answer has no such relationship, the package uses the id Apple puts under
  `attributes.playParams.catalogId`. The documentation doesn't list that field, but Apple's answers carry it.
- That a `next` link keeps what the first page was asked with. If it drops `include`, tracks after the first
  hundred are read with their catalog id and without their ISRC.
- That a `404` for the tracks of a playlist that exists means it has none. Before the package believes that, it
  asks for the playlist once more, with `include=tracks`. A playlist that then shows a track isn't empty, and the
  `404` is what the verb rejects with. A playlist wrongly taken for empty would have everything it holds added
  again.
- That a playlist asked for with `include=tracks` carries its first tracks, which is what a `404` for its tracks
  is checked against.
- That a track added by its catalog id is then held under that id. `plan` goes by it. If the library answers with
  another id for the same recording, the track will look missing.
- How long a write takes to show, which the defaults of `settle` are a guess at.
- How many tracks one request takes. `chunk` is held to 300 because that's the most the client's function takes.
- That a playlist's name and description come back as they were sent, which finding a playlist by them needs. If
  Apple changes either, a playlist a run made is never found again by its plan: the run resolves with
  `verified: false`, and the `id` it resolved with is the way back to the playlist.

## [lib-preview-player](./reference/@open-music-sdk/lib-preview-player/)

Apple documents that a song and a music video have `previews`, each with a `url`, and that a preview may be
available with or without an Apple Music subscription.

It doesn't document which host the clips are served from. The host the player's errors name as an example,
`itunes.apple.com`, is a guess from clips seen on `audio-ssl.itunes.apple.com`, and hasn't been checked against
the live API. Look at what your own answers hold before you set `hosts`.

Nothing here has been run in a browser against a clip from the live API. The player takes on trust how browsers
behave: that the first sound may follow a click, that one clip may follow another on the same element without a
second click, and that an element says it has ended only after it has paused.

## [developer-token](./reference/@open-music-sdk/developer-token/)

An empty `origin` list is refused, not sent. Apple doesn't document whether it would read an empty list as no
origin or as any origin.

## [user-token](./reference/@open-music-sdk/user-token/)

Apple documents two causes for a `401` on the listener's paths: the developer token, or a listener who isn't
signed in or has no Apple Music subscription. The answer doesn't say which. So after a `401`, `validateUserToken`
makes one more request with the developer token alone, `GET /v1/test`. If Apple accepts it, the listener was the
problem, and the error is `UserTokenInvalid`. If that request fails in any way, its error is the one you get.

## [util-artwork](./reference/@open-music-sdk/util-artwork/)

Apple's reference documents `{w}x{h}` in an artwork template, and nothing else. The rest is what Apple's own pages
and image server were seen to do when the package was written:

- the `{f}` and `{c}` placeholders, for the format and the crop. A template that has either doesn't work until it
  is filled in.
- the six formats: `jpg`, `jpeg`, `png`, `webp`, `heic` and `heif`. The image server refuses `avif` and `bmp`, and
  for `gif` and `tiff` it sends a JPEG under another name, so the package refuses those four.
- the crop codes, such as `bb`, `cc` and `sr`, and how each one fills or fits the box. They're undocumented, so
  the package accepts any code of the right shape.
- the limit of 10,000 pixels a side.

## [types](./reference/@open-music-sdk/types/)

The names differ from the documentation's. Apple titles each resource by the plural value of its `type`, so one
song is documented as `Songs`. Where an object is a single thing, its type is named in the singular, with a `t`
in front: `Songs.Attributes` is `tSongAttributes`. A response keeps the plural, since it wraps a list:
`tSongsResponse`.

An object the documentation gives no properties for is `Record<string, unknown>`.

## [validate](./reference/@open-music-sdk/validate/)

The validators are named as the types are, without the `t` and with the first letter in lower case:
`Songs.Attributes` is `songAttributes`.

A validator allows keys Apple hasn't documented. Apple adds attributes without notice, and that shouldn't break
your app.

# Differences from Apple's documentation

The types and validators are generated from Apple's documentation, and each client's tests hold every function
to it: the method, the path, every documented parameter and the answer of each endpoint. Where Apple's
documentation is silent, the SDK has met the live API twice: the CLI's first sign-in on 16 October 2026, and its
`check` on 18 October 2026, in one storefront, with the sign-in's questions run by hand in Firefox on Windows.
`check` asked every endpoint function of both clients that only reads, and held each answer to its generated type.
This page lists, package by package, where the SDK differs from the documentation, what those runs settled, and
what it still takes on trust. One run is one sample: what was seen once may not hold every day, in every storefront.

## [browser](./reference/@open-music-sdk/browser/)

Sign-in runs Apple's own script, whose behaviour Apple doesn't fully document. What the script throws is
undocumented, so `createConnect` hands it on as it came.

The two runs, from the CLI's page on `localhost`, settled these:

- Apple's sign-in takes a page on `http://localhost:<port>`, with a developer token bound to that origin, and the
  token it gives is one `userTokenIntake` accepts.
- The sign-in window names the app by the page's host, `window.location.host`, not by the `app` the script is
  configured with.
- The window's icon comes from the page's `apple-music-app-icon` link, and shows once that is an HTTPS address.
- The content security policy in [Sign a listener in](./guides/sign-in#_6-let-apple-s-script-through-your-security-headers)
  let everything the sign-in needed through.
- A listener who declines, by closing Apple's window or by declining in it, makes the script's `authorize()`
  reject, not answer with nothing: with an `Error` named `AUTHORIZATION_ERROR`, its `errorCode` the same and its
  message `Unauthorized`. `connect()` takes that for a decline, and resolves to `undefined`.
- The script keeps its copy of the Music User Token in `localStorage`, under `music.<your team id in small
  letters>.media-user-token`, beside two short keys of the same prefix, `itre` and `itua`. It kept nothing in
  cookies, IndexedDB or Cache Storage. See the [security model](./concepts/security#in-a-page).
- `disconnect()`, which runs the script's own sign-out, ends the token at Apple, and with it a copy your server
  stored: Apple refused the token as soon as the sign-out was done, and five minutes later.
- A page that keeps the script's copy has the listener back on a reload. On the React sample's page in headless
  Edge, on 20 October 2026, a token put under that key before a reload was what `ready` resolved to, and Apple took
  it for the listener's requests.

These are still open:

- how sign-in goes in other browsers, Safari first, and on macOS and Linux, including whether loading the script
  ahead of the click keeps the window inside the click everywhere, and where they keep the script's copy;
- whether a configured instance takes a new developer token for a returning listener. On the CLI's page, which
  clears the script's copy, it held no token, and Apple's window asked again as it did the first time;
- whether a `MusicKit` global the page loaded itself may be configured before its `musickitloaded` event;
- whether a `Cross-Origin-Opener-Policy` of `same-origin` cuts the sign-in window off, as expected, where
  `same-origin-allow-popups` keeps it;
- whether, after a token Apple wouldn't take, a second try in the same tab asks Apple again or hands back the same
  token.

## [react](./reference/@open-music-sdk/react/)

The React and Next.js samples ran against the live API in headless Edge on Windows on 20 October 2026, signed
out, and the Next sample's pages for a listener too, with a token handed to its server. They settled these:

- Under `<StrictMode>`, which mounts each component twice in development, the provider, `useConnect` and
  `usePreviewPlayer` set up and undid what they set up, with no error or warning in the console.
- `next build`, in Next 16 with Turbopack, reads the `"use client"` directive on the hooks' file alone. The Next
  sample imports `musicQueries`, `schemas` and `isAppleMusicError` from the package into server components, and
  into the words for an error that its server actions share with its page, and the build passes.
- A query `musicQueries` builds on the server and prefetches into a `HydrationBoundary` is the query the page's
  `useMusicQueries` builds for the same call: the album page is drawn without asking Apple again.

Still open: Apple's sign-in through `useConnect`, in a browser, by hand.

## [cli](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme)

The CLI's `login` is where the sign-ins above ran. Its `check` asked the live API on 18 October 2026: every endpoint
function that reads, each answer held to its generated type, and every question it asks about how Apple behaves,
reads and writes. Its findings are in the sections below, by package. `open-music-sdk check` asks it all again, and
`open-music-sdk check <name>` one function or question, to see whether it still holds.

Settled for the CLI itself:

- What the page puts back after a sign-in, cookies, `localStorage` and `sessionStorage`, covers where the script
  kept its copy in Firefox.
- With `--port` fixed and a second `login`, the page restores nothing for a returning listener: Apple asks again.

Still open:

- how `login` goes in other browsers, and on macOS and Linux;
- whether, after a token Apple wouldn't take, a second try in the same tab asks Apple again or hands back the same
  token;
- whether a browser ever asks for the page twice of its own accord, which the one-time address would turn away.

## [client-catalog](./reference/@open-music-sdk/client-catalog/)

Against the live API on 18 October 2026:

- A search's `next` link answers with results by type, as the search does, not with a page, so `paginate` stops
  after the first page. The link keeps the term and the types, and leaves out `limit`.
- A chart's `next` link answers with charts by type as well, and keeps the types and the limit.
- 25 ISRCs gave 663 songs in one page, with no `next`, even asked for one to a page.
- Every function that was asked answered as its generated type has it, once the [types](#types) were corrected
  where the documentation marks as required what Apple left out.
- A view's `next` link keeps nothing but its offset, so it drops `with`. A view's own attributes, such as its title,
  come only on a page asked for with `with: ["attributes"]`, and so only on the first page.
- These held nothing to see in that storefront, each asked of five: a playlist's `more-by-curator` view, a music
  video's `genres`, and a live radio station's `radio-show`. A search for ten common words found no activity, so
  the functions for activities weren't asked.

Where it differs from the documentation:

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

Against the live API on 18 October 2026:

- A song never rated is answered `404`, so `getSongRating` rejects with an `ApiError` of status `404`. The ratings
  of several songs leave out those never rated.
- **Ratings, of each of the nine types that take one:** a dislike set on a song, an album, a music video, a
  playlist, a station, and on a library song, album, music video and playlist was read back at once, alone and in a
  batch. Taken away, it was gone at once.
- **A library copy's rating:** a library song's, album's or music video's rating was its catalog item's too, and
  went with it.
- `listRecentlyPlayed` and `listRecentlyPlayedTracks` answer without `types`, with what was played, as they do with
  every type named.
- **Additions:** `addToLibrary` took a song, an album, a catalog playlist and a music video. In one run each showed
  in the library within 4 seconds. In another, the song took 20 seconds and the album 16. Neither time did the
  catalog playlist's songs go into the library with it.
- **An album held in part:** an album counted as in the library once one song of it was. Its `library`
  relationship answered with the listener's copy.
- `addToFavorites` gave the song a rating of 1 at once, as a like does, and put it in the library.
- **A playlist folder:** `createLibraryPlaylistFolder` made one in the root. It could be read by its id at once,
  and was among the root's children after a second, with `p.playlistsroot` for its parent.
- Every function that reads, and was asked, answered as its generated type has it, once the [types](#types) were
  corrected and the root folder was asked for as below. A listener with no music video in their library was asked
  none of the functions for music videos.
- The root folder came only when something was included with it. The documented request,
  `filter[identity]=playlistsroot` and nothing else, was answered `200` with `data` empty, and so was
  `meta.filters.identity.playlistsroot`, for a listener with folders and without. With `include=children`, or
  `include=parent`, Apple answered with the root: `p.playlistsroot`, with no attributes, and its children. So
  `getRootLibraryPlaylistFolder` asks with `include=children`, unless you name what to include.
- By its id, `p.playlistsroot` was answered `404` with nothing included, and with the root when asked with
  `include=children`. Its `children` answered with the listener's playlists and folders either way. A folder made in
  the root was answered by its id with nothing included.
- `searchLibrary` found nothing for the whole name of a song of three words or more that was in the library, while
  the first word of it found the song. A name of one or two words found it.

Where it differs from the documentation:

- Every function takes the same options, so most take some that their endpoint isn't documented with: `limit` and
  `offset` where resources are asked for by id or by a filter, `offset` on a relationship, `include` and `extend`
  on a search, and all four on a write and on `listRecentlyAdded`, which are documented with `language` alone. An
  option you give is sent, and Apple decides what to make of it.
- `types` is optional for `listRecentlyPlayed` and `listRecentlyPlayedTracks`. The documentation marks it as
  required, while its own example asks without one and its sample answer holds several types, and Apple answers
  without it.
- `getUserStorefront` resolves to a `tStorefrontsResponse`. The documentation names a collection of any resource
  as its answer, and what that holds is the listener's storefront.
- `delete<X>Rating`, `addToLibrary` and `addToFavorites` resolve to nothing. The documentation names an empty
  object as their answer, which holds nothing to hand over.
- `addLibraryPlaylistTracks` resolves to nothing as well. The documentation names the playlist's tracks as its
  answer, for a `204`, which is a success with no body.
- `addToLibrary` and `addToFavorites` take ids of any type. The documentation lists no types for either, so a
  type is any name that could be one, and Apple says whether it is. The library took each of `songs`, `albums`,
  `playlists` and `music-videos`.
- The generated type for a playlist to create wants `tracks` and `parent` together under `relationships`, because
  the documentation marks both as required there. Apple made one with neither.

## [lib-playlists](./reference/@open-music-sdk/lib-playlists/)

Apple documents making a library playlist, adding tracks to the end of one, and reading one and its tracks. It
documents that `filter[isrc]` takes 25 values at most, and that one ISRC may come back as several songs. It
documents no way to take a track out, move one, or rename or delete a playlist, so this package can't do those.

Against the live API on 18 October 2026, a playlist was made, given 300 tracks, read back and planned for again:

- A playlist's tracks asked for with `include=catalog` carry their catalog song, which is where the ISRC is. A
  track with none had a catalog id under `attributes.playParams.catalogId`, which the documentation doesn't list
  and the package reads instead.
- A `next` link of a playlist's tracks keeps nothing but its offset, so it drops `include`. `read` puts
  `include=catalog` back on every link, which gives the tracks after the first hundred their catalog songs again.
- The tracks of a playlist with none are answered `404`, and `read` takes it for empty. A playlist with tracks,
  asked for with `include=tracks`, carries them, which is what a `404` for its tracks is checked against.
- A track added by its catalog id is held under that id: 300 of 300, in the order they were added.
- A new playlist could be read by its id at once, and was among the listener's playlists after 4 seconds, and after
  5 in a second run. 300 tracks added to it showed after 2. `settle` gives a write ten reads a second apart.
- The 300 songs added to a playlist went into the listener's library with it in one run, and not in another.
- One request took 300 tracks, which `chunk` defaults to.
- A playlist's name and description came back as they were sent, and `apply` with the same plan found the
  playlist and added nothing.
- `resolve`, given the name, artist and album of 50 chart songs and no ISRC, found a song for every one. 32 were
  the chart's own song, and 18 another release of it, as the same song on another album is; 30 and 20 in a second
  run.

It still takes these on trust:

- That a write shows as soon on another day, with a larger library, or in another storefront. If a playlist a run
  made isn't listed within `settle`'s reads, the run resolves with `verified: false`, and a run of the same plan
  before it is listed makes a second one.
- That a `404` for the tracks of a playlist that exists always means it has none. The package still asks for the
  playlist once more, with `include=tracks`, before it believes that.
- How many tracks of a real import the exact-match rule of `resolve`'s search misses: chart songs are the easy case.

## [lib-preview-player](./reference/@open-music-sdk/lib-preview-player/)

Apple documents that a song and a music video have `previews`, each with a `url`, and that a preview may be
available with or without an Apple Music subscription.

It doesn't document which host the clips are served from. Against the live API on 18 October 2026, the clips of
50 chart songs in one storefront were all on `audio-ssl.itunes.apple.com`, which `hosts: ["itunes.apple.com"]`
allows. Apple may serve others elsewhere: look at what your own answers hold before you set `hosts`.

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

A token Apple never gave was answered `403`, which `validateUserToken` calls `UserTokenInvalid`, against the live
API on 18 October 2026. A token after the script's sign-out came out as `UserTokenInvalid` too. What an expired
token is answered isn't known.

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

Against the live API on 18 October 2026, the 200 artwork templates of one storefront's charts all named their crop
and format, with `{w}` and `{h}` their only placeholders, and were all on `mzstatic.com`. One of them, asked for in
each of the six formats, came back in each, with its Content-Type.

In the Next sample on 20 October 2026, `next/image` with `artworkUrl` as its loader asked for the widths of its own
list, `256x256` and `640x640` for a cover shown at 240, and the artwork of a listener's own playlist, a URL with no
size to fill in, needed `unoptimized`. See [With `next/image`](./guides/artwork#with-next-image).

## [types](./reference/@open-music-sdk/types/)

The names differ from the documentation's. Apple titles each resource by the plural value of its `type`, so one
song is documented as `Songs`. Where an object is a single thing, its type is named in the singular, with a `t`
in front: `Songs.Attributes` is `tSongAttributes`. A response keeps the plural, since it wraps a list:
`tSongsResponse`.

An object the documentation gives no properties for is `Record<string, unknown>`.

Four properties the documentation marks as required are optional, since Apple left them out against the live API
on 18 October 2026. Each one's doc comment says so.
- **A view's own `attributes`:** sent only for a page asked for with `with: ["attributes"]`, and only on the first.
- **`durationInMillis` of a song and of a music video:** left out for some of an album's tracks, in an album looked
  up by its UPC.
- **`artistName` and `artwork` of an album in the library:** left out for some albums in a listener's library.

## [validate](./reference/@open-music-sdk/validate/)

The validators are named as the types are, without the `t` and with the first letter in lower case:
`Songs.Attributes` is `songAttributes`.

A validator allows keys Apple hasn't documented. Apple adds attributes without notice, and that shouldn't break
your app.

A validator takes the four properties the [types](#types) make optional as optional too, so it passes what Apple
sends without them.

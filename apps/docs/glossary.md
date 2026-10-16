# Glossary

The words these docs use, in alphabetical order.

### Apple Music API

Apple's REST API for Apple Music, at `https://api.music.apple.com`. Every request is JSON over HTTPS and carries a
[developer token](#developer-token). This SDK sends every request there and nowhere else.

### Artwork template

What Apple sends instead of an image URL: a URL with `{w}` and `{h}` where the pixel size goes. You fill in the
size you want. See [Show artwork](./guides/artwork).

### Catalog

Everything Apple Music offers in a [storefront](#storefront): songs, albums, artists, playlists, music videos,
stations, charts and search. Reading the catalog needs only a [developer token](#developer-token).
[`client-catalog`](./reference/@open-music-sdk/client-catalog/) covers it.

### Client

The object every request goes through, made by `createClient` in `core` or by one of the
[integrations](#integration). It holds your tokens and settings. Every function that asks Apple for something takes a
client, or is already bound to one.

### Developer token

A JSON Web Token ([JWT](#jwt)) you sign with your [MusicKit private key](#musickit-private-key). It tells Apple a
request comes from a registered developer, and every request needs one. See
[Developer tokens and Music User Tokens](./concepts/tokens).

### Intake

The route on your server that takes a [Music User Token](#music-user-token) from a page, checks it with Apple and
stores it: `userTokenIntake` in `user-token`, which `server` re-exports. See
[Keep a listener's token on your server](./guides/store-user-tokens).

### Integration

One of the three packages an app installs: `server`, `browser` or `react`. Each gives you a ready-made client and
re-exports what an app uses of the other packages. See [Which package to install](./concepts/packages).

### ISRC

International Standard Recording Code: a 12-character code that identifies one recording, such as
`GBAYE0601498`. Apple can look songs and music videos up by ISRC, which is how a track from another service is
best found in Apple's catalog.

### JWT

JSON Web Token: a signed, base64url-encoded string of three parts. A developer token is a JWT signed with the
ES256 algorithm.

### Key ID

The 10-character ID of your [MusicKit private key](#musickit-private-key). It is also the part of the key file's
name after `AuthKey_`.

### Library

A listener's own collection in Apple Music: what they have added from the catalog, and the playlists they
made. Reading or changing it needs their [Music User Token](#music-user-token).
[`client-user`](./reference/@open-music-sdk/client-user/) covers it.

### Listener

The person using your app who signs in with their Apple Account. Their [Music User Token](#music-user-token) lets
your app read and change their [library](#library).

### Music User Token

A token Apple issues after a listener signs in, which lets your app act for them. Requests for their library,
ratings, recommendations and history (paths under `/v1/me`), their personal station and a catalog resource's
`library` relationship need it, as well as a developer token. Only Apple can issue one. For your own account, the
CLI's `login` gets one: see [The command-line tool](./concepts/packages#the-command-line-tool). See also
[Developer tokens and Music User Tokens](./concepts/tokens).

### MusicKit on the Web

Apple's JavaScript library for web pages, served from Apple's CDN. The SDK uses it for one thing: signing a
listener in. See [Sign a listener in](./guides/sign-in).

### MusicKit private key

The `.p8` file you download from your Apple Developer account, which signs developer tokens. Apple lets you
download it once. Keep it out of your repository and out of anything a browser loads. See
[Set up your MusicKit key](./guides/musickit-key).

### Namespace

A set of functions on a [client](#client) under one name: `catalog`, `user` or `playlists`. Each function is bound
to the client, so you don't pass it one. Those of `catalog` and `user` hand over what Apple's answer holds rather
than the whole answer: a song, say, rather than `{ data: [song] }`. See
[What an integration gives you](./concepts/packages#what-an-integration-gives-you).

### Page, `next` link

Apple answers a request for a long list one page at a time. Each page holds `data`, the items, and `next`, the
path of the following page, until the last. A function that walks pages follows `next` for you.

### Preview

A short audio clip of a song, under `attributes.previews` in the catalog. Any audio element can play it. See
[Play song previews](./guides/previews).

### Provider

A function the client calls for a token when it needs one, rather than a fixed token string. The developer token
providers in `developer-token` cache a token and replace it before it expires.

### Relationship

A list of resources linked to another resource, such as an album's `tracks` or a song's `artists`. It is a
[page](#page-next-link) like any other list.

### Resource

One object in Apple's API, such as a song or a library playlist. Every resource has an `id`, a `type` and an
`href`, and usually `attributes` and `relationships`.

### Standard Schema

A shared interface for validators, which libraries such as Zod and Valibot implement. `core`'s `request` and every
function of the two clients take one as their `schema` option. See [Validate Apple's responses](./guides/validation).

### Storefront

The country or region whose Apple Music catalog you ask, as a two-letter code such as `us` or `gb`. Each
storefront has its own catalog, and an ID in one may not exist in another.

### Team ID

The 10-character ID of your Apple Developer team, shown on your membership page.

### Token endpoint

A route on your server that hands a page a short-lived developer token. A page cannot sign one itself, because it
cannot hold the private key. `tokenEndpoint` in `server` is that route. See
[Serve a developer token to a page](./guides/token-endpoint).

### UPC

Universal Product Code: the barcode number of a release. Apple can look albums up by UPC.

### View

Apple's name for a list it puts together about a resource, such as an artist's `top-songs` or an album's
`other-versions`. Like a [relationship](#relationship), it comes as a page.

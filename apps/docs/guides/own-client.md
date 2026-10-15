# Build your own client from the parts

An integration gives you a client with everything on it. When you want the smallest bundle, or to put the parts
together your own way, install the packages an integration is made of and compose them yourself. In this guide
you create a client with `core`, give it a developer token, and call the functions you import.

Before you start, you need:

- on a server, your MusicKit key. See [Set up your MusicKit key](./musickit-key).
- for a page, a route that serves it a developer token. See [Serve a developer token to a page](./token-endpoint).
- to know which packages you want. See [Which package to install](../concepts/packages).

In the code below, `musicUserToken` is a listener's token, from [Sign a listener in](./sign-in).

## 1. Install the parts

Install `core`, `developer-token`, and the packages whose functions you call:

```sh
pnpm add @open-music-sdk/core @open-music-sdk/developer-token @open-music-sdk/client-catalog
```

Keep every package on [the same version as `core`](../concepts/packages#one-version-for-every-package).

## 2. Create the client

`createClient` takes the developer token as a [provider](../glossary#provider): a function the client calls when
a request needs a token.

On your server, `developerTokenMinter` signs tokens with your key:

```ts
import { createClient } from "@open-music-sdk/core";
import { developerTokenMinter } from "@open-music-sdk/developer-token";

const developerToken = developerTokenMinter({
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
});
const music = createClient({ developerToken, storefront: "us" });
```

In your page, `developerTokenFetcher` fetches tokens from your token route. Import it from the
`@open-music-sdk/developer-token/fetcher` entry, which holds no signing code:

```ts
import { createClient } from "@open-music-sdk/core";
import { developerTokenFetcher } from "@open-music-sdk/developer-token/fetcher";

const developerToken = developerTokenFetcher("/api/music/token");
const music = createClient({ developerToken, storefront: "us" });
```

Both providers reuse a token and replace it before it expires.

The fetcher resolves a relative URL against the document's base URL each time it fetches a token, so outside a
browser, pass an absolute one. In a page, a `<base>` element put into it later would move where the token comes
from: set `base-uri 'self'` in your content security policy. See the [security model](../concepts/security).

`createClient` also takes the options an integration passes on to it, such as `userTokenStore`, `retry`,
`rateLimit` and the hooks. It checks them when you call it, so a mistake is a `TypeError` there.

## 3. Call the functions with the client

Each function of `client-catalog` and `client-user` is a separate export that takes the client first. A bundler
leaves out of your app every function you don't import.

```ts
import { getAlbum } from "@open-music-sdk/client-catalog";

const { data } = await getAlbum(music, "1613600183");
```

For the listener's library, install `@open-music-sdk/client-user`, and call its functions with a client for the
listener:

```ts
import { listLibraryPlaylists } from "@open-music-sdk/client-user";

const listener = music.as(musicUserToken);
const firstPage = await listLibraryPlaylists(listener, { limit: 100 });
for await (const playlist of listener.paginate(firstPage)) console.log(playlist.attributes?.name);
```

Called with a client, a function resolves to Apple's answer as it came, and a list to its first page. `paginate`
walks on from a page you already have, without asking for it again.

## 4. Or bind them to the client

`catalog(client)` and `user(client)` give every function of their package bound to one client, as an
integration's `music.catalog` and `music.user` do. A bound function takes the same arguments without the client,
and hands over what Apple's answer holds:

```ts
import { catalog } from "@open-music-sdk/client-catalog";

const store = catalog(music); // create it once, and keep it
const album = await store.getAlbum("1613600183"); // the album itself
for await (const track of store.getAlbumRelationship("1613600183", "tracks")) console.log(track.attributes?.name);
```

What each kind of function gives, called with the client and bound, is under "Two ways to call" in the reference
for [`client-catalog`](../reference/@open-music-sdk/client-catalog/#two-ways-to-call) and
[`client-user`](../reference/@open-music-sdk/client-user/#two-ways-to-call).

A bound namespace holds every function of its package, so your bundle holds them all. To keep a bundle small,
call the functions you import with the client instead.

## 5. Add the playlist verbs

Install `@open-music-sdk/lib-playlists`. `playlists(client)` gives its four verbs, `resolve`, `read`, `plan` and
`apply`, for one client. `read` and `apply` work on the listener's library, so give it a listener's client:

```ts
import { playlists } from "@open-music-sdk/lib-playlists";

const lists = playlists(music.as(musicUserToken));
const { tracks } = await lists.resolve([{ isrc: "GBAYE0601498" }]);
```

## 6. Put the namespaces on the client

`withNamespaces` from `core` puts namespaces on a client under the names you choose. The clients that `as()` and
`forUser()` give get the same namespaces, made for them. Here, `developerToken` is the provider from step 2:

```ts
import { createClient, withNamespaces } from "@open-music-sdk/core";
import { catalog } from "@open-music-sdk/client-catalog";
import { user } from "@open-music-sdk/client-user";
import { playlists } from "@open-music-sdk/lib-playlists";

const app = withNamespaces(createClient({ developerToken, storefront: "us" }), { catalog, user, playlists });

const album = await app.catalog.getAlbum("1613600183");
for await (const playlist of app.as(musicUserToken).user.listLibraryPlaylists()) console.log(playlist.id);
```

This is how the integrations build their clients. A namespace can't take the name of one of the client's own
functions: `request`, `paginate`, `storefront`, `as` or `forUser`.

For sign-in in a page, `createConnect` from `@open-music-sdk/browser` takes anything that holds a
`developerToken` provider, such as the fetcher from step 2:
`createConnect({ developerToken }, { app: { name: "Crate Digger" } })`. See [Sign a listener in](./sign-in).

## Next steps

- [Which package to install](../concepts/packages), for what each package holds.
- [Call an endpoint the clients don't cover](./direct-requests).
- The reference for [`createClient`](../reference/@open-music-sdk/core/functions/createClient),
  [`withNamespaces`](../reference/@open-music-sdk/core/functions/withNamespaces),
  [`catalog`](../reference/@open-music-sdk/client-catalog/functions/catalog),
  [`user`](../reference/@open-music-sdk/client-user/functions/user) and
  [`playlists`](../reference/@open-music-sdk/lib-playlists/functions/playlists).

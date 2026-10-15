# @open-music-sdk/lib-playlists

Apple's API can make a playlist in a listener's library and add tracks to its end. It can't take a track out, move
one, or delete a playlist. This package does the work every app does around that: it finds tracks known from
somewhere else in Apple's catalog, reads a playlist whole, works out what it's missing, and adds that without adding
anything twice.

Most apps install [`server`](../../integrations/server/README.md), [`browser`](../../integrations/browser/README.md)
or [`react`](../../integrations/react/README.md) instead, which put these verbs on `music.playlists`. Use this
package to build your own client.

```
pnpm add @open-music-sdk/lib-playlists @open-music-sdk/core
```

Keep the two on the same version. See
[One version for every package](https://open-music-sdk.github.io/js/concepts/packages#one-version-for-every-package).

## Example

On a server or in a page, where `developerToken` and `musicUserToken` are your tokens:

```ts
import { createClient } from "@open-music-sdk/core";
import { playlists } from "@open-music-sdk/lib-playlists";

const lists = playlists(createClient({ developerToken, storefront: "us" }).as(musicUserToken)); // for one listener

// Find tracks known from elsewhere in Apple's catalog: by ISRC, or by name and artist.
const { tracks, skipped } = await lists.resolve([{ isrc: "GBAYE0601498" }, { name: "Yesterday", artistName: "The Beatles" }]);

// Work out what the playlist is missing. Nothing is asked of Apple: looking at the plan is the dry run.
const plan = lists.plan({ name: "Imported", description: "from my-app" }, tracks);

// Find or make the playlist, and add what it's missing to its end.
const { id, created, appended, verified } = await lists.apply(plan);
```

## What's in it

One function, `playlists(client)`, which gives a frozen object of four verbs. Each verb can be handed on by itself.

| Verb | What it does | What it asks Apple |
| --- | --- | --- |
| `resolve(descriptions, options?)` | Finds a song in the catalog for each description of a track, and hands back the ones it couldn't match with the songs its search found | The catalog, with the developer token alone |
| `read(id, options?)` | Reads a playlist of the listener's library whole, as plain JSON you can save as an export | The library, with both tokens |
| `plan(playlist, tracks)` | Works out what the playlist is missing, and what can't be done | Nothing |
| `apply(plan, options?)` | Finds or makes the playlist and adds what it's missing, sending each write once | The library, with both tokens |

`read` and `apply` need a client that holds the listener's Music User Token. `resolve` works with a client that has
none, as long as the client or the call names a storefront.

| Types | For |
| --- | --- |
| `tPlaylists` | What `playlists(client)` gives |
| `tTrackDescription`, `tResolvedTracks`, `tSkippedTrack`, `tResolveOptions` | `resolve` |
| `tPlaylistSnapshot`, `tPlaylistSnapshotTrack`, `tReadPlaylistOptions` | `read` |
| `tNewPlaylist`, `tPlaylistPlan`, `tPlaylistTrack` | `plan` |
| `tAppliedPlan`, `tApplyOptions`, `tSettleOptions` | `apply` |
| `tAskOptions`, `tPaceOptions`, `tLimitOptions`, `tProgress`, `tStorefrontOption` | The options the verbs share |

## Learn more

- [Import a playlist](https://open-music-sdk.github.io/js/guides/import-playlist)
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens)
- [Handle errors](https://open-music-sdk.github.io/js/guides/errors)
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences), for what this package
  takes on trust about Apple's API
- [Reference for this package](https://open-music-sdk.github.io/js/reference/@open-music-sdk/lib-playlists/)

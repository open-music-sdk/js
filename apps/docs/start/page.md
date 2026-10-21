# Part 2: The page and the catalog

In this part you build the page, with no framework, on Vite's dev server. By the end it shows crates of Apple's
charts and of each genre, opens an album, an artist or a playlist, searches the catalog, plays previews, and
takes songs into your own crate. Nobody has to sign in for any of it: the catalog needs only the developer token
your server hands out.

The finished page is [`samples/web-vanilla`](https://github.com/open-music-sdk/js/tree/main/samples/web-vanilla).

## 1. Make the folder

From the repository's root, make a folder for your page and copy in its TypeScript settings:

```sh
mkdir samples/my-page
mkdir samples/my-page/src
cp samples/web-vanilla/tsconfig.json samples/my-page/
```

Then make `samples/my-page/package.json`:

```json
{
  "name": "my-page",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite"
  },
  "dependencies": {
    "@open-music-sdk/browser": "workspace:*",
    "@open-music-sdk/core": "workspace:*"
  },
  "devDependencies": {
    "vite": "catalog:"
  }
}
```

`@open-music-sdk/browser` is the package for a page. `@open-music-sdk/core` gives one function the page uses in
part 3. Install, from the root:

```sh
pnpm install
```

## 2. Set up the dev server

```sh
cp samples/web-vanilla/vite.config.ts samples/my-page/
```

<<< @/../../samples/web-vanilla/vite.config.ts{ts}

Two settings matter to the SDK:

- The page is served on `localhost:2728`, the origin your server binds the developer token to. Apple's script will
  keep the listener's token in that origin's storage, so it's a port of its own.
- Everything under `/api` goes to your server on `127.0.0.1:8787`. To the page, the server is on its own origin, so
  it fetches its token from a relative URL, and CORS never comes up.

The rest keeps the dev server from handing your `.env` or anything like it to a page that asks.

## 3. Add the page's markup and look

```sh
cp samples/web-vanilla/index.html samples/my-page/
cp samples/web-vanilla/styles.css samples/my-page/
```

`index.html` has the header, with its tabs, the storefront picker and the sign-in button; a section for each of the
three screens, Dig, your crate and your library; and the player along the page's foot. `styles.css` draws the
crates of record sleeves. Neither has anything of the SDK's in it.

## 4. Make the page's client

```sh
cp samples/web-vanilla/src/music.ts samples/my-page/src/
```

<<< @/../../samples/web-vanilla/src/music.ts{ts}

`createBrowserClient` fetches its developer token from your server's route, the first time a request needs one, and
the next one before it runs out. Every screen asks Apple through this one client.

`now` is the page's own: who is signed in, and the storefront the catalog is read in. Every screen draws itself
again when it changes.

## 5. Say what went wrong

```sh
cp samples/web-vanilla/src/errors.ts samples/my-page/src/
```

Every request that fails ends in one function, which says each kind of error in words a listener can act on:

<<< @/../../samples/web-vanilla/src/errors.ts#explain{ts}

`isAppleMusicError(e, tag)` tests for one kind. The rest of the file puts the words in the page's status line. See
[Handle errors](../guides/errors).

## 6. Draw the crates

Five files draw the crates and the pages they open. Only one has anything of the SDK's in it:

```sh
cp samples/web-vanilla/src/dom.ts samples/my-page/src/
cp samples/web-vanilla/src/artwork.ts samples/my-page/src/
cp samples/web-vanilla/src/sleeve.ts samples/my-page/src/
cp samples/web-vanilla/src/box.ts samples/my-page/src/
cp samples/web-vanilla/src/view.ts samples/my-page/src/
```

Apple doesn't send an image URL for a cover, but a template, with the size left for you to fill in.
`artworkImage` fills it in for the size each cover is shown at:

<<< @/../../samples/web-vanilla/src/artwork.ts#artwork{ts}

It gives the `<img>` a `srcset`, so that a dense screen gets a sharper image. See [Show artwork](../guides/artwork).

`sleeve.ts` and `box.ts` draw a crate, flipped through with the arrow keys, and `view.ts` swaps the floor of crates
for the page a sleeve opens, at an address of its own so that Back works.

## 7. Play previews

```sh
cp samples/web-vanilla/src/player.ts samples/my-page/src/
```

<<< @/../../samples/web-vanilla/src/player.ts{ts}

- `previewPlayer` plays the short clips that come with each song, through an audio element of its own. It asks
  Apple for nothing.
- `playFrom` plays a whole list from the track clicked. A browser starts sound only after a click, so it's only ever
  called from one.
- `subscribe` draws the player along the page's foot after each change.

See [Play song previews](../guides/previews).

## 8. Add the songs and your crate

```sh
cp samples/web-vanilla/src/songs.ts samples/my-page/src/
cp samples/web-vanilla/src/crate.ts samples/my-page/src/
```

`songs.ts` draws a crate of songs: pulling one out plays it, and the one in front can go into your crate. Its Love
and Add to library buttons show once you sign in, in part 3.

`crate.ts` holds the songs you pick, in the tab, and finds a pasted tracklist in the catalog:

<<< @/../../samples/web-vanilla/src/crate.ts#resolve{ts}

`playlists.resolve` searches the catalog for each line, and takes a song only where its name and its artist are the
line's, compared without case or punctuation. A line with no match comes back with the songs its search found,
which the page offers instead. It needs no sign-in.

## 9. Open albums, artists and playlists

```sh
cp samples/web-vanilla/src/pages.ts samples/my-page/src/
```

A sleeve opens a page of its own. The album's is read with its tracks, and held to the album's type as it arrives:

<<< @/../../samples/web-vanilla/src/pages.ts#validate{ts}

`schema: schemas.albumsResponse` checks the answer against the shape Apple documents, and fails with a
`ValidationError` that names the path of each value that differs. See
[Validate Apple's responses](../guides/validation).

The artist's page walks a view, the artist's top songs, and a relationship, their albums, with `getArtistView` and
`getArtistRelationship`. The playlist's is like the album's.

## 10. Fill the floor

```sh
cp samples/web-vanilla/src/dig.ts samples/my-page/src/
```

The floor is the first screen: the storefront's top charts, then a crate of albums for each genre:

<<< @/../../samples/web-vanilla/src/dig.ts#charts{ts}

`listGenres` walks every page of the storefront's genres. A genre's crate asks for its chart only once it scrolls
into view, so the floor asks Apple only for what you reach.

While nobody is signed in, you pick the storefront the catalog is read in:

<<< @/../../samples/web-vanilla/src/dig.ts#storefronts{ts}

## 11. Search the catalog

```sh
cp samples/web-vanilla/src/search.ts samples/my-page/src/
```

<<< @/../../samples/web-vanilla/src/search.ts{ts}

`searchCatalog` searches four kinds at once, and `getSearchHints` offers terms as you type, once typing pauses.

## 12. Start the page

Make `samples/my-page/src/main.ts`, which loads each screen and makes the header's tabs switch between them:

```ts
// The page: each screen's module starts it as it loads, and the header's tabs
// switch between them.
import "./player";
import "./dig";
import "./search";
import "./crate";
import { drawPage } from "./view";

const tabs = document.querySelectorAll<HTMLButtonElement>("nav button");
for (const tab of tabs) {
  tab.onclick = () => {
    for (const each of tabs) {
      const isThisTab = each === tab;
      each.ariaPressed = String(isThisTab);
      const screen = document.getElementById(each.value);
      screen?.toggleAttribute("hidden", !isThisTab);
    }
  };
}

// Every page has its route by now, so an address the page was loaded with, such
// as a search, opens its page.
drawPage();
```

Part 3 adds the three screens of a signed-in listener.

## 13. Run it

From the root, start your page and your server together:

```sh
pnpm turbo dev --filter=my-page --filter=my-server
```

Open `http://localhost:2728`. Use `localhost`, not `127.0.0.1`: the developer token is bound to that origin.

- The floor fills with the charts' crates, then the genres' as you scroll. Flip through a crate with its arrows or
  the arrow keys.
- Click the album in front of a crate to open its page, and Back to return to the crates as you left them.
- Click Play on a track, then Next along the page's foot.
- Put a few songs in your crate, and open the Your crate tab. Paste a tracklist, one `Artist - Title` a line.
- Search for an artist, and pick another storefront.

The Sign in button stays greyed out for now. Stop the pair with Ctrl+C.

[Next: the listener](./listener).

# Part 3: The listener

In this part you sign in with Apple Music, and your page and your server act for you: they love songs, add them to
your library, show your library's lists, and send your crate to a playlist. These steps write to your own Apple
Music library, so sign in with an account you don't mind adding a few songs and one playlist to.

## 1. Sign in

```sh
cp samples/web-vanilla/src/sign-in.ts samples/my-page/src/
```

<<< @/../../samples/web-vanilla/src/sign-in.ts#file{ts}

- `createConnect` is made as the page loads, not when the button is clicked, so that Apple's script is loaded and
  configured before the click. A browser opens Apple's sign-in window only inside a click.
- `connect()` opens the window, and resolves to your Music User Token, or to nothing if you close it.
- `ready` resolves to a token when Apple's script restores one for a returning listener, who then needs no click.
- `keep` posts the token to your server's route from part 1. Once the server has kept it, `music.as(token)` gives
  the page a client that acts for you, and `getUserStorefront` asks which storefront your account is in. Every
  screen then draws itself again, in your storefront.
- Signing out tells your server to forget the token first, then runs Apple's own sign-out, which ends the token at
  Apple.

See [Sign a listener in](../guides/sign-in).

## 2. Love songs, and add them to your library

`songs.ts`, which you copied in part 2, draws Love and Add to library once you're signed in. The hearts come from
one request for every song in the crate:

<<< @/../../samples/web-vanilla/src/songs.ts#love{ts}

Loving a song rates it `1`, and taking the love away deletes the rating. Adding a song is one request:

<<< @/../../samples/web-vanilla/src/songs.ts#add-to-library{ts}

## 3. See whether you hold an album

`pages.ts`, also from part 2, says on an album's page whether it's in your library. No client function asks that,
so the page asks Apple by the path:

<<< @/../../samples/web-vanilla/src/pages.ts#in-library{ts}

`segmentOf` comes from `@open-music-sdk/core`, and checks each value as one segment of the path, as the clients check
every id. See [Call an endpoint the clients don't cover](../guides/direct-requests).

## 4. Show your library

```sh
cp samples/web-vanilla/src/library.ts samples/my-page/src/
```

The Library tab draws a crate for each of your lists, the first page of each:

<<< @/../../samples/web-vanilla/src/library.ts#library-lists{ts}

One of them comes from your server, which asks Apple for you with the token it kept in part 1:

<<< @/../../samples/web-vanilla/src/library.ts#act-for-listener{ts}

And your playlists come in 25 at a time, the next page asked for as you flip near the back of the crate:

<<< @/../../samples/web-vanilla/src/library.ts#your-playlists{ts}

## 5. Send your crate to a playlist

```sh
cp samples/web-vanilla/src/send.ts samples/my-page/src/
```

Apple's API can add songs to the end of a playlist, but can neither take one out nor move one. So sending starts
with a plan, which the page shows before anything is written:

<<< @/../../samples/web-vanilla/src/send.ts#plan{ts}

Once you say Send it, the page applies the plan:

<<< @/../../samples/web-vanilla/src/send.ts#apply{ts}

Sending the same crate again adds nothing, once Apple shows what the first send added: the plan finds every song
in the playlist already. Apple carries a write out after it answers, so the page says whether it shows the songs
yet, and a send made before it does can add them twice. See [Import a playlist](../guides/import-playlist).

## 6. Start every screen

Add the three screens to `samples/my-page/src/main.ts`, which is now the finished sample's:

<<< @/../../samples/web-vanilla/src/main.ts{ts}

## 7. Run it, and sign in

From the root:

```sh
pnpm turbo dev --filter=my-page --filter=my-server
```

Open `http://localhost:2728`, and click Sign in with Apple Music. Sign in in Apple's window. The status line says
which storefront you're digging in, and a Library tab appears.

- Reload the page. Apple's script restores you, with no click.
- Love a song you haven't rated, and add one that isn't in your library yet. Taking the love away deletes the
  song's rating, whatever it was before.
- Open the Library tab. The first crate, recently played, is the one your server asked Apple for.
- Put a few songs in your crate, open the Your crate tab, and send it to a new playlist. Plan it, read the plan,
  and press Send it. If the page says the songs can take a few seconds to show, wait that long. Then send it
  again, and see that the plan adds nothing.

## 8. When you're done

Sign out before you stop. Apple's script keeps a copy of your Music User Token in the storage of `localhost:2728`,
which any other app you later serve on that port could read. Then stop the pair with Ctrl+C.

Everything the page wrote is in your Apple Music account. Undo in Apple Music what you don't want to keep:

- the playlist the page made, named Vinyl Collector Simulator, whose description says it was made here;
- the songs you loved, and the songs and albums you added to your library;
- an album you made a favorite on its page.

Your two folders are yours to keep, and the repository ignores them. To put the repository back as you cloned it,
delete them, restore the lockfile pnpm wrote them into, and restore the generated types, from the root:

```sh
rm -r samples/my-page
rm -r samples/my-server
git checkout pnpm-lock.yaml
pnpm install
git checkout packages/types/src packages/validate/src
```

## Where next

- The [guides](../guides/musickit-key) go further into each part, in the page and server you pick in the nav.
- The [sample apps](../samples) are the same app in React and in Next.js, and its server as a Cloudflare Worker.
- [Developer tokens and Music User Tokens](../concepts/tokens) explains the two tokens your app now uses.

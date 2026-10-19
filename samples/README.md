# Sample apps

One small app, Crate Digger, written once per way of using the SDK. You dig through Apple's catalog, play the
previews, sign in with Apple Music, and send a crate of songs to your library as a playlist. It is a demo: there
are no accounts, the crate lives in the tab, and nothing is built to be deployed.

Each sample runs on your machine against the live Apple Music API, with your own MusicKit key and your own Apple
Account. They are private to this repository and never published.

## Run one

You need Node 24, pnpm, a MusicKit key, and an Apple Account with an Apple Music subscription. See
[Set up your MusicKit key](https://open-music-sdk.github.io/js/guides/musickit-key).

1. Install, from the repository's root:

   ```sh
   pnpm install
   ```

2. Copy [`.env.example`](./.env.example) to the server sample you run, and fill it in. Never commit the copy.

   | Server | Copy it to |
   | --- | --- |
   | `express-server` | `samples/express-server/.env` |
   | `worker-server` | `samples/worker-server/.env` |

   The Worker reads `.env`, not Wrangler's usual `.dev.vars`, because the page's dev server refuses to serve a
   file named `.env` and would serve `.dev.vars` to any page that asked for it.

3. Run a page with a server, from the repository's root. Turborepo builds the packages first.

   ```sh
   pnpm turbo dev --filter=web-vanilla --filter=express-server
   pnpm turbo dev --filter=web-vanilla --filter=worker-server
   ```

4. Open <http://localhost:2728>. Use `localhost`, not `127.0.0.1`: the developer token is bound to that origin.

5. Sign out before you stop. Apple's script keeps a copy of your Music User Token in the storage of
   `localhost:2728`, which any other app you later serve on that port could read.

Any page runs with any server. Both servers listen on `127.0.0.1:8787` and answer the same routes, and the page's
dev server forwards `/api` to whichever one runs, so the page and its server share one origin.

| Route | What it does |
| --- | --- |
| `GET /api/music/token` | Hands the page a developer token, bound to the page's origin |
| `POST /api/music/user-token` | Takes the listener's Music User Token after Apple's sign-in, checks it with Apple, and keeps it |
| `GET /api/me/recent` | What the listener played lately, asked by the server with the token it kept |

A listener is a random id in a cookie, `crate_session`, which the server gives with its first answer.

## The samples

| Sample | Runs on | Shows |
| --- | --- | --- |
| [`express-server`](./express-server) | Node 24 and Express 5 | `createServerClient`, `tokenEndpoint` mounted on Express, `acceptUserToken` behind Express's own body parser, `MemoryUserTokenStore`, `forUser` |
| [`worker-server`](./worker-server) | Cloudflare Workers, locally through Wrangler | the same routes with `userTokenIntake` and `KvUserTokenStore` |
| [`web-vanilla`](./web-vanilla) | A page built with Vite, no framework | `createBrowserClient`, `createConnect`, `previewPlayer`, the catalog, the listener's library, and the playlist tools |

Every sample has the same screens in files of the same names, so two samples side by side show what a framework
changes. Each file starts with the exports it shows and the guide it pairs with.

[`export-check`](./export-check) is a test, not an app. It fails when an export of `server` or `browser` is used by
no sample and is not on its list of exceptions, each with the reason.

## What they leave out

- Accounts and lasting storage. The Express server forgets its tokens when it stops.
- A content security policy. Vite's dev server injects inline scripts, which a strict policy refuses. The CLI's
  sign-in page sets one, in [`apps/cli/src/loopback.ts`](../apps/cli/src/loopback.ts).
- Music videos in the crate. They play, but the playlist tools are shown with songs.
- Deployment. A build exists only to check that a sample bundles.

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

The build that `pnpm turbo dev` starts with writes the generated files under `packages/types/src` and
`packages/validate/src` again, with LF line endings. On a checkout with CRLF endings git then shows them changed,
with nothing in them changed. `git checkout -- packages/types/src packages/validate/src` puts them back.

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

The two servers answer the same routes. Each page sample has the same screens, in files of the same names, so
two page samples side by side show what a framework changes. Each file starts with the exports it shows and the
guide it pairs with.

[`export-check`](./export-check) is a test, not an app. It fails when an export of `server` or `browser` is used by
no sample and is not on its list of exceptions, each with the reason.

## What they leave out

Each of these is enough for one developer's machine, and not for an app on the web. Change them before you copy a
sample into one.

- Accounts and real sessions. A listener is any id a browser presents in the `crate_session` cookie: not checked
  as one the server gave, not renewed at sign-in, and not `Secure`.
- Lasting, encrypted storage. The Express server forgets its tokens when it stops. The Worker's tokens sit in
  plain text in `.wrangler/state` until you delete it.
- Rate limits on the two routes. A deployed token route hands tokens to anyone who asks, and the user-token route
  costs a request to Apple for each token posted to it.
- A content security policy. Vite's dev server injects inline scripts, which a strict policy refuses. The CLI's
  sign-in page sets one, in [`apps/cli/src/loopback.ts`](../apps/cli/src/loopback.ts).
- An icon of your own. The page's `apple-music-app-icon` link points at this project's logo, which Apple's sign-in
  window shows beside your page's host.
- Music videos in the crate. They play, but the playlist tools are shown with songs.
- Deployment. A build exists only to check that a sample bundles. The servers answer only requests sent to
  `127.0.0.1:8787` or to the page's own host, and refuse to start without `PAGE_ORIGIN`.

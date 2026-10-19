# Sample apps

The repository has one small app, Crate Digger, written once per way of using the SDK. You dig through Apple's
catalog, play the previews, sign in with Apple Music, and send a crate of songs to your library as a playlist.
It's a demo: there are no accounts, the crate lives in the tab, and nothing is built to be deployed.

Each sample runs on your machine against the live Apple Music API, with your own MusicKit key and Apple Account.
The guides show code from them, and every sample is in the repository's
[`samples` folder](https://github.com/open-music-sdk/js/tree/main/samples).

## Run one

You need Node 24, pnpm, [a MusicKit key](./guides/musickit-key), and an Apple Account with an Apple Music
subscription.

1. Clone the repository, and install from its root:

   ```sh
   git clone https://github.com/open-music-sdk/js.git open-music-sdk
   cd open-music-sdk
   pnpm install
   ```

2. Copy `samples/.env.example` to the server sample you run, as `.env`, and fill it in:
   `samples/express-server/.env` or `samples/worker-server/.env`.

3. Run a page with a server, from the repository's root:

   ```sh
   pnpm turbo dev --filter=web-vanilla --filter=express-server
   ```

4. Open `http://localhost:2728` in your browser. Use `localhost`, not `127.0.0.1`: the developer token is bound to
   that origin.

5. Sign out before you stop. Apple's script keeps a copy of your Music User Token in the storage of
   `localhost:2728`, which any other app you later serve on that port could read.

Any page runs with any server: swap `express-server` for `worker-server` to run the Worker instead.

::: warning Keep the key in a file named `.env`
The file you copied holds your private key. The repository ignores it, and the page's dev server refuses to serve
it. The Worker reads `.env` rather than Wrangler's usual `.dev.vars` for that reason: the dev server would serve a
`.dev.vars` to any page that asked for it.
:::

## The samples

| Sample | Runs on | Shows |
| --- | --- | --- |
| [`express-server`](https://github.com/open-music-sdk/js/tree/main/samples/express-server) | Node 24 and Express 5 | `createServerClient`, `tokenEndpoint` mounted on Express, `acceptUserToken` behind Express's body parser, `MemoryUserTokenStore`, `forUser` |
| [`worker-server`](https://github.com/open-music-sdk/js/tree/main/samples/worker-server) | Cloudflare Workers, through Wrangler on your machine | `tokenEndpoint`, `userTokenIntake`, `KvUserTokenStore`, `forUser` |
| [`web-vanilla`](https://github.com/open-music-sdk/js/tree/main/samples/web-vanilla) | A page built with Vite, with no framework | `createBrowserClient`, `createConnect`, `previewPlayer`, the catalog, the listener's library, and the playlist tools |

The two servers answer the same routes. Each page sample has the same screens, in files of the same names, so
two page samples side by side show what a framework changes. Each file starts with a comment that names the
exports it shows and the guide it pairs with.

## How a page and its server talk

Both servers listen on `127.0.0.1:8787` and answer the same routes. The page's dev server forwards `/api` to
whichever one runs, so the page and its server share one origin, and the page's `tokenUrl` stays relative.

| Route | What it does | Guide |
| --- | --- | --- |
| `GET /api/music/token` | Hands the page a developer token, bound to the page's origin | [Serve a developer token to a page](./guides/token-endpoint) |
| `POST /api/music/user-token` | Takes the listener's Music User Token after Apple's sign-in, checks it with Apple, and keeps it | [Keep a listener's token on your server](./guides/store-user-tokens) |
| `GET /api/me/recent` | What the listener played lately, asked by the server with the token it kept | [Keep a listener's token on your server](./guides/store-user-tokens) |

A listener is a random id in a cookie the server gives with its first answer. A real app uses its own sessions.

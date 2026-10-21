# Sample apps

The repository has one small app, Vinyl Collector Simulator, written once per way of using the SDK. You flip
through crates of Apple's catalog, play the previews, sign in with Apple Music, and send your own crate of songs to
your library as a playlist. It's a demo: there are no accounts, your crate lives in the tab, and nothing is built to
be deployed.

Each sample runs on your machine against the live Apple Music API, with your own MusicKit key and Apple Account.
The guides show code from them, and every sample is in the repository's
[`samples` folder](https://github.com/open-music-sdk/js/tree/main/samples).

## Run one

You need Node 24, pnpm, [a MusicKit key](./guides/musickit-key), and an Apple Account with an Apple Music
subscription.

Pick the client and the server to run. Either Vite page runs with either server, and the Next app is both: it's its
own server.

<FrameworkPicker />

### 1. Get the repository

Clone it, and install from its root:

```sh
git clone https://github.com/open-music-sdk/js.git open-music-sdk
cd open-music-sdk
pnpm install
```

### 2. Add your key

Copy `samples/.env.example` to the server you run, and fill it in:

::: for server=express
```sh
cp samples/.env.example samples/express-server/.env
```
:::

::: for server=workers
```sh
cp samples/.env.example samples/worker-server/.env
```

The Worker reads `.env` rather than Wrangler's usual `.dev.vars`. The page's dev server refuses to serve a file
named `.env`, and would serve a `.dev.vars` to any page that asked for it.
:::

::: for server=nextjs
```sh
cp samples/.env.example samples/web-nextjs/.env.local
```
:::

The file holds your private key. The repository ignores it, and neither the Vite pages' dev server nor Next serves
it. Never commit it.

### 3. Run the pair

From the repository's root. Turborepo builds the packages first:

::: for client=vanilla server=express
```sh
pnpm turbo dev --filter=web-vanilla --filter=express-server
```
:::

::: for client=vanilla server=workers
```sh
pnpm turbo dev --filter=web-vanilla --filter=worker-server
```
:::

::: for client=react server=express
```sh
pnpm turbo dev --filter=web-react --filter=express-server
```
:::

::: for client=react server=workers
```sh
pnpm turbo dev --filter=web-react --filter=worker-server
```
:::

::: for client=nextjs server=nextjs
```sh
pnpm turbo dev --filter=web-nextjs
```
:::

Every page sample serves on `localhost:2728`, so only one runs at a time.

The build writes the generated files under `packages/types/src` and `packages/validate/src` again, with LF line
endings. On a checkout with CRLF endings, git then shows them changed with nothing in them changed;
`git checkout -- packages/types/src packages/validate/src` puts them back.

### 4. Open it

Open `http://localhost:2728` in your browser. Use `localhost`, not `127.0.0.1`: the developer token is bound to that
origin.

### 5. Stop it

Sign out before you stop. Apple's script keeps a copy of your Music User Token in the storage of `localhost:2728`,
which any other app you later serve on that port could read.

Then press Ctrl+C in the terminal. On Windows, Turborepo can stay at "tasks shutting down…" after the first one,
with a `Terminate batch job (Y/N)?` line for each task: pnpm's own command is a batch file there, and the question
it leaves waits for an answer nobody can give. Press Ctrl+C again, and Turborepo ends the tasks. The
`ELIFECYCLE … -1073741510` beside each question is Windows' code for a program that Ctrl+C ended, not an error.

::: for server=workers
On Windows, Wrangler's `workerd` can outlive the run. If `127.0.0.1:8787` is still taken, end it in PowerShell:

```powershell
Get-Process workerd -ErrorAction SilentlyContinue | Stop-Process
```

The Worker keeps the tokens it took in `samples/worker-server/.wrangler/state`, in plain text, after it stops.
Delete that folder when you're done.
:::

::: for server=express,nextjs
The server forgets the tokens it took when it stops.
:::

## The samples

| Sample | Runs on | Shows |
| --- | --- | --- |
| [`express-server`](https://github.com/open-music-sdk/js/tree/main/samples/express-server) | Node 24 and Express 5 | `createServerClient`, `tokenEndpoint` mounted on Express, `acceptUserToken` behind Express's body parser, `MemoryUserTokenStore`, `forUser` |
| [`worker-server`](https://github.com/open-music-sdk/js/tree/main/samples/worker-server) | Cloudflare Workers, through Wrangler on your machine | `tokenEndpoint`, `userTokenIntake`, `KvUserTokenStore`, `forUser` |
| [`web-vanilla`](https://github.com/open-music-sdk/js/tree/main/samples/web-vanilla) | A page built with Vite, with no framework | `createBrowserClient`, `createConnect`, `previewPlayer`, the catalog, the listener's library, and the playlist tools |
| [`web-react`](https://github.com/open-music-sdk/js/tree/main/samples/web-react) | A React page built with Vite, with TanStack Query | `MusicProvider`, `useConnect`, `usePreviewPlayer`, `useMusicQueries` with `useQuery` and `useInfiniteQuery`, `useMutation` over `useMusic` |
| [`web-nextjs`](https://github.com/open-music-sdk/js/tree/main/samples/web-nextjs) | Next.js 16, its own server | Server components and server actions through `forUser`, `tokenEndpoint` and `userTokenIntake` as routes, `musicQueries` prefetched, `"use cache"`, `next/image` with `artworkUrl` |

The two servers answer the same routes. Each page sample has the same crates and screens, and the two Vite pages
keep them in files of the same names, so two samples side by side show what a framework changes. Each file starts
with a comment that names the exports it shows and the guide it pairs with.

Every pair, for reference:

| Page | Server | Key file | Command, from the repository's root |
| --- | --- | --- | --- |
| Vanilla | Express | `samples/express-server/.env` | `pnpm turbo dev --filter=web-vanilla --filter=express-server` |
| Vanilla | Workers | `samples/worker-server/.env` | `pnpm turbo dev --filter=web-vanilla --filter=worker-server` |
| React | Express | `samples/express-server/.env` | `pnpm turbo dev --filter=web-react --filter=express-server` |
| React | Workers | `samples/worker-server/.env` | `pnpm turbo dev --filter=web-react --filter=worker-server` |
| Next.js | Next.js | `samples/web-nextjs/.env.local` | `pnpm turbo dev --filter=web-nextjs` |

## How a page and its server talk

Both servers listen on `127.0.0.1:8787` and answer the same routes. The page's dev server forwards `/api` to
whichever one runs, so the page and its server share one origin, and the page's `tokenUrl` stays relative.

| Route | What it does | Guide |
| --- | --- | --- |
| `GET /api/music/token` | Hands the page a developer token, bound to the page's origin | [Serve a developer token to a page](./guides/token-endpoint) |
| `POST /api/music/user-token` | Takes the listener's Music User Token after Apple's sign-in, checks it with Apple, and keeps it | [Keep a listener's token on your server](./guides/store-user-tokens) |
| `GET /api/me/recent` | What the listener played lately, asked by the server with the token it kept | [Keep a listener's token on your server](./guides/store-user-tokens) |

A listener is a random id in a cookie the server gives with its first answer. A real app uses its own sessions.

The Next app answers the first two routes under its own `src/app/api`, and needs no third: its pages ask Apple for the
listener on the server, with the token the second route kept.

# Set up your server

Your server holds your MusicKit key. It signs developer tokens, hands them to your pages, and calls Apple for a
listener who has signed in. In this guide you add the SDK to it, give it your key, make its one client, and run it.

Before you start, you need:

- your MusicKit private key, key ID and team ID. See [Set up your MusicKit key](./musickit-key).

The code below comes from the [sample apps](../samples)' servers, for the server you pick in the nav: Express,
Cloudflare Workers, or a Next.js app, which is its own server.

## 1. Install the package

::: for server=express
```sh
pnpm add @open-music-sdk/server express
```
:::

::: for server=workers
```sh
pnpm add @open-music-sdk/server
```

The package runs on Workers as it is. It needs nothing but `fetch` and WebCrypto, which Workers have.
:::

::: for server=nextjs
```sh
pnpm add @open-music-sdk/server @open-music-sdk/react
```

Route handlers, server components and server actions use `@open-music-sdk/server`, which can hold your private
key. Client components use `@open-music-sdk/react`, which can't.

`@open-music-sdk/react` puts the `"use client"` directive on the one file that holds `MusicProvider` and the
hooks, and on nothing else. So what else it exports, such as `artworkImage`, `isAppleMusicError` or
`musicQueries`, carries no directive, and you can import it into a route handler or a server component too.
:::

## 2. Give it your key

The SDK reads no environment variable and no file: your server reads the key and its two IDs, and hands them
over. These docs keep them in three variables, with a fourth for the origin your pages are served from, which every
developer token your server hands out is bound to:

```dotenv
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT…\n-----END PRIVATE KEY-----"
APPLE_MUSIC_TEAM_ID="ABCDE12345"
APPLE_MUSIC_KEY_ID="ABC123DEFG"
PAGE_ORIGIN="http://localhost:2728"
```

The key is the contents of the `.p8` file on one line, with each line break written as `\n`, which the SDK reads.

::: for server=express
On your machine, put them in a `.env` file beside your server's `package.json`, and have Node load it:

```sh
node --env-file=.env src/server.ts
```

Node 24 runs TypeScript as it is, so the server needs no build.
:::

::: for server=workers
On your machine, put them in a `.dev.vars` file beside your Wrangler config, which `wrangler dev` reads.

If a Vite dev server runs in the same repository, as a page's often does, name the file `.env` instead, which
`wrangler dev` reads when there is no `.dev.vars`. Vite's dev server serves any file in the repository to a page
that asks for it, except those on its deny list, and that list names `.env` but not `.dev.vars`. The
[sample apps](../samples) do this.

A deployed Worker takes them as secrets instead: see [Deploy a Worker](./cloudflare-workers).
:::

::: for server=nextjs
On your machine, put them in `.env.local` beside your `package.json`. Next loads it for your server's code, and
hands none of it to the page unless a name starts with `NEXT_PUBLIC_`, which these must never do.
:::

::: warning Never commit the file
It holds your private key. Add it to `.gitignore` before you write the key into it.
:::

## 3. Make its client once

:::: for server=express
Make one client for the whole server, as it starts. The Express sample reads its settings first, so a missing one
stops the server at once, with the setting's name:

<<< @/../../samples/express-server/src/server.ts#server-client{ts}

`MemoryUserTokenStore` keeps listeners' tokens in the process, and loses them when it stops. See
[Choose a store](./store-user-tokens#choose-a-store) for one that lasts.

Then make the app, and listen. The sample's app refuses a request sent by any name but its own or the page's, and
listens on your machine's loopback address alone. The routes go between the two, as
[Serve a developer token to a page](./token-endpoint) and [Keep a listener's token on your server](./store-user-tokens)
show:

::: code-group

<<< @/../../samples/express-server/src/server.ts#app{ts} [app]

<<< @/../../samples/express-server/src/server.ts#listen{ts} [listen]

:::

::::

:::: for server=workers
A Worker is handed its secrets with each request, in `env`. Make the client from them on the first request, and
keep it in a module variable, as `app ??= setUp(env)` does:

::: code-group

<<< @/../../samples/worker-server/src/index.ts#fetch{ts} [fetch]

<<< @/../../samples/worker-server/src/index.ts#server-client{ts} [setUp]

:::

Don't make it per request. A client made per request imports the key and signs a new token on every request. One
kept in the module signs a token once, reuses it for every request the isolate serves, and replaces it in the
background halfway through its life.

The Worker keeps listeners' tokens in a Workers KV namespace, bound in its Wrangler config as `MUSIC_USER_TOKENS`:

<<< @/../../samples/worker-server/wrangler.jsonc{jsonc}
::::

::: for server=nextjs
Make one client for your whole server, in a module only server code imports. The Next sample makes it, with its
store of listeners' tokens, in `src/lib/music.ts`:

<<< @/../../samples/web-nextjs/src/lib/music.ts{ts}

- The client is made the first time it's asked for, not as the module loads. `next build` loads every route's
  modules with no key in its environment, and builds nothing that needs one.
- It's kept on `globalThis`, because Next can load the module more than once, in each route's bundle and again
  after an edit. Every copy has to find the same tokens.

`MemoryUserTokenStore` keeps tokens in one process only, and loses them on restart. If your app runs on more than
one instance, or on serverless functions, use a store they all reach. See
[Choose a store](./store-user-tokens#choose-a-store).
:::

The client signs one developer token, uses it for every request, and signs the next before it runs out. Its
`rateLimit` is shared by every request your server makes for every listener, since they all spend the same token's
limit.

## 4. Run it

::: for server=express
```sh
node --env-file=.env --watch src/server.ts
```

The Express sample listens on `127.0.0.1:8787` alone, so nothing but your own machine reaches it.
:::

::: for server=workers
```sh
npx wrangler dev
```

`wrangler dev` keeps the KV namespace's data on your machine, in `.wrangler/state`, in plain text. Delete the folder
when you're done.
:::

::: for server=nextjs
```sh
pnpm next dev --port 2728
```

Your server and your pages run as one app, on one origin: the port of `PAGE_ORIGIN`.
:::

A server with no routes does nothing for a page yet. Its first route hands your pages a developer token.

## Next steps

- [Serve a developer token to a page](./token-endpoint), the route every page needs.
- [Set up your client](./client-setup), the page that uses it.
- [Keep a listener's token on your server](./store-user-tokens), to call Apple for a listener from your server.
- The reference for [`createServerClient`](../reference/@open-music-sdk/server/functions/createServerClient).

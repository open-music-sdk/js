# Set up your client

Your page calls Apple with a client that fetches its developer token from your server. In this guide you add the
SDK to your page, let it reach your server, make its one client, and make a first request.

Before you start, you need:

- a server with a route that hands out developer tokens. See [Set up your server](./server-setup) and
  [Serve a developer token to a page](./token-endpoint).

The code below is for the client you pick in the nav: a page with no framework, a React app on Vite, or a Next.js
app.

## 1. Install the package

::: for client=vanilla
```sh
pnpm add @open-music-sdk/browser
pnpm add -D vite
```

Vite serves the page while you work, and builds it.
:::

::: for client=react
```sh
pnpm add @open-music-sdk/react @tanstack/react-query react react-dom
pnpm add -D vite @vitejs/plugin-react
```

Vite serves the page while you work, and builds it. `@open-music-sdk/react` doesn't depend on TanStack Query. It gives the objects TanStack Query's hooks take, so the
examples here use it, as the [React sample](../samples) does.
:::

::: for client=nextjs
You installed `@open-music-sdk/react` with the server's package in [Set up your server](./server-setup). Add
TanStack Query, whose hooks the examples here use:

```sh
pnpm add @tanstack/react-query
```
:::

## 2. Let it reach your server

::: for client=vanilla,react
Serve the page from the origin your server's developer tokens are bound to, its `PAGE_ORIGIN`, and forward `/api`
to your server, so that the page and its server share one origin. The Vite samples' config does both, and refuses to
serve your key or any other secret in the repository to a page that asks:

<<< @/../../samples/web-vanilla/vite.config.ts{ts}

Port 2728 is the page's own. Apple's script keeps a listener's token in the storage of the page's origin, which
another app served on the same port could read.
:::

::: for client=nextjs
A Next app is its own server. Its pages and its routes share one origin, so the token route is at
`/api/music/token`, with nothing to forward. Run it on the port of `PAGE_ORIGIN`, on your machine alone:

```sh
pnpm next dev --port 2728 --hostname localhost
```
:::

## 3. Make the page's client once

::: for client=vanilla
Make one client for the page, in a module the rest of the page imports. In `src/music.ts`:

```ts
import { createBrowserClient } from "@open-music-sdk/browser";

export const music = createBrowserClient({
  tokenUrl: "/api/music/token",
  storefront: "us",
});
```
:::

::: for client=react
Make the client once, outside the tree, and hand it to `MusicProvider`, inside TanStack Query's
`QueryClientProvider`. In `src/main.tsx`:

```tsx
import { MusicProvider, createBrowserClient } from "@open-music-sdk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const music = createBrowserClient({
  tokenUrl: "/api/music/token",
  storefront: "us",
});
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MusicProvider music={music}>
      <App />
    </MusicProvider>
  </QueryClientProvider>,
);
```

Components get the client from the provider, with `useMusic()`.
:::

::: for client=nextjs
Client components get their client from `MusicProvider`. Make the page's client once, outside the tree, in a
client component of its own. In `src/components/providers.tsx`:

```tsx
"use client";
import { MusicProvider, createBrowserClient } from "@open-music-sdk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const music = createBrowserClient({
  tokenUrl: "/api/music/token",
  storefront: "us",
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <MusicProvider music={music}>{children}</MusicProvider>
    </QueryClientProvider>
  );
}
```

Then wrap your layout in it. In `src/app/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

The provider holds the listener's token in React state, in memory only. Never hand it a token as a prop from a
server component: a prop from a server component is written into the page. The token arrives through
`useConnect`, as [Sign a listener in](./sign-in) shows.
:::

`storefront` is the [storefront](../glossary#storefront) the catalog is read in. The client fetches a developer
token from `tokenUrl` the first time a request needs one, and fetches the next before that one runs out.

## 4. Make a first request

::: for client=vanilla
Read an album from the catalog, and show its name. In `src/main.ts`:

```ts
import { music } from "./music";

const album = await music.catalog.getAlbum("1613600183");
const heading = document.querySelector("h1");
if (heading) heading.textContent = album.attributes?.name ?? "";
```
:::

::: for client=react
In a component, `useMusicQueries()` gives every read function of the catalog as a query:

```tsx
import { useMusicQueries } from "@open-music-sdk/react";
import { useQuery } from "@tanstack/react-query";

export function Album({ id }: { id: string }) {
  const queries = useMusicQueries();
  const { data: album } = useQuery(queries.catalog.getAlbum(id));
  return <h1>{album?.attributes?.name}</h1>;
}
```

Render it from `App`, as `<Album id="1613600183" />`.
:::

::: for client=nextjs
A server component reads the catalog with the server's client, which signs its own token. A new Next 16 app has
Cache Components turned on, so a read made at each request goes inside `<Suspense>`, after `await connection()`.
In `src/app/album/[id]/page.tsx`:

```tsx
import { connection } from "next/server";
import { Suspense } from "react";
import { getMusic } from "@/lib/music";

type tParams = Promise<{ id: string }>;

export default function AlbumPage({ params }: { params: tParams }) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Album params={params} />
    </Suspense>
  );
}

async function Album({ params }: { params: tParams }) {
  await connection();
  const { id } = await params;
  const album = await getMusic().catalog.getAlbum(id);
  return <h1>{album.attributes?.name}</h1>;
}
```

The client reads the clock to keep its developer token fresh. Next refuses that while it draws a page ahead of
time, and stops with an error that names `Date.now()`, so `await connection()` makes the read wait for a request.
The page's own client is for what runs in the browser: the listener's sign-in, previews, and queries.
:::

## 5. Open it

::: for client=vanilla
Give the page an `index.html` beside `package.json`, with the heading the code fills in, and start Vite:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>An album</title>
  </head>
  <body>
    <h1></h1>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```sh
pnpm vite
```
:::

::: for client=react
Give the page an `index.html` beside `package.json`, with the element React draws into, and start Vite:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>An album</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```sh
pnpm vite
```
:::

::: for client=nextjs
`next dev`, from step 2, serves the page.
:::

Open `http://localhost:2728`, with your server running too. The album's name on the page means the whole path works,
from your key to Apple.

## Next steps

- [Sign a listener in](./sign-in), to read and change a listener's library.
- [Play song previews](./previews) and [Show artwork](./artwork).
- [Handle errors](./errors), for what a request can end in.
- The reference for [`createBrowserClient`](../reference/@open-music-sdk/browser/functions/createBrowserClient).

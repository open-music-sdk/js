# Next.js

In this guide you set up a Next.js app with the App Router: routes that hand pages a developer token and take in
a listener's token, client components that sign listeners in, server components that read the catalog, and server
actions that act for a listener.

Before you start, you need:

- your MusicKit private key, key ID and team ID, in your app's environment. See
  [Set up your MusicKit key](./musickit-key).
- a Next.js 16 app that uses the App Router.
- a session of your own, which tells your server who is signed in.

The [Next sample](../samples) is this setup whole, and the code below comes from it. `next build` runs it in CI
with no key in its environment.

## 1. Install the two packages

```
pnpm add @open-music-sdk/server @open-music-sdk/react
```

Route handlers, server components and server actions use `@open-music-sdk/server`, which can hold your private
key. Client components use `@open-music-sdk/react`, which can't.

`@open-music-sdk/react` puts the `"use client"` directive on the one file that holds `MusicProvider` and the
hooks, and on nothing else. So what else it exports, such as `artworkImage`, `isAppleMusicError` or
`musicQueries`, carries no directive, and you can import it into a route handler or a server component too. The
sample does, in its album page and its server actions.

## 2. Make the server's client once

Make one client for your whole server, in a module that only server code imports. The sample makes it, with its
store of listeners' tokens, in `lib/music.ts`:

<<< @/../../samples/web-nextjs/lib/music.ts{ts}

- The client is made the first time it's asked for, not as the module loads. `next build` loads every route's
  modules with no key in its environment, and builds nothing that needs one.
- It's kept on `globalThis`, because Next can load the module more than once, in each route's bundle and again
  after an edit. Every copy has to find the same tokens.

`MemoryUserTokenStore` keeps tokens in one process only, and loses them on restart. If your app runs on more than
one instance, or on serverless functions, use a store they all reach. See
[Keep a listener's token on your server](./store-user-tokens).

## 3. Add the token route

A page fetches its developer token from a route on your server. In `app/api/music/token/route.ts`:

<<< @/../../samples/web-nextjs/app/api/music/token/route.ts#token-route{ts}

`await connection()` tells Next the route answers each request as it comes, so it's never prerendered.

::: warning Never let Next prerender the token route
A token minted at build time would be served to everyone who asks, from the build's output.
:::

[Serve a developer token to a page](./token-endpoint) explains `origin`, and what limits who can take tokens from
this route.

## 4. Add the route that takes a listener's token

After a listener signs in, your page posts their Music User Token to your server, which checks it with Apple and
keeps it. In `app/api/music/user-token/route.ts`:

<<< @/../../samples/web-nextjs/app/api/music/user-token/route.ts#user-token{ts}

`userId` decides whose token this is, so it must return the signed-in user from your own session, and nothing
when there is none. The sample's `sessionId` reads its session cookie. [Keep a listener's token on your
server](./store-user-tokens) covers what the route answers and what the page sends.

When the listener signs out, the sample's page sends a `DELETE` to the same route, after Apple's sign-out:

<<< @/../../samples/web-nextjs/app/api/music/user-token/route.ts#sign-out{ts}

::: warning Who can post a token
Read the warnings in [Mount the intake route](./store-user-tokens#_2-mount-the-intake-route) before you deploy
this route: on `userId`, on your CORS policy, and on rate-limiting it.
:::

## 5. Wrap the app in `MusicProvider`

Client components get their client from `MusicProvider`. Make the page's client once, outside the tree, in a
client component of its own. In `app/providers.tsx`:

```tsx
"use client";
import { MusicProvider, createBrowserClient } from "@open-music-sdk/react";
import type { ReactNode } from "react";

const music = createBrowserClient({
  tokenUrl: "/api/music/token",
  storefront: "us",
});

export function Providers({ children }: { children: ReactNode }) {
  return <MusicProvider music={music}>{children}</MusicProvider>;
}
```

Then wrap your layout in it. In `app/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { Providers } from "./providers";

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

In the sample, the server acts for the listener. Its sign-in posts the token to the route of step 4, has the
provider forget it, and loads the page again. `router.refresh()` would draw only the route that is open: Next keeps
the pages visited before, hidden, for Back, as they were drawn for no one. Sign-out loads the page again for the
same reason. Apple's script still keeps its own copy of the token in the page's storage until the sign-out, as on any
page: see [In a page](../concepts/security#in-a-page) in the security model.

<<< @/../../samples/web-nextjs/app/sign-in.tsx#after-sign-in{tsx}

## 6. Read the catalog in a server component

A server component reads the catalog with the server's client. A new Next 16 app has Cache Components turned on,
so a read made at each request goes inside `<Suspense>`, after `await connection()`. In
`app/album/[id]/page.tsx`:

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
The sample awaits it once, in the function each of its pages calls first to find the listener. A read marked
`"use cache"` needs none: see step 8.

Reading the catalog needs only the developer token, which the server's client signs for itself.

## 7. Act for a listener in a server action

A server action finds the listener's token in your store with `music.forUser(userId)`. In `app/actions.ts`:

<<< @/../../samples/web-nextjs/app/actions.ts#add-to-library{ts}

The client looks the token up in the store at each request. A listener the store has no token for gets a
`UserTokenInvalid` error, as does one whose token Apple answers `403` to. Either way, ask them to sign in again.

`answer` hands back Apple's error in words, as `{ ok: false, said }`, rather than throwing it: in production, Next
keeps a thrown error's message from the page. The page says what the action answered.

Every server action is a `POST` that anyone can send. The sample's actions check each argument before they act,
and act only for the session that sent the request.

A listener who isn't signed in to Apple Music, or has no subscription, can get a `401` instead, which arrives as
`DeveloperTokenInvalid`. `validateUserToken` tells it apart from a developer token Apple refuses. See
[Handle errors](./errors).

## 8. Cache catalog reads

The client sends every request through the `fetch` it's given, so Next's caching applies the usual ways: pass a
`fetch` of your own to `createServerClient`, or wrap a read in a function marked `"use cache"`. In the sample's
`lib/catalog.ts`:

<<< @/../../samples/web-nextjs/lib/catalog.ts#cache-catalog{ts}

`"use cache"` needs Cache Components, turned on in `next.config.ts`:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

export default config;
```

See [Next's documentation](https://nextjs.org/docs/app/api-reference/directives/use-cache).

Cache catalog reads, which are the same for everyone in a storefront. A listener's library is theirs alone, so
don't cache it this way.

## Next steps

- [Serve a developer token to a page](./token-endpoint), for the token route's options and its limits.
- [Keep a listener's token on your server](./store-user-tokens), for the store and the user-token route.
- [TanStack Query](./tanstack-query), to fetch in client components and prefetch the catalog on the server.
- [Sign a listener in](./sign-in), with `useConnect`.
- [Show artwork](./artwork#with-next-image), with `next/image`.

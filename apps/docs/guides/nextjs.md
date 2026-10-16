# Next.js

In this guide you set up a Next.js app with the App Router: routes that hand pages a developer token and take in
a listener's token, client components that sign listeners in, server components that read the catalog, and server
actions that act for a listener.

Before you start, you need:

- your MusicKit private key, key ID and team ID, in your app's environment. See
  [Set up your MusicKit key](./musickit-key).
- a Next.js app that uses the App Router.
- a session of your own, which tells your server who is signed in.

::: info Not yet tried in a Next build
This recipe hasn't been through a Next.js build yet, and neither has importing from `@open-music-sdk/react` into
server code, as step 1 describes. The Next sample app is where both will be proven.
:::

## 1. Install the two packages

```
pnpm add @open-music-sdk/server @open-music-sdk/react
```

Route handlers, server components and server actions use `@open-music-sdk/server`, which can hold your private
key. Client components use `@open-music-sdk/react`, which can't.

`@open-music-sdk/react` puts the `"use client"` directive on the one file that holds `MusicProvider` and the
hooks, and on nothing else. So what else it exports, such as `artworkImage`, `isAppleMusicError` or
`musicQueries`, carries no directive, and you can import it into a route handler or a server component too.

## 2. Make the server's client once

Make one client for your whole server, in a module that only server code imports. Here it's `lib/music.ts`:

```ts
import { createServerClient, type tUserTokenStore } from "@open-music-sdk/server";

// Where listeners' tokens are kept, reachable from every instance of your server.
export const store: tUserTokenStore = createTokenStore();

export const music = createServerClient({
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
  storefront: "us",
  userTokenStore: store,
});
```

`createTokenStore`, `sessionUserId` and `currentUserId` in this guide stand for your own code.

`MemoryUserTokenStore` keeps tokens in one process only, and loses them on restart. If your app runs on more than
one instance, or on serverless functions, use a store they all reach. See
[Keep a listener's token on your server](./store-user-tokens).

## 3. Add the token route

A page fetches its developer token from a route on your server. In `app/api/music/token/route.ts`:

```ts
import { connection } from "next/server";
import { tokenEndpoint } from "@open-music-sdk/server";

const token = tokenEndpoint({
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
  origin: ["https://app.example"],
});

export async function GET(req: Request) {
  await connection();
  return token(req);
}
```

`await connection()` tells Next the route answers each request as it comes, so it's never prerendered.

::: warning Never let Next prerender the token route
A token minted at build time would be served to everyone who asks, from the build's output.
:::

[Serve a developer token to a page](./token-endpoint) explains `origin`, and what limits who can take tokens from
this route.

## 4. Add the route that takes a listener's token

After a listener signs in, your page posts their Music User Token to your server, which checks it with Apple and
keeps it. In `app/api/music/user-token/route.ts`:

```ts
import { userTokenIntake } from "@open-music-sdk/server";
import { music, store } from "@/lib/music";

export const POST = userTokenIntake(music, { store, userId: (req) => sessionUserId(req) });
```

`userId` decides whose token this is, so it must return the signed-in user from your own session, and nothing
when there is none. [Keep a listener's token on your server](./store-user-tokens) covers what the route answers
and what the page sends.

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

const music = createBrowserClient({ tokenUrl: "/api/music/token", storefront: "us" });

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

## 6. Read the catalog in a server component

A server component reads the catalog with the server's client. In `app/album/[id]/page.tsx`:

```tsx
import { music } from "@/lib/music";

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const album = await music.catalog.getAlbum(id);
  return <h1>{album.attributes?.name}</h1>;
}
```

Reading the catalog needs only the developer token, which the server's client signs for itself.

## 7. Act for a listener in a server action

A server action finds the listener's token in your store with `music.forUser(userId)`. In `app/actions.ts`:

```ts
"use server";
import { isAppleMusicError } from "@open-music-sdk/server";
import { music } from "@/lib/music";

export async function addToLibrary(songId: string): Promise<"added" | "sign-in-again"> {
  const userId = await currentUserId();
  try {
    await music.forUser(userId).user.addToLibrary({ songs: [songId] });
    return "added";
  } catch (e) {
    if (isAppleMusicError(e, "UserTokenInvalid")) return "sign-in-again";
    throw e;
  }
}
```

The client looks the token up in the store at each request. A listener the store has no token for gets a
`UserTokenInvalid` error, as does one whose token Apple answers `403` to. Either way, ask them to sign in again.

A listener who isn't signed in to Apple Music, or has no subscription, can get a `401` instead, which arrives as
`DeveloperTokenInvalid` and which this action rethrows. `validateUserToken` tells it apart from a developer token
Apple refuses. See [Handle errors](./errors).

## 8. Cache catalog reads

The client sends every request through the `fetch` it's given, so Next's caching applies the usual ways: pass a
`fetch` of your own to `createServerClient`, or wrap a read in a function marked `"use cache"`. In
`lib/catalog.ts`:

```ts
import { music } from "./music";

export async function getAlbum(id: string) {
  "use cache";
  return music.catalog.getAlbum(id);
}
```

`"use cache"` has to be turned on in your Next config. See
[Next's documentation](https://nextjs.org/docs/app/api-reference/directives/use-cache).

Cache catalog reads, which are the same for everyone in a storefront. A listener's library is theirs alone, so
don't cache it this way.

## Next steps

- [Serve a developer token to a page](./token-endpoint), for the token route's options and its limits.
- [Keep a listener's token on your server](./store-user-tokens), for the store and the user-token route.
- [TanStack Query](./tanstack-query), to fetch in client components and prefetch the catalog on the server.
- [Sign a listener in](./sign-in), with `useConnect`.

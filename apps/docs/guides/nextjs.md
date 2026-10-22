---
for: client=nextjs server=nextjs
---

# Use server actions and caching in Next.js

In a Next.js app, your server can do what a page would otherwise do for itself. In this guide you act for a
listener in a server action, and cache the catalog reads that are the same for everyone.

Before you start, you need:

- a client on your server that finds each listener's token in a store, made on first use rather than as its module
  loads, since `next build` loads it with no key. See [Set up your server](./server-setup).
- a route that stores each listener's token under your own session's id. See
  [Keep a listener's token on your server](./store-user-tokens).

In the code below, `getMusic()` returns that client. `sessionId()` is your own session lookup: it resolves to the
signed-in user's id, or `undefined` when there's none. `explain(e)` puts an Apple Music error in words the listener
can act on.

The [Next sample](../samples) acts and caches this way, and the code below comes from it. `next build` runs it in
CI with no key in its environment.

## 1. Act for a listener in a server action

A server action finds the listener's token in your store with `getMusic().forUser(userId)`. Write it in a file
that starts with `"use server"`, here `src/lib/actions.ts`.

In the code below, `libraryIds(kind, id)` checks what the page sent, and returns the ids `addToLibrary` takes, such
as `{ songs: [id] }`, or `undefined`. `SIGN_IN_FIRST` is the answer
`{ ok: false, said: "Sign in with Apple Music first." }`, and `tAnswer<T>` is `{ ok: true, value: T }` or
`{ ok: false, said: string }`:

<<< @/../../samples/web-nextjs/src/lib/actions.ts#add-to-library{ts}

The client looks the token up in the store at each request. A listener the store has no token for gets a
`UserTokenInvalid` error, as does one whose token Apple answers `403` to. Either way, ask them to sign in again.

`answer` hands back Apple's error in words, as `{ ok: false, said }`, rather than throwing it: in production, Next
keeps a thrown error's message from the page. The page says what the action answered.

Every server action is a `POST` that anyone can send. Check each argument before you act, as `libraryIds` does
here, and act only for the session that sent the request.

A listener who isn't signed in to Apple Music, or has no subscription, can get a `401` instead, which arrives as
`DeveloperTokenInvalid`. `validateUserToken` tells it apart from a developer token Apple refuses. See
[Handle errors](./errors).

## 2. Cache catalog reads

The client sends every request through the `fetch` it's given, so Next's caching applies the usual ways: pass a
`fetch` of your own to `createServerClient`, or wrap a read in a function marked `"use cache"`. In a server module,
here `src/lib/catalog.ts`, where `cacheLife`, from `next/cache`, sets how long Next keeps what the function gives:

<<< @/../../samples/web-nextjs/src/lib/catalog.ts#cache-catalog{ts}

A read made for each request, as a page is drawn, needs `await connection()`, from `next/server`, before it: the
client reads the clock to keep its developer token fresh, which a page Next draws ahead may not. A read marked
`"use cache"` needs none: Next runs it once and keeps what it gives. It needs Cache Components, turned on in
`next.config.ts`:

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

- [Read and write with TanStack Query](./tanstack-query), to prefetch the catalog for a client component.
- [Sign a listener in](./sign-in), with `useConnect`.
- [Show artwork](./artwork#with-next-image), with `next/image`.

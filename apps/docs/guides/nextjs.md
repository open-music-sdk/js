---
for: client=nextjs server=nextjs
---

# Act and cache on a Next.js server

In a Next.js app, your server can do what a page would otherwise do for itself. In this guide you act for a
listener in a server action, and cache the catalog reads that are the same for everyone.

Before you start, you need:

- the server's client and the page's provider. See [Set up your server](./server-setup) and
  [Set up your client](./client-setup).
- listeners' tokens kept on your server, under your own session's ids. See
  [Keep a listener's token on your server](./store-user-tokens).

The [Next sample](../samples) acts and caches this way, and the code below comes from it. `next build` runs it in
CI with no key in its environment.

## 1. Act for a listener in a server action

A server action finds the listener's token in your store with `music.forUser(userId)`. In `src/lib/actions.ts`:

<<< @/../../samples/web-nextjs/src/lib/actions.ts#add-to-library{ts}

The client looks the token up in the store at each request. A listener the store has no token for gets a
`UserTokenInvalid` error, as does one whose token Apple answers `403` to. Either way, ask them to sign in again.

`answer` hands back Apple's error in words, as `{ ok: false, said }`, rather than throwing it: in production, Next
keeps a thrown error's message from the page. The page says what the action answered.

Every server action is a `POST` that anyone can send. The sample's actions check each argument before they act,
and act only for the session that sent the request.

A listener who isn't signed in to Apple Music, or has no subscription, can get a `401` instead, which arrives as
`DeveloperTokenInvalid`. `validateUserToken` tells it apart from a developer token Apple refuses. See
[Handle errors](./errors).

## 2. Cache catalog reads

The client sends every request through the `fetch` it's given, so Next's caching applies the usual ways: pass a
`fetch` of your own to `createServerClient`, or wrap a read in a function marked `"use cache"`. In the sample's
`src/lib/catalog.ts`:

<<< @/../../samples/web-nextjs/src/lib/catalog.ts#cache-catalog{ts}

A read marked `"use cache"` needs no `await connection()`, as one made at each request does: Next runs it once and
keeps what it gives. It needs Cache Components, turned on in `next.config.ts`:

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

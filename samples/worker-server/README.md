# worker-server

Vinyl Collector Simulator's server as a Cloudflare Worker, run on your machine by Wrangler. It hands the page a
developer token, takes in the listener's Music User Token and keeps it in Workers KV, and asks Apple for one list with
it.

```sh
cp ../.env.example .env   # then fill it in
pnpm turbo dev --filter=web-vanilla --filter=worker-server   # from the repository's root
```

The KV namespace lives in `.wrangler/state` on your machine. `pnpm build` is a dry run of a deploy, which checks
that the Worker bundles and uploads nothing.

| File | Shows |
| --- | --- |
| [`src/index.ts`](./src/index.ts) | `createServerClient`, `createRateLimiter`, `tokenEndpoint`, `userTokenIntake`, `KvUserTokenStore`, `forUser`, `isAppleMusicError` |
| [`wrangler.jsonc`](./wrangler.jsonc) | The KV binding, and the address the page's dev server forwards to |

It is the Worker that [Set up your server](https://open-music-sdk.github.io/js/guides/server-setup) and the guides
to its two routes show, with a session cookie of its own and `/api/me/recent` for the listener's list. It is never deployed, so the KV
namespace's id in `wrangler.jsonc` is a placeholder.

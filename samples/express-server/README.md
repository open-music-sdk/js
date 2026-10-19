# express-server

Crate Digger's server on Node 24 and Express 5. It hands the page a developer token, takes in the listener's Music
User Token, and asks Apple for one list with the token it kept.

```sh
cp ../.env.example .env   # then fill it in
pnpm turbo dev --filter=web-vanilla --filter=express-server   # from the repository's root
```

Node runs the TypeScript itself, with no build: `node --env-file-if-exists=.env --watch-path=src src/server.ts`.
Variables already in your shell win over the file.

| File | Shows |
| --- | --- |
| [`src/server.ts`](./src/server.ts) | `createServerClient`, `createRateLimiter`, `tokenEndpoint`, `acceptUserToken`, `MemoryUserTokenStore`, `forUser`, `isAppleMusicError` |
| [`src/web.ts`](./src/web.ts) | How a web-standard handler such as `tokenEndpoint` is mounted on Express |

It takes the token with `acceptUserToken` behind `express.json()`, rather than mounting `userTokenIntake`, to show
the step without a web `Request`. [`worker-server`](../worker-server) mounts the intake.

It leaves out lasting storage: `MemoryUserTokenStore` forgets every token when the server stops, so a listener
signs in again after a restart.

# Part 1: The server

Your page needs a server for two things it can't do itself: sign a developer token, which takes your private key,
and keep a listener's Music User Token for requests made on their behalf. In this part you build that server, on
Express, and ask it for a token.

The finished server is [`samples/express-server`](https://github.com/open-music-sdk/js/tree/main/samples/express-server).

## 1. Make the folder

From the repository's root, make a folder for your server and copy in its TypeScript settings:

```sh
mkdir samples/my-server
mkdir samples/my-server/src
cp samples/express-server/tsconfig.json samples/my-server/
```

Then make `samples/my-server/package.json`:

```json
{
  "name": "my-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --env-file-if-exists=.env --watch-path=src src/server.ts"
  },
  "dependencies": {
    "@open-music-sdk/server": "workspace:*",
    "express": "catalog:"
  },
  "devDependencies": {
    "@types/express": "catalog:",
    "@types/node": "catalog:"
  }
}
```

`workspace:*` is the SDK's package from this repository, and `catalog:` is the version the repository uses for
everything else. Node runs the TypeScript itself, with no build. Install, from the root, so that pnpm links the
package to your folder:

```sh
pnpm install
```

pnpm writes your folder into the repository's `pnpm-lock.yaml`. [When you're done](./listener#_8-when-you-re-done)
puts it back.

## 2. Add your key

Copy the example settings into your folder:

```sh
cp samples/.env.example samples/my-server/.env
```

Fill in `samples/my-server/.env` with your key, key ID and team ID. The key goes on one line, with each line break
written as `\n`. Leave `PAGE_ORIGIN` as it is: it's the address your page will run on in part 2.

The repository ignores every `.env`, so this one stays on your machine. Never commit it.

## 3. Copy the server

Copy the finished server's two files:

```sh
cp samples/express-server/src/server.ts samples/my-server/src/
cp samples/express-server/src/web.ts samples/my-server/src/
```

The rest of this part reads `server.ts` with you, a step at a time.

## 4. Make the server's client

The server makes one client, with your key, for every route to share:

<<< @/../../samples/express-server/src/server.ts#server-client{ts}

- `createServerClient` signs its own developer token with your key, and signs a new one before the last runs out.
- `MemoryUserTokenStore` keeps listeners' Music User Tokens in memory, so they're gone when the server stops. A
  real app keeps them somewhere that lasts: see [Keep a listener's token on your server](../guides/store-user-tokens).
- `createRateLimiter` paces the requests. Apple counts every listener's requests against your one developer token.

## 5. Give each listener a session

The server needs to tell one listener from another, to know whose token is whose. A real app has its own sessions.
This one gives each browser a random id in a cookie, the first time it asks for anything under `/api`:

<<< @/../../samples/express-server/src/server.ts#session{ts}

Just above it, the server answers only requests sent to its own address or your page's, so that no other site can
reach it through your browser.

## 6. Hand the page a developer token

The token route signs a short-lived developer token for your page:

<<< @/../../samples/express-server/src/server.ts#token-route{ts}

`tokenEndpoint` takes a web-standard `Request` and returns a `Response`, and Express hands a route Node's own request
instead. `web.ts` carries one across to the other:

<<< @/../../samples/express-server/src/web.ts{ts}

The token names your page's origin, and Apple honours it for requests from a browser. Anyone can still fetch one
from the route: [Serve a developer token to a page](../guides/token-endpoint) says what limits the damage.

## 7. Take in the listener's token

After a listener signs in with Apple, in part 3, your page posts their Music User Token here. The server asks Apple
whether the token works, and keeps it under the listener's session only then:

<<< @/../../samples/express-server/src/server.ts#user-token{ts}

The route takes only JSON, which a form on another site can't send, so no other site can bind its own token to your
listener.

## 8. Forget the token, and act for the listener

When the listener signs out, the page tells the server to forget their token:

<<< @/../../samples/express-server/src/server.ts#sign-out{ts}

And with the token it kept, the server can ask Apple for the listener. Here, what they played lately:

<<< @/../../samples/express-server/src/server.ts#act-for-listener{ts}

`music.forUser(session)` gives a client that finds the listener's token in the store at each request. A listener
it has no token for gets a `UserTokenInvalid` error, which the route answers with `422`.

## 9. Run it

From the root, start your server:

```sh
pnpm turbo dev --filter=my-server
```

Turborepo builds the SDK's packages first, then starts the server, which says:

```
express-server: http://127.0.0.1:8787, handing tokens to http://localhost:2728
```

In another terminal, ask it for a developer token. In PowerShell, write `curl.exe` for `curl`:

```sh
curl http://127.0.0.1:8787/api/music/token
```

It answers with a token, `{"token":"eyJ…"}`, signed with your key. If the server fails to start instead, its error
names the setting it couldn't find in your `.env`. Fill that in, then stop the server with Ctrl+C and start it
again: it restarts when `src` changes, not `.env`.

Stop the server with Ctrl+C. In part 2 you run it together with your page. On Windows, a first Ctrl+C can leave
Turborepo waiting: see [Stop it](../samples#_5-stop-it) on the Samples page.

[Next: the page and the catalog](./page).

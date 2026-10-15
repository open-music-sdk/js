# Set up your MusicKit key

Every request to the Apple Music API carries a [developer token](../glossary#developer-token), and you sign it
with a MusicKit private key. In this guide you get the key and its two IDs from Apple, load them into your app,
and check that Apple accepts the tokens they sign.

Before you start, you need:

- a paid Apple Developer Program membership.
- a server, a worker or a command-line tool to run the SDK in. The key never goes into a web page.

## 1. Create the key

In your Apple Developer account, open Certificates, Identifiers & Profiles:

1. Create a MusicKit identifier. The portal lists it among its media identifiers.
2. Create a private key with MusicKit enabled.
3. Download the key. Apple lets you download it once, as a file named `AuthKey_XXXXXXXXXX.p8`. Keep the file
   somewhere safe: if you lose it, you have to create another key.

## 2. Note the two IDs

- The key ID is the ten characters in the file's name, after `AuthKey_`.
- The team ID is ten characters too. It's on your membership page.

Each is ten capital letters and digits, exactly as Apple issues it. The SDK refuses anything else.

## 3. Load the key into your app

The SDK reads no environment variable and no file. Your app loads the key and its two IDs the way it loads its
other secrets, and hands them over as `pem`, `teamId` and `keyId`. These docs use three environment variables:

```sh
# .env, for local work only
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----"
APPLE_MUSIC_TEAM_ID="ABCDE12345"
APPLE_MUSIC_KEY_ID="FGHIJ67890"
```

`pem` is the text of the `.p8` file. A variable usually holds it on one line, with `\n` for each line break.
The SDK accepts that as it is, and also accepts real line breaks, Windows line endings, a byte order mark, and
whitespace around the key.

The SDK checks what it's handed when you create the client. A missing option, or one that isn't a string, is a
`TypeError` that names the option, so an unset variable fails at startup and not on the first request. No error
repeats the value.

## 4. Keep the key out of your repository

Add the key file and your `.env` file to `.gitignore`:

```sh
# .gitignore
*.p8
.env
```

In production, keep the three values in your platform's secret store, not in a file you deploy. Anyone who holds
the key can sign tokens that spend your whole team's rate limit, and a signed token can't be revoked without
revoking the key.

::: warning Never send the key to a browser
Don't import code that holds the key into anything a page loads. A page gets its developer token from a route on
your server instead: see [Serve a developer token to a page](./token-endpoint).
:::

## 5. Check that it works

On your machine, in a file named `check.mts`:

```ts
import { createServerClient } from "@open-music-sdk/server";

const music = createServerClient({
  pem: process.env.APPLE_MUSIC_PRIVATE_KEY!,
  teamId: process.env.APPLE_MUSIC_TEAM_ID!,
  keyId: process.env.APPLE_MUSIC_KEY_ID!,
  storefront: "us",
});

const album = await music.catalog.getAlbum("1613600183");
console.log(album.attributes?.name);
```

Run it with Node 24 or newer, which runs TypeScript files and reads `.env` files itself:

```sh
node --env-file=.env check.mts
```

It prints the album's name. If it doesn't:

- A `TypeError` that names `developer token` means one of the three values is missing or malformed. A `pem`
  that's a string but not a key fails at the first request rather than at startup.
- An `AppleMusicError` tagged `DeveloperTokenInvalid` means Apple refused the token. Check that the key has
  MusicKit enabled, and that the key ID and team ID belong to it.

## Next steps

- [Serve a developer token to a page](./token-endpoint), if your app has a web page.
- [Developer tokens and Music User Tokens](../concepts/tokens), for how the SDK signs and replaces tokens.
- [Security model](../concepts/security), for where the key and the tokens may go.
- The reference for [`createServerClient`](../reference/@open-music-sdk/server/functions/createServerClient) and
  [`developerTokenMinter`](../reference/@open-music-sdk/developer-token/functions/developerTokenMinter).

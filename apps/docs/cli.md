# The command-line tool

`@open-music-sdk/cli` is a command you run while you build, not a library you import. It does what your app can't
do for you yet:

- `login` gets a Music User Token for your own Apple Music account. It serves a page on `localhost` that runs
  Apple's sign-in, opens it in your browser, and keeps the token once Apple has accepted it.
- `token` prints that token, and nothing else, for another program to read. `token --developer` mints a developer
  token from your key instead, which lives an hour.
- `doctor` asks Apple whether your key works, then whether the kept token does. A `401` can mean either, and this
  tells them apart. It prints nothing secret.
- `check` asks the live API, as you, what the SDK takes on trust about it, and prints what Apple did. With
  `--write` it also makes a playlist and adds to your library, and ends with the steps that remove what it added.
- `logout` forgets the kept token.

It reads your key and its IDs from `APPLE_MUSIC_PRIVATE_KEY`, `APPLE_MUSIC_TEAM_ID` and `APPLE_MUSIC_KEY_ID`, the
variables these docs use, so with those set it needs no flags. A value it can't find, it asks for. You also need
Node 24 or newer, and an Apple Account with an Apple Music subscription to sign in with.

To use your own account from a script, sign in once, then hand the token to the script in an environment
variable. On your machine:

```sh
open-music-sdk login
APPLE_MUSIC_USER_TOKEN=$(open-music-sdk token) node job.js
```

In `job.js`, `music.as(process.env.APPLE_MUSIC_USER_TOKEN)` gives a client that acts for you.

Add the CLI to your project as a dev dependency and run it with `pnpm exec`. Or run it once with `npx`, pinned to
a version: unpinned, `npx` runs whatever is newest, with your key in reach.

```sh
pnpm add -D @open-music-sdk/cli
pnpm exec open-music-sdk doctor

npx @open-music-sdk/cli@<version> login
```

`open-music-sdk --help` lists every command, and `open-music-sdk help <command>` gives a command's options. The
CLI's [README](https://github.com/open-music-sdk/js/tree/main/apps/cli#readme) covers where it finds your key and
where it keeps the token: in one file in your user profile, readable by you alone and not encrypted, until `logout`
forgets it. [On your machine, with the CLI](./concepts/security#on-your-machine-with-the-cli) explains how `login`
keeps the sign-in safe.

The token the CLI keeps is yours. Your listeners' tokens come from their own sign-in in your app: see
[Sign a listener in](./guides/sign-in).

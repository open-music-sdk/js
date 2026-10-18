# @open-music-sdk/cli

Get a Music User Token for your own Apple Music account from the command line. A browser opens, you sign in at
Apple, and the terminal keeps the token, the way `aws login` gets you a session. It also tells you whether Apple
takes your MusicKit key.

```
pnpm add -D @open-music-sdk/cli
```

The command is `open-music-sdk`, so run it with `pnpm exec open-music-sdk`. To run it once without installing,
pin the version: `npx @open-music-sdk/cli@0.0.0 login`. Without a version, `npx` runs whatever is newest, with
your key in reach.

You need Node 24 or newer, a MusicKit key from your Apple Developer account, and an Apple Account with an Apple
Music subscription to sign in with.

## Example

With your key in `APPLE_MUSIC_PRIVATE_KEY`, and its IDs in `APPLE_MUSIC_TEAM_ID` and `APPLE_MUSIC_KEY_ID`, as the
SDK's docs keep them, no command needs a flag. On your machine:

```sh
open-music-sdk doctor                                  # does Apple take my key?
open-music-sdk login                                   # sign in at Apple, and keep the token
APPLE_MUSIC_USER_TOKEN=$(open-music-sdk token) node job.js
```

## Commands

| Command | What it does |
| --- | --- |
| `login` | Checks your key with Apple, then serves a page on `http://localhost` that runs Apple's sign-in, and opens it in your browser. Keeps the token once Apple accepts it. `--port` fixes the port; `--no-browser` only prints the address. |
| `token` | Prints the kept token, and nothing else, for another program to read. `--developer` mints a developer token from your key instead, which lives an hour. |
| `doctor` | Asks Apple whether your key works (`GET /v1/test`), then whether the kept token does (`GET /v1/me/storefront`). A `401` can mean either, and this tells them apart. Prints nothing secret. |
| `check` | Asks the live API what the SDK takes on trust about it, as you, and prints what Apple did. See [`check`](#check). |
| `logout` | Forgets the kept token. Apple isn't told, so a copy you handed to another program works until Apple ends it. |

`open-music-sdk --help` lists every command, and `open-music-sdk help <command>` gives a command's options and
examples.

What a command produces, the token or `doctor`'s report, goes to stdout. Everything said to you goes to stderr. So
`$(open-music-sdk token)` gets the token alone, and a pipe never swallows a question or an error. Color is off when
the output isn't a terminal, when `NO_COLOR` is set, or with `--no-color`.

| Exit status | Means |
| --- | --- |
| `0` | Done. |
| `1` | It failed: Apple refused, couldn't be reached, or no token is kept. |
| `2` | It wasn't run as it should be: an unknown command or option, or a missing key. |
| `130` | Stopped with Ctrl+C. |

## Where the key comes from

`login`, `doctor`, `check` and `token --developer` need your key and its two IDs. Each comes from its flag, else its
environment variable, else a question:

| Value | Flag | Environment variable | Asked for |
| --- | --- | --- | --- |
| Private key | `--key-file <path>`, or `--key-file -` for stdin | `APPLE_MUSIC_PRIVATE_KEY`, holding the key itself | Pasted, with nothing shown |
| Team ID | `--team-id <id>` | `APPLE_MUSIC_TEAM_ID` | Typed |
| Key ID | `--key-id <id>` | `APPLE_MUSIC_KEY_ID` | Typed |

- The variables' names are fixed: they're the ones the SDK's docs use.
- `APPLE_MUSIC_PRIVATE_KEY` holds the contents of the `.p8`, with escaped `\n` line breaks, Windows line endings or
  a byte order mark if need be. A path in it is refused, with a pointer to `--key-file`.
- A key file is read only when `--key-file` names it. It must be a file of at most 16 KB, not a folder, a device or
  a pipe. If it keeps Apple's name, `AuthKey_<key id>.p8`, its key ID comes before `APPLE_MUSIC_KEY_ID`, though
  after `--key-id`.
- `--key-file -` reads the key from a pipe, so it can go from a secret manager to the CLI and nowhere else:
  `op read "op://Dev/MusicKit/AuthKey.p8" | open-music-sdk login --key-file - --team-id … --key-id …`. The IDs must
  then come from flags or variables, and a missing one is reported before the pipe is read. A terminal on stdin is
  refused, since the key would show as you typed it.
- Questions are asked only at an interactive terminal. The key comes first, so a key on your clipboard is pasted
  where nothing is shown. It's read to its `END` line, or Ctrl+D, and anything pasted after it is let go rather than
  left for your shell. At the ID questions, letters become capitals and only ID characters are shown.
- `--no-input` turns questions off, and every command takes it. Without a terminal, or with `--no-input`, a missing
  value ends with exit status `2` and a message naming its flag and its variable.
- The key is checked before Apple is asked: it must be a P-256 private key, in Apple's PKCS8 form or in SEC1.
- Nothing you give or type is kept, and no message repeats the key. The team ID, the key ID and a key file's path
  are printed, since none is secret; a key path that names no file isn't, unless it looks like a path.

## What it keeps

One file, `user-token.json`, holding the Music User Token. It's in `%LOCALAPPDATA%\open-music-sdk` on Windows, not
the roaming `%APPDATA%`, which a domain copies to its servers and your other machines. Elsewhere it's in
`$XDG_CONFIG_HOME/open-music-sdk`, or `~/.config/open-music-sdk`. `open-music-sdk --help` prints the folder.

- Only `token` prints the token.
- The file is written to a temporary file and renamed, so you never find half of it. On Windows, where a rename is
  refused while another program has the file open, it's tried again for a couple of seconds.
- On macOS and Linux the file is readable by you alone (mode `600`), and a folder the CLI makes is mode `700`; a
  folder that was already there keeps its mode. On Windows it sits in your own profile, which other users can't
  read.
- It isn't encrypted. The system's keychain isn't used: that needs a native module, or a different command on each
  system, and waits until someone asks for it.

The file is kept by `FileUserTokenStore`: `core`'s `tUserTokenStore`, the three methods that `forUser()` and the
intake call, over one JSON file. A store of your own can be that small.

To remove everything, run `open-music-sdk logout`, then delete the folder.

## How `login` works

Before a browser opens, `login` makes sure it can write the token file, and asks Apple whether your key works. Then
it serves its sign-in page on a port the system picks, unless you give `--port`. Apple registers no address, so a
new port each run costs nothing.

The page is built from the SDK: `browser`'s `createBrowserClient` and `createConnect`, with its developer token
from `server`'s `tokenEndpoint`, and the token Apple gives posted to `server`'s `userTokenIntake`, which asks Apple
about it, for up to 30 seconds, before keeping it. The page is served on `localhost` alone, its address opens once,
and it closes once it has a token, after five minutes, or on Ctrl+C. The terminal then says which storefront the
account is in.

Apple's sign-in window shows the project's logo, and names the app `localhost:<port>`, not Open Music CLI: Apple's
script names an app by the page's host.

- [Security model](https://open-music-sdk.github.io/js/concepts/security#on-your-machine-with-the-cli) explains
  what keeps the page, your key and the kept token safe.
- [Differences from Apple's documentation](https://open-music-sdk.github.io/js/differences#cli) says what its
  first live run, on 16 October 2026, settled, and what's still open.

## `check`

Apple's documentation is silent or wrong in places, and the SDK takes some things on trust there. `check` asks the
live API about those a server can ask, through the SDK's own functions, signed in as you with the token `login`
kept. It starts with `doctor`'s two questions, then prints a line for each answer:

| Mark | Means |
| --- | --- |
| `✓` | Apple did what the SDK assumes. |
| `≠` | It didn't. The line says which package assumes otherwise. |
| `·` | What Apple did, where the SDK assumes nothing, such as how long a write takes to show. |
| `-` | Not asked: your account can't be asked it, for example when no playlist of yours is long enough, or what it would be asked after didn't hold. |
| `✗` | Apple failed, so the question wasn't answered. |

It exits `1` for a `≠` or a `✗`. What it prints on stdout is the report, for an issue as it is, inside a code block.
Its first line names the CLI's version, Node's and your system, and `doctor`'s lines after it name your key's ID,
your team's and your storefront. Nothing in it names anything of your library, says whether something is in it,
or counts your things. Progress, the paths of files, and the cleanup steps below go to stderr, which is for you.

```sh
open-music-sdk check                           # every check that only reads
open-music-sdk check isrc-next rating-unset    # those two alone
open-music-sdk check --write                   # the checks that write too
open-music-sdk help check                      # every check, by name
```

The checks that write run only with `--write`, since what they add stays: Apple's API has no way to take a playlist
or anything else out of your library, and `check` doesn't take its favorite back. They add up to four things to
your library, an album's songs with it, make one song a favorite, and make a playlist of up to 300 songs, which may
put those songs in your library too. Each is something you didn't have, and the run ends with numbered
steps that remove them, each with a link to its own page in Apple Music, whose … menu takes it out: the library's
own lists don't. A song's link is its own page, not its album's, where Delete from Library takes out the whole
album. Where a write may or may not have carried something else in with it, the steps say what to look for. They're printed whatever happens, Ctrl+C and a SIGTERM included, and a second
Ctrl+C waits for them. Run them on an account you don't mind cluttering, with an Apple Music subscription.

What `check` finds goes into [Differences from Apple's
documentation](https://open-music-sdk.github.io/js/differences), and a difference into a fix of the package it
names.

## Development

From a clone of the repository:

```
pnpm --filter @open-music-sdk/cli... build
node apps/cli/dist/bin.js --help
```

`build` makes `dist/bin.js`, the command, with `@open-music-sdk/server` bundled into it, and `dist/page.js`, the
sign-in page, with `@open-music-sdk/browser` bundled into it. The tests run against fakes of Apple: the arguments,
the file store, the loopback server over `node:http`, the page in happy-dom, the commands end to end, and what the
build makes.

## Learn more

- [The command-line tool](https://open-music-sdk.github.io/js/concepts/packages#the-command-line-tool), and how it
  fits beside the packages
- [Developer tokens and Music User Tokens](https://open-music-sdk.github.io/js/concepts/tokens)
- [Sign a listener in](https://open-music-sdk.github.io/js/guides/sign-in), for your listeners' tokens, from your
  own page
- What the CLI is made of: [`@open-music-sdk/server`](../../integrations/server/README.md) and
  [`@open-music-sdk/browser`](../../integrations/browser/README.md)

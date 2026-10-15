# @open-music-sdk/cli

Get a Music User Token for your own Apple Music account from the command line. A browser opens, you sign
in at Apple, and the terminal has the token, the way `aws login` gets you a session. It also tells you
whether your MusicKit key works.

```
npx @open-music-sdk/cli@0.0.0 login --key ./AuthKey_ABC123DEFG.p8 --team-id DEF123GHIJ
npx @open-music-sdk/cli@0.0.0 doctor
APPLE_MUSIC_USER_TOKEN=$(npx @open-music-sdk/cli@0.0.0 token) node job.js
```

Pin the version. `npx` without one runs whatever is newest, with your key in reach. Or install it as a dev
dependency, and the command is `open-music-sdk`:

```
pnpm add -D @open-music-sdk/cli
pnpm exec open-music-sdk login --key ./AuthKey_ABC123DEFG.p8 --team-id DEF123GHIJ
```

You need Node 24 or newer, a MusicKit key from your Apple Developer account, and an Apple Account with an
Apple Music subscription to sign in with.

## Commands

| Command | Does |
| --- | --- |
| `login` | Asks Apple whether your key works, then serves a page on `http://localhost` that runs Apple's own sign-in and opens it in your browser. Once Apple accepts the token, it is kept. `--port` fixes the port; `--no-browser` only prints the address. |
| `token` | Prints the kept token, and nothing else, for another program to read. `--developer` mints a developer token from your key instead, which lives an hour. |
| `doctor` | Asks Apple whether your key works (`GET /v1/test`), then whether the kept token does (`GET /v1/me/storefront`). A 401 can mean either; this tells them apart. It prints nothing secret. |
| `logout` | Forgets the kept token. Apple is not told: a copy you handed to another program works until Apple ends it. |

`open-music-sdk --help` lists them, and `open-music-sdk help <command>` shows a command's options and
examples.

What a command produces goes to stdout: the token, and `doctor`'s report. Everything said to you goes to
stderr. So `$(open-music-sdk token)` gets the token alone, and a pipe never swallows a question or an
error. Color goes off when the output is not a terminal, when `NO_COLOR` is set, or with `--no-color`.

## Where the key comes from

Each of the three comes from the first of these that has it:

1. The flags: `--key <path>`, `--team-id <id>`, `--key-id <id>`.
2. The environment: `APPLE_MUSIC_KEY_PATH`, `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`.
3. What the last `login` kept.

The key ID is in the name Apple gave the file, `AuthKey_<key id>.p8`, so you can leave it out while the
file keeps that name. The key is read from its file, never from a flag or a variable: a flag would show up
in your shell's history and in `ps`. The CLI checks that the file is a P-256 private key before anything
is asked of Apple, and no message ever quotes it.

## What it keeps

Two files, in `%LOCALAPPDATA%\open-music-sdk` on Windows, and in `$XDG_CONFIG_HOME/open-music-sdk`, or
`~/.config/open-music-sdk`, elsewhere. `open-music-sdk --help` prints the folder. On Windows it is not the
roaming `%APPDATA%`, which a domain copies to its servers and to your other machines.

| File | Holds |
| --- | --- |
| `user-token.json` | The Music User Token. Only `token` prints it. |
| `config.json` | The key's path and its two IDs, which `login` keeps so the commands after it need no flags. Never the key itself. |

Each is written to a temporary file and renamed, so you never find half of one; on Windows, where a rename is
refused while another program has the file open, it is tried again for a couple of seconds. On macOS and
Linux both files are readable by you alone (mode `600`), and a folder the CLI makes is mode `700`; one that
was already there keeps its mode. On Windows they sit in your own profile, which other users cannot read.
The system's keychain is not used: that needs a native module, or a different command on each system, and
waits until someone asks for it.

The token file is kept by `FileUserTokenStore`: core's `tUserTokenStore`, the three methods that
`forUser()` and the [intake](../../packages/user-token/README.md) call, over one JSON file. A store of your
own can be as small as this one.

To remove everything: `open-music-sdk logout`, then delete the folder.

## How `login` works

1. Your key is loaded, and the token file read, so a bad key or a file the CLI cannot write fails before a
   browser opens. Apple is asked `GET /v1/test`.
2. A server listens on both loopback addresses, `127.0.0.1` and `::1`, on one port the system picks unless
   you give `--port`. Its page is `http://localhost:<port>/?state=<ticket>`, with a fresh random ticket each
   run. Apple registers no address, so a new port each time costs nothing.
3. The ticket opens the page once. The page carries a second secret, which its script sends to the two
   routes below.
4. The page is the browser package's `createBrowserClient` and `createConnect`. Its developer token comes
   from the server package's `tokenEndpoint`, at `/token?state=<secret>`, which mints fifteen-minute
   tokens bound to the page's origin. Its button runs Apple's sign-in inside your click.
5. The page posts the token to the server package's `userTokenIntake`, at `/user-token`, with the secret in
   an `x-login-state` header. The intake asks Apple about the token, for up to 30 seconds, and only then
   keeps it. One token is taken: a second post is turned away.
6. Once the page has been told, the server closes and the terminal says which storefront the account is
   in. The page puts its origin back as it was before Apple's script ran, and says you can close the tab.
7. Five minutes without a token, or Ctrl+C at any point, closes it too, and nothing is kept.

## What it holds to

- **Loopback, both addresses, and its own page only.** `localhost` can mean `127.0.0.1` or `::1`, and a
  browser may try either first. The server holds the port on both, so no other program can take the one it
  left free and, with it, the page and the token. It answers only requests whose `Host` is
  `localhost:<port>`, so a name rebound to that address reaches nothing, and refuses any request whose
  `Origin` is another page's.
- **An address that works once.** The address is handed to the browser in a command line, which other
  users of the machine may be able to read. Its ticket is used up when the page opens, and a second
  opening is told the page is open already and to press Ctrl+C if that was not you. The routes the page
  talks to need the page's own secret, which is never in an address or a command line.
- **Another site cannot post a token.** The post needs a JSON body and the `x-login-state` header, so a
  browser asks first, and nothing here answers that asking. A post without the secret is refused before
  Apple is asked, and once a token is kept no other is taken.
- **A dispenser only while it waits.** The token route exists while `login` waits, needs the secret, and
  its tokens live fifteen minutes and are bound to the page's origin.
- **Apple's copy does not outlive the page.** A cookie set on `localhost` is shared by every port, so a
  copy Apple's script left there would reach every server you run on this machine. After every try, and
  when the tab is closed, the page deletes the cookies and storage entries Apple's script added and gives
  the ones it wrote over their old values. `disconnect()` is not used: whether it ends the token at Apple
  is not yet known.
- **The page's headers.** `cache-control: no-store`, `x-content-type-options: nosniff`, and a CSP that
  lets in Apple's script from `js-cdn.music.apple.com` and nothing but Apple's hosts. No
  `Referrer-Policy: no-referrer`, which developers report breaks Apple's sign-in, and no
  `Cross-Origin-Opener-Policy`, since the sign-in window talks back to the page that opened it.
- **No secret in a message.** Only `token` prints the token. An argument that looks like neither a command
  nor a flag is not repeated in an error, in case it is a token pasted in the wrong place, and neither is a
  key path that names no file unless it looks like a path. Text from Apple is printed without control
  characters.
- **A pinned version is all pinned.** The family is bundled into the command when it is built, so
  `npx @open-music-sdk/cli@<version>` runs exactly the packages that version was made with. `jose` is its
  one dependency.
- **The page has no signing code.** The browser package is bundled into it, and a test reads what the
  build makes and finds none of `jose` in it.

## Exit status

| Status | Means |
| --- | --- |
| `0` | Done. |
| `1` | It failed: Apple refused, could not be reached, or nothing is kept. |
| `2` | It was not run as it should be: an unknown command or option, or a missing key. |
| `130` | Stopped with Ctrl+C. |

## What Apple documents, and what it does not

`login` is where the SDK's sign-in first meets Apple's live script, and none of it has been run against
Apple yet. These are open until the first live run:

- Whether Apple's sign-in takes a page on `http://localhost`, and honours the `origin` claim from it.
- Which hosts Apple's script reaches, and so whether the page's CSP lets them all in.
- Where Apple's script keeps its copy of the token: the page puts back cookies, `localStorage` and
  `sessionStorage`, not IndexedDB.
- What a decline gives, and, with `--port` fixed and a second `login`, what the page restores for a
  returning listener.
- Whether, after a token Apple would not take, a second try in the same tab asks Apple's sign-in again or
  hands back the same token from memory.
- Whether a browser ever asks for the page twice of its own accord, which the one-time address would turn
  away.

## Development

```
pnpm --filter @open-music-sdk/cli... build
node apps/cli/dist/bin.js --help
```

`build` makes `dist/bin.js`, the command, with `@open-music-sdk/server` bundled into it, and `dist/page.js`,
the sign-in page with `@open-music-sdk/browser` bundled into it. The tests run against fakes of Apple: the
argument handling, the file store, the loopback server over `node:http`, the page in happy-dom, the
commands end to end, and what the build makes.

## Not here

- The functions the CLI is made of: [`@open-music-sdk/server`](../../integrations/server/README.md) and
  [`@open-music-sdk/browser`](../../integrations/browser/README.md).
- `check`, the live checks of what Apple documents and what it does not: next, once the first live run
  shows what it should hold.

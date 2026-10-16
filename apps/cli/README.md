# @open-music-sdk/cli

Get a Music User Token for your own Apple Music account from the command line. A browser opens, you sign
in at Apple, and the terminal has the token, the way `aws login` gets you a session. It also tells you
whether your MusicKit key works.

With your key in `APPLE_MUSIC_PRIVATE_KEY`, and its IDs in `APPLE_MUSIC_TEAM_ID` and `APPLE_MUSIC_KEY_ID`,
as the SDK's own READMEs keep them, no command needs a flag:

```
npx @open-music-sdk/cli@0.0.0 login
npx @open-music-sdk/cli@0.0.0 doctor
APPLE_MUSIC_USER_TOKEN=$(npx @open-music-sdk/cli@0.0.0 token) node job.js
```

Pin the version. `npx` without one runs whatever is newest, with your key in reach. Or install it as a dev
dependency, and the command is `open-music-sdk`:

```
pnpm add -D @open-music-sdk/cli
pnpm exec open-music-sdk login
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

`login`, `doctor` and `token --developer` need your key and its two IDs. Each of the three comes from its
flag, else its environment variable, else a question:

| Value | Flag | Environment variable | Asked for |
| --- | --- | --- | --- |
| Private key | `--key-file <path>`, or `--key-file -` for stdin | `APPLE_MUSIC_PRIVATE_KEY`, holding the key itself | Pasted, with nothing shown |
| Team ID | `--team-id <id>` | `APPLE_MUSIC_TEAM_ID` | Typed |
| Key ID | `--key-id <id>` | `APPLE_MUSIC_KEY_ID` | Typed |

- **The variables' names are fixed:** they are the ones the SDK's READMEs use.
- **`APPLE_MUSIC_PRIVATE_KEY`** holds the contents of the `.p8`. It may hold them with escaped `\n` line
  breaks, Windows line endings, or a byte order mark. A path in it is refused, with a pointer to
  `--key-file`.
- **A key file is read only when `--key-file` names it,** and it must be a file of at most 16 KB, not a
  folder, a device or a pipe. If the file keeps the name Apple gave it, `AuthKey_<key id>.p8`, its key ID
  is used before `APPLE_MUSIC_KEY_ID`, though after `--key-id`.
- **`--key-file -` reads the key from a pipe,** so it goes from a secret manager to the CLI and nowhere
  else: `op read "op://Dev/MusicKit/AuthKey.p8" | open-music-sdk login --key-file - --team-id … --key-id …`.
  With stdin carrying the key, nothing else can be asked for, so the IDs must come from their flags or
  variables, and a missing one is reported before the pipe is read. A terminal on stdin is refused, since
  the key would be typed where it shows.
- **Questions are asked only at an interactive terminal,** for what the flags and the environment leave
  out. The key is asked for first, so a key on your clipboard is pasted where nothing is shown. It is read
  to its `END` line, or to Ctrl+D, and whatever arrives after it, the rest of a pasted file say, is let go
  by rather than left for your shell. The team ID and key ID follow: letters are taken as capitals, and
  only ID characters are shown, so even a key pasted there shows nothing of itself.
- **`--no-input` turns questions off,** and every command takes it. Without a terminal, or with
  `--no-input`, a missing value ends with exit status 2 and a message naming its flag and its variable.
- **Nothing given or typed is kept.** The next command finds the key and its IDs where this one did.
- **The key is checked before anything is asked of Apple:** it must be a P-256 private key, in Apple's PKCS8
  form or in SEC1. No message repeats the key, a token, or anything that came in that might be one. The
  team ID, the key ID and a key file's path are printed, since none of them is secret.
- **The CLI hands the key to no program it starts.** `APPLE_MUSIC_PRIVATE_KEY` is taken out of the CLI's
  own environment before it starts anything, so the browser it opens is not handed it. Whatever started the
  CLI had the variable already, your shell and `npx` among them, and on Linux and macOS the CLI's starting
  environment stays readable, by you and root alone, while it runs.

## What it keeps

One file, `user-token.json`, in `%LOCALAPPDATA%\open-music-sdk` on Windows, and in
`$XDG_CONFIG_HOME/open-music-sdk`, or `~/.config/open-music-sdk`, elsewhere. `open-music-sdk --help` prints
the folder. On Windows it is not the roaming `%APPDATA%`, which a domain copies to its servers and to your
other machines. The file holds the Music User Token, and only `token` prints it.

It is written to a temporary file and renamed, so you never find half of it; on Windows, where a rename is
refused while another program has the file open, it is tried again for a couple of seconds. On macOS and
Linux it is readable by you alone (mode `600`), and a folder the CLI makes is mode `700`; one that was
already there keeps its mode. On Windows it sits in your own profile, which other users cannot read. It is
not encrypted. The system's keychain is not used: that needs a native module, or a different command on
each system, and waits until someone asks for it.

The token file is kept by `FileUserTokenStore`: core's `tUserTokenStore`, the three methods that
`forUser()` and the [intake](../../packages/user-token/README.md) call, over one JSON file. A store of your
own can be as small as this one.

To remove everything: `open-music-sdk logout`, then delete the folder.

## How `login` works

1. The token file is read, so a file the CLI cannot write fails before anything is asked. Your key and its
   IDs are found, or asked for, and Apple is asked `GET /v1/test`, so a bad key fails before a browser
   opens.
2. A server listens on both loopback addresses, `127.0.0.1` and `::1`, on one port the system picks unless
   you give `--port`. Its page is `http://localhost:<port>/?state=<ticket>`, with a fresh random ticket each
   run. Apple registers no address, so a new port each time costs nothing.
3. The ticket opens the page once. The page carries a second secret, which its script sends to the two
   routes below.
4. The page is the browser package's `createBrowserClient` and `createConnect`. Its developer token comes
   from the server package's `tokenEndpoint`, at `/token?state=<secret>`, which mints fifteen-minute
   tokens bound to the page's origin. Its button runs Apple's sign-in inside your click. The page is the
   Open Music CLI's, with the project's logo. Apple's sign-in window shows the logo, which the page hands
   over in the `apple-music-app-icon` link Apple's script reads, as the GitHub organisation's avatar, an
   HTTPS address Apple's page can load. The window names the app `localhost:<port>`, not Open Music CLI:
   Apple's script names it by the page's host, whatever the app is configured as.
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
  key path that names no file unless it looks like a path. Text from Apple, and paths, are printed without
  control characters.
- **A pinned version is all pinned.** The family is bundled into the command when it is built, and `jose`,
  its one dependency, is pinned to the exact version the family is tested with, so
  `npx @open-music-sdk/cli@<version>` runs exactly the code that version was made with.
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

`login` is where the SDK's sign-in first meets Apple's live script. The first live run, on 16 October 2026
on Windows, settled these:

- **Sign-in works from localhost.** Apple's sign-in takes a page on `http://localhost:<port>`, with a
  developer token bound to that origin, and `login` keeps the token Apple then gives. `doctor` asks both of
  its questions of the live API.
- **The CSP was enough.** It let in all that sign-in needed, in the browser the run used.
- **The consent window names the app by the page's host,** `localhost:<port>`, and not by the name
  `createConnect` configures. Apple's script (v3) sends the window `window.location.host` as the name.
- **The icon comes from the page's `apple-music-app-icon` link.** It showed once it was an HTTPS address,
  since the window is an HTTPS page of Apple's.

These are still open:

- How it goes in other browsers and on macOS and Linux.
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

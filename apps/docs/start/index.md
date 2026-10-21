# Build Vinyl Collector Simulator

In this tutorial you build Vinyl Collector Simulator, the app the [sample apps](../samples) are made of, as a web
page with no framework and a server on Express. By the end, your page flips through crates of Apple's catalog,
plays the previews, signs you in with Apple Music, and sends a crate of songs you picked to your library as a
playlist.

It takes about an hour, in three parts:

1. [The server](./server): the routes that hand your page a developer token and take in your Music User Token.
2. [The page and the catalog](./page): crates of charts, albums and search results, with previews, for anyone.
3. [The listener](./listener): signing in, your library, and sending the crate.

## How you build it

You build the app in two folders of your own, beside the finished samples in the repository. Each step adds one
file, copied from the finished sample, and shows the part of it that uses the SDK. The rest of the file is the page's
own: buttons, crates, a status line. You run what you have at the end of each part.

Nothing in the tutorial is code you won't find in the samples. When your app does something other than this page
says, compare your folder with the sample's.

## Before you start

You need:

- Node 24 and pnpm.
- Your MusicKit private key, key ID and team ID. See [Set up your MusicKit key](../guides/musickit-key).
- An Apple Account with an Apple Music subscription, for part 3.
- A terminal. The commands below work in a macOS or Linux shell and in PowerShell, from the repository's root.

The SDK isn't on npm yet, so you build inside the repository, where your folders use its packages as they are.

## Get the repository

Clone it, and install from its root:

```sh
git clone https://github.com/open-music-sdk/js.git open-music-sdk
cd open-music-sdk
pnpm install
```

Every page sample serves on `localhost:2728`, and every server on `127.0.0.1:8787`, so stop any sample you have
running before you start yours.

[Start with the server](./server).

---
layout: home

hero:
  name: Open Music SDK
  text: The Apple Music API for JavaScript and TypeScript
  tagline: Open and community-led. A typed function for nearly every endpoint, tokens that look after themselves, and packages for servers, web pages and React.
  image:
    src: /logo.svg
    alt: Open Music SDK logo
  actions:
    - theme: brand
      text: Which package to install
      link: /concepts/packages
    - theme: alt
      text: Guides
      link: /guides/musickit-key
    - theme: alt
      text: Reference
      link: /reference/

features:
  - title: server
    details: For Node, Cloudflare Workers, Bun and Deno. Signs its own developer token, and hands your pages one.
    link: /reference/@open-music-sdk/server/
  - title: browser
    details: For a web page. Fetches its token from your server, and runs Apple's sign-in for the listener.
    link: /reference/@open-music-sdk/browser/
  - title: react
    details: For a React app. A provider, hooks for sign-in and previews, and queries for TanStack Query.
    link: /reference/@open-music-sdk/react/
  - title: cli
    details: For you, while you build. Checks your MusicKit key, and signs you in at Apple to get a Music User Token for your own account.
    link: /concepts/packages#the-command-line-tool
---

::: warning Under construction
Nothing is published to npm yet. The CLI's sign-in has run once against the live Apple Music API, on Windows; the
rest hasn't, and nothing has run in a React app outside its tests. See [Status and roadmap](./status) for what
exists.
:::

## Where to start

1. Read [Which package to install](./concepts/packages). Most apps need one package.
2. [Set up your MusicKit key](./guides/musickit-key). Every request needs a developer token, and you sign it
   with this key. The CLI's `doctor` tells you whether Apple takes it.
3. To learn the SDK by building something, follow the [tutorial](./start/): a page and a server that dig through
   Apple's catalog, play previews, sign you in, and send songs to your library, in about an hour.
4. Follow the example in the reference page of your package: [`server`](./reference/@open-music-sdk/server/),
   [`browser`](./reference/@open-music-sdk/browser/) or [`react`](./reference/@open-music-sdk/react/).
5. To try the listener's side with your own account before your app has a sign-in, get a Music User Token with
   the CLI's `login`. See [The command-line tool](./concepts/packages#the-command-line-tool).
6. To see it all working together, run one of the [sample apps](./samples) on your machine.

## A first look

On your server, with your MusicKit key:

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

## How these docs are organised

- [Guides](./guides/musickit-key) take you to one goal, such as signing a listener in or importing a playlist.
- [Concepts](./concepts/packages) explain how the SDK works and why: its tokens, its security model and its
  errors.
- The [Reference](./reference/) lists every function, type and option of every package, generated from the
  source.
- The [Glossary](./glossary) explains the words these docs use.

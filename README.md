<div align="center">

<img src="./assets/open-music-app-logo.svg" alt="open-music-sdk" width="200">

# Open Music SDK for JavaScript

[![test coverage](https://codecov.io/gh/open-music-sdk/js/graph/badge.svg)](https://codecov.io/gh/open-music-sdk/js)

</div>

> Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.

An open, community-led TypeScript SDK for the Apple Music API. It gives you a typed function for every endpoint,
tokens that look after themselves, and packages for servers, web pages and React: an ESM-only alternative to
Apple's MusicKit on the Web.

> **🚧 Under construction.** Nothing is published to npm yet, and nothing has been run against the live Apple
> Music API. See [Status and roadmap](https://open-music-sdk.github.io/js/status) for what exists.

**Documentation: [open-music-sdk.github.io/js](https://open-music-sdk.github.io/js/)**

## Which package to install

Most apps install one package:

| You're building | Install |
| --- | --- |
| Server-side code: Node, Cloudflare Workers, Bun, Deno, a command-line tool | [`@open-music-sdk/server`](./integrations/server/README.md) |
| A web page without React | [`@open-music-sdk/browser`](./integrations/browser/README.md) |
| A React app | [`@open-music-sdk/react`](./integrations/react/README.md) |
| A Next.js app | `server` and `react` |

Each gives you a client with the catalog, the listener's library and playlist tools on it. See
[Which package to install](https://open-music-sdk.github.io/js/concepts/packages) for the rest of the family.

## Example

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

## Documentation

- [Guides](https://open-music-sdk.github.io/js/guides/musickit-key): set up your key, sign a listener in, use
  Next.js or Cloudflare Workers, and more.
- [Concepts](https://open-music-sdk.github.io/js/concepts/packages): tokens, security, errors and the design
  principles every package follows.
- [Reference](https://open-music-sdk.github.io/js/reference/): every function, type and option.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the repository layout and how to write docs.

## License

[MIT](./LICENSE) with a [Developer Certificate of Origin](./CONTRIBUTING.md#developer-certificate-of-origin) sign-off
on contributions. The project name and logo are not covered by the code license; see [TRADEMARKS.md](./TRADEMARKS.md).
Using the Apple Music API requires your own Apple Developer account and agreement with Apple.

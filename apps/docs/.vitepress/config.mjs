// The site: guides, concepts and the reference, published to GitHub Pages at open-music-sdk.github.io/js. The
// reference is written to reference/ by TypeDoc before VitePress runs (see package.json), with a sidebar beside it.
import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";

// TypeDoc lists the packages alphabetically. The sidebar groups them by tier, with what an app installs first.
const tiers = {
  Integrations: ["server", "browser", "react"],
  Clients: ["client-catalog", "client-user"],
  Libraries: ["lib-playlists", "lib-preview-player"],
  Foundation: ["core", "developer-token", "user-token", "util-artwork", "types", "validate"],
};
const packages = JSON.parse(readFileSync(new URL("../reference/typedoc-sidebar.json", import.meta.url), "utf8"));
const named = (name) => {
  const item = packages.find((p) => p.text === `@open-music-sdk/${name}`);
  if (!item) throw new Error(`.vitepress/config.mjs: no reference for @open-music-sdk/${name}; update the tiers`);
  return item;
};
if (packages.length !== Object.values(tiers).flat().length) throw new Error(".vitepress/config.mjs: a package is in no tier; add it to the tiers");

// A sidebar is rendered into every page it is on, so each package gets one that lists its own members and links the
// others: one sidebar with all 900 members made each reference page 380 kB. The two generated packages, one entry
// per Apple object, list none; their page and the search find them.
const generated = new Set(["types", "validate"]);
const referenceSidebar = (current) => [
  {
    text: "Reference",
    items: [
      { text: "All packages", link: "/reference/" },
      { text: "Differences from Apple's documentation", link: "/differences" },
      { text: "Glossary", link: "/glossary" },
    ],
  },
  ...Object.entries(tiers).map(([text, names]) => ({
    text,
    items: names.map((name) => (name === current && !generated.has(name) ? { ...named(name), text: name, collapsed: false } : { text: name, link: named(name).link })),
  })),
];

const guides = [
  {
    text: "Guides",
    items: [
      { text: "Set up your MusicKit key", link: "/guides/musickit-key" },
      { text: "Serve a developer token to a page", link: "/guides/token-endpoint" },
      { text: "Sign a listener in", link: "/guides/sign-in" },
      { text: "Keep a listener's token on your server", link: "/guides/store-user-tokens" },
      { text: "Play song previews", link: "/guides/previews" },
      { text: "Show artwork", link: "/guides/artwork" },
      { text: "Import a playlist", link: "/guides/import-playlist" },
      { text: "Handle errors", link: "/guides/errors" },
      { text: "Validate Apple's responses", link: "/guides/validation" },
      { text: "Call an endpoint the clients don't cover", link: "/guides/direct-requests" },
      { text: "Build your own client from the parts", link: "/guides/own-client" },
    ],
  },
  {
    text: "Frameworks and platforms",
    items: [
      { text: "Next.js", link: "/guides/nextjs" },
      { text: "Cloudflare Workers", link: "/guides/cloudflare-workers" },
      { text: "TanStack Query", link: "/guides/tanstack-query" },
    ],
  },
];

const concepts = [
  {
    text: "Concepts",
    items: [
      { text: "Which package to install", link: "/concepts/packages" },
      { text: "Developer tokens and Music User Tokens", link: "/concepts/tokens" },
      { text: "Security model", link: "/concepts/security" },
      { text: "Errors", link: "/concepts/errors" },
      { text: "Design principles", link: "/concepts/principles" },
    ],
  },
];

export default defineConfig({
  title: "Open Music SDK",
  description: "An open, community-led TypeScript SDK for the Apple Music API.",
  base: "/js/",
  outDir: "dist",
  cleanUrls: true,
  // The site's data, the reference sidebar's 900 entries among it, goes in one file every page shares. Inlined, it is
  // copied into each of those 900 pages, and the site runs to most of a gigabyte.
  metaChunk: true,
  // The app's own README is for whoever works on the site, not for its readers.
  srcExclude: ["README.md"],
  head: [["link", { rel: "icon", href: "/js/logo.svg" }]],
  // The one chunk past Vite's 500 kB warning is the search index, about 2.5 MB, which loads when the search box opens.
  vite: { build: { chunkSizeWarningLimit: 4000 } },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guides", link: "/guides/musickit-key", activeMatch: "^/guides/" },
      { text: "Concepts", link: "/concepts/packages", activeMatch: "^/concepts/" },
      { text: "Reference", link: "/reference/", activeMatch: "^/(reference/|differences|glossary)" },
      { text: "Status", link: "/status" },
    ],
    // The longest matching path wins, so a package's own sidebar is used under its folder.
    sidebar: {
      "/guides/": guides,
      "/concepts/": concepts,
      "/reference/": referenceSidebar(),
      "/differences": referenceSidebar(),
      "/glossary": referenceSidebar(),
      ...Object.fromEntries(Object.values(tiers).flat().map((name) => [`/reference/@open-music-sdk/${name}/`, referenceSidebar(name)])),
    },
    search: { provider: "local" },
    outline: [2, 3],
    socialLinks: [{ icon: "github", link: "https://github.com/open-music-sdk/js" }],
    footer: {
      message: "MIT licensed. Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.",
    },
  },
});

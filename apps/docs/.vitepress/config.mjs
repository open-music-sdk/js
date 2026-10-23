// The site: guides, concepts and the reference, published to GitHub Pages at open-music-sdk.github.io/js. The
// reference is written to reference/ by TypeDoc before VitePress runs (see package.json), with a sidebar beside it.
import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";
import { PAIRS, VALUES, dataAttributes, pageScope, settle } from "./frameworks.mjs";
import { splitIntoSections, variantBlocks } from "./variants.mjs";

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

// Guides' sidebar, which the concepts, the samples and the CLI share, under the nav's Guides; their pages keep their
// addresses. Getting started sets up the client and server the reader picks. A guide for some frameworks alone, such
// as TanStack Query's, is shown to the readers who picked them (see `scoped` and `neighbours` below).
const guides = [
  {
    text: "Getting started",
    items: [
      { text: "Set up your MusicKit key", link: "/guides/musickit-key" },
      { text: "Set up your server", link: "/guides/server-setup" },
      { text: "Serve a developer token to a page", link: "/guides/token-endpoint" },
      { text: "Set up your client", link: "/guides/client-setup" },
    ],
  },
  // Each entry reads on from the heading, as "How To: Handle errors", and each page stands on its own.
  {
    text: "How To",
    items: [
      { text: "Sign a listener in", link: "/guides/sign-in" },
      { text: "Keep a listener's token on your server", link: "/guides/store-user-tokens" },
      { text: "Play song previews", link: "/guides/previews" },
      { text: "Show artwork", link: "/guides/artwork" },
      { text: "Import a playlist", link: "/guides/import-playlist" },
      { text: "Handle errors", link: "/guides/errors" },
      { text: "Validate Apple's responses", link: "/guides/validation" },
      { text: "Call an endpoint the clients don't cover", link: "/guides/direct-requests" },
      { text: "Build your own client from the parts", link: "/guides/own-client" },
      { text: "Read and write with TanStack Query", link: "/guides/tanstack-query" },
      { text: "Use server actions and caching in Next.js", link: "/guides/nextjs" },
      { text: "Deploy a Worker", link: "/guides/cloudflare-workers" },
    ],
  },
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
  { text: "Samples", items: [{ text: "Sample apps", link: "/samples" }] },
  { text: "CLI", items: [{ text: "The command-line tool", link: "/cli" }] },
];

// What a page is for, from the `for:` in its frontmatter, as `client=react,nextjs`: `{}` for a page for every one.
const scopeOf = (link) => pageScope(readFileSync(new URL(`..${link}.md`, import.meta.url), "utf8"));

// A page for some frameworks alone carries a mark of what it's for in its sidebar entry, which the CSS reads to leave
// the entry out for a reader who chose others (see theme/frameworks.css).
const scoped = (groups) =>
  groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const scope = scopeOf(item.link);
      if (Object.keys(scope).length === 0) return item;
      return { ...item, text: `${item.text}<span class="for-only"${dataAttributes(scope)}></span>` };
    }),
  }));
const guidesSidebar = scoped(guides);

// The theme's pager links the page next to this one in the sidebar, whatever it's for. Guides' pages have a pager of
// their own instead (theme/FrameworkPager.vue), which links, for each client and server the reader may choose, the
// nearest page `step` away that is for them: one link where every choice has the same page, else one for each choice,
// of which the CSS shows the reader's.
const pages = guides.flatMap((group) => group.items).map((item) => ({ ...item, scope: scopeOf(item.link) }));
const isFor = (page, pair) => Object.entries(page.scope).every(([axis, values]) => values.includes(pair[axis]));
const neighbours = (index, step) => {
  const found = PAIRS.map((pair) => {
    let i = index + step;
    while (pages[i] && !isFor(pages[i], pair)) i += step;
    return pages[i];
  });
  const target = (page, pair) => ({ text: page.text, link: page.link, ...(pair && { for: pair }) });
  if (found.every((page) => page === found[0])) return found[0] ? [target(found[0])] : [];
  return PAIRS.flatMap((pair, n) => (found[n] ? [target(found[n], pair)] : []));
};

// A package README links to the site by its full URL, so the link works on GitHub and npm too. On the site it is
// made relative, which keeps it in the same tab and puts it under VitePress's check for dead links. It runs after
// linkify, so a bare URL that linkify turns into a link is caught too.
const site = "https://open-music-sdk.github.io/js/";
const siteLinks = (md) =>
  md.core.ruler.after("linkify", "site-links", (state) => {
    for (const token of state.tokens)
      for (const child of token.children ?? []) {
        const href = child.type === "link_open" ? child.attrGet("href") : null;
        if (href?.startsWith(site)) child.attrSet("href", `/${href.slice(site.length)}`);
      }
  });

// A README opens with the family's header, the logo, a plain-English title and the badges, for GitHub and npm. On the
// site, which has its own, the header gives way to the package name the rest of the reference uses, and the README's
// pointer to the repository's "Which package to install" goes to the site's own page. The source is changed before
// the block rules read it; the reference copies a README after a breadcrumb line, so the header is not at the start.
const readmeHeader = /<div align="center">[\s\S]*?<\/div>\s*\n> Not affiliated[^\n]*\n/;
const referenceReadme = (md) =>
  md.core.ruler.before("block", "reference-readme", (state) => {
    const name = state.env.relativePath?.match(/^reference\/@open-music-sdk\/([^/]+)\/index\.md$/)?.[1];
    if (!name) return;
    if (!readmeHeader.test(state.src)) throw new Error(`${state.env.relativePath}: the README has no header to replace`);
    state.src = state.src
      .replace(readmeHeader, `# @open-music-sdk/${name}\n`)
      .replaceAll("https://github.com/open-music-sdk/js#which-package-to-install", `${site}concepts/packages`);
  });

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
  // The reader's choice of frameworks is settled before the first paint, so a guide never shows another
  // framework's code first and then swaps it.
  head: [
    ["link", { rel: "icon", href: "/js/logo.svg" }],
    ["script", {}, `(${settle.toString()})(${JSON.stringify(VALUES)}, location.href);`],
  ],
  // The one chunk past Vite's 500 kB warning is the search index, about 2.5 MB, which loads when the search box opens.
  // `pnpm --filter docs dev` serves files from the whole repository, as Vite does from a workspace's root. Its list of
  // refusals is restated with a MusicKit key and the sample Worker's files added, and no page on another origin may
  // read an answer.
  vite: {
    build: { chunkSizeWarningLimit: 4000 },
    server: { cors: false, fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "*.p8", ".dev.vars", ".dev.vars.*", "**/.wrangler/**"] } },
  },
  // A page in Guides' sidebar gets the links of its own pager (see `neighbours`), and none from the theme's.
  transformPageData(pageData) {
    const index = pages.findIndex((page) => `${page.link.slice(1)}.md` === pageData.relativePath);
    if (index === -1) return;
    pageData.frontmatter.prev = false;
    pageData.frontmatter.next = false;
    pageData.frontmatter.pager = { prev: neighbours(index, -1), next: neighbours(index, 1) };
  },
  markdown: {
    config: (md) => {
      referenceReadme(md);
      siteLinks(md);
      variantBlocks(md);
    },
  },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guides", link: "/guides/musickit-key", activeMatch: "^/(guides/|concepts/|samples|cli)" },
      { text: "Reference", link: "/reference/", activeMatch: "^/(reference/|differences|glossary)" },
      { text: "Status", link: "/status" },
    ],
    // The longest matching path wins, so a package's own sidebar is used under its folder.
    sidebar: {
      "/guides/": guidesSidebar,
      "/concepts/": guidesSidebar,
      "/samples": guidesSidebar,
      "/cli": guidesSidebar,
      "/reference/": referenceSidebar(),
      "/differences": referenceSidebar(),
      "/glossary": referenceSidebar(),
      ...Object.fromEntries(Object.values(tiers).flat().map((name) => [`/reference/@open-music-sdk/${name}/`, referenceSidebar(name)])),
    },
    // Each variant of a guide is a search result of its own, titled with its frameworks, so a result says whether
    // it's the React code or the Express code, and opening it switches the picker to match. The hook is underscored
    // in VitePress's types: after an upgrade, check that the search still finds a variant by its framework.
    search: { provider: "local", options: { miniSearch: { _splitIntoSections: splitIntoSections } } },
    outline: [2, 3],
    socialLinks: [{ icon: "github", link: "https://github.com/open-music-sdk/js" }],
    footer: {
      message: "MIT licensed. Not affiliated with, endorsed by, or sponsored by Apple Inc. Apple Music and MusicKit are trademarks of Apple Inc.",
    },
  },
});

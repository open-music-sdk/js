import { defineConfig } from "tsdown";

// Two builds into one folder: the command for Node, which loads the family from `@open-music-sdk/server` at run
// time, and the sign-in page, with `@open-music-sdk/browser` bundled into it so the page needs nothing but itself
// and Apple's script. `bin.js` reads `page.js` from beside it.
export default defineConfig([
  {
    entry: { bin: "src/bin.ts" },
    format: ["esm"],
    platform: "node",
    deps: { neverBundle: [/^@open-music-sdk\//] },
    fixedExtension: false,
    dts: false,
  },
  {
    // A module with nothing left to import, which the page loads with `<script type="module">`.
    entry: { page: "src/page.ts" },
    format: ["esm"],
    platform: "browser",
    deps: { alwaysBundle: [/^@open-music-sdk\//] },
    fixedExtension: false,
    minify: true,
    dts: false,
  },
]);

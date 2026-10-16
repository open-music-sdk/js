import { defineConfig } from "tsdown";

// Two builds into one folder: the command for Node, and the sign-in page, which `bin.js` reads from beside it. The
// family is bundled into both: into the page so it needs nothing but itself and Apple's script, and into the command
// so that `npx @open-music-sdk/cli@<version>` runs exactly the packages that version was built with, the key in
// reach of none that came later. jose, which is not the family's, stays a dependency.
export default defineConfig([
  {
    entry: { bin: "src/bin.ts" },
    format: ["esm"],
    platform: "node",
    deps: { alwaysBundle: [/^@open-music-sdk\//], neverBundle: ["jose"] },
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
    // The project's logo, beside the page that shows it and names it to Apple as the app's icon.
    copy: { from: "../../assets/open-music-app-logo.svg", to: "dist", flatten: true },
    dts: false,
  },
]);

import { defineConfig } from "vite";

// The page is served on localhost:2728, the origin the servers bind the developer token to, and a port of its own:
// Apple's script keeps the listener's token in this origin's storage, which another app on the same port could read.
// Everything under /api goes to whichever server sample runs on 8787, so the page and its server share one origin.
export default defineConfig({
  server: {
    port: 2728,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
    // Vite's dev server can hand out any file in the repository to a page that asks. Its default list of refusals
    // is restated, with a MusicKit key and Wrangler's files added, and no page on another origin may read an answer.
    cors: false,
    fs: { deny: [".env", ".env.*", "*.{crt,pem,key,p12,pfx,cer,der}", ".npmrc", ".yarnrc.yml", "**/.git/**", "*.p8", ".dev.vars", ".dev.vars.*", "**/.wrangler/**"] },
    // No page may frame this one. Another localhost port counts as the same site, so a frame there would have the
    // listener signed in, and a page opened by its address could be laid under a click meant for something else.
    headers: { "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" },
  },
});

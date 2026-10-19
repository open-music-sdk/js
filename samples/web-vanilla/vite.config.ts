import { defineConfig } from "vite";

// The page is served on localhost:5173, the origin the servers bind the developer token to. Everything under /api
// goes to whichever server sample runs on 8787, so the page and its server share one origin.
export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:8787" } },
});

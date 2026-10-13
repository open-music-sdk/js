import { libraryConfig } from "tooling-tsdown-config";

// Unbundled: one built file per source file, so that client.js, the one with the provider and the hooks, begins with
// "use client" and nothing else does. Bundled, the two files that import the hooks would share a chunk, and the
// directive would sit on a stub that re-exports it rather than on the code.
export default libraryConfig({ unbundle: true });

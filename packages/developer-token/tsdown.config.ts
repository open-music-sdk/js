import { libraryConfig } from "tooling-tsdown-config";

// Two builds so only the "./node" entry may reach for Node built-ins; the main entry stays platform neutral.
export default [libraryConfig(), libraryConfig({ entry: ["src/node.ts"], platform: "node", fixedExtension: false, clean: false })];

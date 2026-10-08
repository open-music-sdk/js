import { libraryConfig } from "tooling-tsdown-config";

// "./fetcher" is its own entry so that code which must not carry signing code can import a file that has none.
export default libraryConfig({ entry: ["src/index.ts", "src/fetcher.ts"] });

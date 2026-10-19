import { libraryConfig } from "tooling-vitest-config";

// The test reads the samples' sources and covers no code of its own, so CI's coverage run writes no report for it.
export default libraryConfig({ coverage: { reporter: ["text"] } });

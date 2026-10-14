import { libraryConfig } from "tooling-vitest-config";

// A DOM for the hooks; the files that render on a server, or need none, say so at their top.
export default libraryConfig({ environment: "happy-dom" });

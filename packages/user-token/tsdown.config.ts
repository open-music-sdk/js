import { libraryConfig } from "tooling-tsdown-config";

// The stores are AsyncDisposable. The declaration bundler drops the `/// <reference lib>` in
// src/stores.ts, so it is put back here; without it a consumer on an older `lib` cannot read the types.
export default libraryConfig({ banner: { dts: '/// <reference lib="esnext.disposable" />' } });

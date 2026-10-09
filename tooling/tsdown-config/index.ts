import { defineConfig, type UserConfig } from "tsdown";

/** Shared by every publishable package. ESM only; siblings, jose, and framework peers are never bundled. */
export const libraryConfig = (overrides: UserConfig = {}) =>
  defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    // With maps: `sourcemap` below stamps a sourceMappingURL on the declarations too, and it must point at something.
    dts: { sourcemap: true },
    platform: "neutral",
    deps: { neverBundle: [/^@open-music-sdk\//, "jose", "react", "next", "@tanstack/react-query"] },
    treeshake: true,
    sourcemap: true,
    ...overrides,
  });

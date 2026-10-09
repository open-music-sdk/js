import { defineConfig, type UserConfig } from "tsdown";

/**
 * Shared by every publishable package. ESM only; siblings, jose, and framework peers are never bundled.
 *
 * Maps are for work inside this repository, where `src` is there for them to lead back to: `build` asks for them
 * with `--sourcemap`. `prepack` does not, so nothing that is published carries one.
 */
export const libraryConfig = (overrides: UserConfig = {}) =>
  defineConfig(({ sourcemap = false }) => ({
    entry: ["src/index.ts"],
    format: ["esm"],
    // Both or neither: `sourcemap` below stamps a sourceMappingURL on the declarations too, and it must point at something.
    dts: { sourcemap: Boolean(sourcemap) },
    platform: "neutral",
    deps: { neverBundle: [/^@open-music-sdk\//, "jose", "react", "next", "@tanstack/react-query"] },
    treeshake: true,
    sourcemap,
    ...overrides,
  }));

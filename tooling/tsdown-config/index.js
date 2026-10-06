import { defineConfig } from "tsdown";

/**
 * Shared by every publishable package. ESM only; siblings, jose, and framework peers are never bundled.
 * @param {import("tsdown").UserConfig} [overrides]
 */
export const libraryConfig = (overrides = {}) =>
  defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    platform: "neutral",
    external: [/^@open-music-sdk\//, "jose", "react", "next", "@tanstack/react-query"],
    treeshake: true,
    sourcemap: true,
    ...overrides,
  });

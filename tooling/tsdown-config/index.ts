import { defineConfig, type UserConfig } from "tsdown";

/** Shared by every publishable package. ESM only; siblings, jose, and framework peers are never bundled. */
export const libraryConfig = (overrides: UserConfig = {}) =>
  defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    platform: "neutral",
    deps: { neverBundle: [/^@open-music-sdk\//, "jose", "react", "next", "@tanstack/react-query"] },
    treeshake: true,
    sourcemap: true,
    ...overrides,
  });

import { defineConfig, type ViteUserConfig } from "vitest/config";

/** Shared Vitest config for packages. */
export const libraryConfig = (overrides: ViteUserConfig["test"] = {}) =>
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
      ...overrides,
    },
  });

import { defineConfig } from "vitest/config";

/**
 * Shared Vitest config for packages.
 * @param {import("vitest/config").UserConfig["test"]} [overrides]
 */
export const libraryConfig = (overrides = {}) =>
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
      ...overrides,
    },
  });

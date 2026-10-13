import { defineConfig, type ViteUserConfig } from "vitest/config";

/** Shared Vitest config for packages. */
export const libraryConfig = (overrides: ViteUserConfig["test"] = {}) =>
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
      coverage: {
        include: ["src/**/*.ts"],
        exclude: ["src/generated/**"],
        // Paths in lcov.info are written from the repo root, two levels above each package, so no two packages report the same path.
        reporter: ["text", ["lcov", { projectRoot: "../.." }]],
      },
      ...overrides,
    },
  });

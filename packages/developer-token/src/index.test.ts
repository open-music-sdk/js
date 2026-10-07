import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };

describe("the package manifest", () => {
  const core = "@open-music-sdk/core";

  // The errors this package throws are core's class, and core recognises its own by instanceof. A second copy of
  // core nested under this package would throw errors the application's copy does not recognise or retry.
  test("core is a peer, so an application and this package share one copy of it", () => {
    expect(manifest.peerDependencies).toHaveProperty([core]);
    expect(manifest.dependencies).not.toHaveProperty([core]);
  });

  test("the peer is pinned to the workspace version, because the family is released in lockstep", () => {
    expect(manifest.peerDependencies[core]).toBe("workspace:*");
  });

  test("jose is the only runtime dependency", () => {
    expect(Object.keys(manifest.dependencies)).toEqual(["jose"]);
  });
});

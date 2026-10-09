import type { tArtwork } from "@open-music-sdk/types";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index.js";

describe("the package entry", () => {
  test("exports the documented functions and nothing else", () => {
    expect(Object.keys(api).sort()).toEqual(["artworkSrcSet", "artworkUrl"]);
  });

  test("from an artwork object as the API gives it to an image, using nothing but the entry", () => {
    const artwork: tArtwork = { url: "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover.jpg/{w}x{h}bb.jpg", width: 3000, height: 3000, bgColor: "1a1a1a" };
    expect(api.artworkUrl(artwork, 300)).toBe("https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover.jpg/300x300bb.jpg");
    expect(api.artworkSrcSet(artwork, 300)).toContain("/600x600bb.jpg 2x");
  });
});

describe("the package manifest", () => {
  test("has one entry", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test("has no dependencies: it is strings in and strings out", () => {
    expect(manifest).not.toHaveProperty("dependencies");
    expect(manifest).not.toHaveProperty("peerDependencies");
  });
});

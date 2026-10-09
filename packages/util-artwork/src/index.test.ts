import type { tArtwork } from "@open-music-sdk/types";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index.js";

describe("the package entry", () => {
  test("exports the documented functions and nothing else", () => {
    expect(Object.keys(api).sort()).toEqual(["artworkImage", "artworkSrcSet", "artworkUrl"]);
  });

  test("from an artwork object as the API gives it to an image, using nothing but the entry", () => {
    const at = (size: string) => `https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover.jpg/${size}bb.jpg`;
    const artwork: tArtwork = { url: at("{w}x{h}"), width: 3000, height: 3000, bgColor: "1a1a1a" };
    expect(api.artworkUrl(artwork, 300)).toBe(at("300x300"));
    expect(api.artworkSrcSet(artwork, 300)).toBe(`${at("300x300")} 1x, ${at("600x600")} 2x, ${at("900x900")} 3x`);
    expect(api.artworkImage(artwork, 300)).toEqual({ src: api.artworkUrl(artwork, 300), srcset: api.artworkSrcSet(artwork, 300), width: 300, height: 300 });
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

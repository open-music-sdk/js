import type { tArtwork, tLibraryPlaylist, tSong } from "@open-music-sdk/types";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

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

describe("the README's way of reaching an artwork, against the generated types", () => {
  const artwork: tArtwork = { url: "https://example.com/{w}x{h}bb.jpg", width: 3000, height: 3000 };

  test("a resource's attributes may be missing, and so may its artwork: reached with ?., what is left is an artwork or nothing", () => {
    const song: Pick<tSong, "attributes"> = {};
    const playlist: Pick<tLibraryPlaylist, "attributes"> = {};
    for (const reached of [song.attributes?.artwork, playlist.attributes?.artwork]) {
      const image = reached ? api.artworkImage(reached, 300) : undefined;
      expect(image).toBeUndefined();
    }
  });

  test("the lack of an artwork is not an artwork: the types refuse it, and so does the call", () => {
    const song: Pick<tSong, "attributes"> = {};
    // @ts-expect-error -- attributes may be missing, so this may be undefined, which is not an artwork
    expect(() => api.artworkUrl(song.attributes?.artwork, 300)).toThrow(TypeError);
    // @ts-expect-error -- null is not an artwork either
    expect(() => api.artworkImage(null, 300)).toThrow(TypeError);
  });

  test("what artworkImage gives can be spread onto an element in the README's two ways", () => {
    const { srcset, ...image } = api.artworkImage(artwork, 300);
    expect(Object.keys(image).sort()).toEqual(["height", "src", "width"]);
    expect(srcset).toContain(" 2x");
    const img: { src: string; srcset: string; width: number; height: number; alt: string } = { src: "", srcset: "", width: 0, height: 0, alt: "" };
    Object.assign(img, api.artworkImage(artwork, 300));
    expect(img.width).toBe(300);
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

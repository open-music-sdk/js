import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { tArtwork, tLibraryPlaylist, tSong } from "@open-music-sdk/types";
import { build } from "tsdown";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

describe("the package entry", () => {
  test("exports the documented functions and nothing else", () => {
    expect(Object.keys(api).sort()).toEqual(["FORMATS", "artworkImage", "artworkSrcSet", "artworkUrl"]);
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

describe("what an app carries because of this package", () => {
  /** What only the client holds: the header it sends, where it sends it, the error it throws and the walk it makes. */
  const CLIENT = ["music-user-token", "api.music.apple.com", "AppleMusicError", "paginate"];

  /** This package as an app's bundler leaves it: core bundled in with it, and what nothing uses dropped. */
  async function carried(): Promise<string> {
    const { bundles } = await build({
      config: false,
      entry: ["src/index.ts"],
      format: ["esm"],
      platform: "neutral",
      deps: { alwaysBundle: [/^@open-music-sdk\//] },
      treeshake: true,
      dts: false,
      write: false,
      clean: false,
      report: false,
      logLevel: "silent",
    });
    return bundles.flatMap((bundle) => bundle.chunks.map((chunk) => ("code" in chunk ? chunk.code : ""))).join("\n");
  }

  test("of core, the check on where a URL points and nothing of the client", { timeout: 30_000 }, async () => {
    const code = await carried();
    expect(code).toContain("hosts must be an array of");
    expect(code).not.toContain("@open-music-sdk/core");
    expect(CLIENT.filter((mark) => code.includes(mark))).toEqual([]);
  });

  test("the check that says so can tell: all of core has every one of those in it", () => {
    const core = readFileSync(createRequire(import.meta.url).resolve("@open-music-sdk/core"), "utf8");
    expect(CLIENT.filter((mark) => core.includes(mark))).toEqual(CLIENT);
  });
});

describe("the package manifest", () => {
  test("has one entry", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test("has one dependency, core, on a caret range as it is for the rest of the family: it is strings in and strings out", () => {
    expect(manifest.dependencies).toEqual({ "@open-music-sdk/core": "workspace:^" });
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

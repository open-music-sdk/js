import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { tSong } from "@open-music-sdk/types";
import { build } from "tsdown";
import { describe, expect, test } from "vitest";
import manifest from "../package.json" with { type: "json" };
import * as api from "./index";

describe("the package entry", () => {
  test("exports one name, the noun, and nothing else", () => {
    expect(Object.keys(api)).toEqual(["previewPlayer"]);
  });

  test("exports the documented types and nothing else", () => {
    // A type leaves nothing at runtime to list, so the names are read from the entry.
    const named = [...readFileSync(new URL("index.ts", import.meta.url), "utf8").matchAll(/^export type \{ ([^}]+) \}/gm)].flatMap((line) => (line[1] ?? "").split(", "));
    expect(named.sort()).toEqual(["tLoadedPreviews", "tPreviewAudio", "tPreviewPlayer", "tPreviewPlayerOptions", "tPreviewPlayerState", "tPreviewStatus", "tPreviewable", "tSkippedPreview"]);
  });

  test("is the only one", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  test("from songs as the catalog gives them to a clip playing, using nothing but the entry", async () => {
    // The least of an audio element that lets a clip be asked for: what a page's own <audio> gives in full.
    const asked: string[] = [];
    const audio = {
      src: "",
      currentTime: 0,
      volume: 1,
      duration: Number.NaN,
      paused: true,
      ended: false,
      play() {
        asked.push(this.src);
        this.paused = false;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const songs = [
      { id: "1", type: "songs", href: "/v1/catalog/us/songs/1", attributes: { name: "With a clip", previews: [{ url: "https://audio-ssl.itunes.apple.com/1.m4a" }] } },
      { id: "2", type: "songs", href: "/v1/catalog/us/songs/2", attributes: { name: "Without", previews: [] } },
    ] as unknown as tSong[];

    const player = api.previewPlayer<tSong>({ audio });
    const { tracks, skipped } = player.load(songs);
    expect(tracks.map((track) => track.id)).toEqual(["1"]);
    expect(skipped).toEqual([{ index: 1, track: songs[1], reason: "no-preview" }]);
    await player.play();
    expect(asked).toEqual(["https://audio-ssl.itunes.apple.com/1.m4a"]);
    expect(player.state.track?.attributes?.name).toBe("With a clip");
    player.dispose();
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

  test("of core, the checks it makes and nothing of the client: it asks Apple for nothing, and carries nothing that could", { timeout: 30_000 }, async () => {
    const code = await carried();
    expect(code).toContain("previewPlayer");
    expect(code).not.toContain("@open-music-sdk/core");
    expect(CLIENT.filter((mark) => code.includes(mark))).toEqual([]);
  });

  test("the check that says so can tell: all of core has every one of those in it", () => {
    const core = readFileSync(createRequire(import.meta.url).resolve("@open-music-sdk/core"), "utf8");
    expect(CLIENT.filter((mark) => core.includes(mark))).toEqual(CLIENT);
  });

  test("it makes no request: nothing in its sources names fetch, a client or Apple's API", () => {
    const source = readFileSync(new URL("player.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfetch\b|createClient|\.request\(|api\.music\.apple\.com/);
  });
});

describe("the package manifest", () => {
  const core = "@open-music-sdk/core";

  test("core is an ordinary dependency on a caret range, as it is for the rest of the family", () => {
    expect(manifest.dependencies[core]).toBe("workspace:^");
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  test("core is the only dependency: the types are here for the tests alone, since a track is taken by its shape", () => {
    expect(Object.keys(manifest.dependencies)).toEqual([core]);
    expect(manifest.devDependencies).toHaveProperty("@open-music-sdk/types", "workspace:*");
  });

  test("it says it has no side effects, which is what lets a bundler drop what an app does not import", () => {
    expect(manifest.sideEffects).toBe(false);
  });
});

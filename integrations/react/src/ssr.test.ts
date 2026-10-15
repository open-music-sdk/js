// @vitest-environment node
import { createBrowserClient } from "@open-music-sdk/browser";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MusicProvider, useConnect, useMusic, useMusicQueries, useMusicUserToken, usePreviewPlayer } from "./client";

describe("on a server, with no document, no element and no script", () => {
  const music = createBrowserClient({ tokenUrl: "https://app.example/api/music/token" });

  test("a tree with every hook renders: the page's client, no token, not ready, the idle snapshot, scope 0", () => {
    function App() {
      const held = useMusic();
      const [token] = useMusicUserToken();
      const { isReady, error } = useConnect({ app: { name: "Crate Digger" } });
      const { state } = usePreviewPlayer();
      const queries = useMusicQueries();
      return createElement("p", null, [held === music ? "page" : "bound", String(token), String(isReady), String(error), state.status, String(queries.catalog.getSong("1").queryKey[1])].join(" "));
    }
    expect(renderToString(createElement(MusicProvider, { music }, createElement(App)))).toContain("page undefined false undefined idle 0");
  });

  test("the hooks without a provider are a TypeError naming each", () => {
    for (const [name, hook] of [
      ["useMusic", useMusic],
      ["useMusicUserToken", useMusicUserToken],
      ["useMusicQueries", useMusicQueries],
      ["useConnect", () => useConnect({ app: { name: "x" } })],
    ] as const) {
      function Probe(): null {
        hook();
        return null;
      }
      expect(() => renderToString(createElement(Probe)), name).toThrow(new TypeError(`${name}: no MusicProvider above this component`));
    }
  });

  test("the idle snapshot is one object, frozen, so a server render and a hydration agree", () => {
    const seen: unknown[] = [];
    function Probe(): null {
      seen.push(usePreviewPlayer().state);
      return null;
    }
    renderToString(createElement(Probe));
    renderToString(createElement(Probe));
    expect(seen[0]).toBe(seen[1]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ status: "idle", tracks: [], index: -1, track: undefined, position: 0, duration: 0, volume: 1 });
  });
});

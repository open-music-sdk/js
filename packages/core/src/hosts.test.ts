import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { hostsOf, isOnHost } from "./hosts";

describe("hostsOf", () => {
  test("no hosts named is no check asked for", () => {
    expect(hostsOf("artwork", undefined, "mzstatic.com")).toBeUndefined();
  });

  test.each([[["mzstatic.com"]], [["mzstatic.com", "blobstore.apple.com"]], [["localhost"]], [["a-b.example.org"]], [Array.from({ length: 16 }, (_, i) => `h${String(i)}.example.org`)]])(
    "%j is taken as it is",
    (hosts) => {
      expect(hostsOf("artwork", hosts, "mzstatic.com")).toEqual(hosts);
    },
  );

  test.each<[string, unknown]>([
    ["no list", "mzstatic.com"],
    ["an empty list, which would allow nothing", []],
    ["more than sixteen", Array.from({ length: 17 }, (_, i) => `h${String(i)}.example.org`)],
    ["a URL", ["https://mzstatic.com"]],
    ["a pattern", ["*.mzstatic.com"]],
    ["capitals, which a URL parser never gives", ["MzStatic.com"]],
    ["a port", ["mzstatic.com:443"]],
    ["a dot at the end", ["mzstatic.com."]],
    ["an empty name", [""]],
    ["a name longer than a host can be", [`${"a".repeat(250)}.com`]],
    ["something that is no string", [1]],
    ["null", null],
    ["an object", { 0: "mzstatic.com", length: 1 }],
  ])("%s is refused, under the caller's name and with the caller's example", (_name, hosts) => {
    expect(() => hostsOf("artwork", hosts, "mzstatic.com")).toThrow(new TypeError("artwork: hosts must be an array of 1 to 16 host names in small letters, such as mzstatic.com"));
    expect(() => hostsOf("previewPlayer", hosts, "itunes.apple.com")).toThrow(/^previewPlayer: hosts must be .* such as itunes\.apple\.com$/);
  });

  test("the list is this call's own: changing the caller's afterwards changes nothing", () => {
    const given = ["mzstatic.com"];
    const taken = hostsOf("artwork", given, "mzstatic.com");
    given[0] = "example.org";
    given.push("example.net");
    expect(taken).toEqual(["mzstatic.com"]);
  });
});

describe("isOnHost", () => {
  const APPLE = ["mzstatic.com"];

  test.each(["https://mzstatic.com/a.jpg", "https://is1-ssl.mzstatic.com/image/thumb/a.jpg", "https://a.b.mzstatic.com/", "HTTPS://IS1-SSL.MZSTATIC.COM/a.jpg", "https://mzstatic.com:443/a.jpg"])(
    "%s is on the host or on a subdomain of it",
    (url) => {
      expect(isOnHost(url, APPLE)).toBe(true);
    },
  );

  test.each<[string, string]>([
    ["another host", "https://example.org/a.jpg"],
    ["a host that only ends the same way", "https://notmzstatic.com/a.jpg"],
    ["the host as a subdomain of another", "https://mzstatic.com.example.org/a.jpg"],
    ["the host in the path", "https://example.org/mzstatic.com/a.jpg"],
    ["the host as the user name", "https://mzstatic.com@example.org/a.jpg"],
    ["http", "http://mzstatic.com/a.jpg"],
    ["another scheme", "javascript://mzstatic.com/%0aalert(1)"],
    ["data", "data:image/png;base64,AAAA"],
    ["a port of its own", "https://mzstatic.com:8443/a.jpg"],
    ["credentials", "https://user:pass@mzstatic.com/a.jpg"],
    ["a user name alone", "https://user@mzstatic.com/a.jpg"],
    ["a URL with no scheme", "//mzstatic.com/a.jpg"],
    ["a relative URL", "/image/thumb/a.jpg"],
    ["nothing", ""],
    ["a backslash where a browser reads a slash", "https://example.org\\@mzstatic.com/a.jpg"],
  ])("%s is not", (_name, url) => {
    expect(isOnHost(url, APPLE)).toBe(false);
  });

  test.each<[string, string, string]>([
    ["no slash after the scheme", "https:mzstatic.com/a.jpg", "https://app.example/dir/mzstatic.com/a.jpg"],
    ["one slash after the scheme", "https:/mzstatic.com/a.jpg", "https://app.example/mzstatic.com/a.jpg"],
    ["one slash, and a path that climbs", "https:/mzstatic.com/../account/delete?confirm=1", "https://app.example/account/delete?confirm=1"],
    ["no slash, and a path that climbs", "https:mzstatic.com/../../uploads/theirs.jpg", "https://app.example/uploads/theirs.jpg"],
  ])("a URL with %s names the host on its own, and is a path on the page's own host to a page that is https: it is not on the host", (_name, url, asked) => {
    // What the check is up against: read alone the URL names the host allowed, and a page reads it as somewhere else.
    expect(new URL(url).hostname).toBe("mzstatic.com");
    expect(new URL(url, "https://app.example/dir/page.html").href).toBe(asked);
    expect(isOnHost(url, APPLE)).toBe(false);
  });

  test.each(["https:\\\\mzstatic.com/a.jpg", "https:/\\mzstatic.com/a.jpg", "  https://mzstatic.com/a.jpg  ", "ht\ttps://mzstatic.com/a.jpg"])(
    "%j is read the same way alone and by a page, and is on the host",
    (url) => {
      expect(new URL(url, "https://app.example/dir/page.html").hostname).toBe("mzstatic.com");
      expect(isOnHost(url, APPLE)).toBe(true);
    },
  );

  test("any one of the hosts will do", () => {
    expect(isOnHost("https://audio-ssl.itunes.apple.com/a.m4a", ["mzstatic.com", "itunes.apple.com"])).toBe(true);
    expect(isOnHost("https://audio-ssl.itunes.apple.com/a.m4a", ["mzstatic.com"])).toBe(false);
  });
});

describe("the module", () => {
  test("imports nothing, so a package that takes only this check from core takes nothing else with it", () => {
    expect(readFileSync(new URL("hosts.ts", import.meta.url), "utf8")).not.toMatch(/^import /m);
  });

  test("the check that says so can tell: an import is found", () => {
    expect('import { got } from "./got";').toMatch(/^import /m);
  });
});

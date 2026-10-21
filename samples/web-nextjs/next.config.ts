import type { NextConfig } from "next";

const config: NextConfig = {
  // A page reads Apple on every request, but for what says "use cache", and
  // navigating hides the page left behind rather than dropping it: on Back,
  // the floor's crates are where the listener left them.
  cacheComponents: true,
  partialPrefetching: true,
  // Next's badge in development sits on the player along the page's foot. Its
  // overlay still shows an error.
  devIndicators: false,
  // No page may frame this one. Another localhost port counts as the same
  // site, so a frame there would have the listener signed in, and a page
  // opened by its address could be laid under a click meant for something
  // else.
  headers() {
    const headers = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return Promise.resolve([{ source: "/:path*", headers }]);
  },
};

export default config;

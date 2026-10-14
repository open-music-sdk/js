// What a React app installs: everything in the browser package, the provider and the hooks, and the query factory.
// The "use client" directive is on client.js alone, so what is re-exported here still runs in a route handler or a
// server component, and the query factory runs on a server for a prefetch.
export * from "@open-music-sdk/browser";
export { MusicProvider, useConnect, useMusic, useMusicQueries, useMusicUserToken, usePreviewPlayer } from "./client";
export type { tMusicProviderProps, tUseConnect, tUsePreviewPlayer, tUsePreviewPlayerOptions } from "./client";
export { musicQueries } from "./query";
export type { tInfiniteQuery, tMusicQueries, tQueries, tQuery, tQueryOf } from "./query";

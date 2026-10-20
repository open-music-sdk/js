"use client";
// Shows: createBrowserClient, MusicProvider, musicQueries. Guide:
// /guides/nextjs
//
// What the page's client components read from: the page's own client, for
// Apple's sign-in and the album's query, TanStack Query's cache, your crate,
// and the preview player.
import {
  MusicProvider,
  createBrowserClient,
  musicQueries,
} from "@open-music-sdk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { CrateProvider } from "./crate";
import { PlayerProvider } from "./player";

// Made once, outside the tree. It fetches its developer token from the token
// route when Apple's sign-in, or a query the server's answer has gone stale
// for, needs one.
const music = createBrowserClient({ tokenUrl: "/api/music/token" });

/**
 * The catalog's queries over the page's own client, in scope 0, as the server
 * builds them for its prefetch: the keys match whoever is signed in, even
 * while the provider holds a token for the moment the sign-in takes.
 */
export const catalog = musicQueries(music).catalog;

export function Providers({ children }: { children: ReactNode }) {
  // One cache per page. A query the server prefetched is fresh for five
  // minutes, so the page asks Apple again only after that.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 60_000 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MusicProvider music={music}>
        <CrateProvider>
          <PlayerProvider>{children}</PlayerProvider>
        </CrateProvider>
      </MusicProvider>
    </QueryClientProvider>
  );
}

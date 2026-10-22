// Shows: createServerClient, createRateLimiter, MemoryUserTokenStore.
// Guide: /guides/server-setup
import {
  MemoryUserTokenStore,
  createRateLimiter,
  createServerClient,
  type tMusic,
  type tUserTokenStore,
} from "@open-music-sdk/server";
import { required } from "./env";

interface tServer {
  readonly music: tMusic;
  readonly store: tUserTokenStore;
}

// Kept on globalThis: Next can load this module more than once, in each
// route's bundle and again after an edit, and every copy has to find the same
// tokens.
const held = globalThis as { vinylCollector?: tServer };

/**
 * The server's one client and its store of listeners' tokens, made on first
 * use rather than as the module loads: `next build` loads the module with no
 * key in its environment, and builds nothing that needs one.
 */
function made(): tServer {
  if (held.vinylCollector !== undefined) return held.vinylCollector;
  // The store loses its tokens when the server stops: a real app keeps them
  // somewhere lasting, that every instance of it reaches.
  const store = new MemoryUserTokenStore();
  // Every listener's requests count against the same developer token, so
  // they share one limiter.
  const music = createServerClient({
    pem: required("APPLE_MUSIC_PRIVATE_KEY"),
    teamId: required("APPLE_MUSIC_TEAM_ID"),
    keyId: required("APPLE_MUSIC_KEY_ID"),
    // The storefront of a catalog call that names none, as the guides'
    // shorter examples do. The sample's own calls each name the storefront the
    // page is in.
    storefront: "us",
    userTokenStore: store,
    rateLimit: createRateLimiter({ capacity: 20, refillPerSecond: 10 }),
  });
  held.vinylCollector = { music, store };
  return held.vinylCollector;
}

export function getMusic(): tMusic {
  return made().music;
}

export function getStore(): tUserTokenStore {
  return made().store;
}

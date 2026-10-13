// The server's client: core's client over a minter that holds the key, with the catalog, the listener's library and
// the playlist verbs on it. One build runs on Node, workerd, Bun and Deno: each has the same fetch and WebCrypto.
import { catalog } from "@open-music-sdk/client-catalog";
import { user } from "@open-music-sdk/client-user";
import { createClient, optionsOf, withNamespaces, type tClientOptions, type tWithNamespaces } from "@open-music-sdk/core";
import { developerTokenMinter, type tMinterOptions } from "@open-music-sdk/developer-token";
import { playlists } from "@open-music-sdk/lib-playlists";

/**
 * The key and its two ids, as `developerTokenMinter` takes them, and every option of `createClient` but the
 * developer token, which the minter provides. `origin` is not among them: the server's own token never meets a
 * browser, and the one that does is `tokenEndpoint`'s. Invalid values throw a TypeError when the client is made.
 */
export interface tServerClientOptions extends Omit<tClientOptions, "developerToken">, Omit<tMinterOptions, "origin"> {}

/** What goes on the client, under these names, made for it and for each client it derives. */
const NAMESPACES = { catalog, user, playlists };

/**
 * Core's client with `catalog`, `user` and `playlists` on it: `catalog(client)`, `user(client)` and
 * `playlists(client)` made for this client, and again for each one `as()` or `forUser()` gives.
 */
export type tMusic = tWithNamespaces<typeof NAMESPACES>;

const WHAT = "an options object with pem, teamId and keyId";

/**
 * A client that mints its own developer token from the key it is handed, replaced in the background halfway through
 * its life, with the catalog, the listener's library and the playlist verbs on it. The options are checked and taken
 * here, once: what the minter checks it names itself, and so does `createClient`. Nothing is asked of Apple until a
 * call. Make it once, at module level: on a worker that is handed its secrets per request, a client made per request
 * imports the key and signs a token on every one.
 */
export function createServerClient(options: tServerClientOptions): tMusic {
  if ((options as unknown) === undefined) throw new TypeError(`createServerClient: expected ${WHAT}; got undefined`);
  const { pem, teamId, keyId, ttlSeconds, refreshAheadSeconds, ...client } = optionsOf("createServerClient", options, WHAT);
  const developerToken = developerTokenMinter({ pem, teamId, keyId, ttlSeconds, refreshAheadSeconds });
  return withNamespaces(createClient({ ...client, developerToken }), NAMESPACES);
}

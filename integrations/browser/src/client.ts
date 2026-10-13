// The page's client: core's client over a fetcher that gets the developer token from an endpoint the app hosts,
// with the catalog, the listener's library and the playlist verbs on it. Nothing here, or behind it, can sign a
// token: the developer-token package is reached through its `./fetcher` entry alone.
import { catalog } from "@open-music-sdk/client-catalog";
import { user } from "@open-music-sdk/client-user";
import { createClient, got, isPlain, optionsOf, ownOf, withNamespaces, type tClientOptions, type tTokenProvider, type tWithNamespaces } from "@open-music-sdk/core";
import { developerTokenFetcher, type tDeveloperTokenProvider, type tFetcherOptions } from "@open-music-sdk/developer-token/fetcher";
import { playlists } from "@open-music-sdk/lib-playlists";

/** Invalid values throw a TypeError when the client is made. */
export interface tBrowserClientOptions extends Omit<tClientOptions, "developerToken"> {
  /** Where `tokenEndpoint` of `@open-music-sdk/server` is mounted. A relative URL resolves against the page, as `fetch` resolves it. */
  readonly tokenUrl: string | URL;
  /**
   * The endpoint's own options: a `fetch` for it, with the credentials or headers it needs, `timeoutMs`, and
   * `refreshAheadSeconds`. The client's own `fetch` is for Apple, and never reaches the endpoint.
   */
  readonly endpoint?: tFetcherOptions | undefined;
}

/** What goes on the client, under these names, made for it and for each client it derives. */
const NAMESPACES = { catalog, user, playlists };

/** Core's client with `catalog`, `user` and `playlists` on it, made for this client and for each one `as()` or `forUser()` gives. */
export type tMusic = tWithNamespaces<typeof NAMESPACES>;

/** The page's client: `tMusic` with the developer-token provider on it, which `createConnect` takes, and kept through `as()` and `forUser()`. */
export interface tBrowserMusic extends Omit<tMusic, "as" | "forUser"> {
  /** The provider that fetches the token from `tokenUrl`: what Apple's script is configured with, by `createConnect`. */
  readonly developerToken: tDeveloperTokenProvider;
  as(userToken: string | tTokenProvider): tBrowserMusic;
  forUser(userId: string): tBrowserMusic;
}

const WHAT = "an options object with tokenUrl";

/** `music` with the provider on it, and `as()` and `forUser()` that keep it there. */
function attached(music: tMusic, developerToken: tDeveloperTokenProvider): tBrowserMusic {
  const made: Record<string, unknown> = { ...music, developerToken };
  made.as = (userToken: string | tTokenProvider) => attached(music.as(userToken), developerToken);
  made.forUser = (userId: string) => attached(music.forUser(userId), developerToken);
  return Object.freeze(ownOf(made)) as unknown as tBrowserMusic;
}

/**
 * A client that fetches its developer token from `tokenUrl`, reused and replaced in the background halfway through
 * its life, with the catalog, the listener's library and the playlist verbs on it. The options are checked and
 * taken here, once: what the fetcher checks it names itself, and so does `createClient`. Nothing is fetched until
 * a call.
 */
export function createBrowserClient(options: tBrowserClientOptions): tBrowserMusic {
  if ((options as unknown) === undefined) throw new TypeError(`createBrowserClient: expected ${WHAT}; got undefined`);
  const { tokenUrl, endpoint, ...client } = optionsOf("createBrowserClient", options, WHAT);
  if (typeof tokenUrl !== "string" && !(tokenUrl instanceof URL)) throw new TypeError(`createBrowserClient: tokenUrl must be where your token endpoint is, as a string or a URL; got ${got(tokenUrl)}`);
  if (endpoint !== undefined && !isPlain(endpoint)) throw new TypeError(`createBrowserClient: endpoint must be an options object for the token endpoint, with fetch, timeoutMs or refreshAheadSeconds; got ${got(endpoint)}`);
  const developerToken = developerTokenFetcher(tokenUrl, endpoint);
  return attached(withNamespaces(createClient({ ...client, developerToken }), NAMESPACES), developerToken);
}

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
export type tMusic = tWithNamespaces<{
  /** `catalog` of `@open-music-sdk/client-catalog`. */
  catalog: typeof catalog;
  /** `user` of `@open-music-sdk/client-user`. */
  user: typeof user;
  /** `playlists` of `@open-music-sdk/lib-playlists`. */
  playlists: typeof playlists;
}>;

/** The page's client: `tMusic` with the developer-token provider on it, which `createConnect` takes, and kept through `as()` and `forUser()`. */
export interface tBrowserMusic extends Omit<tMusic, "as" | "forUser"> {
  /** The provider that fetches the token from `tokenUrl`: what Apple's script is configured with, by `createConnect`. */
  readonly developerToken: tDeveloperTokenProvider;
  /** The catalog's functions, bound to this client: `catalog(client)` of `@open-music-sdk/client-catalog`. */
  readonly catalog: tMusic["catalog"];
  /** The listener's library and its functions, bound to this client: `user(client)` of `@open-music-sdk/client-user`. */
  readonly user: tMusic["user"];
  /** The playlist verbs, bound to this client: `playlists(client)` of `@open-music-sdk/lib-playlists`. */
  readonly playlists: tMusic["playlists"];
  /**
   * A client for one listener: the same developer token, limiter, retry policy and hooks, with the namespaces made
   * for it and the provider kept on it.
   *
   * @param userToken - The listener's Music User Token, or a provider that gives it.
   * @returns The listener's client, frozen.
   * @throws TypeError if `userToken` is neither a token nor a function. The three namespaces are fixed here, and
   * each checks nothing but the client it is handed, which is one just made, so this is the whole list.
   */
  as(userToken: string | tTokenProvider): tBrowserMusic;
  /**
   * `as()`, with the token looked up in the client's `userTokenStore` at each request; a listener the store has no
   * token for is a `UserTokenInvalid` at the first request.
   *
   * @param userId - The id the store keeps the listener's token under.
   * @returns The listener's client, frozen.
   * @throws TypeError if the client was made without a `userTokenStore`. The three namespaces are fixed here, and
   * each checks nothing but the client it is handed, which is one just made, so this is the whole list.
   */
  forUser(userId: string): tBrowserMusic;
}

const WHAT = "an options object with tokenUrl";

/**
 * Where the endpoint is, settled when the client is made: against the page's base as it is now, so that a route the
 * page moves to later, a `<base>` put into it later, or a `URL` changed later, moves nothing. Where there is no page
 * yet, as on a server loading a module that makes the client, a relative URL is left to resolve at the first fetch.
 * What cannot be read as a URL is left for the fetcher to refuse under its own name.
 */
function settled(tokenUrl: string | URL): string {
  const base = (globalThis as { document?: { baseURI?: string } }).document?.baseURI;
  try {
    return base === undefined ? (tokenUrl instanceof URL ? tokenUrl.href : tokenUrl) : new URL(tokenUrl, base).href;
  } catch {
    return String(tokenUrl);
  }
}

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
 *
 * @param options - Where the token endpoint is, the endpoint's own options, and every option of core's client but
 * the developer token.
 * @returns The client, frozen, with the three namespaces and the provider on it.
 * @throws TypeError if `options` is not a plain object, `tokenUrl` is neither a string nor a `URL`, `endpoint` is
 * not a plain object, the URL is neither http nor https or carries a username or password, or a value is not what
 * the fetcher or `createClient` takes.
 */
export function createBrowserClient(options: tBrowserClientOptions): tBrowserMusic {
  if ((options as unknown) === undefined) throw new TypeError(`createBrowserClient: expected ${WHAT}; got undefined`);
  const { tokenUrl, endpoint, ...client } = optionsOf("createBrowserClient", options, WHAT);
  if (typeof tokenUrl !== "string" && !(tokenUrl instanceof URL)) throw new TypeError(`createBrowserClient: tokenUrl must be where your token endpoint is, as a string or a URL; got ${got(tokenUrl)}`);
  if (endpoint !== undefined && !isPlain(endpoint)) throw new TypeError(`createBrowserClient: endpoint must be an options object for the token endpoint, with fetch, timeoutMs or refreshAheadSeconds; got ${got(endpoint)}`);
  const developerToken = developerTokenFetcher(settled(tokenUrl), endpoint);
  return attached(withNamespaces(createClient({ ...client, developerToken }), NAMESPACES), developerToken);
}

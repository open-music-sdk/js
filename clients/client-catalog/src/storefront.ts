// Where the catalog is: every storefront has its own, so every path into one holds the storefront's id.
import { segmentOf, type tAppleMusicClient, type tCollection, type tLater } from "@open-music-sdk/core";

/** The option every function that asks a catalog takes: whose catalog. */
export interface tStorefrontOption {
  /**
   * The storefront whose catalog is asked, by its id, such as `"gb"`. Default: the client's, which is the one it
   * was created with, or else the listener's, which the client looks up once.
   */
  readonly storefront?: string | undefined;
}

/**
 * What every request of this package is made with: no Music User Token. Nothing in the catalog is a listener's, so
 * none is sent, whichever client a function is handed and wherever a next link of a walk points.
 */
export const NO_LISTENER = { user: false } as const;

/** A collection of this package's: where it is, and that nothing asked of it carries a listener's token. */
const collection = <C>(where: (fn: string, client: tAppleMusicClient, options: C) => string | tLater<string>): tCollection<C> => Object.assign(where, NO_LISTENER);

/**
 * What `finish` makes of the storefront a call is for. When the call named it, that is there and then. When it did
 * not, the client has to say which it is, and may have to ask Apple for the listener's: that is left for when the
 * request is about to be made, so a walk nobody loops over asks for nothing. Either way the storefront is handed
 * over as one segment of a path, checked and encoded, so one from outside cannot move the request out of the catalog.
 */
export function inStorefront<T>(fn: string, client: tAppleMusicClient, storefront: unknown, finish: (storefront: string) => T): T | tLater<T> {
  const checked = (id: unknown) => finish(segmentOf(fn, "storefront", id));
  // Waited for whatever the client gives: a client is known by its methods, and a wrapped one may answer with the storefront itself where createClient's answers with a promise of it.
  return storefront === undefined ? async () => checked(await client.storefront()) : checked(storefront);
}

/** The collection of one type of resource in a storefront's catalog, such as `songs`, as a declaration takes it. */
export const catalogOf = (type: string): tCollection<tStorefrontOption> => collection((fn, client, options) => inStorefront(fn, client, options.storefront, (storefront) => `v1/catalog/${storefront}/${type}`));

/** Storefronts are not in any storefront's catalog: they are the list of them. */
export const storefronts: tCollection = /*#__PURE__*/ collection(() => "v1/storefronts");

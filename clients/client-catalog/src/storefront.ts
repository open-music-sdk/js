// Where the catalog is: every storefront has its own, so every path into one holds the storefront's id.
import { inStorefront, type tAppleMusicClient, type tCollection, type tLater, type tStorefrontOption } from "@open-music-sdk/core";

/**
 * What every request of this package is made with: no Music User Token. Nothing in the catalog is a listener's, so
 * none is sent, whichever client a function is handed and wherever a next link of a walk points.
 */
export const NO_LISTENER = { user: false } as const;

/** A collection of this package's: where it is, and that nothing asked of it carries a listener's token. */
const collection = <C>(where: (fn: string, client: tAppleMusicClient, options: C) => string | tLater<string>): tCollection<C> => Object.assign(where, NO_LISTENER);

/** The collection of one type of resource in a storefront's catalog, such as `songs`, as a declaration takes it. */
export const catalogOf = (type: string): tCollection<tStorefrontOption> => collection((fn, client, options) => inStorefront(fn, client, options.storefront, (storefront) => `v1/catalog/${storefront}/${type}`));

/** Storefronts are not in any storefront's catalog: they are the list of them. */
export const storefronts: tCollection = /*#__PURE__*/ collection(() => "v1/storefronts");

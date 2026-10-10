// Every function of this package bound to one client, for code that holds a client and wants what the answers
// hold. It is what an integration composes as `music.catalog`.
import { endpointNamespace, type tAppleMusicClient, type tEndpointNamespace } from "@open-music-sdk/core";
import * as discover from "./discover";
import * as resources from "./resources";

/**
 * The catalog as one client sees it: each function of this package under its own name, taking the same arguments
 * without the client, and handing over what the answer holds. A `get` of one resource gives the resource, a `get`
 * of several gives the list, and a `list`, a relationship or a view gives every item of every page as it is looped
 * over. Search, hints, suggestions, charts and the language tag give Apple's answer as it is.
 */
export type tCatalog = tEndpointNamespace<typeof resources & typeof discover>;

/** The catalog for one client. What it gives cannot be changed. */
export function catalog(client: tAppleMusicClient): tCatalog {
  // Gathered here and not beside the imports, so that code which never calls this carries none of the functions it did not import itself.
  return endpointNamespace("catalog", client, { ...resources, ...discover });
}

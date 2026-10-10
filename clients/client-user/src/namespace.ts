// Every function of this package bound to one client, for code that holds a listener's client and wants what the
// answers hold. It is what an integration composes as `music.user`.
import { endpointNamespace, type tAppleMusicClient, type tEndpointNamespace } from "@open-music-sdk/core";
import * as library from "./library";
import * as ratings from "./ratings";
import * as resources from "./resources";

/**
 * A listener's side of Apple Music as one client sees it: each function of this package under its own name, taking
 * the same arguments without the client, and handing over what the answer holds. A `get` of one resource, a
 * `create` and a `set` give the resource, a `get` of several gives the list, and a `list` or a relationship gives
 * every item of every page as it is looped over. A search gives Apple's answer as it is, and what adds or deletes
 * gives nothing.
 */
export type tUser = tEndpointNamespace<typeof resources & typeof ratings & typeof library>;

/** The listener's side for one client, which has to be a listener's: one made with a Music User Token. What it gives cannot be changed. */
export function user(client: tAppleMusicClient): tUser {
  // Gathered here and not beside the imports, so that code which never calls this carries none of the functions it did not import itself.
  return endpointNamespace("user", client, { ...resources, ...ratings, ...library });
}

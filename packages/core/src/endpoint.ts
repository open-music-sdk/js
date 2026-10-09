// A function for one endpoint is declared once, and both of its forms come from the declaration. Called with a
// client, it resolves to what Apple answered. Bound to a client, it hands over what the answer holds: the resource,
// the list of them, or every item of every page. The client packages are made of these.
import type { tRelationshipResponse } from "@open-music-sdk/types";
import { clientOf, listOf, optionsOf, segmentOf } from "./check";
import { pageOf, type tAppleMusicClient, type tPage, type tRequestInit } from "./client";
import { AppleMusicError } from "./errors";
import { got } from "./got";
import { initOf, type tReadOptions } from "./options";

/** A request as `client.request` takes it: where it goes, and what goes with it. */
export type tRequestPlan<R> = readonly [path: string, init?: tRequestInit<R>];

/**
 * A function for one endpoint. Called with a client it resolves to what Apple answered. `bound(client)` is the same
 * call with the client fixed and the answer unwrapped, and is what an endpoint namespace is made of.
 */
export interface tEndpoint<A extends readonly unknown[], R, U> {
  (client: tAppleMusicClient, ...args: A): Promise<R>;
  readonly bound: (client: tAppleMusicClient) => (...args: A) => U;
}

/** An answer whose resources are under `data`. */
export interface tResources {
  readonly data: readonly unknown[];
}

/** What an answer holds under `data`, one at a time. */
export type tItem<R> = R extends { readonly data?: readonly (infer T)[] | undefined } ? T : never;

/** An answer that may be one page of several: Apple documents the collection, and sends `next` when there is more. */
export type tPaged<R> = R & { readonly next?: string | undefined };

/**
 * How a bound function hands the answer over: the one `resource` it holds, the `resources` it holds, every item
 * of all its `pages`, or the `answer` as it is.
 */
export type tUnwrap = "resource" | "resources" | "pages" | "answer";

/** The client's methods a function for an endpoint may call. */
const METHODS = ["paginate", "request", "storefront"] as const;
const OPTIONS = "an options object";

type tPlan<A extends readonly unknown[], R> = (client: tAppleMusicClient, ...args: A) => tRequestPlan<R> | Promise<tRequestPlan<R>>;

/**
 * Declares a function for one endpoint. `plan` turns the function's arguments into a request, checking them as it
 * goes: it is where a mistake becomes a TypeError naming `fn`, before Apple is asked. `unwrap` says what the bound
 * form hands over.
 *
 * A bound function that walks pages asks for nothing, and checks nothing, until its loop starts.
 */
export function endpoint<A extends readonly unknown[], R extends tResources>(fn: string, unwrap: "resource", plan: tPlan<A, R>): tEndpoint<A, R, Promise<tItem<R>>>;
export function endpoint<A extends readonly unknown[], R extends tResources>(fn: string, unwrap: "resources", plan: tPlan<A, R>): tEndpoint<A, R, Promise<tItem<R>[]>>;
export function endpoint<A extends readonly unknown[], R extends tPage<unknown>>(fn: string, unwrap: "pages", plan: tPlan<A, R>): tEndpoint<A, R, AsyncIterable<tItem<R>>>;
export function endpoint<A extends readonly unknown[], R>(fn: string, unwrap: "answer", plan: tPlan<A, R>): tEndpoint<A, R, Promise<R>>;
export function endpoint(fn: string, unwrap: tUnwrap, plan: tPlan<unknown[], unknown>): tEndpoint<unknown[], unknown, unknown> {
  const send = async (client: tAppleMusicClient, ...args: unknown[]): Promise<unknown> => {
    const music = clientOf(fn, client, METHODS);
    const [path, init] = await plan(music, ...args);
    return music.request(path, init);
  };
  const bound = (client: tAppleMusicClient) => {
    const music = clientOf(fn, client, METHODS);
    if (unwrap === "answer") return (...args: unknown[]) => send(music, ...args);
    if (unwrap === "pages")
      return async function* (...args: unknown[]): AsyncIterable<unknown> {
        const [path, init] = await plan(music, ...args);
        yield* music.paginate(path, init as tRequestInit<tPage<unknown>>);
      };
    return async (...args: unknown[]): Promise<unknown> => {
      const { data } = pageOf(await send(music, ...args), fn);
      if (unwrap === "resources") return data;
      // A success that holds no resource is not the resource: it is said, not handed over as undefined.
      if (data[0] == null) throw new AppleMusicError("ApiError", `${fn}: Apple answered with no resource`, { status: 200 });
      return data[0];
    };
  };
  return Object.assign(send, { bound });
}

/**
 * Where a collection is for one call, such as `v1/catalog/us/songs`: a path with nothing after it. It is handed
 * the options the call was given, already known to be an object, and may ask the client, as a catalog does for a
 * storefront no option named. Everything else a call was handed has been checked by the time it is asked.
 */
export type tCollection<O> = (fn: string, client: tAppleMusicClient, options: O) => string | Promise<string>;

/** A function for the resource with one id in a collection: `GET {collection}/{id}`. `also` names any options it takes beyond `tReadOptions`. */
export function resourceGetter<R extends tResources, O extends tReadOptions<R> = tReadOptions<R>>(fn: string, collection: tCollection<O>, also?: readonly string[]): tEndpoint<[id: string, options?: O], R, Promise<tItem<R>>> {
  return endpoint(fn, "resource", async (client, id: string, options?: O) => {
    const bag = optionsOf(fn, options, OPTIONS);
    const init = initOf<R>(fn, bag, {}, also);
    const segment = segmentOf(fn, "id", id);
    return [`${await collection(fn, client, bag)}/${segment}`, init];
  });
}

/** A function for the resources with the ids given: `GET {collection}?ids=`. */
export function resourcesGetter<R extends tResources, O extends tReadOptions<R> = tReadOptions<R>>(fn: string, collection: tCollection<O>, also?: readonly string[]): tEndpoint<[ids: readonly string[], options?: O], R, Promise<tItem<R>[]>> {
  return endpoint(fn, "resources", async (client, ids: readonly string[], options?: O) => {
    const bag = optionsOf(fn, options, OPTIONS);
    const init = initOf<R>(fn, bag, { ids: listOf(fn, "ids", ids) }, also);
    return [await collection(fn, client, bag), init];
  });
}

/** A function for a whole collection, a page at a time: `GET {collection}`. */
export function resourceLister<R extends tResources, O extends tReadOptions<tPaged<R>> = tReadOptions<tPaged<R>>>(fn: string, collection: tCollection<O>, also?: readonly string[]): tEndpoint<[options?: O], tPaged<R>, AsyncIterable<tItem<R>>> {
  return endpoint(fn, "pages", async (client, options?: O) => {
    const bag = optionsOf(fn, options, OPTIONS);
    const init = initOf<tPaged<R>>(fn, bag, {}, also);
    return [await collection(fn, client, bag), init];
  });
}

/** What the relationship `K` of `Rels` holds: the kind of resource under its `data`. */
export type tRelated<Rels, K extends keyof Rels> = tItem<NonNullable<Rels[K]>>;

/** What Apple answers when a relationship is asked for by name: a page of what it holds. */
export type tRelationshipPage<Rels, K extends keyof Rels> = Omit<tRelationshipResponse, "data"> & { data: tRelated<Rels, K>[] };

/**
 * A function for a resource's relationships: `GET {collection}/{id}/{name}`. `Rels` is the resource's relationships
 * as the generated types have them, such as `tAlbumRelationships`: its keys are the names that may be asked for,
 * and the name asked for decides what comes back.
 */
export interface tRelationshipEndpoint<Rels, O> {
  <K extends keyof Rels & string>(client: tAppleMusicClient, id: string, name: K, options?: O): Promise<tRelationshipPage<Rels, K>>;
  readonly bound: (client: tAppleMusicClient) => <K extends keyof Rels & string>(id: string, name: K, options?: O) => AsyncIterable<tRelated<Rels, K>>;
}

/** The names are held to `Rels` by the types alone: at runtime a name is any one segment of a path, and Apple says whether there is such a relationship. */
export function relationshipGetter<Rels, O extends tReadOptions<tRelationshipResponse> = tReadOptions<tRelationshipResponse>>(fn: string, collection: tCollection<O>): tRelationshipEndpoint<Rels, O> {
  const declared = endpoint(fn, "pages", async (client, id: string, name: string, options?: O) => {
    const bag = optionsOf(fn, options, OPTIONS);
    const init = initOf<tRelationshipResponse>(fn, bag);
    const segments = `${segmentOf(fn, "id", id)}/${segmentOf(fn, "name", name)}`;
    return [`${await collection(fn, client, bag)}/${segments}`, init];
  });
  // What is declared takes any name and gives any resource; the type handed out ties the one to the other.
  return declared as unknown as tRelationshipEndpoint<Rels, O>;
}

/**
 * Each function of `F` bound to one client, under its own name. Whatever in `F` is not a function for an endpoint
 * is left out.
 */
export type tEndpointNamespace<F> = {
  readonly [K in keyof F as F[K] extends { readonly bound: (client: tAppleMusicClient) => unknown } ? K : never]: F[K] extends { readonly bound: (client: tAppleMusicClient) => infer B } ? B : never;
};

const isEndpoint = (value: unknown): value is { readonly bound: (client: tAppleMusicClient) => unknown } => typeof value === "function" && typeof (value as { bound?: unknown }).bound === "function";

/**
 * Binds every function in `endpoints` to `client`: `{ getSong, getSongs }` becomes an object whose `getSong(id)`
 * and `getSongs(ids)` need no client and hand over what the answer holds. `endpoints` is an object of functions
 * made here, such as a module of them; it is read once, and the namespace it gives cannot be changed.
 */
export function endpointNamespace<F extends object>(fn: string, client: tAppleMusicClient, endpoints: F): tEndpointNamespace<F> {
  const music = clientOf(fn, client, METHODS);
  if (typeof endpoints !== "object" || (endpoints as unknown) === null) throw new TypeError(`${fn}: endpoints must be an object of functions for endpoints; got ${got(endpoints)}`);
  const bound = Object.entries(endpoints).flatMap(([name, value]: [string, unknown]) => (isEndpoint(value) ? [[name, value.bound(music)] as const] : []));
  // From entries, so that a function named `__proto__` is one more function and nothing else.
  return Object.freeze(Object.fromEntries(bound)) as tEndpointNamespace<F>;
}

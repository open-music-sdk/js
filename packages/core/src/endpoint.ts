// A function for one endpoint is declared once, and both of its forms come from the declaration. Called with a
// client, it resolves to what Apple answered. Bound to a client, it hands over what the answer holds: the resource,
// the list of them, or every item of every page. The client packages are made of these.
import type { tRelationshipResponse } from "@open-music-sdk/types";
import { clientOf, isBracketed, listOf, optionsOf, ownOf, segmentOf } from "./check";
import { pageOf, type tAppleMusicClient, type tPage, type tRequestInit } from "./client";
import { AppleMusicError } from "./errors";
import { got } from "./got";
import { initOf, walkOf, type tAlsoKinds, type tReadOptions, type tWalkOptions } from "./options";

/** A request as `client.request` takes it: where it goes, and what goes with it. A walk's may also say how many pages it may ask for. */
export type tRequestPlan<R> = readonly [path: string, init?: tRequestInit<R> & tWalkOptions];

/**
 * A function for one endpoint. Called with a client it resolves to what Apple answered. `bound(client)` is the same
 * call with the client fixed and the answer unwrapped, and is what an endpoint namespace is made of. `unwrap` says
 * how, and is on the function so that a reader of it, or anything built over it, can tell a write from a read.
 */
export interface tEndpoint<A extends readonly unknown[], R, U, K extends tUnwrap = tUnwrap> {
  /**
   * Asks Apple, with `client`. Everything handed over is checked as the call is made, before Apple is asked, and a
   * mistake is a TypeError naming the function. Which arguments there are is the function's own to say.
   *
   * @param client - The client to ask with.
   * @param args - The function's own arguments, as it declares them: an id, a list of ids, a name, options.
   * @returns What Apple answered, parsed, as the function's answer type says.
   * @throws TypeError if `client` is no client, an argument is not what it should be, or the collection's path could
   * not be asked for as written; before this endpoint is asked.
   * @throws AppleMusicError as `client.request` rejects with, `_tag` says which; or as `client.storefront()` rejects
   * with, where the collection asks it.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  (client: tAppleMusicClient, ...args: A): Promise<R>;
  /**
   * The same call with the client fixed and the answer unwrapped as `unwrap` says. Binding checks the client and
   * nothing else; the arguments are checked as the bound function is called. Beyond what the call throws, a
   * `resource` or `resources` function rejects with an `ApiError` when a success is no object, or its `data` is
   * there and is no list, and a `resource` function also when the success holds no resource; a `pages` function
   * hands over an iterable that asks for nothing until a loop starts, and throws from the loop what
   * `client.paginate` does, an `ApiError` for a page that is none among them.
   */
  readonly bound: (client: tAppleMusicClient) => (...args: A) => U;
  /** The kind the function was declared with: what its bound form hands over. */
  readonly unwrap: K;
}

/** An answer whose resources are under `data`. */
export interface tResources {
  /** The resources Apple answered with. */
  readonly data: readonly unknown[];
}

/** What an answer holds under `data`, one at a time. */
export type tItem<R> = R extends {
  /** The items. */
  readonly data?: readonly (infer T)[] | undefined;
}
  ? T
  : never;

/** An answer that may be one page of several: Apple documents the collection, and sends `next` when there is more. */
export type tPaged<R> = R & {
  /** Where the next page is, when there is more. */
  readonly next?: string | undefined;
};

/**
 * How a bound function hands the answer over: the one `resource` it holds, the `resources` it holds, every item
 * of all its `pages`, what a write has `written`, or the `answer` as it is.
 *
 * `written` is for a function that makes or changes something. It hands over the resource the answer holds, as
 * `resource` does, and `undefined` where a success holds none: the write happened either way, and an error there
 * would have a caller make the same thing again.
 */
export type tUnwrap = "resource" | "resources" | "pages" | "written" | "answer";

const UNWRAPS: readonly unknown[] = ["resource", "resources", "pages", "written", "answer"] satisfies readonly tUnwrap[];
/** The client's methods a function for an endpoint may call. */
const METHODS = ["paginate", "request", "storefront"] as const;
const OPTIONS = "an options object";

/**
 * What is left for when a request is about to be made: a function that is not called until then. It is how a plan,
 * or a collection, puts off what means asking the client, such as which storefront is the listener's. Everything a
 * call was handed is checked as the call is made; this is the part that has to wait.
 */
export type tLater<T> = () => T | Promise<T>;

/** What a plan gives: the request, a promise of it, or the rest of the plan to run when the request is about to be made. */
export type tPlanned<R> = tRequestPlan<R> | Promise<tRequestPlan<R>> | tLater<tRequestPlan<R>>;

/** What a declaration hands `endpoint`: from the client and the arguments of the call, the request to make, or a promise of it, or the rest of the plan. */
export type tPlan<A extends readonly unknown[], R> = (client: tAppleMusicClient, ...args: A) => tPlanned<R>;

const isWaited = (value: unknown): value is PromiseLike<unknown> => typeof (value as { then?: unknown } | null | undefined)?.then === "function";

/** What a plan gave, as the request it has to be: a path, and an init or nothing. Anything else is the mistake of whoever declared the function. */
function planOf(fn: string, planned: unknown): tRequestPlan<unknown> {
  const [path, init] = Array.isArray(planned) ? (planned as unknown[]) : [];
  if (typeof path !== "string" || !(init === undefined || (typeof init === "object" && init !== null))) throw new TypeError(`${fn}: its plan must give [path, init]; got ${got(planned)}`);
  return init === undefined ? [path] : [path, init];
}

/** What a plan gave, with whatever it left for later begun: the request is about to be made. */
const begun = (planned: unknown): unknown => (typeof planned === "function" ? (planned as () => unknown)() : planned);

/** What a plan gave, checked: there and then when it is there at once, and when it comes otherwise. */
const settled = (fn: string, planned: unknown): tRequestPlan<unknown> | Promise<tRequestPlan<unknown>> => (isWaited(planned) ? Promise.resolve(planned).then((late) => planOf(fn, late)) : planOf(fn, planned));

/** The first resource a write's answer holds under `data`, read as the answer's own, or `undefined` when it holds none or is no such answer. */
function made(body: unknown): unknown {
  const data: unknown = typeof body === "object" && body !== null ? ownOf(body as { readonly data?: unknown }).data : undefined;
  return Array.isArray(data) ? ((data[0] as unknown) ?? undefined) : undefined;
}

/**
 * The name a declaration gives its function, checked. It is the first thing a declaration is handed and the first
 * thing checked, by every function that makes one, so that a mistake in a declaration is named in the order it was
 * written, as a mistake in a call is.
 */
function named(builder: string, fn: unknown): void {
  if (typeof fn !== "string" || fn === "") throw new TypeError(`${builder}: fn must be the name of the function, a string with something in it; got ${got(fn)}`);
}

/**
 * What every declaration comes to, whichever function made it. `builder` is that function's name: a declaration is
 * checked as it is made, so a mistake in one is found when the module loads and names what was called.
 */
function declare<A extends readonly unknown[], R, U, K extends tUnwrap>(builder: string, fn: string, unwrap: K, plan: tPlan<A, R>): tEndpoint<A, R, U, K> {
  named(builder, fn);
  if (!UNWRAPS.includes(unwrap)) throw new TypeError(`${builder}: unwrap must be "resource", "resources", "pages", "written" or "answer"; got ${got(unwrap)}`);
  if (typeof plan !== "function") throw new TypeError(`${builder}: plan must be a function; got ${got(plan)}`);
  const planFor = plan as unknown as tPlan<unknown[], unknown>;

  /** One call, planned and asked for: what Apple answered, and with what status, when the client says. */
  const ask = async (music: tAppleMusicClient, args: unknown[]): Promise<{ readonly body: unknown; readonly status: number | undefined }> => {
    const [path, planned = {}] = await settled(fn, begun(planFor(music, ...args)));
    // What the plan's init holds itself. A hook that other code has put on Object.prototype is not the plan's, and
    // is neither called nor, where it is no function, the reason a request that was answered is said to have failed.
    const init = ownOf(planned);
    let status: number | undefined;
    const body = await music.request(path, {
      ...init,
      // `request` resolves to the body alone. The status comes by its hook, which a plan may have a use for as well.
      onResponse: (res, req, outcome) => {
        status = res.status;
        init.onResponse?.(res, req, outcome);
      },
    });
    return { body, status };
  };
  const send = async (client: tAppleMusicClient, ...args: unknown[]): Promise<unknown> => (await ask(clientOf(fn, client, METHODS), args)).body;
  const bound = (client: tAppleMusicClient) => {
    const music = clientOf(fn, client, METHODS);
    if (unwrap === "answer") return (...args: unknown[]) => send(music, ...args);
    if (unwrap === "pages")
      return (...args: unknown[]): AsyncIterable<unknown> => {
        // Planned as the function is called, so that what it was handed is checked and taken here. What the plan
        // left for later is the part that asks the client, and it is begun by each loop as the loop starts.
        const planned: unknown = planFor(music, ...args);
        const now = typeof planned === "function" ? undefined : settled(fn, planned);
        // A plan that is a promise is already on its way, and may fail while no loop is listening. That is kept
        // for the loop to hear, and is nobody's unhandled rejection in the meantime.
        void Promise.resolve(now).catch(() => undefined);
        return {
          async *[Symbol.asyncIterator]() {
            const [path, init] = await (now ?? settled(fn, begun(planned)));
            yield* music.paginate(path, init as tRequestInit<tPage<unknown>>);
          },
        };
      };
    return async (...args: unknown[]): Promise<unknown> => {
      const { body, status } = await ask(music, args);
      // A write that succeeded has happened, whatever its answer holds: the resource when there is one, and nothing otherwise.
      if (unwrap === "written") return made(body);
      const { data } = pageOf(body, fn, status);
      if (unwrap === "resources") return data;
      // A success that holds no resource is not the resource: it is said, with the status it came with, not handed over as undefined.
      if (data[0] == null) throw new AppleMusicError("ApiError", `${fn}: Apple answered with no resource`, { status });
      return data[0];
    };
  };
  // Frozen, so that what a namespace binds is what was declared: nothing can put another `bound`, or another kind, in its place.
  return Object.freeze(Object.assign(send, { bound, unwrap })) as unknown as tEndpoint<A, R, U, K>;
}

/**
 * Declares a function for one endpoint. `plan` turns the function's arguments into a request, `[path, init]`,
 * checking them as it goes: it is where a mistake becomes a TypeError naming `fn`, before Apple is asked. `unwrap`
 * says what the bound form hands over. The declaration itself is checked as it is made, and what it gives is frozen.
 *
 * A bound function that walks pages is planned when it is called, like any other, so what it is handed is checked
 * and taken then: a mistake the plan throws is thrown from the call. Apple is asked for nothing until a loop
 * starts, and each loop over what the call gave asks afresh. A plan that has to ask the client for something gives
 * the rest of itself as a function, a `tLater`, which is what keeps that asking for the loop as well.
 *
 * `written` with a plan whose answer is `void` is for a write whose answer holds nothing, such as an add or a delete:
 * bound, it resolves to `undefined`, and the write happened.
 *
 * @param fn - The function's name, as its errors say it.
 * @param unwrap - What the bound form hands over: the `resource`, the `resources`, every item of all its `pages`, what
 * a write has `written`, or the `answer` as it is.
 * @param plan - From the client and the arguments of a call, the request to make: `[path, init]`, a promise of it, or
 * the rest of the plan as a function to call when the request is about to be made. It checks the arguments, and
 * throws a TypeError for a mistake.
 * @returns The function, frozen, with `bound` and `unwrap` on it.
 * @throws TypeError if `fn` is not a string with something in it, `unwrap` is none of the five kinds, or `plan` is no
 * function.
 */
export function endpoint<A extends readonly unknown[], R extends tResources>(fn: string, unwrap: "resource", plan: tPlan<A, R>): tEndpoint<A, R, Promise<tItem<R>>, "resource">;
export function endpoint<A extends readonly unknown[], R extends tResources>(fn: string, unwrap: "resources", plan: tPlan<A, R>): tEndpoint<A, R, Promise<tItem<R>[]>, "resources">;
export function endpoint<A extends readonly unknown[], R extends tPage<unknown>>(fn: string, unwrap: "pages", plan: tPlan<A, R>): tEndpoint<A, R, AsyncIterable<tItem<R>>, "pages">;
export function endpoint<A extends readonly unknown[], R extends tResources>(fn: string, unwrap: "written", plan: tPlan<A, R>): tEndpoint<A, R, Promise<tItem<R> | undefined>, "written">;
export function endpoint<A extends readonly unknown[]>(fn: string, unwrap: "written", plan: tPlan<A, void>): tEndpoint<A, void, Promise<undefined>, "written">;
export function endpoint<A extends readonly unknown[], R>(fn: string, unwrap: "answer", plan: tPlan<A, R>): tEndpoint<A, R, Promise<R>, "answer">;
export function endpoint(fn: string, unwrap: tUnwrap, plan: tPlan<unknown[], unknown>): tEndpoint<unknown[], unknown, unknown> {
  return declare("endpoint", fn, unwrap, plan);
}

/**
 * Where a collection is for one call, such as `v1/catalog/us/songs`: a path with nothing after it. It is handed
 * the options the call was given, of which `C` is the part it reads, and may ask the client, as a catalog does for
 * a storefront no option named. Everything else a call was handed has been checked by the time it is asked.
 *
 * A collection that has to ask the client gives a function for the path, a `tLater`, in place of the path. That
 * function is called when a request is about to be made: at once for a function that asks for one thing, and as
 * each loop starts for one that walks pages, so that a walk nobody loops over asks for nothing at all. A promise is
 * taken too, and is on its way from the moment the collection gave it.
 *
 * What it gives is checked before it is asked for: plain ASCII segments with single slashes between, none of them
 * "." or "..", and no question mark, hash or backslash. A path that is not is a TypeError that says what is wrong
 * with it, and never shows it:
 *
 * | A path that | Is refused because |
 * | --- | --- |
 * | holds a segment that is `.` or `..`, written out or as `%2e` | a URL reads them as "here" and "one up", so the request would go to another path |
 * | holds a backslash | a URL reads it as a slash, so it would begin another segment |
 * | holds a question mark | it begins the query, so what follows would not be part of the path |
 * | holds a hash | it begins a fragment, so what follows would not be sent |
 * | holds a space, a tab, a line break or another control character | a URL drops or trims it, joining what was on either side |
 * | holds a character outside ASCII | a URL rewrites it |
 * | holds an empty segment | two slashes together, or one at the end, leave out what was meant to be there |
 * | begins with a name and a colon | a URL reads it as a scheme, and the rest as another address |
 * | is empty, longer than 256 characters, or no string | no collection's path is |
 *
 * So a storefront from outside cannot move a request under `/v1/me`, where the client sends the Music User Token.
 * A collection that checks its own parts with `segmentOf` gets to name the option that was wrong.
 */
export interface tCollection<C = tNone> {
  /**
   * The collection's path for one call. What it throws, the function throws as it is, from the call: a collection
   * that reads an option should throw a TypeError naming `fn` for one that is not what it should be, as `segmentOf` does.
   *
   * @param fn - The name of the function the call was made to, for errors.
   * @param client - The client the call is made with, for what only it can say, such as the listener's storefront.
   * @param options - The options the call was given, read as the collection's own; the rest are checked elsewhere.
   * @returns The path, such as `v1/catalog/us/songs`; a promise of it; or a function that gives either when the
   * request is about to be made.
   */
  (fn: string, client: tAppleMusicClient, options: C): string | Promise<string> | tLater<string>;
  /**
   * Whether what is asked of this collection carries the Music User Token. Left out, the client goes by the path,
   * and sends it under /v1/me. `false` holds for every page of a walk, wherever a next link points: it is how a
   * catalog says that nothing asked of it is the listener's. `true` sends it outside /v1/me as well.
   */
  readonly user?: boolean | undefined;
}

/** No options of that kind: an object, so that what is left of the options is still nothing but an object. */
export type tNone = object;

/**
 * The options a function takes: the ones every function takes, the ones its collection reads (`C`, such as a
 * storefront), and the ones sent as parameters under their own names (`E`, such as `views`).
 */
export type tEndpointOptions<T, C = tNone, E = tNone> = tReadOptions<T> & C & E;

/**
 * Every option of `E` by name, with what it is: a `"list"` where its type is a list, and a `"name"` where it is one
 * string. All of them have to be there, and nothing else can be: an option that is typed is an option that is sent,
 * and is held, when a call is made, to being what its type says.
 */
export type tAlso<E> = { readonly [K in keyof E]-?: NonNullable<E[K]> extends readonly unknown[] ? "list" : "name" };

/**
 * The `also` argument as a declaration takes it: when `E` names options, one `tAlso<E>` that says what each is, and
 * when it names none, nothing at all.
 */
export type tAlsoGiven<E> = [keyof E] extends [never] ? [also?: undefined] : [also: tAlso<E>];

/**
 * The collection a declaration takes, once it has said `R`, the type of the answer. With `R` left to be inferred it
 * is `never`: a declaration that does not say what Apple answers has nothing it can pass here, and the types refuse it.
 */
export type tCollectionGiven<R, C> = [R] extends [never] ? never : tCollection<C>;

/** Longer than any collection's path, which is a handful of short segments. */
const MAX_PATH = 256;

/**
 * Why a path would not be asked for as it is written, or `undefined` when it would be. Each reason is something a
 * URL reads as other than a plain character, so that the request would go somewhere the path does not say.
 */
function hazardOf(path: string): string | undefined {
  if (path.length > MAX_PATH) return `is longer than ${String(MAX_PATH)} characters, which no collection's path is`;
  // The first character that is not printable ASCII, if there is one: at or below DEL it is a space or a control character.
  const odd = /[^\x21-\x7e]/.exec(path)?.[0];
  if (odd !== undefined && odd <= "\u007f") return "holds a space, a tab, a line break or another control character, which a URL drops or trims, joining what was on either side of it";
  if (odd !== undefined) return "holds a character outside ASCII, which a URL rewrites, so that what is asked for would not be what was written";
  if (path.includes("\\")) return "holds a backslash, which a URL reads as a slash, so that it would begin another segment";
  if (path.includes("?")) return "holds a question mark, which begins the query, so that what follows it would not be part of the path";
  if (path.includes("#")) return "holds a hash, which begins a fragment, so that what follows it would not be sent at all";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return "begins with a name and a colon, which a URL reads as a scheme, so that the rest would be read as another address";
  const segments = path.replace(/^\//, "").split("/");
  if (segments.includes("")) return "holds an empty segment, from two slashes together or a slash at its end, so that what was meant to fill it is missing";
  if (segments.some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) return 'holds a segment that is "." or "..", written out or percent-encoded, which a URL reads as "here" and "one up", so that the request would go to another path';
  return undefined;
}

/**
 * The path a collection gave, or a TypeError that says why it cannot be asked for. A collection's path is the one
 * part of a request this file does not build, and what goes into it, a storefront above all, may have come from
 * outside the app. Whatever it was is described by what is wrong with it, and never shown.
 */
function collectionOf(fn: string, path: unknown): string {
  if (typeof path !== "string" || path === "") throw new TypeError(`${fn}: the path of the collection must be a string with something in it; got ${got(path)}`);
  const hazard = hazardOf(path);
  if (hazard === undefined) return path;
  throw new TypeError(`${fn}: the path of the collection ${hazard}`);
}

/**
 * A plan finished with the collection's path: there and then when the collection gives it at once, when it comes
 * when it is a promise, and when the request is about to be made when the collection left it for later. Whichever,
 * the path is checked before it is used. The plans below are not async for this reason: what they check, they
 * check as they are called, and throw there.
 */
function located<R>(fn: string, path: string | Promise<string> | tLater<string>, finish: (collection: string) => tRequestPlan<R>): tPlanned<R> {
  const found = (given: string | Promise<string>) => (isWaited(given) ? Promise.resolve(given).then((late) => finish(collectionOf(fn, late))) : finish(collectionOf(fn, given)));
  // Left for later by the collection, and so by the plan: the path is asked for, and checked, when the request is about to be made.
  return typeof path === "function" ? () => found(path()) : found(path);
}

/**
 * The collection and the further options a declaration was given, checked as it is made. The names are this
 * declaration's own copy, so nothing done to the object afterwards changes what its function sends.
 */
function given<C>(builder: string, collection: unknown, also: unknown): readonly [collection: tCollection<C>, also: tAlsoKinds, user: boolean | undefined] {
  if (typeof collection !== "function") throw new TypeError(`${builder}: collection must be a function that gives the collection's path; got ${got(collection)}`);
  // Its own, and not one found on a prototype: `user` put on Object.prototype by other code is not this collection's say.
  const user: unknown = Object.hasOwn(collection, "user") ? (collection as { user?: unknown }).user : undefined;
  if (user !== undefined && typeof user !== "boolean") throw new TypeError(`${builder}: collection.user must be true or false where it is given; got ${got(user)}`);
  const kinds: [string, unknown][] = typeof also === "object" && also !== null && !Array.isArray(also) ? Object.entries(also) : [];
  if ((also !== undefined && (typeof also !== "object" || also === null || Array.isArray(also))) || kinds.some(([, kind]) => kind !== "list" && kind !== "name")) {
    throw new TypeError(`${builder}: also must be an object that says what each further option is, a "list" or a "name", such as { views: "list" }; got ${got(also)}`);
  }
  return [collection as tCollection<C>, Object.fromEntries(kinds) as tAlsoKinds, user];
}

/** The option of a function that asks one storefront's catalog: whose catalog. */
export interface tStorefrontOption {
  /**
   * The storefront whose catalog is asked, by its id, such as `"gb"`. Default: the client's, which is the one it
   * was created with, or else the listener's, which the client looks up once.
   */
  readonly storefront?: string | undefined;
}

/** The option of a function for a resource that has views: which of them to send with the resource. */
export interface tViewsOption<Views> {
  /** The views to send with the resource, by name, such as `["top-songs"]`. Default: none. */
  readonly views?: readonly (keyof Views & string)[] | undefined;
}

/**
 * What `finish` makes of the storefront a call is for. When the call named it, that is there and then. When it did
 * not, the client has to say which it is, and may have to ask Apple for the listener's: that is left for when the
 * request is about to be made, so a walk nobody loops over asks for nothing. Either way the storefront is handed
 * over as one segment of a path, checked and encoded, so one from outside cannot move the request to another path.
 *
 * @param fn - The name of the function the call was made to, for the error.
 * @param client - The client the call is made with, asked for its storefront when the call named none.
 * @param storefront - The storefront the call named, or `undefined` for the client's.
 * @param finish - What to make of the storefront as one encoded segment, such as the collection's path.
 * @returns What `finish` gave, when the call named a storefront; otherwise a function that asks the client, checks
 * its answer and gives what `finish` makes of it, for when the request is about to be made. That function rejects
 * with what `client.storefront()` rejects with, and with a TypeError when the client's answer is no segment.
 * @throws TypeError if `storefront` is given and is not one segment of a path, as `segmentOf` holds it to be.
 */
export function inStorefront<T>(fn: string, client: tAppleMusicClient, storefront: unknown, finish: (storefront: string) => T): T | tLater<T> {
  const checked = (id: unknown) => finish(segmentOf(fn, "storefront", id));
  // Waited for whatever the client gives: a client is known by its methods, and a wrapped one may answer with the storefront itself where createClient's answers with a promise of it.
  return storefront === undefined ? async () => checked(await client.storefront()) : checked(storefront);
}

/** What a request is made with, with the collection's say on the Music User Token where it has one. */
const pinned = <I extends object>(init: I, user: boolean | undefined): I => (user === undefined ? init : { ...init, user });

/**
 * A function for the resource with one id in a collection: `GET {collection}/{id}`. `R` is the answer's type and has
 * to be said. `also` names the options of `E`, the ones the function takes beyond everyone's and the collection's.
 *
 * The function it gives takes an `id` and `options`, checks the id as one segment of a path and the options as
 * `tEndpointOptions`, and throws and resolves as `tEndpoint` says. Bound, it hands over the one resource.
 *
 * @param fn - The function's name, as its errors say it.
 * @param collection - Where the resources are: the path with nothing after it, or how to ask the client for it.
 * @param also - What each option of `E` is, a `"list"` or a `"name"`; left out when `E` names none.
 * @returns The function, frozen, with `bound` and `unwrap` on it.
 * @throws TypeError if `fn` is not a string with something in it, `collection` is no function, its `user` is given
 * and is no boolean, or `also` is not an object that says `"list"` or `"name"` for each option.
 */
export function resourceGetter<R extends tResources = never, C extends object = tNone, E extends object = tNone>(
  fn: string,
  collection: tCollectionGiven<R, C>,
  ...also: tAlsoGiven<E>
): tEndpoint<[id: string, options?: tEndpointOptions<R, C, E>], R, Promise<tItem<R>>, "resource"> {
  named("resourceGetter", fn);
  const [locate, names, user] = given<C>("resourceGetter", collection, (also as readonly unknown[])[0]);
  // Here and below, what a call was handed is checked in the order it was handed over, so the first mistake is the one named.
  return declare("resourceGetter", fn, "resource", (client, id: string, options?: tEndpointOptions<R, C, E>) => {
    const segment = segmentOf(fn, "id", id);
    const bag = optionsOf(fn, options, OPTIONS);
    const init = pinned(initOf<R>(fn, bag, {}, names), user);
    return located<R>(fn, locate(fn, client, bag), (path) => [`${path}/${segment}`, init]);
  });
}

/** What the two below come to: `GET {collection}?{param}=`, for the list a caller hands over, which a mistake in it calls `name`, as the function's signature does. */
function picked<R extends tResources, C extends object, E extends object>(
  builder: string,
  fn: string,
  param: string,
  name: string,
  collection: unknown,
  also: unknown,
): tEndpoint<[values: readonly string[], options?: tEndpointOptions<R, C, E>], R, Promise<tItem<R>[]>, "resources"> {
  named(builder, fn);
  const [locate, names, user] = given<C>(builder, collection, also);
  return declare(builder, fn, "resources", (client, values: readonly string[], options?: tEndpointOptions<R, C, E>) => {
    const list = listOf(fn, name, values);
    const bag = optionsOf(fn, options, OPTIONS);
    const init = pinned(initOf<R>(fn, bag, { [param]: list }, names), user);
    return located<R>(fn, locate(fn, client, bag), (path) => [path, init]);
  });
}

/**
 * A function for the resources with the ids given: `GET {collection}?ids=`.
 *
 * The function it gives takes `ids` and `options`, checks the ids as a list of 1 to 300 strings, as `listOf` does, and
 * the options as `tEndpointOptions`, and throws and resolves as `tEndpoint` says. Bound, it hands over the list of resources.
 *
 * @param fn - The function's name, as its errors say it.
 * @param collection - Where the resources are: the path with nothing after it, or how to ask the client for it.
 * @param also - What each option of `E` is, a `"list"` or a `"name"`; left out when `E` names none.
 * @returns The function, frozen, with `bound` and `unwrap` on it.
 * @throws TypeError if `fn` is not a string with something in it, `collection` is no function, its `user` is given
 * and is no boolean, or `also` is not an object that says `"list"` or `"name"` for each option.
 */
export function resourcesGetter<R extends tResources = never, C extends object = tNone, E extends object = tNone>(
  fn: string,
  collection: tCollectionGiven<R, C>,
  ...also: tAlsoGiven<E>
): tEndpoint<[ids: readonly string[], options?: tEndpointOptions<R, C, E>], R, Promise<tItem<R>[]>, "resources"> {
  return picked("resourcesGetter", fn, "ids", "ids", collection, (also as readonly unknown[])[0]);
}

/**
 * A function for the resources a filter picks out of a collection: `GET {collection}?filter[{filter}]=`. `filter`
 * is the filter's name as Apple writes it, such as `isrc`, and the function takes the values to look for, which a
 * mistake in them calls `values`, as the function's own signature does.
 *
 * The function it gives takes `values` and `options`, checks the values as a list of 1 to 300 strings, as `listOf`
 * does, and the options as `tEndpointOptions`, and throws and resolves as `tEndpoint` says. Bound, it hands over the
 * list of resources.
 *
 * @param fn - The function's name, as its errors say it.
 * @param filter - The filter's name as Apple writes it, lowercase words with hyphens between, such as `isrc`.
 * @param collection - Where the resources are: the path with nothing after it, or how to ask the client for it.
 * @param also - What each option of `E` is, a `"list"` or a `"name"`; left out when `E` names none.
 * @returns The function, frozen, with `bound` and `unwrap` on it.
 * @throws TypeError if `fn` is not a string with something in it, `filter` is not lowercase words with hyphens
 * between of at most 64 characters, `collection` is no function, its `user` is given and is no boolean, or `also` is
 * not an object that says `"list"` or `"name"` for each option.
 */
export function resourcesFinder<R extends tResources = never, C extends object = tNone, E extends object = tNone>(
  fn: string,
  filter: string,
  collection: tCollectionGiven<R, C>,
  ...also: tAlsoGiven<E>
): tEndpoint<[values: readonly string[], options?: tEndpointOptions<R, C, E>], R, Promise<tItem<R>[]>, "resources"> {
  named("resourcesFinder", fn);
  if (!isBracketed(filter)) throw new TypeError(`resourcesFinder: filter must be the name of a filter, lowercase words with hyphens between and at most 64 characters, such as "isrc"; got ${got(filter)}`);
  return picked("resourcesFinder", fn, `filter[${filter}]`, "values", collection, (also as readonly unknown[])[0]);
}

/**
 * A function for a whole collection, a page at a time: `GET {collection}`.
 *
 * The function it gives takes `options` alone, checks them as `tEndpointOptions` with `maxPages`, and throws and
 * resolves as `tEndpoint` says: called with a client, to the one page Apple answers with. Bound, it walks every page
 * and hands over each item, as `tEndpoint` says of `pages`.
 *
 * @param fn - The function's name, as its errors say it.
 * @param collection - Where the resources are: the path with nothing after it, or how to ask the client for it.
 * @param also - What each option of `E` is, a `"list"` or a `"name"`; left out when `E` names none.
 * @returns The function, frozen, with `bound` and `unwrap` on it.
 * @throws TypeError if `fn` is not a string with something in it, `collection` is no function, its `user` is given
 * and is no boolean, or `also` is not an object that says `"list"` or `"name"` for each option.
 */
export function resourceLister<R extends tResources = never, C extends object = tNone, E extends object = tNone>(
  fn: string,
  collection: tCollectionGiven<R, C>,
  ...also: tAlsoGiven<E>
): tEndpoint<[options?: tEndpointOptions<tPaged<R>, C, E> & tWalkOptions], tPaged<R>, AsyncIterable<tItem<R>>, "pages"> {
  named("resourceLister", fn);
  const [locate, names, user] = given<C>("resourceLister", collection, (also as readonly unknown[])[0]);
  return declare("resourceLister", fn, "pages", (client, options?: tEndpointOptions<tPaged<R>, C, E> & tWalkOptions) => {
    const bag = optionsOf(fn, options, OPTIONS);
    const init = pinned(walkOf<tPaged<R>>(fn, bag, {}, names), user);
    return located<tPaged<R>>(fn, locate(fn, client, bag), (path) => [path, init]);
  });
}

/** What the relationship `K` of `Rels` holds: the kind of resource under its `data`. */
export type tRelated<Rels, K extends keyof Rels> = tItem<NonNullable<Rels[K]>>;

/** What Apple answers when a relationship is asked for by name: a page of what it holds. */
export type tRelationshipPage<Rels, K extends keyof Rels> = Omit<tRelationshipResponse, "data"> & {
  /** The resources the relationship holds, of the kind the name asked for. */
  data: tRelated<Rels, K>[];
};

/**
 * A function for a resource's relationships: `GET {collection}/{id}/{name}`. `Rels` is the resource's relationships
 * as the generated types have them, such as `tAlbumRelationships`: its keys are the names that may be asked for,
 * and the name asked for decides what comes back, and so what a `schema` for it has to be a schema of.
 */
export interface tRelationshipEndpoint<Rels, C = tNone> {
  /**
   * One page of the relationship, as Apple answers it. `id` and `name` are each checked as one segment of a path, and
   * `options` as `tEndpointOptions`, before Apple is asked.
   *
   * @param client - The client to ask with.
   * @param id - The resource's id.
   * @param name - The relationship's name, one of the keys of `Rels`, such as `"albums"`.
   * @param options - What everyone's options are, the collection's, and `maxPages`, which this call has no use for.
   * @returns What Apple answered: the first page of the relationship, with `next` when there is more.
   * @throws TypeError if `client` is no client, `id` or `name` is not one segment of a path, an option is not what it
   * should be, or the collection's path could not be asked for as written; before this endpoint is asked.
   * @throws AppleMusicError as `client.request` rejects with, `_tag` says which; or as `client.storefront()` rejects
   * with, where the collection asks it.
   * @throws The reason `options.signal` aborted with, when it does.
   * @throws Whatever a token provider, store, schema, hook or rate limiter throws, as `client.request` passes it on.
   */
  <K extends keyof Rels & string>(client: tAppleMusicClient, id: string, name: K, options?: tEndpointOptions<tRelationshipPage<Rels, K>, C> & tWalkOptions): Promise<tRelationshipPage<Rels, K>>;
  /**
   * The same call with the client fixed, walking every page: the resources the relationship holds, one at a time,
   * for as many pages as `maxPages` allows. Binding checks the client; the arguments are checked as the bound
   * function is called, and a mistake is thrown from the call. Apple is asked for nothing until a loop starts, and
   * the loop throws what `client.paginate` does.
   */
  readonly bound: (
    client: tAppleMusicClient,
  ) => <K extends keyof Rels & string>(id: string, name: K, options?: tEndpointOptions<tRelationshipPage<Rels, K>, C> & tWalkOptions) => AsyncIterable<tRelated<Rels, K>>;
  /** Always `"pages"`: the bound form walks them. */
  readonly unwrap: "pages";
}

/**
 * A function for a resource's relationships, each a collection of its own: `GET {collection}/{id}/{name}`. The names
 * are held to `Rels` by the types alone: at runtime a name is any one segment of a path, and Apple says whether there
 * is such a relationship. The function it gives is a `tRelationshipEndpoint`, and throws and resolves as that says.
 *
 * @param fn - The function's name, as its errors say it.
 * @param collection - Where the resources are: the path with nothing after it, or how to ask the client for it.
 * @returns The function, frozen, with `bound` and `unwrap` on it.
 * @throws TypeError if `fn` is not a string with something in it, `collection` is no function, or its `user` is
 * given and is no boolean.
 */
export function relationshipGetter<Rels = never, C extends object = tNone>(fn: string, collection: tCollectionGiven<Rels, C>): tRelationshipEndpoint<Rels, C> {
  named("relationshipGetter", fn);
  const [locate, , user] = given<C>("relationshipGetter", collection, undefined);
  const declared = declare("relationshipGetter", fn, "pages", (client, id: string, name: string, options?: tEndpointOptions<tRelationshipResponse, C> & tWalkOptions) => {
    const segments = `${segmentOf(fn, "id", id)}/${segmentOf(fn, "name", name)}`;
    const bag = optionsOf(fn, options, OPTIONS);
    const init = pinned(walkOf<tRelationshipResponse>(fn, bag), user);
    return located<tRelationshipResponse>(fn, locate(fn, client, bag), (path) => [`${path}/${segments}`, init]);
  });
  // What is declared takes any name and gives any resource; the type handed out ties the one to the other.
  return declared as unknown as tRelationshipEndpoint<Rels, C>;
}

/** What makes a value a function for an endpoint, to the types as to the code below: a function, with a `bound` function on it. */
export type tBindable = ((...args: never[]) => unknown) & {
  /** The function with a client fixed. */
  readonly bound: (client: tAppleMusicClient) => unknown;
};

/**
 * Each function of `F` bound to one client, under its own name. Whatever in `F` is not a function for an endpoint
 * is left out, and one that `F` may or may not hold is one the namespace may or may not hold.
 */
export type tEndpointNamespace<F> = {
  readonly [K in keyof F as NonNullable<F[K]> extends tBindable ? K : never]: NonNullable<F[K]> extends {
    /** The function with a client fixed. */
    readonly bound: (client: tAppleMusicClient) => infer B;
  }
    ? B
    : never;
};

const isEndpoint = (value: unknown): value is tBindable => typeof value === "function" && typeof (value as { bound?: unknown }).bound === "function";

/**
 * Binds every function in `endpoints` to `client`: `{ getSong, getSongs }` becomes an object whose `getSong(id)`
 * and `getSongs(ids)` need no client and hand over what the answer holds. `endpoints` is an object of functions
 * made here, such as a module of them; it is read once, and the namespace it gives cannot be changed.
 *
 * @param fn - The name of the function that is binding, for the errors, such as `"catalog"`.
 * @param client - The client to bind to, from `createClient` or anything with `request`, `paginate` and `storefront`.
 * @param endpoints - The functions to bind, by name; whatever is no function with a `bound` on it is left out.
 * @returns A frozen object with no prototype, holding each bound function under its name.
 * @throws TypeError if `client` is no client, or `endpoints` is no object.
 */
export function endpointNamespace<F extends object>(fn: string, client: tAppleMusicClient, endpoints: F): tEndpointNamespace<F> {
  const music = clientOf(fn, client, METHODS);
  if (typeof endpoints !== "object" || (endpoints as unknown) === null) throw new TypeError(`${fn}: endpoints must be an object of functions for endpoints; got ${got(endpoints)}`);
  const bound = Object.entries(endpoints).flatMap(([name, value]: [string, unknown]) => (isEndpoint(value) ? [[name, value.bound(music)] as const] : []));
  // From entries, so that a function named `__proto__` is one more function and nothing else. And with nothing to
  // inherit from, so that a name looked up in the namespace is one of its functions or is not there: not
  // `constructor` or `toString`, which every ordinary object has.
  return Object.freeze(ownOf(Object.fromEntries(bound))) as tEndpointNamespace<F>;
}

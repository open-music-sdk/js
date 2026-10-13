// One factory over every read function of the two clients, for TanStack Query: what `useQuery` and `useInfiniteQuery`
// take, keyed, with `retry: false` since core retried what should be, and pages asked for as `paginate` asks them.
// Nothing of TanStack is imported: its option builders are identity functions, and these objects are what they give.
import * as catalogFunctions from "@open-music-sdk/client-catalog";
import type { tCatalogFunctions } from "@open-music-sdk/client-catalog";
import * as userFunctions from "@open-music-sdk/client-user";
import type { tUserFunctions } from "@open-music-sdk/client-user";
import { clientOf, got, isPlain, ownOf, type tAppleMusicClient, type tEndpoint, type tPage, type tRequestInit, type tUnwrap } from "@open-music-sdk/core";

/** What `useQuery` takes, for one answer. */
export interface tQuery<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: () => Promise<T>;
  /** Core retried what should be retried; three more tries on a refusal, or on a mistake, would help nobody. */
  readonly retry: false;
}

/** What `useInfiniteQuery` takes, for a walk: Apple's pages, each with the `next` Apple sent, and nothing kept back. */
export interface tInfiniteQuery<P extends tPage<unknown>> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: (context: { readonly pageParam: string | undefined }) => Promise<P>;
  readonly initialPageParam: string | undefined;
  readonly getNextPageParam: (lastPage: P) => string | undefined;
  readonly retry: false;
}

/** A function for an endpoint as a function of the same arguments giving its query: one answer, or a walk. A write has none. */
export type tQueryOf<F> =
  F extends tEndpoint<infer A, infer R, infer U, infer K> ?
    K extends "pages" ? (...args: A) => tInfiniteQuery<R & tPage<unknown>>
    : K extends "written" ? never
    : (...args: A) => tQuery<Awaited<U>>
  : never;

/** Every read function of `F`, as its query. */
export type tQueries<F> = { readonly [K in keyof F as [tQueryOf<F[K]>] extends [never] ? never : K]: tQueryOf<F[K]> };

/** What `musicQueries` gives: the catalog's and the listener's read functions, each as its query. */
export interface tMusicQueries {
  readonly catalog: tQueries<tCatalogFunctions>;
  readonly user: tQueries<tUserFunctions>;
}

type tAnyEndpoint = ((client: tAppleMusicClient, ...args: unknown[]) => Promise<unknown>) & {
  readonly bound: (client: tAppleMusicClient) => (...args: unknown[]) => unknown;
  readonly unwrap: tUnwrap;
};

const isEndpoint = (value: unknown): value is tAnyEndpoint =>
  typeof value === "function" && typeof (value as { bound?: unknown }).bound === "function" && typeof (value as { unwrap?: unknown }).unwrap === "string";

const PREFIX = "open-music-sdk";
const METHODS = ["request", "paginate", "storefront", "as", "forUser"] as const;

const isSchema = (value: unknown): boolean => typeof value === "object" && value !== null && Object.hasOwn(value, "~standard");

/** The options bag of a call, when its last argument is one: what `schema` and `maxPages` are read from. */
const bagOf = (args: readonly unknown[]): Record<string, unknown> | undefined => {
  const last: unknown = args[args.length - 1];
  return isPlain(last) ? ownOf(last as Record<string, unknown>) : undefined;
};

/**
 * An argument as it goes into a key. A schema is a marker, since two are not told apart by a key; a function or a
 * signal is nothing to key on, and is left out; what is plain is keyed by what it holds.
 */
function keyed(value: unknown): unknown {
  if (isSchema(value)) return "schema";
  if (typeof value === "function" || value instanceof AbortSignal) return undefined;
  if (isPlain(value)) return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([name, held]) => (keyed(held) === undefined ? [] : [[name, keyed(held)]])));
  return value;
}

const keyOf = (scope: unknown, ns: string, name: string, args: readonly unknown[]): readonly unknown[] => Object.freeze([PREFIX, scope ?? 0, ns, name, ...args.map(keyed)]);

/** `next` as Apple wrote it, read from the body as it came and not from a schema's copy, which may have kept only what it knows. */
function linkOf(body: unknown): string | undefined {
  const next: unknown = typeof body === "object" && body !== null && Object.hasOwn(body, "next") ? (body as { next?: unknown }).next : undefined;
  return typeof next === "string" ? next : undefined;
}

/** A walk as one query per page: the first page is the function's, later ones are asked for as `paginate` asks. */
function walkOf(fn: tAnyEndpoint, music: tAppleMusicClient, ns: "catalog" | "user", name: string, scope: unknown, args: readonly unknown[]): tInfiniteQuery<tPage<unknown>> {
  const bag = bagOf(args);
  if (bag?.maxPages !== undefined) throw new TypeError(`musicQueries.${ns}.${name}: maxPages is not an option of a query; how many pages are kept is TanStack's maxPages, on useInfiniteQuery`);
  const schema = isSchema(bag?.schema) ? (bag?.schema as tRequestInit["schema"]) : undefined;
  const queryFn = async ({ pageParam }: { readonly pageParam: string | undefined }): Promise<tPage<unknown>> => {
    let next: string | undefined;
    const page: unknown =
      pageParam === undefined ?
        // The function's own first page, through a client whose request keeps the `next` Apple sent beside what a schema made of the answer.
        await fn(
          {
            request: (path, init) => music.request(path, { ...init, onResponse: (res, req, outcome) => (next = linkOf(outcome.body), init?.onResponse?.(res, req, outcome)) }),
            paginate: (from, init) => music.paginate(from, init),
            storefront: () => music.storefront(),
            as: (token) => music.as(token),
            forUser: (userId) => music.forUser(userId),
          },
          ...args,
        )
        // A later page, as the walk would ask for it: no Music User Token for the catalog's, wherever the link points, and the same schema.
      : await music.request(pageParam, { ...(ns === "catalog" ? { user: false } : {}), ...(schema === undefined ? {} : { schema }), onResponse: (_res, _req, outcome) => (next = linkOf(outcome.body)) });
    return Object.freeze({ ...(typeof page === "object" && page !== null ? page : {}), next });
  };
  return Object.freeze({ queryKey: keyOf(scope, ns, name, args), queryFn, initialPageParam: undefined, getNextPageParam: (lastPage: tPage<unknown>) => lastPage.next, retry: false as const });
}

function queriesOf<F extends object>(ns: "catalog" | "user", music: tAppleMusicClient, scope: unknown, functions: F): tQueries<F> {
  const made: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(functions)) {
    if (!isEndpoint(fn) || fn.unwrap === "written") continue;
    if (fn.unwrap === "pages") made[name] = (...args: unknown[]) => walkOf(fn, music, ns, name, scope, args);
    else {
      const bound = fn.bound(music);
      made[name] = (...args: unknown[]) => Object.freeze({ queryKey: keyOf(scope, ns, name, args), queryFn: () => Promise.resolve(bound(...args)), retry: false as const });
    }
  }
  return Object.freeze(ownOf(made)) as tQueries<F>;
}

/**
 * Every read function of the catalog and of the listener's library, as its query for TanStack Query: one function of
 * the same arguments for each, giving what `useQuery` takes, or what `useInfiniteQuery` takes for one that walks
 * pages. A write is not among them: it is `useMutation` over the client's namespace. `scope` goes into every key, so
 * that one listener's cache is never another's: `useMusicQueries` passes the provider's generation, raised by every
 * change of token. A token is never part of a key. Made once for one client and reused; nothing is asked until a
 * query runs.
 */
export function musicQueries(music: tAppleMusicClient, scope?: string | number): tMusicQueries {
  const client = clientOf("musicQueries", music, METHODS);
  if (scope !== undefined && typeof scope !== "string" && typeof scope !== "number") throw new TypeError(`musicQueries: scope must be a string or a number, such as the provider's generation; got ${got(scope)}`);
  return Object.freeze(ownOf({ catalog: queriesOf("catalog", client, scope, catalogFunctions), user: queriesOf("user", client, scope, userFunctions) }));
}

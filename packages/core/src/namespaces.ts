// An integration's client: core's client with namespaces on it, such as `catalog`, `user` and `playlists`, each
// made for that client by a factory. What `as()` and `forUser()` give is composed the same way over the client
// they derive, so the namespaces are there for a listener's client too.
import { clientOf, gotFor, isPlain, ownOf } from "./check";
import type { tAppleMusicClient, tTokenProvider } from "./client";
import { got } from "./got";

/** Factories by the name each goes under: each takes a client and gives what that name holds, as `catalog(client)` does. */
export type tNamespaces = Readonly<Record<string, (client: tAppleMusicClient) => object>>;

/** The client with each namespace of `N` on it, under its name; its `as()` and `forUser()` give the same again. */
export type tWithNamespaces<N extends tNamespaces> = Omit<tAppleMusicClient, "as" | "forUser"> & {
  readonly [K in keyof N]: ReturnType<N[K]>;
} & {
  /** A client for one listener, with the same namespaces made for it. */
  as(userToken: string | tTokenProvider): tWithNamespaces<N>;
  /** `as()`, with the token looked up in the client's store, and the same namespaces made for it. */
  forUser(userId: string): tWithNamespaces<N>;
};

/** The client's own functions, which a namespace may not be named for: it would hide one. */
const METHODS = ["request", "paginate", "storefront", "as", "forUser"] as const;

/**
 * `client` with each namespace of `namespaces` on it, under its name: `withNamespaces(music, { catalog })` gives a
 * client whose `catalog` is `catalog(music)`. The factories are checked and read here, once, and each is called
 * once for this client and once for each client that `as()` or `forUser()` derives. What is given is frozen and
 * inherits nothing, and its functions need no `this`.
 */
export function withNamespaces<N extends tNamespaces>(client: tAppleMusicClient, namespaces: N): tWithNamespaces<N> {
  const music = clientOf("withNamespaces", client, METHODS);
  if (!isPlain(namespaces)) throw new TypeError(`withNamespaces: namespaces must be a plain object of functions, each taking a client, such as { catalog }; got ${gotFor(namespaces)}`);
  const factories = Object.entries(ownOf(namespaces)).map(([name, factory]: [string, unknown]) => {
    if (typeof factory !== "function") throw new TypeError(`withNamespaces: namespaces.${name} must be a function taking a client; got ${got(factory)}`);
    if ((METHODS as readonly string[]).includes(name)) throw new TypeError(`withNamespaces: ${name} is a function of the client, and cannot be the name of a namespace`);
    return [name, factory as (client: tAppleMusicClient) => object] as const;
  });
  const compose = (base: tAppleMusicClient): tWithNamespaces<N> => {
    const made: Record<string, unknown> = {
      // Bound, so that a client whose functions do need `this`, such as a test's own class, still works through here.
      request: base.request.bind(base),
      paginate: base.paginate.bind(base),
      storefront: base.storefront.bind(base),
      as: (userToken: string | tTokenProvider) => compose(base.as(userToken)),
      forUser: (userId: string) => compose(base.forUser(userId)),
    };
    for (const [name, factory] of factories) made[name] = factory(base);
    return Object.freeze(ownOf(made)) as unknown as tWithNamespaces<N>;
  };
  return compose(music);
}

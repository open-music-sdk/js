// Where a URL may point, for a caller who says. An artwork and a preview clip each come as a URL in Apple's
// answers, and one that did not come straight from there, but from a cache or from what someone else wrote, can
// point anywhere. Nothing here is asked unless the caller names hosts. This module imports nothing: a package that
// has only this check to make takes only this from core.

/** More hosts than Apple serves artwork or clips from. */
const MAX_HOSTS = 16;

/**
 * The hosts a caller allows, as a list of this call's own, or `undefined` when none were named. Each is a bare host
 * name in small letters, as a URL parser gives a host: `https://mzstatic.com`, `*.mzstatic.com` and `MzStatic.com`
 * would each match nothing, so they are refused here and not left to refuse every URL later. `fn` is who a mistake
 * is named for, and `example` a host to show in the error, such as `mzstatic.com`.
 */
export function hostsOf(fn: string, value: unknown, example: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const hosts: unknown[] = Array.isArray(value) && value.length <= MAX_HOSTS ? [...(value as unknown[])] : [];
  if (hosts.length > 0 && hosts.every((host): host is string => typeof host === "string" && host.length <= 253 && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(host))) return hosts;
  throw new TypeError(`${fn}: hosts must be an array of 1 to ${String(MAX_HOSTS)} host names in small letters, such as ${example}`);
}

/** A page that is itself `https`, on a host nobody allows: what a URL is read against, to see that it stands on its own. */
const ELSEWHERE = "https://elsewhere.invalid/";

/**
 * Whether `url` is `https` on one of `hosts` or on a subdomain of one, with no port and no credentials. The URL is
 * read by the parser a browser reads it with, so what is checked is what will be requested. One that does not stand
 * on its own, such as a relative one, is on no host that could be allowed.
 *
 * It is read twice: on its own, and as a page that is `https` itself reads it. `https:host/a` and `https:/host/a`
 * are whole URLs on their own and name `host`, but such a page reads them as paths on its own host, and asks
 * there. A URL that the two readings take to different places is on no host that could be allowed.
 */
export function isOnHost(url: string, hosts: readonly string[]): boolean {
  let parsed: URL | undefined;
  try {
    const alone = new URL(url);
    if (new URL(url, ELSEWHERE).href === alone.href) parsed = alone;
  } catch {
    // Not a URL on its own: on no host.
  }
  const host = parsed?.hostname ?? "";
  return parsed?.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.port === "" && hosts.some((name) => host === name || host.endsWith(`.${name}`));
}

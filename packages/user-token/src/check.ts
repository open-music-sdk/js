// What a function is handed is checked where it is handed over. A mistake is a TypeError that names the function
// and the argument and describes the value, never repeats it: a value in the wrong place may be a token.
import { got, parseToken } from "@open-music-sdk/core";

/**
 * The token as core will send it, with the whitespace around it dropped. What a token is, is core's rule and
 * decided nowhere else.
 */
export function tokenOf(fn: string, token: unknown): string {
  const value = parseToken(token);
  if (value !== undefined) return value;
  throw new TypeError(`${fn}: token must be printable characters with no spaces or line breaks inside; got ${got(token)}`);
}

/**
 * What a value is, for an error that must not show what it holds: a value in the wrong place may be the private
 * key, or some other secret. A number is the one thing printed as it is, since it cannot be either.
 */
export const got = (value: unknown): string =>
  typeof value === "number" ? String(value) : typeof value === "string" ? `${String(value.length)} characters` : value === null ? "null" : typeof value;

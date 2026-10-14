/**
 * What a value is, for an error that must not show what it holds: a value in the wrong place may be the private
 * key, or some other secret. A number is the one thing printed as it is, since it cannot be either.
 *
 * @param value - The value an error is about.
 * @returns The number itself, `"null"`, a string's length as `"12 characters"`, or else what `typeof` says: fit to end a message with.
 */
export const got = (value: unknown): string =>
  typeof value === "number" ? String(value) : typeof value === "string" ? `${String(value.length)} characters` : value === null ? "null" : typeof value;

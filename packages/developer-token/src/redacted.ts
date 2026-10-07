/** A secret that prints as a mask. Only `unwrap()` gives the value back. */
export interface tRedacted<T> {
  unwrap(): T;
  toString(): string;
  toJSON(): string;
}

const mask = () => "<redacted>";

/**
 * Wraps a secret so string conversion, JSON serialisation, and console logging print `<redacted>`.
 * The value lives in a closure, never on the object, so no inspector or serialiser can walk to it.
 */
export const redacted = <T>(value: T): tRedacted<T> =>
  Object.freeze({ unwrap: () => value, toString: mask, toJSON: mask, [Symbol.for("nodejs.util.inspect.custom")]: mask });

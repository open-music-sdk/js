/** A secret that prints as a mask. Only `unwrap()` gives the value back. */
export interface tRedacted<T> {
  unwrap(): T;
  toString(): string;
  toJSON(): string;
}

const mask = () => "<redacted>";

/**
 * Wraps a secret so string conversion and JSON serialisation print `<redacted>`, as does console logging
 * where the runtime honours Node's inspect symbol. The value lives in a closure, never on
 * the object, so where the symbol means nothing a console shows three functions and still not the value.
 */
export const redacted = <T>(value: T): tRedacted<T> =>
  Object.freeze({ unwrap: () => value, toString: mask, toJSON: mask, [Symbol.for("nodejs.util.inspect.custom")]: mask });

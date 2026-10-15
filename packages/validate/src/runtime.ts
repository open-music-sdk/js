// The few combinators the generated validators are built from. Each validator implements
// Standard Schema v1 (https://standardschema.dev); the interface is structural, so it is declared
// here rather than pulled from a package.

/** One thing wrong with a value, as a validator reports it. */
export interface tIssue {
  /** What was expected and was not found: `required`, `expected string`, `expected "songs"`. */
  readonly message: string;
  /** Where in the value, from its root: property names and array indexes. Empty when the value itself is the problem. */
  readonly path?: readonly (string | number)[] | undefined;
}

/** What validating a value comes to: the value, now typed, or everything wrong with it. */
export type tResult<T> =
  | {
      /** The value as it was given, now known to be a `T`. */
      readonly value: T;
      /** Never set when the value passed: `if (result.issues)` tells the two apart. */
      readonly issues?: undefined;
    }
  | {
      /** Everything wrong with the value, in the order it was found. */
      readonly issues: readonly tIssue[];
    };

/**
 * Standard Schema v1 (https://standardschema.dev), as any library that takes a validator reads one. The interface
 * is structural, so it is declared here and not taken from a package.
 */
export interface tStandardSchemaV1<Input = unknown, Output = Input> {
  /** The one property the standard asks for, named so that it collides with nothing of a schema's own. */
  readonly "~standard": {
    /** The version of the standard this follows. */
    readonly version: 1;
    /** Who made the validator: `open-music-sdk` for every one here. */
    readonly vendor: string;
    /** Validates a value. The standard lets a validator answer later; every one here answers at once. */
    readonly validate: (value: unknown) => tResult<Output> | Promise<tResult<Output>>;
    /** Type-level only, so that `Input` and `Output` can be inferred from a schema. Never set at runtime. */
    readonly types?:
      | {
          /** What the validator takes. */
          readonly input: Input;
          /** What a value that passes is. */
          readonly output: Output;
        }
      | undefined;
  };
}

/**
 * The raw check a validator is built from. It returns nothing: a check that found nothing wrong has pushed nothing.
 *
 * @param value - What to look at.
 * @param path - Where `value` sits in the whole, from the root, for the issues to carry.
 * @param issues - Where to push one issue for each thing wrong.
 */
export type tCheck = (value: unknown, path: readonly (string | number)[], issues: tIssue[]) => void;

/** A generated validator: Standard Schema, answering at once, plus the raw check it is built from. */
export interface tSchema<T> extends tStandardSchemaV1<unknown, T> {
  /** As the standard's, with a `validate` that answers at once: its result never needs awaiting. */
  readonly "~standard": Omit<tStandardSchemaV1<unknown, T>["~standard"], "validate"> & {
    /** Validates a value and answers at once: the value as a `T`, or everything wrong with it. */
    readonly validate: (value: unknown) => tResult<T>;
  };
  /** The check itself, to call with a path and an issue list of your own, or to build another check from. */
  readonly check: tCheck;
}

/**
 * A validator over a check.
 *
 * @param check - The check that decides.
 * @returns The check as a Standard Schema that answers at once, and the check itself under `check`.
 */
export function schema<T>(check: tCheck): tSchema<T> {
  return {
    check,
    "~standard": {
      version: 1,
      vendor: "open-music-sdk",
      validate(value) {
        const issues: tIssue[] = [];
        check(value, [], issues);
        return issues.length > 0 ? { issues } : { value: value as T };
      },
    },
  };
}

/** A check that says `expected ${what}` when `test` fails. */
const expect =
  (what: string, test: (value: unknown) => boolean): tCheck =>
  (value, path, issues) => {
    if (!test(value)) issues.push({ message: `expected ${what}`, path });
  };

/** A string, boxed ones excluded. */
export const string = expect("string", (v) => typeof v === "string");
/** A number, `NaN` included: Apple sends none, and a check on type is all a scalar gets. */
export const number = expect("number", (v) => typeof v === "number");
/** `true` or `false`. */
export const boolean = expect("boolean", (v) => typeof v === "boolean");
/** An object that is not an array, whatever it holds: what a dictionary Apple documents no properties of becomes. */
export const record = expect("object", (v) => typeof v === "object" && v !== null && !Array.isArray(v));
/** Anything at all, for a property whose type the documentation does not say. */
export const unknown: tCheck = () => undefined;

/**
 * One of a few exact values, as an `allowedValues` list is enforced.
 *
 * @param values - The values allowed, as Apple documents them; a number where the property is numeric.
 * @returns A check that reports `expected "a" | "b"` when the value is none of them.
 */
export const literal = (...values: readonly (string | number)[]): tCheck =>
  expect(values.map((v) => JSON.stringify(v)).join(" | "), (v) => values.includes(v as string | number));

/**
 * An array whose every item passes `item`.
 *
 * @param item - The check for each item, run with the item's index added to the path.
 * @returns A check that reports `expected array` for what is no array, and otherwise each item's issues.
 */
export const array =
  (item: tCheck): tCheck =>
  (value, path, issues) => {
    if (!Array.isArray(value)) {
      issues.push({ message: "expected array", path });
      return;
    }
    value.forEach((v: unknown, i) => {
      item(v, [...path, i], issues);
    });
  };

/**
 * Defers the lookup so validators can reference each other in any order, including cycles.
 *
 * @param get - Hands over the validator, asked each time a value is checked, by when every module has loaded.
 * @returns A check that runs that validator's own.
 */
export const lazy =
  (get: () => tSchema<unknown>): tCheck =>
  (value, path, issues) => {
    get().check(value, path, issues);
  };

/**
 * Passes when any member passes; otherwise reports the issues of the closest member (fewest issues, first wins ties).
 *
 * @param members - The checks, one of which the value has to pass.
 * @returns A check that reports nothing when a member passes, and the closest member's issues when none does.
 */
export const union =
  (...members: readonly tCheck[]): tCheck =>
  (value, path, issues) => {
    let closest: tIssue[] | undefined;
    for (const member of members) {
      const got: tIssue[] = [];
      member(value, path, got);
      if (got.length === 0) return;
      if (!closest || got.length < closest.length) closest = got;
    }
    issues.push(...(closest ?? [{ message: "expected one of no members", path }]));
  };

/**
 * A validator for an object with named properties. Unknown keys are allowed: Apple adds attributes without notice.
 *
 * @param props - A check for each documented property, run only when the property is there.
 * @param required - The properties that have to be there; each one missing is `required` at its path.
 * @returns A validator that reports `expected object` for what is no object, and otherwise every property's issues.
 */
export function object<T>(props: Record<keyof T & string, tCheck>, required: readonly (keyof T & string)[]): tSchema<T> {
  return schema<T>((value, path, issues) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({ message: "expected object", path });
      return;
    }
    const v = value as Record<string, unknown>;
    for (const k of required) if (v[k] === undefined) issues.push({ message: "required", path: [...path, k] });
    for (const k of Object.keys(props) as (keyof T & string)[]) if (v[k] !== undefined) props[k](v[k], [...path, k], issues);
  });
}

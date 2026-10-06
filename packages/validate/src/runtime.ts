// The few combinators the generated validators are built from. Each validator implements
// Standard Schema v1 (https://standardschema.dev); the interface is structural, so it is declared
// here rather than pulled from a package.

export interface tIssue {
  readonly message: string;
  readonly path?: readonly (string | number)[] | undefined;
}

export type tResult<T> = { readonly value: T; readonly issues?: undefined } | { readonly issues: readonly tIssue[] };

export interface tStandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => tResult<Output> | Promise<tResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export type tCheck = (value: unknown, path: readonly (string | number)[], issues: tIssue[]) => void;

/** A generated validator: Standard Schema, synchronous, plus the raw check for composition. */
export interface tSchema<T> extends tStandardSchemaV1<unknown, T> {
  readonly "~standard": Omit<tStandardSchemaV1<unknown, T>["~standard"], "validate"> & {
    readonly validate: (value: unknown) => tResult<T>;
  };
  readonly check: tCheck;
}

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

const expect =
  (what: string, test: (value: unknown) => boolean): tCheck =>
  (value, path, issues) => {
    if (!test(value)) issues.push({ message: `expected ${what}`, path });
  };

export const string = expect("string", (v) => typeof v === "string");
export const number = expect("number", (v) => typeof v === "number");
export const boolean = expect("boolean", (v) => typeof v === "boolean");
export const record = expect("object", (v) => typeof v === "object" && v !== null && !Array.isArray(v));
export const unknown: tCheck = () => undefined;

export const literal = (...values: readonly (string | number)[]): tCheck =>
  expect(values.map((v) => JSON.stringify(v)).join(" | "), (v) => values.includes(v as string | number));

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

/** Defers the lookup so validators can reference each other in any order, including cycles. */
export const lazy =
  (get: () => tSchema<unknown>): tCheck =>
  (value, path, issues) => {
    get().check(value, path, issues);
  };

/** Passes when any member passes; otherwise reports the issues of the closest member (fewest issues, first wins ties). */
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

/** Unknown keys are allowed: Apple adds attributes without notice. */
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

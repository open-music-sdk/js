import { describe, expect, expectTypeOf, test, vi } from "vitest";
import * as r from "./runtime";
import type { tCheck, tIssue, tSchema } from "./runtime";

/** Runs a check at the root and returns its issues. */
const run = (check: tCheck, value: unknown): tIssue[] => {
  const issues: tIssue[] = [];
  check(value, [], issues);
  return issues;
};
/** "path: message" per issue, "<root>" for an empty path. */
const report = (check: tCheck, value: unknown): string[] =>
  run(check, value).map((i) => `${(i.path ?? []).join(".") || "<root>"}: ${i.message}`);

describe("string", () => {
  test.each(["", "a", "with spaces", "ünïcödé"])("accepts %j", (v) => {
    expect(run(r.string, v)).toEqual([]);
  });
  test.each([1, 0, true, null, undefined, {}, [], new String("boxed")])("rejects %s", (v) => {
    expect(report(r.string, v)).toEqual(["<root>: expected string"]);
  });
});

describe("number", () => {
  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.NaN])("accepts %s", (v) => {
    expect(run(r.number, v)).toEqual([]);
  });
  test.each(["1", "", null, undefined, true, [], {}, 10n])("rejects %s", (v) => {
    expect(report(r.number, v)).toEqual(["<root>: expected number"]);
  });
});

describe("boolean", () => {
  test.each([true, false])("accepts %s", (v) => {
    expect(run(r.boolean, v)).toEqual([]);
  });
  test.each([0, 1, "true", "", null, undefined, [], {}])("rejects %s", (v) => {
    expect(report(r.boolean, v)).toEqual(["<root>: expected boolean"]);
  });
});

describe("record", () => {
  test.each([{}, { a: 1 }, Object.create(null) as object])("accepts %s", (v) => {
    expect(run(r.record, v)).toEqual([]);
  });
  test.each([[], null, "x", 1, undefined, true])("rejects %s", (v) => {
    expect(report(r.record, v)).toEqual(["<root>: expected object"]);
  });
});

describe("unknown", () => {
  test.each([undefined, null, Number.NaN, 0, "", [], {}, () => 1])("accepts %s", (v) => {
    expect(run(r.unknown, v)).toEqual([]);
  });
});

describe("literal", () => {
  const rating = r.literal("clean", "explicit");
  test.each(["clean", "explicit"])("accepts %j", (v) => {
    expect(run(rating, v)).toEqual([]);
  });
  test.each(["CLEAN", "", "clean ", "cleanexplicit", undefined, null, 1, ["clean"]])("rejects %s", (v) => {
    expect(report(rating, v)).toEqual(['<root>: expected "clean" | "explicit"']);
  });

  const sign = r.literal(-1, 1);
  test.each([-1, 1])("numeric literal accepts %s", (v) => {
    expect(run(sign, v)).toEqual([]);
  });
  test.each([0, 2, "1", "-1", true, null])("numeric literal rejects %s", (v) => {
    expect(report(sign, v)).toEqual(["<root>: expected -1 | 1"]);
  });

  test("single value", () => {
    expect(run(r.literal("songs"), "songs")).toEqual([]);
    expect(report(r.literal("songs"), "albums")).toEqual(['<root>: expected "songs"']);
  });

  test("mixed string and number values compare strictly", () => {
    const mixed = r.literal("1", 1);
    expect(run(mixed, "1")).toEqual([]);
    expect(run(mixed, 1)).toEqual([]);
    expect(report(mixed, 2)).toEqual(['<root>: expected "1" | 1']);
  });
});

describe("array", () => {
  const strings = r.array(r.string);
  test.each([[[]], [["a"]], [["a", "b", "c"]]])("accepts %j", (v) => {
    expect(run(strings, v)).toEqual([]);
  });
  test.each(["abc", { length: 1, 0: "a" }, new Set(["a"]), null, undefined, {}, 1])("rejects non-array %s", (v) => {
    expect(report(strings, v)).toEqual(["<root>: expected array"]);
  });

  test("reports every bad element with its index", () => {
    expect(report(strings, ["a", 1, "b", null, undefined])).toEqual([
      "1: expected string",
      "3: expected string",
      "4: expected string",
    ]);
  });

  test("nested arrays build nested paths", () => {
    const grid = r.array(r.array(r.number));
    expect(run(grid, [[1], [2, 3], []])).toEqual([]);
    expect(report(grid, [[1], [2, "3"], "row"])).toEqual(["1.1: expected number", "2: expected array"]);
  });

  test("an empty array passes regardless of the item check", () => {
    expect(run(r.array(r.literal("never")), [])).toEqual([]);
  });
});

describe("object", () => {
  interface tPoint {
    x: number;
    y: number;
    label?: string;
  }
  const point = r.object<tPoint>({ x: r.number, y: r.number, label: r.string }, ["x", "y"]);

  test.each([{ x: 1, y: 2 }, { x: 0, y: 0, label: "origin" }, { x: 1, y: 2, extra: true }])("accepts %j", (v) => {
    expect(point["~standard"].validate(v)).toEqual({ value: v });
  });

  test.each([null, [], "x", 1, undefined, true])("rejects non-object %s", (v) => {
    expect(report(point.check, v)).toEqual(["<root>: expected object"]);
  });

  test("lists every missing required key, in declaration order", () => {
    expect(report(point.check, {})).toEqual(["x: required", "y: required"]);
    expect(report(point.check, { y: 1 })).toEqual(["x: required"]);
  });

  test("a required key set to undefined counts as missing, like JSON", () => {
    expect(report(point.check, { x: undefined, y: 1 })).toEqual(["x: required"]);
  });

  test("a present required key is type-checked, not reported as missing", () => {
    expect(report(point.check, { x: "1", y: 2 })).toEqual(["x: expected number"]);
  });

  test("optional keys are skipped when absent or undefined, checked otherwise", () => {
    expect(run(point.check, { x: 1, y: 2, label: undefined })).toEqual([]);
    expect(report(point.check, { x: 1, y: 2, label: null })).toEqual(["label: expected string"]);
    expect(report(point.check, { x: 1, y: 2, label: 3 })).toEqual(["label: expected string"]);
  });

  test("required issues come before property issues", () => {
    expect(report(point.check, { x: "1" })).toEqual(["y: required", "x: expected number"]);
  });

  test("unknown keys are ignored", () => {
    expect(run(point.check, { x: 1, y: 2, z: 3, nested: { deep: [1] } })).toEqual([]);
  });

  test("keys that need quoting keep their exact spelling in paths", () => {
    const results = r.object<{ "music-videos": string }>({ "music-videos": r.string }, ["music-videos"]);
    expect(report(results.check, {})).toEqual(["music-videos: required"]);
    expect(report(results.check, { "music-videos": 1 })).toEqual(["music-videos: expected string"]);
  });

  test("nested objects prefix their paths, via lazy or via .check", () => {
    interface tLine {
      from: tPoint;
      to?: tPoint;
    }
    const line = r.object<tLine>({ from: r.lazy(() => point), to: point.check }, ["from"]);
    expect(run(line.check, { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } })).toEqual([]);
    expect(report(line.check, { from: { x: 0 }, to: { x: "1", y: 1 } })).toEqual([
      "from.y: required",
      "to.x: expected number",
    ]);
    expect(report(line.check, { from: "origin" })).toEqual(["from: expected object"]);
  });

  test("a valid result carries the same reference, typed as T", () => {
    const input = { x: 1, y: 2 };
    const result = point["~standard"].validate(input);
    expect(result.issues).toBeUndefined();
    if (!result.issues) {
      expect(result.value).toBe(input);
      expectTypeOf(result.value).toEqualTypeOf<tPoint>();
    }
  });
});

describe("lazy", () => {
  test("does not resolve the schema until a value is checked", () => {
    const get = vi.fn(() => r.schema<string>(r.string));
    const check = r.lazy(get);
    expect(get).not.toHaveBeenCalled();
    expect(run(check, "a")).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("supports a schema that references itself", () => {
    interface tTree {
      name: string;
      children: tTree[];
    }
    const tree: tSchema<tTree> = r.object<tTree>({ name: r.string, children: r.array(r.lazy(() => tree)) }, ["name", "children"]);
    const ok = { name: "root", children: [{ name: "a", children: [] }, { name: "b", children: [{ name: "c", children: [] }] }] };
    expect(tree["~standard"].validate(ok)).toEqual({ value: ok });
    expect(report(tree.check, { name: "root", children: [{ name: "a", children: [{ children: [] }, { name: 1, children: "x" }] }] })).toEqual([
      "children.0.children.0.name: required",
      "children.0.children.1.name: expected string",
      "children.0.children.1.children: expected array",
    ]);
  });

  test("supports mutual recursion in either declaration order", () => {
    interface tA {
      b?: tB;
    }
    interface tB {
      a?: tA;
      n: number;
    }
    const a: tSchema<tA> = r.object<tA>({ b: r.lazy(() => b) }, []);
    const b: tSchema<tB> = r.object<tB>({ a: r.lazy(() => a), n: r.number }, ["n"]);
    expect(run(a.check, { b: { n: 1, a: { b: { n: 2 } } } })).toEqual([]);
    expect(report(a.check, { b: { n: 1, a: { b: { n: "2" } } } })).toEqual(["b.a.b.n: expected number"]);
  });
});

describe("union", () => {
  const stringOrNumber = r.union(r.string, r.number);

  test.each(["a", 1, "", 0])("accepts %j when any member passes", (v) => {
    expect(run(stringOrNumber, v)).toEqual([]);
  });

  test("reports the first member's issues when all members tie", () => {
    expect(report(stringOrNumber, true)).toEqual(["<root>: expected string"]);
    expect(report(r.union(r.number, r.string), true)).toEqual(["<root>: expected number"]);
  });

  test("reports the member with the fewest issues", () => {
    const wide = r.object<{ a: string; b: string; c: string }>({ a: r.string, b: r.string, c: r.string }, ["a", "b", "c"]);
    const narrow = r.object<{ z: string }>({ z: r.string }, ["z"]);
    expect(report(r.union(wide.check, narrow.check), {})).toEqual(["z: required"]);
    expect(report(r.union(wide.check, narrow.check), { a: "", b: "" })).toEqual(["c: required"]);
  });

  test("stops at the first passing member", () => {
    const second = vi.fn<tCheck>();
    expect(run(r.union(r.string, second), "a")).toEqual([]);
    expect(second).not.toHaveBeenCalled();
    expect(run(r.union(r.number, second), "a")).toEqual([]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("a single-member union behaves like the member", () => {
    expect(run(r.union(r.string), "a")).toEqual([]);
    expect(report(r.union(r.string), 1)).toEqual(["<root>: expected string"]);
  });

  test("a union with no members rejects everything", () => {
    expect(report(r.union(), "anything")).toEqual(["<root>: expected one of no members"]);
  });

  test("composes inside arrays with element paths", () => {
    expect(report(r.array(stringOrNumber), ["a", 1, true, null])).toEqual(["2: expected string", "3: expected string"]);
  });

  test("the resource pattern: discriminate by a literal type", () => {
    const song = r.object<{ type: "songs"; id: string }>({ type: r.literal("songs"), id: r.string }, ["type", "id"]);
    const album = r.object<{ type: "albums"; id: string }>({ type: r.literal("albums"), id: r.string }, ["type", "id"]);
    const either = r.union(song.check, album.check);
    expect(run(either, { type: "songs", id: "1" })).toEqual([]);
    expect(run(either, { type: "albums", id: "1" })).toEqual([]);
    expect(report(either, { type: "artists", id: "1" })).toEqual(['type: expected "songs"']);
  });
});

describe("schema", () => {
  const s = r.schema<string>(r.string);

  test("implements Standard Schema v1", () => {
    expect(s["~standard"].version).toBe(1);
    expect(s["~standard"].vendor).toBe("open-music-sdk");
    expect(s["~standard"].types).toBeUndefined();
    expect(typeof s["~standard"].validate).toBe("function");
  });

  test("validates synchronously", () => {
    expect(s["~standard"].validate("a")).not.toBeInstanceOf(Promise);
    expect(s["~standard"].validate("a")).toEqual({ value: "a" });
    expect(s["~standard"].validate(1)).toEqual({ issues: [{ message: "expected string", path: [] }] });
  });

  test("exposes the raw check for composition", () => {
    expect(s.check).toBe(r.string);
  });

  test("each call starts with a fresh issue list", () => {
    expect(s["~standard"].validate(1).issues).toHaveLength(1);
    expect(s["~standard"].validate(1).issues).toHaveLength(1);
  });

  test("a bare check can be lifted to a schema and used in object props", () => {
    const list = r.schema<string[]>(r.array(r.string));
    expect(list["~standard"].validate(["a"])).toEqual({ value: ["a"] });
    expect(list["~standard"].validate(["a", 1]).issues).toEqual([{ message: "expected string", path: [1] }]);
  });
});

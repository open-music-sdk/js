import { afterEach, describe, expect, test } from "vitest";
import { first, held } from "./own";

/** What other code may have put where every object finds it. */
const polluted = Object.prototype as Record<string, unknown>;
const PLANTED = ["id", "type", "data", "catalogId", "isrc", "name", "attributes", "0"];

afterEach(() => {
  for (const key of PLANTED) Reflect.deleteProperty(polluted, key);
});

describe("held", () => {
  test("a plain object is read as what it holds itself", () => {
    expect({ ...held({ id: "1", type: "songs" }) }).toEqual({ id: "1", type: "songs" });
    expect({ ...held(Object.assign(Object.create(null) as object, { id: "1" })) }).toEqual({ id: "1" });
  });

  test("what comes back inherits nothing: a field it does not hold is undefined, whatever every object has", () => {
    for (const key of PLANTED) polluted[key] = "planted";
    const read = held({ name: "its own" });
    expect(PLANTED.filter((key) => key !== "name").map((key) => read[key])).toEqual(PLANTED.slice(1).map(() => undefined));
    expect(read.name).toBe("its own");
    expect("toString" in read).toBe(false);
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["null", null],
    ["a string", "songs"],
    ["a number", 7],
    ["a list", [{ id: "1" }]],
    ["an instance of a class", new (class { id = "1"; })()],
    ["an object that inherits its fields", Object.create({ id: "1" })],
    ["a Map", new Map([["id", "1"]])],
  ])("%s holds nothing, and what is planted on Object.prototype is not found in it", (_name, value) => {
    for (const key of PLANTED) polluted[key] = "planted";
    const read = held(value);
    expect(Object.keys(read)).toEqual([]);
    expect(PLANTED.map((key) => read[key])).toEqual(PLANTED.map(() => undefined));
  });

  test("each field is read once, as it is asked for: an object that answers differently a second time is not asked one", () => {
    let reads = 0;
    const shifting = Object.defineProperty({}, "id", { get: () => `i.${String(++reads)}`, enumerable: true });
    const read = held(shifting);
    expect([read.id, read.id, reads]).toEqual(["i.1", "i.1", 1]);
  });
});

describe("first", () => {
  test("the first item of a list that has one", () => {
    expect(first(["a", "b"])).toBe("a");
    expect(first([undefined, "b"])).toBeUndefined();
  });

  test.each<[string, unknown]>([
    ["an empty list", []],
    ["a list with a hole where its first item would be", new Array<unknown>(1)],
    ["no list", { 0: "a", length: 1 }],
    ["nothing", undefined],
    ["a string", "ab"],
  ])("%s has none, whatever is under 0 on Object.prototype", (_name, list) => {
    polluted["0"] = "planted";
    expect(first(list)).toBeUndefined();
  });
});

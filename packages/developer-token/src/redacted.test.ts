import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { redacted } from "./redacted";

const SECRET = "-----BEGIN PRIVATE KEY-----hunter2-----END PRIVATE KEY-----";

describe("redacted", () => {
  test.each([["a string", SECRET], ["a number", 42], ["an object", { key: SECRET }], ["undefined", undefined]])("unwrap gives %s back", (_name, value) => {
    expect(redacted(value).unwrap()).toBe(value);
  });

  test.each([
    ["String()", (r: unknown) => String(r)],
    ["a template literal", (r: unknown) => `key: ${r as string}`],
    ["concatenation", (r: unknown) => "key: " + (r as string)],
    ["JSON.stringify", (r: unknown) => JSON.stringify(r)],
    ["JSON.stringify of a holder", (r: unknown) => JSON.stringify({ config: { pem: r } })],
    ["util.inspect", (r: unknown) => inspect(r)],
    ["util.inspect of a holder, hidden properties included", (r: unknown) => inspect({ pem: r }, { depth: null, showHidden: true })],
    ["an Error message", (r: unknown) => new Error(`bad key ${r as string}`).message],
    ["its own keys and values", (r: unknown) => JSON.stringify(Object.entries(r as object).map(([k, v]) => [k, String(v)]))],
    ["a spread copy", (r: unknown) => inspect({ ...(r as object) }, { depth: null, showHidden: true })],
  ])("%s does not reveal the value", (_name, render) => {
    const out = render(redacted(SECRET));
    expect(out).not.toContain("hunter2");
  });

  test("prints a mask where the value would have been", () => {
    const r = redacted(SECRET);
    expect(String(r)).toBe("<redacted>");
    expect(JSON.stringify({ pem: r })).toBe('{"pem":"<redacted>"}');
    expect(inspect({ pem: r })).toBe("{ pem: <redacted> }");
  });

  test("cannot be cloned out of the wrapper", () => {
    expect(() => structuredClone(redacted(SECRET))).toThrow();
  });

  test("cannot be altered to reveal the value", () => {
    const r = redacted(SECRET);
    expect(() => {
      (r as { toString: unknown }).toString = () => SECRET;
    }).toThrow(TypeError);
  });
});

import { describe, expect, test } from "bun:test";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";

describe("canonicalStringify", () => {
  test("orders object keys by a fixed code-unit order instead of the host locale", () => {
    expect(canonicalStringify({ ä: 2, z: 1, a: { é: 4, y: 3 } })).toBe(
      '{"a":{"y":3,"é":4},"z":1,"ä":2}',
    );
  });
});

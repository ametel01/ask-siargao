import { describe, expect, test } from "bun:test";

import { activeDependencyAuditExceptionIds } from "@/server/qa/dependency-audit";

describe("dependency audit exceptions", () => {
  test("allows only unexpired advisory exceptions", () => {
    expect(
      activeDependencyAuditExceptionIds(new Date("2026-08-10T00:00:00.000Z"), [
        { advisoryId: "GHSA-example", expiresAt: "2026-08-11T00:00:00.000Z" },
      ]),
    ).toEqual(["GHSA-example"]);
  });

  test("fails CI when an exception reaches its expiry", () => {
    expect(() =>
      activeDependencyAuditExceptionIds(new Date("2026-08-11T00:00:00.000Z"), [
        { advisoryId: "GHSA-example", expiresAt: "2026-08-11T00:00:00.000Z" },
      ]),
    ).toThrow(/expired/);
  });
});

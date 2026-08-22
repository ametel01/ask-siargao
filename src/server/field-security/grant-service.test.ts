import { describe, expect, test } from "bun:test";

import { offlineFieldGrantPolicy } from "@/server/field-security/grant-service";

describe("Offline Field Grant server policy", () => {
  test("caps grants at 72 hours and documents learned-revocation semantics", () => {
    expect(offlineFieldGrantPolicy()).toEqual({
      clockRollbackToleranceMinutes: 2,
      defaultDurationHours: 72,
      maxDurationHours: 72,
      revocationSemantics: "learned_during_explicit_online_preflight",
    });
  });
});

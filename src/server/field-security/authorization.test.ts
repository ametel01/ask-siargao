import { describe, expect, test } from "bun:test";

import {
  authorizeFieldResearcher,
  readFieldResearcherAccountAllowlist,
} from "@/server/field-security/authorization";

describe("Field Researcher authorization", () => {
  test("accepts explicit Field Researchers or Operators without treating a token as identity", () => {
    const allowlist = readFieldResearcherAccountAllowlist({
      FIELD_RESEARCHER_ACCOUNT_IDS: "field-researcher",
      OPERATOR_ACCOUNT_IDS: "operator",
    });
    for (const accountId of ["field-researcher", "operator"]) {
      expect(
        authorizeFieldResearcher({
          allowlist,
          auth: { accountId, mfaFresh: true },
          mutation: true,
        }),
      ).toEqual({ accountId, allowed: true });
    }
    expect(
      authorizeFieldResearcher({
        allowlist,
        auth: { accountId: "unknown", mfaFresh: true },
        mutation: false,
      }),
    ).toEqual({ allowed: false, reason: "field_researcher_not_authorized" });
  });

  test("requires fresh second factor for trust-creating mutations", () => {
    expect(
      authorizeFieldResearcher({
        allowlist: new Set(["researcher"]),
        auth: { accountId: "researcher", mfaFresh: false },
        mutation: true,
      }),
    ).toEqual({ allowed: false, reason: "fresh_mfa_required" });
  });
});

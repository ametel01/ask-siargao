import { describe, expect, test } from "bun:test";

import { createAuditIntake } from "@/server/audit/intake-service";

const baseInput = {
  travelMonth: "2026-08",
  arrivalOrigin: "Manila",
  stayAreaSlug: "general-luna",
  topConstraint: "quiet sleep",
  travelerContext: { riskTolerance: "balanced" },
} as const;

describe("audit intake and completeness gate", () => {
  test("blocks incomplete audits before checkout eligibility", () => {
    expect(() =>
      createAuditIntake({
        arrivalOrigin: "Manila",
        topConstraint: "quiet sleep",
      }),
    ).toThrow();
  });

  test("blocks below-threshold accommodation matches with actionable followups", () => {
    const result = createAuditIntake({
      ...baseInput,
      accommodationName: "Mystery Villas",
    });

    expect(result.auditRequest.status).toBe("needs_user_input");
    expect(result.completeness.checkoutEligible).toBe(false);
    expect(result.completeness.blockingReasons).toContain(
      "Accommodation match confidence is below the payment threshold.",
    );
    expect(result.completeness.requiredUserFollowups).toContain(
      "Add a listing link or platform URL.",
    );
  });

  test("shows one preview risk when the completeness gate passes", () => {
    const result = createAuditIntake({
      ...baseInput,
      accommodationName: "Example Surf Stay",
    });

    expect(result.auditRequest.status).toBe("complete_for_payment");
    expect(result.completeness.checkoutEligible).toBe(true);
    expect(result.completeness.previewRisk?.id).toBe("preview_arrival_timing");
    expect(result.completeness.evidenceSummary.length).toBeGreaterThan(0);
  });

  test("activates optional modules in the completeness result", () => {
    const result = createAuditIntake({
      ...baseInput,
      optionalModules: ["remote_work", "transport_comfort"],
    });

    expect(result.completeness.activatedModules).toEqual(["remote_work", "transport_comfort"]);
    expect(result.completeness.previewRisk?.whatMightBreak).toContain("transport comfort");
  });

  test("risk tolerance changes preview severity and rationale", () => {
    const relaxed = createAuditIntake({
      ...baseInput,
      travelerContext: { riskTolerance: "relaxed" },
    });
    const lowRisk = createAuditIntake({
      ...baseInput,
      travelerContext: { riskTolerance: "low_risk" },
    });

    expect(relaxed.completeness.previewRisk?.level).toBe("green");
    expect(lowRisk.completeness.previewRisk?.level).toBe("yellow");
    expect(lowRisk.completeness.previewRisk?.whyItMatters).toContain("low-risk tolerance");
  });
});

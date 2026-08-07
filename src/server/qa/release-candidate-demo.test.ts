import { describe, expect, test } from "bun:test";

import {
  releaseCandidateDemoScenario,
  validateReleaseCandidateDemoScenario,
} from "@/server/qa/release-candidate-demo";
import {
  buildTripPassLaunchProof,
  validateTripPassLaunchProof,
} from "@/server/qa/trip-pass-launch-proof";

describe("release-candidate demo scenario", () => {
  test("documents local QA paths backed by synthetic or permitted fixtures", () => {
    const validation = validateReleaseCandidateDemoScenario();

    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(releaseCandidateDemoScenario.paths.map((entry) => entry.path)).toContain(
      "/audits/demo/report",
    );
    expect(releaseCandidateDemoScenario.publicEvidenceIds.length).toBeGreaterThanOrEqual(5);
  });

  test("records Trip Pass launch proof without misreporting external readiness", () => {
    const proof = buildTripPassLaunchProof({});
    const validation = validateTripPassLaunchProof(proof);

    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(proof.launchReady).toBe(false);
    expect(proof.checkoutEnablement.allowedToEnableCheckout).toBe(false);
    expect(proof.deterministicFlowChecks.map((check) => check.id)).toContain(
      "multi_tool_consumes_one_answer",
    );
    expect(proof.deterministicFlowChecks.map((check) => check.id)).toContain(
      "free_outage_and_paid_fallback_budget",
    );
    expect(proof.approvalChecks.map((check) => check.id)).toContain("production_price_currency");
    expect(proof.externalSmokeChecks.map((check) => check.id)).toEqual([
      "stripe_sandbox_lifecycle",
      "redis_integration",
      "waf_verification",
      "analytics_sink_smoke",
    ]);
    expect(proof.externalSmokeChecks.every((check) => check.redactedIdentifier === null)).toBe(
      true,
    );
  });

  test("blocks checkout or extensions while Trip Pass launch blockers remain", () => {
    const checkoutProof = buildTripPassLaunchProof({
      TRIP_PASS_CHECKOUT_MODE: "on",
      TRIP_PASS_EXTENSION_ENABLED: "true",
    });
    const validation = validateTripPassLaunchProof(checkoutProof);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("production_checkout_enabled_with_launch_blockers");
    expect(validation.errors).toContain("trip_pass_extension_enabled_before_launch_approval");
  });
});

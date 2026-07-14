import { describe, expect, test } from "bun:test";

import {
  buildTripPassCostBaselineArtifact,
  buildTripPassCostCandidateComparisonArtifact,
} from "@/server/evaluations/trip-pass-cost-baseline";
import { buildTripPassQualityBypassArtifact } from "@/server/evaluations/trip-pass-quality-bypass";

const requiredCategories = [
  "current weather and conditions",
  "open-now food",
  "beach fit",
  "route time",
  "accommodation comparison",
  "boat and safety caveats",
  "rainy-day itinerary",
  "near-me consent",
  "provider outage",
  "live-limit cached fallback",
];

const requiredBypassResults = [
  "allow",
  "challenge",
  "consume",
  "consume_once",
  "deny",
  "unavailable",
];

describe("Trip Pass decision quality and bypass evaluation", () => {
  test("keeps the 10-case corpus aligned with the launch decision categories", () => {
    const baseline = buildTripPassCostBaselineArtifact();
    const candidate = buildTripPassCostCandidateComparisonArtifact();

    expect(baseline.corpus.caseCount).toBe(10);
    expect(candidate.corpus.caseCount).toBe(10);
    expect(
      candidate.corpus.cases.map((qualityCase) => qualityCase.qualityContract.category),
    ).toEqual(requiredCategories);
    expect(
      candidate.corpus.cases.every((qualityCase) => qualityCase.qualityResult === "pass"),
    ).toBe(true);
  });

  test("proves cost target, call budget, tool ordering, and mixed-card filtering", () => {
    const candidate = buildTripPassCostCandidateComparisonArtifact();
    const routineCases = candidate.corpus.cases.filter(
      (qualityCase) => qualityCase.policyTier === "free_or_paid_routine",
    );
    const providerOutage = candidate.corpus.cases.find(
      (qualityCase) => qualityCase.id === "provider_outage",
    );

    expect(candidate.comparison.passesTwentyPercentTarget).toBe(true);
    expect(candidate.comparison.cacheMissReductionPercent).toBe("36.19%");
    expect(candidate.comparison.modeledCostReductionPercent).toBe("31.88%");
    expect(
      Math.max(...routineCases.map((qualityCase) => qualityCase.callCount)),
    ).toBeLessThanOrEqual(4);
    expect(providerOutage?.qualityContract.semanticToolOrdering).toContain(
      "failed required lookup before downstream Places fallback",
    );
    expect(providerOutage?.qualityContract.artifactAssertions.displayCardFiltering).toBe(
      "mixed displayCardIds keep allowed cards and drop disallowed cards",
    );
  });

  test("records bypass outcomes without raw identity or provider data", () => {
    const artifact = buildTripPassQualityBypassArtifact({});
    const serialized = JSON.stringify(artifact);

    expect(artifact.bypassMatrix.caseCount).toBe(10);
    expect(artifact.bypassMatrix.allCasesPass).toBe(true);
    expect([
      ...new Set(artifact.bypassMatrix.cases.map((bypassCase) => bypassCase.expectedResult)),
    ]).toEqual(expect.arrayContaining(requiredBypassResults));
    expect(artifact.liveProviderSmoke.status).toBe("skipped");
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("cookie=");
    expect(serialized).not.toContain("clerk_");
    expect(serialized).not.toContain("req_");
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
  });
});

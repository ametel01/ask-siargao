import { describe, expect, test } from "bun:test";

import { buildRealityCheckEvaluationArtifact } from "@/server/evaluations/reality-check-matrix";

describe("on-demand Reality Check evaluation matrix", () => {
  test("covers every product kind and the representative traveler constraints", () => {
    const artifact = buildRealityCheckEvaluationArtifact();
    const kinds = artifact.productScenarios.cases.map((scenario) => scenario.expectedKind);

    expect(artifact.executionMode).toBe("on_demand");
    expect(artifact.productScenarios.caseCount).toBe(6);
    expect(artifact.productScenarios.allCasesPass).toBe(true);
    expect(new Set(kinds)).toEqual(
      new Set([
        "accommodation",
        "itinerary",
        "immediate_plan",
        "surf_session",
        "disruption_recovery",
      ]),
    );
    expect(artifact.productScenarios.cases.map((scenario) => scenario.id)).toContain(
      "kids_without_scooter",
    );
  });

  test("proves the required fail-closed and compatibility cases", () => {
    const artifact = buildRealityCheckEvaluationArtifact();

    expect(artifact.failClosedContracts.caseCount).toBe(5);
    expect(artifact.failClosedContracts.allCasesPass).toBe(true);
    expect(artifact.failClosedContracts.cases.map((contractCase) => contractCase.id)).toEqual([
      "missing_input_clarification",
      "provider_failure_downgrade",
      "partial_evidence_label",
      "legacy_summary_compatibility",
      "mixed_artifact_selection",
    ]);
    expect(artifact.semanticOrdering.status).toBe("covered");
    expect(artifact.publicBoundary.status).toBe("covered");
  });

  test("contains synthetic evaluation data only", () => {
    const serialized = JSON.stringify(buildRealityCheckEvaluationArtifact());

    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
    expect(serialized).not.toContain("raw_payload");
    expect(serialized).not.toContain("clerk_");
    expect(serialized).not.toContain("cookie=");
  });
});

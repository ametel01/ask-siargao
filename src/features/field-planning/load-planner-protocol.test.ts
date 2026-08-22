import { describe, expect, test } from "bun:test";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";

import { loadPlannerProtocol } from "./load-planner-protocol";

describe("planner protocol trust boundary", () => {
  test("loads planner rules only after verifying the signed baseline package", async () => {
    const protocol = await loadPlannerProtocol();

    expect(protocol.packageId).toBe("field-protocol-siargao-baseline");
    expect(protocol.assignments).toHaveLength(13);
    expect(protocol.assignments.every(({ editorialPriority }) => editorialPriority > 0)).toBe(true);
    expect(
      protocol.assignments.every(({ anchorAreaId, anchorResolution }) =>
        Boolean(anchorAreaId || anchorResolution === "coverage_snapshot_required"),
      ),
    ).toBe(true);
    expect(protocol.travelEdges.every(({ direction }) => direction === "bidirectional")).toBe(true);
    expect(protocol.eligibilityRules.every(({ hardGate }) => hardGate)).toBe(true);
  });

  test("rejects tampered runtime planning metadata", async () => {
    const tampered = structuredClone(baselineFieldProtocolPackage) as unknown as {
      campaign: { assignments: Array<{ editorialPriority: number }> };
    };
    tampered.campaign.assignments[0].editorialPriority = 999;

    await expect(loadPlannerProtocol({ bundle: tampered })).rejects.toThrow("not verified");
  });
});

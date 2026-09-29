import { describe, expect, test } from "bun:test";
import { proposeFieldDayPlan } from "./field-planner";
import corridorGolden from "./fixtures/island-corridor-golden.json";
import { createFailClosedPlannerFixture, createPlannerFixture } from "./fixtures/planner-fixtures";
import { loadPlannerProtocol } from "./load-planner-protocol";

describe("signed Siargao baseline planner goldens", () => {
  test("ships the ordinary route with no fabricated readiness evidence", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createFailClosedPlannerFixture(protocol);
    const proposal = proposeFieldDayPlan(protocol, fixture.coverageSnapshot, fixture.inputs);

    expect(proposal.selected).toHaveLength(0);
    expect(proposal.exclusions.filter(({ code }) => code === "missing_gate_evidence")).toHaveLength(
      12,
    );
    expect(proposal.exclusions).toContainEqual(
      expect.objectContaining({
        assignmentId: "assignment_conflict_follow_up",
        code: "unresolved_geography",
      }),
    );
  });

  test("plans Del Carmen through the central corridor to General Luna at the exact return boundary", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createPlannerFixture(protocol);
    const wanted = new Set(["assignment_dapa_hub", "assignment_general_luna_journey"]);
    const coverageSnapshot = completeAllExcept(protocol, fixture.coverageSnapshot, wanted);
    const proposal = proposeFieldDayPlan(protocol, coverageSnapshot, {
      ...fixture.inputs,
      availableMinutes: 940,
    });

    expect(
      JSON.stringify({
        selected: proposal.selected.map((entry) => ({
          assignmentId: entry.assignmentId,
          areaId: entry.areaId,
          travelFromPreviousMinutes: entry.travelFromPreviousMinutes,
          workMinutes: entry.workMinutes,
          returnToStartMinutes: entry.returnToStartMinutes,
        })),
        reserveMinutes: proposal.reserveMinutes,
        usableMinutes: proposal.usableMinutes,
        consumedMinutes: proposal.consumedMinutes,
        plannedReturnMinutes: proposal.plannedReturnMinutes,
        remainingMinutes: proposal.remainingMinutes,
      }),
    ).toBe(JSON.stringify(corridorGolden));
  });

  test("re-gates a stale Pilar primary and its south-corridor fallback independently", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createPlannerFixture(protocol);
    const wanted = new Set(["assignment_pilar_access", "assignment_south_central_corridor"]);
    const coverageSnapshot = completeAllExcept(protocol, fixture.coverageSnapshot, wanted);
    const stalePilar = fixture.inputs.eligibilityEvidence.map((entry) =>
      entry.assignmentId === "assignment_pilar_access" && entry.kind === "tide_context"
        ? { ...entry, validUntil: "2026-08-23T07:59:59.000Z" }
        : entry,
    );
    const safeFallback = proposeFieldDayPlan(protocol, coverageSnapshot, {
      ...fixture.inputs,
      availableMinutes: 1_000,
      eligibilityEvidence: stalePilar,
    });

    expect(safeFallback.selected.map(({ assignmentId }) => assignmentId)).toEqual([
      "assignment_south_central_corridor",
    ]);
    expect(safeFallback.exclusions).toContainEqual(
      expect.objectContaining({
        assignmentId: "assignment_pilar_access",
        code: "eligibility_not_current",
        facts: expect.objectContaining({
          safeFallbackAssignmentId: "assignment_south_central_corridor",
        }),
      }),
    );

    const blockedFallback = proposeFieldDayPlan(protocol, coverageSnapshot, {
      ...fixture.inputs,
      availableMinutes: 1_000,
      eligibilityEvidence: stalePilar,
      assignmentGates: fixture.inputs.assignmentGates.map((entry) =>
        entry.assignmentId === "assignment_south_central_corridor"
          ? { ...entry, safety: "blocked" as const }
          : entry,
      ),
    });
    expect(blockedFallback.selected).toHaveLength(0);
  });

  test("keeps a conservative northbound and Santa Monica return", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createPlannerFixture(protocol);
    const wanted = new Set(["assignment_northbound_services", "assignment_santa_monica_alegria"]);
    const coverageSnapshot = completeAllExcept(protocol, fixture.coverageSnapshot, wanted);
    const proposal = proposeFieldDayPlan(protocol, coverageSnapshot, {
      ...fixture.inputs,
      availableMinutes: 1_170,
    });

    expect(new Set(proposal.selected.map(({ assignmentId }) => assignmentId))).toEqual(wanted);
    expect(proposal.consumedMinutes + proposal.plannedReturnMinutes).toBe(proposal.usableMinutes);
    expect(proposal.plannedReturnMinutes).toBe(105);
  });
});

function completeAllExcept(
  protocol: Awaited<ReturnType<typeof loadPlannerProtocol>>,
  snapshot: ReturnType<typeof createPlannerFixture>["coverageSnapshot"],
  outstandingAssignmentIds: ReadonlySet<string>,
) {
  return {
    ...snapshot,
    requirementStates: protocol.assignments
      .filter(({ id }) => !outstandingAssignmentIds.has(id))
      .flatMap((assignment) =>
        assignment.coverageRequirements.map((requirement) => ({
          assignmentId: assignment.id,
          coverageRequirementId: requirement.id,
          capturedCount: requirement.minimumRecords,
          distinctWindows: requirement.minimumDistinctWindows,
          oldestAdmissibleEvidenceAt: "2026-08-01T00:00:00.000Z",
        })),
      ),
  };
}

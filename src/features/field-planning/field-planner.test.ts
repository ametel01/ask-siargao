import { describe, expect, test } from "bun:test";
import { applyFieldPlanAdjustment } from "./field-plan-adjustments";
import { proposeFieldDayPlan } from "./field-planner";
import golden from "./fixtures/del-carmen-golden.json";
import { createTestPlannerFixture } from "./fixtures/test-fixtures";

describe("deterministic Field Day planner", () => {
  test("matches the Del Carmen golden proposal with the full reserve retained", () => {
    const { protocol, coverageSnapshot, inputs } = createTestPlannerFixture();
    const proposal = proposeFieldDayPlan(protocol, coverageSnapshot, inputs);

    expect(
      JSON.stringify({
        selectedAssignmentIds: proposal.selected.map(({ assignmentId }) => assignmentId),
        availableMinutes: proposal.availableMinutes,
        reserveMinutes: proposal.reserveMinutes,
        usableMinutes: proposal.usableMinutes,
        consumedMinutes: proposal.consumedMinutes,
        plannedReturnMinutes: proposal.plannedReturnMinutes,
        remainingMinutes: proposal.remainingMinutes,
        excludedCodes: Object.fromEntries(
          proposal.exclusions.map(({ assignmentId, code }) => [assignmentId, code]),
        ),
      }),
    ).toBe(JSON.stringify(golden));
  });

  test("is byte-stable across Assignment, gate, eligibility, and graph permutations", () => {
    const fixture = createTestPlannerFixture();
    const expected = JSON.stringify(
      proposeFieldDayPlan(fixture.protocol, fixture.coverageSnapshot, fixture.inputs),
    );
    const permutations = [
      <T>(values: readonly T[]) => [...values].reverse(),
      <T>(values: readonly T[]) =>
        values.length === 0 ? [] : [...values.slice(1), values[0] as T],
      <T>(values: readonly T[]) => [...values],
    ];

    for (const permute of permutations) {
      const actual = proposeFieldDayPlan(
        {
          ...fixture.protocol,
          assignments: permute(fixture.protocol.assignments),
          travelEdges: permute(fixture.protocol.travelEdges),
        },
        {
          ...fixture.coverageSnapshot,
          requirementStates: permute(fixture.coverageSnapshot.requirementStates),
        },
        {
          ...fixture.inputs,
          assignmentGates: permute(fixture.inputs.assignmentGates),
          eligibilityEvidence: permute(fixture.inputs.eligibilityEvidence),
        },
      );
      expect(JSON.stringify(actual)).toBe(expected);
    }
  });

  test("accepts exact capacity and rejects one minute over without consuming reserve", () => {
    const fixture = createTestPlannerFixture();
    const exact = proposeFieldDayPlan(fixture.protocol, fixture.coverageSnapshot, {
      ...fixture.inputs,
      availableMinutes: 110,
    });
    expect(exact.selected.map(({ assignmentId }) => assignmentId)).toEqual([
      "assignment_a",
      "assignment_b",
    ]);
    expect(exact.remainingMinutes).toBe(0);

    const over = proposeFieldDayPlan(fixture.protocol, fixture.coverageSnapshot, {
      ...fixture.inputs,
      availableMinutes: 109,
    });
    expect(over.selected.map(({ assignmentId }) => assignmentId)).toEqual(["assignment_a"]);
    expect(over.reserveMinutes).toBe(20);
  });

  test("never lets unsafe work re-enter through manual add", () => {
    const fixture = createTestPlannerFixture();
    const proposal = proposeFieldDayPlan(
      fixture.protocol,
      fixture.coverageSnapshot,
      fixture.inputs,
    );

    expect(() =>
      applyFieldPlanAdjustment(
        fixture.protocol,
        fixture.coverageSnapshot,
        fixture.inputs,
        proposal,
        { kind: "add", assignmentId: "assignment_c" },
      ),
    ).toThrow("does not pass every hard gate");
  });

  test("reorders and removes only after recomputing travel and exact coverage impact", () => {
    const fixture = createTestPlannerFixture();
    const proposal = proposeFieldDayPlan(
      fixture.protocol,
      fixture.coverageSnapshot,
      fixture.inputs,
    );
    const moved = applyFieldPlanAdjustment(
      fixture.protocol,
      fixture.coverageSnapshot,
      fixture.inputs,
      proposal,
      { kind: "move", assignmentId: "assignment_b", direction: "earlier" },
    );
    expect(moved.proposal.selected.map(({ assignmentId }) => assignmentId)).toEqual([
      "assignment_b",
      "assignment_a",
    ]);
    expect(
      moved.proposal.selected.map(({ travelFromPreviousMinutes }) => travelFromPreviousMinutes),
    ).toEqual([10, 10]);

    const removed = applyFieldPlanAdjustment(
      fixture.protocol,
      fixture.coverageSnapshot,
      fixture.inputs,
      proposal,
      { kind: "remove", assignmentId: "assignment_b" },
    );
    expect(removed.proposal.selected.map(({ assignmentId }) => assignmentId)).toEqual([
      "assignment_a",
    ]);
    expect(removed.coverageImpact).toEqual([
      {
        coverageRequirementId: "coverage_assignment_b",
        remainingRecords: 1,
        remainingDistinctWindows: 1,
      },
    ]);
  });

  test("fails closed for stale eligibility and unresolved governed-subject geography", () => {
    const fixture = createTestPlannerFixture();
    const staleEvidence = fixture.inputs.eligibilityEvidence.map((entry) =>
      entry.assignmentId === "assignment_a"
        ? { ...entry, retrievedAt: "2026-08-23T05:00:00.000Z" }
        : entry,
    );
    const proposal = proposeFieldDayPlan(fixture.protocol, fixture.coverageSnapshot, {
      ...fixture.inputs,
      eligibilityEvidence: staleEvidence,
    });

    expect(proposal.exclusions).toContainEqual(
      expect.objectContaining({ assignmentId: "assignment_a", code: "eligibility_not_current" }),
    );
    expect(proposal.exclusions).toContainEqual(
      expect.objectContaining({ assignmentId: "assignment_dynamic", code: "unresolved_geography" }),
    );
  });

  test("admits dynamic geography only when the snapshot resolves a governed area", () => {
    const fixture = createTestPlannerFixture();
    const proposal = proposeFieldDayPlan(
      fixture.protocol,
      {
        ...fixture.coverageSnapshot,
        resolvedAssignmentAreaIds: { assignment_dynamic: "area_start" },
      },
      fixture.inputs,
    );
    expect(proposal.selected.map(({ assignmentId }) => assignmentId)).toContain(
      "assignment_dynamic",
    );
  });

  test("rejects forged Partial Coverage Set IDs", () => {
    const fixture = createTestPlannerFixture();
    const proposal = proposeFieldDayPlan(fixture.protocol, fixture.coverageSnapshot, {
      ...fixture.inputs,
      partialCoverageSetIds: { assignment_a: "partial_forged" },
    });
    expect(proposal.exclusions).toContainEqual(
      expect.objectContaining({ assignmentId: "assignment_a", code: "hard_gate_blocked" }),
    );
  });

  test("permits partial work only through an exact package Partial Coverage Set", () => {
    const fixture = createTestPlannerFixture();
    const protocol = {
      ...fixture.protocol,
      assignments: fixture.protocol.assignments.map((assignment) =>
        assignment.id === "assignment_a"
          ? {
              ...assignment,
              estimatedMinutes: 60,
              coverageRequirements: [
                ...assignment.coverageRequirements,
                {
                  id: "coverage_assignment_a_second",
                  objectiveId: "objective_assignment_a_second",
                  required: true,
                  minimumRecords: 1,
                  minimumDistinctWindows: 1,
                },
              ],
            }
          : assignment,
      ),
    };
    const proposal = proposeFieldDayPlan(protocol, fixture.coverageSnapshot, {
      ...fixture.inputs,
      partialCoverageSetIds: { assignment_a: "partial_assignment_a" },
    });
    const partial = proposal.selected.find(({ assignmentId }) => assignmentId === "assignment_a");

    expect(partial?.partialCoverageSetId).toBe("partial_assignment_a");
    expect(partial?.workMinutes).toBe(30);
    expect(partial?.consequences.map(({ coverageRequirementId }) => coverageRequirementId)).toEqual(
      ["coverage_assignment_a"],
    );
  });

  test("uses stable Assignment ID as the final tie-breaker", () => {
    const fixture = createTestPlannerFixture();
    const tiedAssignments = fixture.protocol.assignments
      .filter(({ id }) => id === "assignment_a" || id === "assignment_b")
      .map((assignment) => ({
        ...assignment,
        anchorAreaId: "area_start",
        estimatedMinutes: 30,
        editorialPriority: 1,
        eligibilityWindows: [{ kind: "ordinary", values: ["current"] }],
      }))
      .reverse();
    const eligibilityEvidence = fixture.inputs.eligibilityEvidence
      .filter(({ assignmentId }) =>
        tiedAssignments.some((assignment) => assignment.id === assignmentId),
      )
      .map((entry) => ({ ...entry, kind: "ordinary" }));
    const proposal = proposeFieldDayPlan(
      { ...fixture.protocol, assignments: tiedAssignments },
      fixture.coverageSnapshot,
      {
        ...fixture.inputs,
        availableMinutes: 50,
        assignmentGates: fixture.inputs.assignmentGates.filter(({ assignmentId }) =>
          tiedAssignments.some((assignment) => assignment.id === assignmentId),
        ),
        eligibilityEvidence,
      },
    );

    expect(proposal.selected.map(({ assignmentId }) => assignmentId)).toEqual(["assignment_a"]);
  });

  test("property: generated cases never exceed usable capacity", () => {
    const fixture = createTestPlannerFixture();
    let seed = 240;
    for (let caseNumber = 0; caseNumber < 300; caseNumber += 1) {
      seed = (seed * 48_271) % 2_147_483_647;
      const availableMinutes = 20 + (seed % 200);
      const proposal = proposeFieldDayPlan(fixture.protocol, fixture.coverageSnapshot, {
        ...fixture.inputs,
        availableMinutes,
      });
      expect(
        proposal.consumedMinutes + proposal.plannedReturnMinutes,
        `seed=${seed};case=${caseNumber}`,
      ).toBeLessThanOrEqual(proposal.usableMinutes);
      expect(proposal.reserveMinutes).toBe(20);
    }
  });
});

import type {
  FieldCoverageSnapshot,
  PlannerAssignment,
  PlannerInputs,
  PlannerProtocol,
} from "../field-planning-types";

const requirements = (assignmentId: string) => [
  {
    id: `coverage_${assignmentId}`,
    objectiveId: `objective_${assignmentId}`,
    required: true,
    minimumRecords: 1,
    minimumDistinctWindows: 1,
  },
];

function assignment(
  id: string,
  areaId: string | undefined,
  kind: string,
  estimatedMinutes: number,
  editorialPriority: number,
): PlannerAssignment {
  return {
    id,
    title: id.replaceAll("_", " "),
    estimatedMinutes,
    editorialPriority,
    evidenceFreshnessReviewMinutes: 60,
    anchorAreaId: areaId,
    anchorResolution: areaId ? undefined : "coverage_snapshot_required",
    eligibilityWindows: [{ kind, values: ["current"] }],
    coverageRequirements: requirements(id),
    partialCoverageSets: [{ id: `partial_${id}`, objectiveIds: [`objective_${id}`] }],
    safeFallbackAssignmentId: id === "assignment_a" ? "assignment_c" : undefined,
  };
}

export function createTestPlannerFixture(): {
  protocol: PlannerProtocol;
  coverageSnapshot: FieldCoverageSnapshot;
  inputs: PlannerInputs;
} {
  const assignments = [
    assignment("assignment_a", "area_start", "rare", 30, 2),
    assignment("assignment_b", "area_remote", "ordinary", 40, 1),
    assignment("assignment_c", "area_start", "ordinary", 20, 3),
    assignment("assignment_dynamic", undefined, "ordinary", 20, 2),
  ];
  const protocol: PlannerProtocol = {
    packageId: "test-package",
    packageVersion: "1.0.0",
    campaignId: "test-campaign",
    campaignVersion: "1.0.0",
    geographyVersion: "1.0.0",
    areas: ["area_remote", "area_start"],
    transportModes: ["walk", "car"],
    eligibilityRules: [
      { kind: "ordinary", rarityRank: 3, maximumAgeMinutes: 60, hardGate: true },
      { kind: "rare", rarityRank: 1, maximumAgeMinutes: 60, hardGate: true },
    ],
    assignments,
    travelEdges: [
      {
        from: "area_start",
        to: "area_remote",
        modes: ["car"],
        durationBandMinutes: [5, 10],
        direction: "bidirectional",
        transferBoundary: false,
      },
    ],
  };
  const coverageSnapshot: FieldCoverageSnapshot = {
    id: "coverage-1",
    version: "1",
    capturedAt: "2026-08-23T07:00:00.000Z",
    protocolPackageId: protocol.packageId,
    protocolPackageVersion: protocol.packageVersion,
    requirementStates: [],
    resolvedAssignmentAreaIds: {},
  };
  const inputs: PlannerInputs = {
    planningAt: "2026-08-23T08:00:00.000Z",
    startingAreaId: "area_start",
    transportMode: "car",
    availableMinutes: 120,
    reserveMinutes: { safety: 5, documentation: 5, rest: 5, daylight: 5 },
    assignmentGates: assignments.map(({ id }) => ({
      id: `gate-${id}`,
      assignmentId: id,
      safety: id === "assignment_c" ? "blocked" : "allowed",
      permission: "allowed",
      access: "allowed",
      sourceId: "readiness",
      retrievedAt: "2026-08-23T07:30:00.000Z",
      validUntil: "2026-08-23T09:00:00.000Z",
      fingerprint: `gate-${id}-v1`,
    })),
    eligibilityEvidence: assignments.map(({ id, eligibilityWindows }) => ({
      id: `eligibility-${id}`,
      assignmentId: id,
      kind: eligibilityWindows[0]?.kind ?? "ordinary",
      value: "current",
      state: "allowed",
      sourceId: "preflight",
      retrievedAt: "2026-08-23T07:30:00.000Z",
      validUntil: "2026-08-23T09:00:00.000Z",
      fingerprint: `eligibility-${id}-v1`,
    })),
  };
  return { protocol, coverageSnapshot, inputs };
}

import type {
  FieldCoverageSnapshot,
  PlannerInputs,
  PlannerProtocol,
} from "../field-planning-types";

export const fixedPlanningAt = "2026-08-23T08:00:00.000Z";

export function createPlannerFixture(protocol: PlannerProtocol): {
  coverageSnapshot: FieldCoverageSnapshot;
  inputs: PlannerInputs;
} {
  return {
    coverageSnapshot: {
      id: "coverage-snapshot-fixture-001",
      version: "1",
      capturedAt: "2026-08-23T07:45:00.000Z",
      protocolPackageId: protocol.packageId,
      protocolPackageVersion: protocol.packageVersion,
      requirementStates: [],
      resolvedAssignmentAreaIds: {},
    },
    inputs: {
      planningAt: fixedPlanningAt,
      startingAreaId: "area_del_carmen",
      transportMode: "motorbike",
      availableMinutes: 720,
      reserveMinutes: { safety: 45, documentation: 45, rest: 30, daylight: 60 },
      assignmentGates: protocol.assignments.map((assignment) => ({
        id: `gate-${assignment.id}`,
        assignmentId: assignment.id,
        safety: "allowed",
        permission: "allowed",
        access: "allowed",
        sourceId: "fixture-field-readiness",
        retrievedAt: "2026-08-23T07:30:00.000Z",
        validUntil: "2026-08-23T18:00:00.000Z",
        fingerprint: `gate-fingerprint-${assignment.id}`,
      })),
      eligibilityEvidence: protocol.assignments.flatMap((assignment) =>
        assignment.eligibilityWindows.map((window) => ({
          id: `eligibility-${assignment.id}-${window.kind}`,
          assignmentId: assignment.id,
          kind: window.kind,
          value: window.values[0] ?? "missing",
          state: "allowed" as const,
          sourceId: "fixture-preflight",
          retrievedAt: "2026-08-23T07:30:00.000Z",
          validUntil: "2026-08-23T18:00:00.000Z",
          fingerprint: `preflight-${assignment.id}-${window.kind}`,
        })),
      ),
    },
  };
}

export function createFailClosedPlannerFixture(protocol: PlannerProtocol): {
  coverageSnapshot: FieldCoverageSnapshot;
  inputs: PlannerInputs;
} {
  const fixture = createPlannerFixture(protocol);
  return {
    coverageSnapshot: fixture.coverageSnapshot,
    inputs: {
      ...fixture.inputs,
      assignmentGates: fixture.inputs.assignmentGates.map((gate) => ({
        ...gate,
        safety: "unknown",
        permission: "unknown",
        access: "unknown",
        fingerprint: `${gate.fingerprint}-unconfirmed`,
      })),
      eligibilityEvidence: fixture.inputs.eligibilityEvidence.map((evidence) => ({
        ...evidence,
        state: "unknown",
        fingerprint: `${evidence.fingerprint}-unconfirmed`,
      })),
    },
  };
}

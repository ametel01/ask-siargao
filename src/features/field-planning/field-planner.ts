import type {
  CoverageConsequence,
  FieldCoverageSnapshot,
  FieldPlanProposal,
  PlannedAssignment,
  PlannerAssignment,
  PlannerInputs,
  PlannerProtocol,
  PlanningReason,
} from "./field-planning-types";
import { findConservativeTravelPath } from "./travel-compatibility";

type Candidate = Readonly<{
  assignment: PlannerAssignment;
  areaId: string;
  partialCoverageSetId?: string;
  workMinutes: number;
  rarityRank: number;
  travelFromStartMinutes: number;
  outstandingRequiredCoverage: number;
  oldestEvidenceAt: string;
  consequences: readonly CoverageConsequence[];
}>;

export function proposeFieldDayPlan(
  protocol: PlannerProtocol,
  coverageSnapshot: FieldCoverageSnapshot,
  inputs: PlannerInputs,
): FieldPlanProposal {
  validateReferences(protocol, coverageSnapshot, inputs);
  const reserveMinutes = Object.values(inputs.reserveMinutes).reduce(
    (total, value) => total + value,
    0,
  );
  const usableMinutes = Math.max(0, inputs.availableMinutes - reserveMinutes);
  const exclusions: PlanningReason[] = [];
  const candidates: Candidate[] = [];

  for (const assignment of [...protocol.assignments].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const result = evaluateCandidate(protocol, assignment, coverageSnapshot, inputs);
    if ("reason" in result) {
      exclusions.push({
        ...result.reason,
        facts: {
          ...result.reason.facts,
          ...(assignment.safeFallbackAssignmentId
            ? { safeFallbackAssignmentId: assignment.safeFallbackAssignmentId }
            : {}),
        },
      });
    } else candidates.push(result);
  }

  candidates.sort(compareCandidates);
  const selected: PlannedAssignment[] = [];
  let currentArea = inputs.startingAreaId;
  let consumedMinutes = 0;
  let plannedReturnMinutes = 0;

  for (const candidate of candidates) {
    const outward = findConservativeTravelPath(
      protocol,
      currentArea,
      candidate.areaId,
      inputs.transportMode,
    );
    const home = findConservativeTravelPath(
      protocol,
      candidate.areaId,
      inputs.startingAreaId,
      inputs.transportMode,
    );
    if (!outward.success || !home.success) {
      exclusions.push(
        reason(
          !outward.success ? outward.code : home.success ? "transport_incompatible" : home.code,
          candidate.assignment.id,
          { fromAreaId: currentArea, toAreaId: candidate.areaId, mode: inputs.transportMode },
        ),
      );
      continue;
    }
    const projected = consumedMinutes + outward.minutes + candidate.workMinutes + home.minutes;
    if (projected > usableMinutes) {
      exclusions.push(
        reason("insufficient_capacity", candidate.assignment.id, {
          usableMinutes,
          consumedMinutes,
          travelMinutes: outward.minutes,
          workMinutes: candidate.workMinutes,
          returnMinutes: home.minutes,
          overByMinutes: projected - usableMinutes,
        }),
      );
      continue;
    }

    consumedMinutes += outward.minutes + candidate.workMinutes;
    plannedReturnMinutes = home.minutes;
    currentArea = candidate.areaId;
    selected.push({
      assignmentId: candidate.assignment.id,
      title: candidate.assignment.title,
      areaId: candidate.areaId,
      partialCoverageSetId: candidate.partialCoverageSetId,
      travelFromPreviousMinutes: outward.minutes,
      returnToStartMinutes: home.minutes,
      workMinutes: candidate.workMinutes,
      outstandingRequiredCoverage: candidate.outstandingRequiredCoverage,
      consequences: candidate.consequences,
      reasons: [
        reason("included", candidate.assignment.id, {
          rarityRank: candidate.rarityRank,
          editorialPriority: candidate.assignment.editorialPriority,
          outstandingRequiredCoverage: candidate.outstandingRequiredCoverage,
          travelMinutes: outward.minutes,
          workMinutes: candidate.workMinutes,
          returnMinutes: home.minutes,
        }),
        ...(candidate.partialCoverageSetId
          ? [
              reason("partial_coverage_selected", candidate.assignment.id, {
                partialCoverageSetId: candidate.partialCoverageSetId,
              }),
            ]
          : []),
      ],
    });
  }

  return deepFreeze({
    protocolPackageId: protocol.packageId,
    protocolPackageVersion: protocol.packageVersion,
    coverageSnapshotId: coverageSnapshot.id,
    selected,
    exclusions: exclusions.sort((left, right) =>
      left.assignmentId.localeCompare(right.assignmentId),
    ),
    availableMinutes: inputs.availableMinutes,
    reserveMinutes,
    usableMinutes,
    consumedMinutes,
    plannedReturnMinutes,
    remainingMinutes: usableMinutes - consumedMinutes - plannedReturnMinutes,
  });
}

function evaluateCandidate(
  protocol: PlannerProtocol,
  assignment: PlannerAssignment,
  coverageSnapshot: FieldCoverageSnapshot,
  inputs: PlannerInputs,
): Candidate | { reason: PlanningReason } {
  const areaId =
    assignment.anchorAreaId ?? coverageSnapshot.resolvedAssignmentAreaIds[assignment.id];
  if (!areaId) {
    return { reason: reason("unresolved_geography", assignment.id, { resolutionRequired: true }) };
  }
  if (!protocol.areas.includes(areaId)) {
    return { reason: reason("unresolved_geography", assignment.id, { areaId }) };
  }

  const gate = inputs.assignmentGates.find((entry) => entry.assignmentId === assignment.id);
  if (!gate || !isCurrent(gate.retrievedAt, gate.validUntil, inputs.planningAt)) {
    return { reason: reason("missing_gate_evidence", assignment.id, { gate: "assignment" }) };
  }
  for (const gateName of ["safety", "permission", "access"] as const) {
    if (gate[gateName] !== "allowed") {
      return {
        reason: reason(
          gate[gateName] === "blocked" ? "hard_gate_blocked" : "missing_gate_evidence",
          assignment.id,
          { gate: gateName, state: gate[gateName] },
        ),
      };
    }
  }

  const rarityRanks: number[] = [];
  for (const window of assignment.eligibilityWindows) {
    const rule = protocol.eligibilityRules.find((entry) => entry.kind === window.kind);
    if (!rule) {
      return { reason: reason("missing_gate_evidence", assignment.id, { kind: window.kind }) };
    }
    const evidence = inputs.eligibilityEvidence.find(
      (entry) => entry.assignmentId === assignment.id && entry.kind === window.kind,
    );
    if (evidence?.state !== "allowed") {
      return {
        reason: reason("eligibility_not_current", assignment.id, {
          kind: window.kind,
          state: evidence?.state ?? "missing",
        }),
      };
    }
    if (
      !isCurrent(
        evidence.retrievedAt,
        evidence.validUntil,
        inputs.planningAt,
        rule.maximumAgeMinutes,
      )
    ) {
      return {
        reason: reason("eligibility_not_current", assignment.id, {
          kind: window.kind,
          state: "stale",
        }),
      };
    }
    if (!window.values.includes(evidence.value)) {
      return {
        reason: reason("eligibility_value_mismatch", assignment.id, {
          kind: window.kind,
          value: evidence.value,
        }),
      };
    }
    rarityRanks.push(rule.rarityRank);
  }

  const path = findConservativeTravelPath(
    protocol,
    inputs.startingAreaId,
    areaId,
    inputs.transportMode,
  );
  const returnPath = findConservativeTravelPath(
    protocol,
    areaId,
    inputs.startingAreaId,
    inputs.transportMode,
  );
  if (!path.success) {
    return {
      reason: reason(path.code, assignment.id, {
        areaId,
        mode: inputs.transportMode,
        returnRequired: true,
      }),
    };
  }
  if (!returnPath.success) {
    return {
      reason: reason(returnPath.code, assignment.id, {
        areaId,
        mode: inputs.transportMode,
        returnRequired: true,
      }),
    };
  }

  const partialCoverageSetId = inputs.partialCoverageSetIds?.[assignment.id];
  const partialCoverageSet = partialCoverageSetId
    ? assignment.partialCoverageSets.find(({ id }) => id === partialCoverageSetId)
    : undefined;
  if (partialCoverageSetId && !partialCoverageSet) {
    return {
      reason: reason("hard_gate_blocked", assignment.id, {
        gate: "partialCoverageSet",
        partialCoverageSetId,
      }),
    };
  }
  const requirements = partialCoverageSet
    ? assignment.coverageRequirements.filter(({ objectiveId }) =>
        partialCoverageSet.objectiveIds.includes(objectiveId),
      )
    : assignment.coverageRequirements;
  const consequences = requirements.map((requirement) => {
    const state = coverageSnapshot.requirementStates.find(
      (entry) =>
        entry.assignmentId === assignment.id && entry.coverageRequirementId === requirement.id,
    );
    return {
      coverageRequirementId: requirement.id,
      remainingRecords: Math.max(0, requirement.minimumRecords - (state?.capturedCount ?? 0)),
      remainingDistinctWindows: Math.max(
        0,
        requirement.minimumDistinctWindows - (state?.distinctWindows ?? 0),
      ),
    };
  });
  const outstandingRequiredCoverage = consequences.reduce(
    (total, consequence) =>
      total + consequence.remainingRecords + consequence.remainingDistinctWindows,
    0,
  );
  if (outstandingRequiredCoverage === 0) {
    return { reason: reason("coverage_complete", assignment.id, { outstanding: 0 }) };
  }
  const oldestEvidenceAt =
    assignment.coverageRequirements
      .map(
        (requirement) =>
          coverageSnapshot.requirementStates.find(
            (entry) =>
              entry.assignmentId === assignment.id &&
              entry.coverageRequirementId === requirement.id,
          )?.oldestAdmissibleEvidenceAt,
      )
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? "0000-01-01T00:00:00.000Z";
  const workMinutes = partialCoverageSet
    ? Math.max(
        1,
        Math.ceil(
          assignment.estimatedMinutes *
            (requirements.length / Math.max(1, assignment.coverageRequirements.length)),
        ),
      )
    : assignment.estimatedMinutes;

  return {
    assignment,
    areaId,
    partialCoverageSetId,
    workMinutes,
    rarityRank: Math.min(...rarityRanks, Number.MAX_SAFE_INTEGER),
    travelFromStartMinutes: path.minutes,
    outstandingRequiredCoverage,
    oldestEvidenceAt,
    consequences,
  };
}

function compareCandidates(left: Candidate, right: Candidate) {
  return (
    left.rarityRank - right.rarityRank ||
    left.travelFromStartMinutes - right.travelFromStartMinutes ||
    right.outstandingRequiredCoverage - left.outstandingRequiredCoverage ||
    left.assignment.editorialPriority - right.assignment.editorialPriority ||
    left.oldestEvidenceAt.localeCompare(right.oldestEvidenceAt) ||
    right.workMinutes - left.workMinutes ||
    left.assignment.id.localeCompare(right.assignment.id)
  );
}

function validateReferences(
  protocol: PlannerProtocol,
  coverageSnapshot: FieldCoverageSnapshot,
  inputs: PlannerInputs,
) {
  if (
    coverageSnapshot.protocolPackageId !== protocol.packageId ||
    coverageSnapshot.protocolPackageVersion !== protocol.packageVersion
  ) {
    throw new Error("Coverage snapshot does not reference the verified planner protocol.");
  }
  if (!protocol.areas.includes(inputs.startingAreaId)) throw new Error("Unknown starting area.");
  if (!protocol.transportModes.includes(inputs.transportMode))
    throw new Error("Unknown transport mode.");
  if (!isFiniteNonNegative(inputs.availableMinutes))
    throw new Error("Available minutes are invalid.");
  if (Object.values(inputs.reserveMinutes).some((value) => !isFiniteNonNegative(value))) {
    throw new Error("Reserve minutes are invalid.");
  }
  if (!Number.isFinite(Date.parse(inputs.planningAt)))
    throw new Error("planningAt must be explicit ISO time.");
  assertUnique(
    inputs.assignmentGates.map(({ assignmentId }) => assignmentId),
    "assignment gate",
  );
  assertUnique(
    inputs.eligibilityEvidence.map(({ assignmentId, kind }) => `${assignmentId}\u0000${kind}`),
    "eligibility evidence",
  );
}

function isCurrent(
  retrievedAt: string,
  validUntil: string,
  planningAt: string,
  maximumAgeMinutes?: number,
) {
  const retrieved = Date.parse(retrievedAt);
  const valid = Date.parse(validUntil);
  const planning = Date.parse(planningAt);
  return (
    Number.isFinite(retrieved) &&
    Number.isFinite(valid) &&
    retrieved <= planning &&
    valid >= planning &&
    (maximumAgeMinutes === undefined || planning - retrieved <= maximumAgeMinutes * 60_000)
  );
}

function reason(
  code: PlanningReason["code"],
  assignmentId: string,
  facts: PlanningReason["facts"],
): PlanningReason {
  return { code, assignmentId, facts };
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
}

function isFiniteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

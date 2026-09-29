import type { FieldPlanSnapshot } from "@/features/field-planning/field-planning-types";
import { validateFieldProtocolRecord } from "@/features/field-protocol/field-protocol";
import type {
  CaptureException,
  FieldVisit,
  ObjectiveCoverage as ProtocolObjectiveCoverage,
} from "@/features/field-protocol/generated";

import type {
  AssignmentExecution,
  AssignmentOutcome,
  FieldDayClose,
  FollowUpAssignment,
  RecorderRecord,
  RecorderStep,
  RecorderWork,
} from "./field-recorder-types";
import type { RecorderProtocol } from "./load-recorder-protocol";
import { deriveAssignmentCoverage, deterministicNextRequirement } from "./objective-coverage";

export function createRecorderWork(input: {
  id: string;
  now: string;
  snapshot: FieldPlanSnapshot;
}): RecorderWork {
  const first = input.snapshot.proposal.selected[0];
  if (!first) throw new Error("A confirmed Field Day Plan needs at least one Assignment.");
  return Object.freeze({
    assignmentOutcomes: [],
    assignments: input.snapshot.proposal.selected.map(
      (assignment): AssignmentExecution => ({
        assignmentId: assignment.assignmentId,
        status: "planned",
        unresolvedRequirementIds: assignment.consequences.map(
          (entry) => entry.coverageRequirementId,
        ),
        visitIds: [],
      }),
    ),
    createdAt: input.now,
    deviceId: input.snapshot.deviceId,
    followUps: [],
    id: input.id,
    mediaReceipts: [],
    objectiveCoverage: [],
    objectiveCoverageRecords: [],
    planContentHash: input.snapshot.contentHash,
    planSnapshot: input.snapshot,
    protocolPackageId: input.snapshot.protocol.packageId,
    protocolPackageVersion: input.snapshot.protocol.packageVersion,
    records: [],
    researcherId: input.snapshot.researcherId,
    revision: 1,
    schemaVersion: "field-recorder-work.v1",
    selectedPartialCoverageSetIds: input.snapshot.inputs.partialCoverageSetIds ?? {},
    step: { assignmentId: first.assignmentId, name: "briefing" as const },
    updatedAt: input.now,
  });
}

export function advanceRecorderStep(input: {
  work: RecorderWork;
  now: string;
  safetyEligible?: boolean;
}): RecorderWork {
  assertMutable(input.work);
  const current = input.work.step;
  if (["start_visit", "close_visit", "outcome"].includes(current.name)) {
    throw new Error("Use the durable Recorder action for this step.");
  }
  const nextName = {
    briefing: "safety",
    safety: input.safetyEligible === false ? "safety" : "start_visit",
    start_visit: "start_visit",
    objectives: "gaps",
    gaps: "close_visit",
    close_visit: "close_visit",
    outcome: "outcome",
  }[current.name] as RecorderStep["name"];
  return revise(input.work, input.now, { ...current, name: nextName });
}

export function deferRecorderAssignment(input: {
  exception: CaptureException;
  now: string;
  outcomeId: string;
  protocol: RecorderProtocol;
  work: RecorderWork;
}): RecorderWork {
  assertMutable(input.work);
  const assignmentId = input.work.step.assignmentId;
  if (input.work.step.name !== "safety") {
    throw new Error("An Assignment may be deferred only from Safety.");
  }
  if (input.exception.assignmentId !== assignmentId || input.exception.visitId) {
    throw new Error("A pre-Visit safety exception must retain Assignment lineage only.");
  }
  assertProtocolRecord("captureException", input.exception, input.protocol);
  const unresolved = input.work.assignments.find(
    (assignment) => assignment.assignmentId === assignmentId,
  )?.unresolvedRequirementIds;
  if (!unresolved?.length) throw new Error("Deferred work must preserve outstanding coverage.");
  const outcome: AssignmentOutcome = {
    assignmentId,
    campaignId: input.work.planSnapshot.protocol.campaignId,
    closedAt: input.now,
    followUpAssignmentIds: [],
    id: input.outcomeId,
    protocolPackageId: input.work.protocolPackageId,
    protocolPackageVersion: input.work.protocolPackageVersion,
    schemaVersion: "assignment-outcome.v1",
    status: "deferred",
    unresolvedRequirementIds: [...unresolved],
    visitIds: [],
  };
  assertGeneratedRecord("assignmentOutcome", outcome, input.protocol);
  const assignments = input.work.assignments.map((assignment) =>
    assignment.assignmentId === assignmentId
      ? { ...assignment, closedAt: input.now, outcomeId: outcome.id, status: "deferred" as const }
      : assignment,
  );
  const nextAssignment = assignments.find((assignment) => assignment.status === "planned");
  return Object.freeze({
    ...input.work,
    assignmentOutcomes: [...input.work.assignmentOutcomes, outcome],
    assignments,
    records: [...input.work.records, { kind: "captureException" as const, value: input.exception }],
    revision: input.work.revision + 1,
    step: nextAssignment
      ? { assignmentId: nextAssignment.assignmentId, name: "briefing" as const }
      : { assignmentId, name: "outcome" as const },
    updatedAt: input.now,
  });
}

export function startRecorderVisit(input: {
  now: string;
  protocol: RecorderProtocol;
  visit: FieldVisit;
  work: RecorderWork;
}): RecorderWork {
  assertMutable(input.work);
  if (input.work.step.name !== "start_visit")
    throw new Error("Visit start is not the current task.");
  if (input.visit.captureState !== "draft" || input.visit.endedAt) {
    throw new Error("A new Visit must begin as an open Draft.");
  }
  if (input.visit.assignmentId !== input.work.step.assignmentId) {
    throw new Error("The Visit must belong to the current Assignment.");
  }
  const records = [...input.work.records, { kind: "fieldVisit" as const, value: input.visit }];
  return updateCoverage({
    now: input.now,
    protocol: input.protocol,
    records,
    step: {
      assignmentId: input.visit.assignmentId,
      name: "objectives",
      visitId: input.visit.id,
    },
    work: input.work,
  });
}

export function captureRecorderRecord(input: {
  now: string;
  protocol: RecorderProtocol;
  record: RecorderRecord;
  work: RecorderWork;
}): RecorderWork {
  assertMutable(input.work);
  if (!input.work.step.visitId) throw new Error("Captured evidence requires an active Visit.");
  if (
    "visitId" in input.record.value &&
    input.record.value.visitId &&
    input.record.value.visitId !== input.work.step.visitId
  ) {
    throw new Error("Captured evidence must belong to the active Visit.");
  }
  if (input.work.records.some((entry) => entry.value.id === input.record.value.id)) {
    throw new Error("Record IDs must be unique.");
  }
  const records = [...input.work.records, input.record];
  return updateCoverage({
    now: input.now,
    protocol: input.protocol,
    records,
    step: { ...input.work.step, name: "objectives" },
    work: input.work,
  });
}

export function closeRecorderVisit(input: {
  followUpId: string;
  now: string;
  outcomeId: string;
  protocol: RecorderProtocol;
  work: RecorderWork;
}): RecorderWork {
  assertMutable(input.work);
  const visitId = input.work.step.visitId;
  if (!visitId) throw new Error("Visit close requires an active Visit.");
  const visitIndex = input.work.records.findIndex(
    (entry) => entry.kind === "fieldVisit" && entry.value.id === visitId,
  );
  if (visitIndex < 0) throw new Error("The active Visit is missing.");
  const visitEntry = input.work.records[visitIndex];
  if (visitEntry?.kind !== "fieldVisit") {
    throw new Error("The active Visit is invalid.");
  }
  if (visitEntry.value.endedAt || visitEntry.value.captureState === "captured") {
    throw new Error("A closed Visit is immutable.");
  }
  const closedVisit: FieldVisit = {
    ...visitEntry.value,
    assetIds: [...visitEntry.value.assetIds],
    captureState: "captured",
    endedAt: input.now,
  };
  const records = input.work.records.with(visitIndex, {
    kind: "fieldVisit",
    value: closedVisit,
  });
  const coverage = deriveAssignmentCoverage({
    assignmentId: input.work.step.assignmentId,
    protocol: input.protocol,
    records,
    selectedPartialCoverageSetId:
      input.work.selectedPartialCoverageSetIds[input.work.step.assignmentId],
  });
  const unresolved = coverage.flatMap((objective) =>
    objective.requirements
      .filter((requirement) =>
        ["blocked", "in_progress", "needs_resolution", "unstarted"].includes(requirement.status),
      )
      .map((requirement) => requirement.coverageRequirementId),
  );
  const complete = unresolved.length === 0;
  const outcome: AssignmentOutcome = {
    assignmentId: input.work.step.assignmentId,
    closedAt: input.now,
    followUpAssignmentIds: complete ? [] : [input.followUpId],
    id: input.outcomeId,
    protocolPackageId: input.work.protocolPackageId,
    protocolPackageVersion: input.work.protocolPackageVersion,
    campaignId: input.work.planSnapshot.protocol.campaignId,
    schemaVersion: "assignment-outcome.v1",
    status: complete ? "complete" : "closed_with_gaps",
    unresolvedRequirementIds: unresolved,
    visitIds: [visitId],
  };
  const followUps: readonly FollowUpAssignment[] = complete
    ? input.work.followUps
    : [
        ...input.work.followUps,
        {
          campaignId: input.work.planSnapshot.protocol.campaignId,
          coverageRequirementIds: unresolved as [string, ...string[]],
          createdAt: input.now,
          id: input.followUpId,
          originatingAssignmentId: input.work.step.assignmentId,
          originatingVisitIds: [visitId],
          protocolPackageId: input.work.protocolPackageId,
          protocolPackageVersion: input.work.protocolPackageVersion,
          reason: coverage.some((entry) => entry.status === "needs_resolution")
            ? "needs_resolution"
            : "closed_with_gaps",
          schemaVersion: "follow-up-assignment.v1",
        },
      ];
  assertGeneratedRecord("assignmentOutcome", outcome, input.protocol);
  for (const followUp of followUps.slice(input.work.followUps.length)) {
    assertGeneratedRecord("followUpAssignment", followUp, input.protocol);
  }
  const assignments = input.work.assignments.map((assignment) =>
    assignment.assignmentId === input.work.step.assignmentId
      ? {
          ...assignment,
          closedAt: input.now,
          outcomeId: input.outcomeId,
          status: complete ? ("complete" as const) : ("closed_with_gaps" as const),
          unresolvedRequirementIds: unresolved,
          visitIds: [...assignment.visitIds, visitId],
        }
      : assignment,
  );
  const nextAssignment = assignments.find((assignment) => assignment.status === "planned");
  const objectiveCoverageRecords = materializeObjectiveCoverage({
    coverage,
    now: input.now,
    protocol: input.protocol,
    work: input.work,
  });
  return Object.freeze({
    ...input.work,
    assignmentOutcomes: [...input.work.assignmentOutcomes, outcome],
    assignments,
    followUps,
    objectiveCoverage: coverage,
    objectiveCoverageRecords,
    records,
    revision: input.work.revision + 1,
    step: nextAssignment
      ? { assignmentId: nextAssignment.assignmentId, name: "briefing" as const }
      : { assignmentId: input.work.step.assignmentId, name: "outcome" as const },
    updatedAt: input.now,
  });
}

export function addSupersedingCorrection(input: {
  now: string;
  protocol: RecorderProtocol;
  record: RecorderRecord;
  supersedesId: string;
  work: RecorderWork;
}): RecorderWork {
  assertMutable(input.work);
  const original = input.work.records.find((entry) => entry.value.id === input.supersedesId);
  if (!original || original.kind !== input.record.kind) {
    throw new Error("A correction must supersede an existing record of the same type.");
  }
  const visitId = "visitId" in original.value ? original.value.visitId : undefined;
  const visit = input.work.records.find(
    (entry): entry is Extract<RecorderRecord, { kind: "fieldVisit" }> =>
      entry.kind === "fieldVisit" && entry.value.id === visitId,
  );
  if (visit?.kind !== "fieldVisit" || !visit.value.endedAt) {
    throw new Error("Corrections are append-only after the original Visit closes.");
  }
  if ((input.record.value as { supersedesId?: string }).supersedesId !== input.supersedesId) {
    throw new Error("Correction lineage must identify the frozen original.");
  }
  return updateCoverage({
    now: input.now,
    protocol: input.protocol,
    records: [...input.work.records, input.record],
    step: input.work.step,
    work: input.work,
  });
}

export function closeFieldDay(input: {
  closeId: string;
  now: string;
  protocol: RecorderProtocol;
  work: RecorderWork;
}): RecorderWork {
  assertMutable(input.work);
  if (
    input.work.assignments.some((assignment) =>
      ["planned", "in_progress"].includes(assignment.status),
    )
  ) {
    throw new Error("Close or defer every active Assignment before closing the Field Day.");
  }
  const unresolvedRecordIds = input.work.records
    .filter(
      (entry) =>
        entry.kind === "schemaGap" ||
        (entry.kind === "routeRun" && entry.value.notTested.length > 0) ||
        (entry.kind === "fieldObservation" &&
          entry.value.contradictsObservationIds &&
          entry.value.contradictsObservationIds.length > 0),
    )
    .map((entry) => entry.value.id);
  const permissionIssueRecordIds = input.work.records
    .filter(
      (entry) =>
        (entry.kind === "sourceStatement" &&
          Object.values(entry.value.consents).some((consent) => consent.decision !== "granted")) ||
        (entry.kind === "evidenceAsset" &&
          ["denied", "withdrawn"].includes(entry.value.consentState)),
    )
    .map((entry) => entry.value.id);
  const assetIssueRecordIds = input.work.records
    .filter(
      (entry) =>
        entry.kind === "evidenceAsset" &&
        (entry.value.redactionState === "pending" || entry.value.retentionState !== "active"),
    )
    .map((entry) => entry.value.id);
  const close: FieldDayClose = {
    assetIssueRecordIds,
    assignmentOutcomeIds: input.work.assignmentOutcomes.map((outcome) => outcome.id),
    campaignId: input.work.planSnapshot.protocol.campaignId,
    closedAt: input.now,
    followUpAssignmentIds: input.work.followUps.map((followUp) => followUp.id),
    id: input.closeId,
    permissionIssueRecordIds,
    planSnapshotId: input.work.planSnapshot.snapshotId,
    protocolPackageId: input.work.protocolPackageId,
    protocolPackageVersion: input.work.protocolPackageVersion,
    recoveryStatus: "recovery_required",
    schemaVersion: "field-day-close.v1",
    unresolvedRecordIds,
  };
  assertGeneratedRecord("fieldDayClose", close, input.protocol);
  return Object.freeze({
    ...input.work,
    fieldDayClose: close,
    revision: input.work.revision + 1,
    updatedAt: input.now,
  });
}

function updateCoverage(input: {
  now: string;
  protocol: RecorderProtocol;
  records: readonly RecorderRecord[];
  step: RecorderStep;
  work: RecorderWork;
}): RecorderWork {
  const coverage = deriveAssignmentCoverage({
    assignmentId: input.step.assignmentId,
    protocol: input.protocol,
    records: input.records,
    selectedPartialCoverageSetId: input.work.selectedPartialCoverageSetIds[input.step.assignmentId],
  });
  const next = deterministicNextRequirement(coverage);
  const assignments = input.work.assignments.map((assignment) =>
    assignment.assignmentId === input.step.assignmentId && assignment.status === "planned"
      ? { ...assignment, status: "in_progress" as const }
      : assignment,
  );
  const objectiveCoverageRecords = materializeObjectiveCoverage({
    coverage,
    now: input.now,
    protocol: input.protocol,
    work: input.work,
  });
  return Object.freeze({
    ...input.work,
    assignments,
    objectiveCoverage: coverage,
    objectiveCoverageRecords,
    records: input.records,
    revision: input.work.revision + 1,
    step:
      input.step.name === "objectives" && next
        ? { ...input.step, ...next, name: "objectives" as const }
        : input.step,
    updatedAt: input.now,
  });
}

function revise(work: RecorderWork, now: string, step: RecorderStep): RecorderWork {
  return Object.freeze({
    ...work,
    revision: work.revision + 1,
    step,
    updatedAt: now,
  });
}

function assertMutable(work: RecorderWork) {
  if (work.fieldDayClose) throw new Error("Closed Field Day work is immutable.");
}

function assertGeneratedRecord(
  kind: "objectiveCoverage" | "assignmentOutcome" | "followUpAssignment" | "fieldDayClose",
  value: unknown,
  protocol: RecorderProtocol,
) {
  const result = validateFieldProtocolRecord(kind, value, { protocolPackage: protocol });
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}

function assertProtocolRecord(
  kind: "captureException",
  value: unknown,
  protocol: RecorderProtocol,
) {
  const result = validateFieldProtocolRecord(kind, value, { protocolPackage: protocol });
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}

function materializeObjectiveCoverage(input: {
  coverage: RecorderWork["objectiveCoverage"];
  now: string;
  protocol: RecorderProtocol;
  work: RecorderWork;
}): readonly Readonly<ProtocolObjectiveCoverage>[] {
  return input.coverage.map((objective) => {
    if (objective.requirements.length === 0) {
      throw new Error("Objective Coverage must contain at least one requirement.");
    }
    const value: ProtocolObjectiveCoverage = {
      assignmentId: input.work.step.assignmentId,
      campaignId: input.work.planSnapshot.protocol.campaignId,
      derivedAt: input.now,
      id: deterministicCoverageId(
        `${input.work.id}:${input.work.step.assignmentId}:${objective.objectiveId}`,
      ),
      objectiveId: objective.objectiveId,
      protocolPackageId: input.work.protocolPackageId,
      protocolPackageVersion: input.work.protocolPackageVersion,
      requirements: objective.requirements.map((requirement) => ({
        capturedRecordIds: [...requirement.capturedRecordIds],
        coverageRequirementId: requirement.coverageRequirementId,
        distinctWindowIds: [...requirement.distinctWindowIds],
        reasonCodes: [
          ...requirement.reasonCodes,
        ] as ProtocolObjectiveCoverage["requirements"][number]["reasonCodes"],
        requiredDistinctWindows: requirement.requiredDistinctWindows,
        requiredRecords: requirement.requiredRecords,
        status: requirement.status,
        supportingAssetIds: [...requirement.supportingAssetIds],
      })) as ProtocolObjectiveCoverage["requirements"],
      schemaVersion: "objective-coverage.v1",
      sourceRecordIds: [...objective.sourceRecordIds],
      status: objective.status,
    };
    assertGeneratedRecord("objectiveCoverage", value, input.protocol);
    return value;
  });
}

function deterministicCoverageId(seed: string): string {
  const words = [2166136261, 2246822519, 3266489917, 668265263].map((initial, index) => {
    let value = initial >>> 0;
    for (let position = index; position < seed.length; position += 4) {
      value ^= seed.charCodeAt(position);
      value = Math.imul(value, 16777619) >>> 0;
    }
    return value.toString(16).padStart(8, "0");
  });
  const hex = words.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

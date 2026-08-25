import { describe, expect, test } from "bun:test";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import type {
  CaptureException,
  EvidenceAsset,
  SchemaGap,
} from "@/features/field-protocol/generated";

import {
  advanceRecorderStep,
  captureRecorderRecord,
  closeRecorderVisit,
  createRecorderWork,
  deferRecorderAssignment,
  startRecorderVisit,
} from "./field-recorder-state";
import type {
  RecorderRecord,
  RecorderWork,
  RequirementCoverageStatus,
} from "./field-recorder-types";
import { deriveAssignmentCoverage } from "./objective-coverage";
import { buildCaptureException } from "./record-builders";
import { exampleObservation, exampleVisit, recorderSnapshot } from "./test-fixtures";

const protocol = baselineFieldProtocolPackage;
const examples = protocol.examples.examples;
const assignmentId = "assignment_del_carmen_essentials";
const objectiveId = "objective_del_carmen_observe_services";
const requirementId = "coverage_payment";
const now = "2026-08-23T08:00:00+08:00";

describe("literal Recorder coverage and outcome acceptance matrix", () => {
  test("derives every governed Requirement Coverage state from protocol records", () => {
    const visit = { kind: "fieldVisit", value: structuredClone(exampleVisit) } as const;
    const cases: readonly {
      label: string;
      records: readonly RecorderRecord[];
      status: RequirementCoverageStatus;
    }[] = [
      { label: "no evidence", records: [visit], status: "unstarted" },
      {
        label: "captured but unusable asset",
        records: [visit, { kind: "evidenceAsset", value: pendingAsset() }],
        status: "in_progress",
      },
      {
        label: "admissible captured observation",
        records: [visit, { kind: "fieldObservation", value: structuredClone(exampleObservation) }],
        status: "satisfied",
      },
      {
        label: "blocking exception",
        records: [visit, { kind: "captureException", value: captureException("interrupted") }],
        status: "blocked",
      },
      {
        label: "not-applicable exception",
        records: [visit, { kind: "captureException", value: captureException("not_applicable") }],
        status: "not_applicable",
      },
      {
        label: "schema gap",
        records: [visit, { kind: "schemaGap", value: schemaGap() }],
        status: "needs_resolution",
      },
    ];

    const observed = cases.map(({ label, records, status }) => {
      const coverage = requirementCoverage(records);
      expect(coverage?.status, label).toBe(status);
      return coverage?.status;
    });
    expect(observed).toEqual([
      "unstarted",
      "in_progress",
      "satisfied",
      "blocked",
      "not_applicable",
      "needs_resolution",
    ]);
  });

  test("permits only planned-to-deferred or in-progress-to-derived terminal outcomes", () => {
    const deferred = deferredWork();
    expect(assignmentStatuses(deferred)).toEqual(["deferred"]);
    expect(deferred.assignmentOutcomes.map((entry) => entry.status)).toEqual(["deferred"]);

    const closedWithGaps = closeStartedVisit(startedWork());
    expect(assignmentStatuses(closedWithGaps)).toEqual(["closed_with_gaps"]);
    expect(closedWithGaps.assignmentOutcomes.map((entry) => entry.status)).toEqual([
      "closed_with_gaps",
    ]);
    expect(closedWithGaps.followUps).toHaveLength(1);

    const complete = closeStartedVisit(workWithEveryRequirementNotApplicable());
    expect(assignmentStatuses(complete)).toEqual(["complete"]);
    expect(complete.assignmentOutcomes.map((entry) => entry.status)).toEqual(["complete"]);
    expect(complete.assignmentOutcomes[0]?.unresolvedRequirementIds).toEqual([]);
    expect(complete.followUps).toEqual([]);
  });
});

function requirementCoverage(records: readonly RecorderRecord[]) {
  return deriveAssignmentCoverage({ assignmentId, protocol, records })
    .flatMap((objective) => objective.requirements)
    .find((requirement) => requirement.coverageRequirementId === requirementId);
}

function pendingAsset(): EvidenceAsset {
  const asset = structuredClone(examples.evidenceAsset) as unknown as EvidenceAsset;
  return { ...asset, redactionState: "pending" };
}

function captureException(reason: CaptureException["reason"]): CaptureException {
  const exception = structuredClone(examples.captureException) as unknown as CaptureException;
  return {
    ...exception,
    assignmentId,
    coverageRequirementId: requirementId,
    objectiveId,
    reason,
    visitId: exampleVisit.id,
  };
}

function schemaGap(): SchemaGap {
  const gap = structuredClone(examples.schemaGap) as unknown as SchemaGap;
  return { ...gap, coverageRequirementId: requirementId, objectiveId };
}

function initialWork(): RecorderWork {
  return createRecorderWork({
    id: "recorder-acceptance-matrix",
    now,
    snapshot: recorderSnapshot(),
  });
}

function safetyWork(): RecorderWork {
  return advanceRecorderStep({ now, work: initialWork() });
}

function startedWork(): RecorderWork {
  let work = advanceRecorderStep({ now, safetyEligible: true, work: safetyWork() });
  const { endedAt: _, ...visit } = structuredClone(exampleVisit);
  work = startRecorderVisit({
    now,
    protocol,
    visit: { ...visit, captureState: "draft", recordedAt: now, startedAt: now },
    work,
  });
  return work;
}

function deferredWork(): RecorderWork {
  const requirement = protocol.campaign.assignments
    .find((entry) => entry.id === assignmentId)
    ?.coverageRequirements.at(0);
  if (!requirement) throw new Error("Acceptance fixture is missing its first requirement.");
  return deferRecorderAssignment({
    exception: buildCaptureException({
      captureContext: "planning",
      context: {
        assignmentId,
        campaignId: protocol.campaign.campaignId,
        captureWindowIds: [exampleVisit.captureWindows[0].id],
        coverageRequirementId: requirement.id,
        deviceId: "device_example",
        localTimezone: "Asia/Manila",
        objectiveId: requirement.objectiveId,
        protocol,
        protocolPackageId: protocol.manifest.packageId,
        protocolPackageVersion: protocol.manifest.packageVersion,
        recordedAt: now,
        researcherId: "researcher_example",
      },
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1801",
      reason: "unsafe_conditions",
      reasonDetails: "Deterministic acceptance-matrix safety stop.",
    }),
    now,
    outcomeId: "0192f060-4f41-7aa1-b322-4aa9fc9f1802",
    protocol,
    work: safetyWork(),
  });
}

function workWithEveryRequirementNotApplicable(): RecorderWork {
  let work = startedWork();
  const assignment = protocol.campaign.assignments.find((entry) => entry.id === assignmentId);
  if (!assignment) throw new Error("Acceptance fixture Assignment is missing.");
  for (const [index, requirement] of assignment.coverageRequirements.entries()) {
    work = captureRecorderRecord({
      now,
      protocol,
      record: {
        kind: "captureException",
        value: buildCaptureException({
          captureContext: "visit",
          context: {
            assignmentId,
            campaignId: protocol.campaign.campaignId,
            captureWindowIds: [exampleVisit.captureWindows[0].id],
            coverageRequirementId: requirement.id,
            deviceId: work.deviceId,
            localTimezone: "Asia/Manila",
            objectiveId: requirement.objectiveId,
            protocol,
            protocolPackageId: protocol.manifest.packageId,
            protocolPackageVersion: protocol.manifest.packageVersion,
            recordedAt: now,
            researcherId: work.researcherId,
            visitId: work.step.visitId,
          },
          id: deterministicRecordId(index),
          reason: "not_applicable",
          reasonDetails: `Requirement ${requirement.id} was deterministically confirmed not applicable.`,
        }),
      },
      work,
    });
  }
  return work;
}

function closeStartedVisit(work: RecorderWork): RecorderWork {
  return closeRecorderVisit({
    followUpId: "0192f060-4f41-7aa1-b322-4aa9fc9f1803",
    now: "2026-08-23T09:00:00+08:00",
    outcomeId: "0192f060-4f41-7aa1-b322-4aa9fc9f1804",
    protocol,
    work,
  });
}

function deterministicRecordId(index: number): string {
  return `0192f060-4f41-7aa1-b322-4aa9fc9f${(0x1900 + index).toString(16)}`;
}

function assignmentStatuses(work: RecorderWork) {
  return work.assignments.map((entry) => entry.status);
}

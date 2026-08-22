import { describe, expect, test } from "bun:test";
import { appendFieldReview, createFieldDeskWork } from "@/features/field-desk/field-desk-state";
import type { FieldDeskWork } from "@/features/field-desk/field-desk-types";
import type { RecorderWork } from "@/features/field-recorder/field-recorder-types";
import {
  exampleObservation,
  exampleVisit,
  recorderSnapshot,
} from "@/features/field-recorder/test-fixtures";
import { deriveFieldBatchGraph } from "./field-batch";

const ids = {
  archive: "0192f060-4f41-7aa1-b322-4aa9fc9f1530",
  batch: "0192f060-4f41-7aa1-b322-4aa9fc9f1531",
  close: "0192f060-4f41-7aa1-b322-4aa9fc9f1532",
  review: "0192f060-4f41-7aa1-b322-4aa9fc9f1533",
  work: "0192f060-4f41-7aa1-b322-4aa9fc9f1534",
} as const;

describe("review-derived Field Batch graph", () => {
  test("derives a deterministic referentially closed graph without caller counts or hashes", async () => {
    const work = await includedWork();
    const result = await deriveFieldBatchGraph({
      batchId: ids.batch,
      intendedUse: "research_internal",
      selectedRecordIds: [exampleObservation.id],
      validateRecorderWork: async () => [],
      works: [work],
    });
    expect(result.issues).toEqual([]);
    expect(result.files.map((file) => file.path)).toEqual([
      "batch-selection.jsonl",
      "field-observations.jsonl",
      "field-reviews.jsonl",
      "field-visits.jsonl",
    ]);
    expect(result.referentialClosureSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  const blockerCases: Array<{
    expectedCode: string;
    label: string;
    makeWork: () => Promise<FieldDeskWork>;
    protocolFailure?: boolean;
    use?: "public" | "research_internal";
  }> = [
    {
      label: "missing review",
      makeWork: async () => baseDeskWork(),
      expectedCode: "effective_review_not_include",
    },
    {
      label: "provisional Subject",
      makeWork: async () =>
        includedWork({
          observation: {
            ...structuredClone(exampleObservation),
            subject: { kind: "provisional" as const, provisionalSubjectId: "provisional_1" },
          },
        }),
      expectedCode: "unresolved_provisional_subject",
    },
    {
      label: "public rights",
      makeWork: async () => includedWork(),
      expectedCode: "observation_permission_insufficient",
      use: "public",
    },
    {
      label: "protocol/schema validation",
      makeWork: async () => includedWork(),
      expectedCode: "pinned_protocol_unavailable",
      protocolFailure: true,
    },
  ];
  for (const blocker of blockerCases) {
    test(`fails closed on ${blocker.label}`, async () => {
      const result = await deriveFieldBatchGraph({
        batchId: ids.batch,
        intendedUse: blocker.use ?? "research_internal",
        selectedRecordIds: [exampleObservation.id],
        validateRecorderWork: async () =>
          blocker.protocolFailure
            ? [{ code: blocker.expectedCode, message: "Pinned protocol unavailable." }]
            : [],
        works: [await blocker.makeWork()],
      });
      expect(result.issues.map((issue) => issue.code)).toContain(blocker.expectedCode);
      expect(result.files).toEqual([]);
    });
  }
});

async function includedWork(input?: {
  observation?: typeof exampleObservation;
}): Promise<FieldDeskWork> {
  const base = await baseDeskWork(input?.observation);
  return appendFieldReview({
    work: base,
    review: {
      id: ids.review,
      recordId: exampleObservation.id,
      reviewerId: "reviewer_desk",
      reviewerMatchesResearcher: false,
      reviewedAt: "2026-08-23T02:05:00.000Z",
      decision: "include",
    },
  });
}

async function baseDeskWork(observation = structuredClone(exampleObservation)) {
  return createFieldDeskWork({
    archiveId: ids.archive,
    handedOffAt: "2026-08-23T02:00:00.000Z",
    recorderWork: recorderWork(observation),
  });
}

function recorderWork(observation: typeof exampleObservation): RecorderWork {
  const snapshot = recorderSnapshot(observation.assignmentId);
  const visit = {
    ...structuredClone(exampleVisit),
    id: observation.visitId,
    assignmentId: observation.assignmentId,
    campaignId: observation.campaignId,
    researcherId: observation.researcherId,
    deviceId: observation.deviceId,
    protocolPackageId: observation.protocolPackageId,
    protocolPackageVersion: observation.protocolPackageVersion,
  };
  return {
    schemaVersion: "field-recorder-work.v1",
    id: ids.work,
    revision: 2,
    planSnapshot: snapshot,
    planContentHash: snapshot.contentHash,
    protocolPackageId: observation.protocolPackageId,
    protocolPackageVersion: observation.protocolPackageVersion,
    researcherId: observation.researcherId,
    deviceId: observation.deviceId,
    selectedPartialCoverageSetIds: {},
    step: { assignmentId: observation.assignmentId, name: "outcome" },
    assignments: [
      {
        assignmentId: observation.assignmentId,
        status: "complete",
        visitIds: [visit.id],
        unresolvedRequirementIds: [],
      },
    ],
    records: [
      { kind: "fieldVisit", value: visit },
      { kind: "fieldObservation", value: observation },
    ],
    mediaReceipts: [],
    objectiveCoverage: [],
    objectiveCoverageRecords: [],
    assignmentOutcomes: [],
    followUps: [],
    fieldDayClose: {
      schemaVersion: "field-day-close.v1",
      id: ids.close,
      campaignId: observation.campaignId,
      planSnapshotId: snapshot.snapshotId,
      protocolPackageId: observation.protocolPackageId,
      protocolPackageVersion: observation.protocolPackageVersion,
      assignmentOutcomeIds: [],
      followUpAssignmentIds: [],
      unresolvedRecordIds: [],
      permissionIssueRecordIds: [],
      assetIssueRecordIds: [],
      recoveryStatus: "recovery_required",
      closedAt: "2026-08-23T01:59:00.000Z",
    },
    createdAt: "2026-08-23T01:00:00.000Z",
    updatedAt: "2026-08-23T01:59:00.000Z",
  };
}

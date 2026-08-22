import { describe, expect, test } from "bun:test";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import type { FollowUpAssignment } from "@/features/field-protocol/generated";
import type { RecorderRecord, RecorderWork } from "@/features/field-recorder/field-recorder-types";
import { exampleObservation, recorderSnapshot } from "@/features/field-recorder/test-fixtures";
import {
  appendDeskRecoveryAudit,
  appendFieldReview,
  createFieldDeskWork,
  derivedRecorderRecoveryStatus,
  effectiveReview,
  proposeIdentityEquivalentDuplicates,
} from "./field-desk-state";

const ids = {
  archive: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
  close: "0192f060-4f41-7aa1-b322-4aa9fc9f1502",
  correction: "0192f060-4f41-7aa1-b322-4aa9fc9f1503",
  followUp: "0192f060-4f41-7aa1-b322-4aa9fc9f1504",
  review: "0192f060-4f41-7aa1-b322-4aa9fc9f1505",
  review2: "0192f060-4f41-7aa1-b322-4aa9fc9f1506",
  work: "0192f060-4f41-7aa1-b322-4aa9fc9f1507",
} as const;

describe("append-only Field Desk review", () => {
  test.each([
    ["include", {}],
    ["exclude", { reason: "Outside the declared evidence use." }],
    [
      "needs_more_evidence",
      { reason: "Repeat in the required window.", followUp: followUpAssignment() },
    ],
    ["correct_by_supersession", { supersedingRecord: correctedObservation() }],
  ] as const)("records %s without changing the immutable original", async (decision, extra) => {
    const work = await createFieldDeskWork({
      archiveId: ids.archive,
      handedOffAt: "2026-08-23T02:00:00.000Z",
      recorderWork: closedWork(),
    });
    const originalBytes = canonicalStringify(work.recorderWork.records[0]);
    const reviewed = await appendFieldReview({
      work,
      review: {
        id: ids.review,
        recordId: exampleObservation.id,
        reviewerId: "researcher_example",
        reviewerMatchesResearcher: true,
        reviewedAt: "2026-08-23T02:05:00.000Z",
        decision,
        ...extra,
      },
    });
    expect(canonicalStringify(reviewed.recorderWork.records[0])).toBe(originalBytes);
    expect(effectiveReview(reviewed, exampleObservation.id)?.decision).toBe(decision);
    expect(reviewed.revision).toBe(2);
  });

  test("fails each conditional review boundary and reviewer disclosure", async () => {
    const work = await deskWork();
    await expect(
      appendFieldReview({
        work,
        review: baseReview({ decision: "exclude" }),
      }),
    ).rejects.toThrow("requires a reason");
    await expect(
      appendFieldReview({
        work,
        review: baseReview({ decision: "needs_more_evidence", reason: "Repeat." }),
      }),
    ).rejects.toThrow("requires an unscheduled follow-up");
    await expect(
      appendFieldReview({
        work,
        review: baseReview({ decision: "correct_by_supersession" }),
      }),
    ).rejects.toThrow("requires a new captured record");
    await expect(
      appendFieldReview({
        work,
        review: { ...baseReview({ decision: "include" }), reviewerMatchesResearcher: false },
      }),
    ).rejects.toThrow("does not match");
  });

  test("retains the complete effective-review chain", async () => {
    const first = await appendFieldReview({
      work: await deskWork(),
      review: baseReview({ decision: "include" }),
    });
    const second = await appendFieldReview({
      work: first,
      review: {
        ...baseReview({ decision: "exclude", reason: "Superseded evidence policy." }),
        id: ids.review2,
      },
    });
    expect(second.reviews).toHaveLength(2);
    expect(second.reviews[1].previousReviewId).toBe(ids.review);
    expect(effectiveReview(second, exampleObservation.id)?.id).toBe(ids.review2);
  });

  test("proposes only full identity-equivalent duplicates and never removes repetitions", () => {
    const first: RecorderRecord = {
      kind: "fieldObservation",
      value: structuredClone(exampleObservation),
    };
    const duplicate: RecorderRecord = {
      kind: "fieldObservation",
      value: { ...structuredClone(exampleObservation), id: ids.correction },
    };
    const repetition: RecorderRecord = {
      kind: "fieldObservation",
      value: {
        ...structuredClone(exampleObservation),
        id: ids.review2,
        observedAt: "2026-08-23T03:00:00.000Z",
      },
    };
    expect(proposeIdentityEquivalentDuplicates([first, duplicate, repetition])).toEqual([
      {
        candidateRecordId: ids.correction,
        existingRecordId: exampleObservation.id,
        reason: "identity_equivalent",
      },
    ]);
  });

  test("keeps Recorder recovery required until a created artifact is locally reopened and verified", async () => {
    const work = await deskWork();
    expect(derivedRecorderRecoveryStatus(work)).toBe("recovery_required");
    const created = appendDeskRecoveryAudit({
      work,
      audit: {
        schemaVersion: "field-desk-recovery-audit.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1510",
        archiveId: ids.archive,
        artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1511",
        operation: "created",
        occurredAt: "2026-08-23T02:10:00.000Z",
        ciphertextSha256: "a".repeat(64),
      },
    });
    expect(derivedRecorderRecoveryStatus(created)).toBe("recovery_required");
    const reopened = appendDeskRecoveryAudit({
      work: created,
      audit: {
        schemaVersion: "field-desk-recovery-audit.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1512",
        archiveId: ids.archive,
        artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1511",
        operation: "locally_reopened",
        occurredAt: "2026-08-23T02:11:00.000Z",
        ciphertextSha256: "a".repeat(64),
        previousAuditId: "0192f060-4f41-7aa1-b322-4aa9fc9f1510",
      },
    });
    expect(derivedRecorderRecoveryStatus(reopened)).toBe("recovery_verified_locally");
  });
});

async function deskWork() {
  return createFieldDeskWork({
    archiveId: ids.archive,
    handedOffAt: "2026-08-23T02:00:00.000Z",
    recorderWork: closedWork(),
  });
}

function baseReview(
  input: Partial<Parameters<typeof appendFieldReview>[0]["review"]> & {
    decision: Parameters<typeof appendFieldReview>[0]["review"]["decision"];
  },
) {
  return {
    id: ids.review,
    recordId: exampleObservation.id,
    reviewerId: "researcher_example",
    reviewerMatchesResearcher: true,
    reviewedAt: "2026-08-23T02:05:00.000Z",
    ...input,
  };
}

function correctedObservation(): RecorderRecord {
  return {
    kind: "fieldObservation",
    value: {
      ...structuredClone(exampleObservation),
      id: ids.correction,
      supersedesId: exampleObservation.id,
      value: { ...exampleObservation.value, corrected: true },
    },
  };
}

function followUpAssignment(): FollowUpAssignment {
  return {
    schemaVersion: "follow-up-assignment.v1",
    id: ids.followUp,
    protocolPackageId: exampleObservation.protocolPackageId,
    protocolPackageVersion: exampleObservation.protocolPackageVersion,
    campaignId: exampleObservation.campaignId,
    originatingAssignmentId: exampleObservation.assignmentId,
    originatingVisitIds: [exampleObservation.visitId],
    coverageRequirementIds: [exampleObservation.coverageRequirementId],
    createdAt: "2026-08-23T02:05:00.000Z",
    reason: "needs_resolution",
  };
}

function closedWork(): RecorderWork {
  const snapshot = recorderSnapshot(exampleObservation.assignmentId);
  return {
    schemaVersion: "field-recorder-work.v1",
    id: ids.work,
    revision: 2,
    planSnapshot: snapshot,
    planContentHash: snapshot.contentHash,
    protocolPackageId: exampleObservation.protocolPackageId,
    protocolPackageVersion: exampleObservation.protocolPackageVersion,
    researcherId: exampleObservation.researcherId,
    deviceId: exampleObservation.deviceId,
    selectedPartialCoverageSetIds: {},
    step: { assignmentId: exampleObservation.assignmentId, name: "outcome" },
    assignments: [
      {
        assignmentId: exampleObservation.assignmentId,
        status: "complete",
        visitIds: [exampleObservation.visitId],
        unresolvedRequirementIds: [],
      },
    ],
    records: [{ kind: "fieldObservation", value: structuredClone(exampleObservation) }],
    mediaReceipts: [],
    objectiveCoverage: [],
    objectiveCoverageRecords: [],
    assignmentOutcomes: [],
    followUps: [],
    fieldDayClose: {
      schemaVersion: "field-day-close.v1",
      id: ids.close,
      campaignId: exampleObservation.campaignId,
      planSnapshotId: snapshot.snapshotId,
      protocolPackageId: exampleObservation.protocolPackageId,
      protocolPackageVersion: exampleObservation.protocolPackageVersion,
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

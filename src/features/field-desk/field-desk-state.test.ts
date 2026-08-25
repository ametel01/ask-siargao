import { describe, expect, test } from "bun:test";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  baselineFieldProtocolPackage,
  validateFieldProtocolRecord,
} from "@/features/field-protocol/field-protocol";
import type {
  CaptureException,
  EvidenceAsset,
  FieldVisit,
  FollowUpAssignment,
  RouteRun,
  SchemaGap,
  SourceStatement,
  StatementTranslation,
} from "@/features/field-protocol/generated";
import type { RecorderRecord, RecorderWork } from "@/features/field-recorder/field-recorder-types";
import { exampleObservation, recorderSnapshot } from "@/features/field-recorder/test-fixtures";
import {
  appendDeskRecoveryAudit,
  appendFieldReview,
  createFieldDeskCorrection,
  createFieldDeskWork,
  derivedRecorderRecoveryStatus,
  effectiveReview,
  proposeIdentityEquivalentDuplicates,
} from "./field-desk-state";

const ids = {
  archive: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
  close: "0192f060-4f41-7aa1-b322-4aa9fc9f1502",
  correction: "0192f060-4f41-7aa1-b322-4aa9fc9f1590",
  followUp: "0192f060-4f41-7aa1-b322-4aa9fc9f1504",
  review: "0192f060-4f41-7aa1-b322-4aa9fc9f1591",
  review2: "0192f060-4f41-7aa1-b322-4aa9fc9f1592",
  work: "0192f060-4f41-7aa1-b322-4aa9fc9f1593",
} as const;

const examples = baselineFieldProtocolPackage.examples.examples;

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
    if (decision === "correct_by_supersession") {
      const successor = reviewed.corrections[0];
      expect(successor?.kind).toBe("fieldObservation");
      if (successor?.kind !== "fieldObservation") return;
      expect(successor.value.value.amount).toBe("75");
      expect(validateFieldProtocolRecord("fieldObservation", successor.value).success).toBe(true);
    }
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

  test("rejects an unbounded or untyped correction input", () => {
    expect(() =>
      createFieldDeskCorrection({
        correctedValue: "\u0000",
        id: ids.correction,
        original: { kind: "fieldObservation", value: structuredClone(exampleObservation) },
      }),
    ).toThrow("control characters");
  });

  test.each(correctionCases())(
    "validates a substantive typed $kind successor under the pinned protocol",
    async ({ correctedValue, kind, original }) => {
      const successor = createFieldDeskCorrection({
        correctedValue,
        id: ids.correction,
        original,
      });
      const work = await deskWorkFor(original);
      const reviewed = await appendFieldReview({
        work,
        review: reviewFor(original, { supersedingRecord: successor }),
      });

      expect(reviewed.corrections).toEqual([successor]);
      expect(reviewed.corrections[0]?.kind).toBe(kind);
      expect(canonicalStringify(successor)).toContain(correctedValue);
    },
  );

  test("rejects unchanged corrections, changed lineage, and protocol-invalid successors", async () => {
    const original = {
      kind: "fieldObservation",
      value: structuredClone(exampleObservation),
    } as const;
    const work = await deskWorkFor(original);
    const unchanged = createFieldDeskCorrection({
      correctedValue: String(exampleObservation.value.amount),
      id: ids.correction,
      original,
    });
    await expect(
      appendFieldReview({ work, review: reviewFor(original, { supersedingRecord: unchanged }) }),
    ).rejects.toThrow("must change the governed typed value");

    const changedLineage = createFieldDeskCorrection({
      correctedValue: "75",
      id: ids.correction,
      original,
    });
    changedLineage.value.researcherId = "different_researcher";
    await expect(
      appendFieldReview({
        work,
        review: reviewFor(original, { supersedingRecord: changedLineage }),
      }),
    ).rejects.toThrow("preserve immutable capture lineage and context");

    const sourceOriginal = {
      kind: "sourceStatement",
      value: structuredClone(examples.sourceStatement) as unknown as SourceStatement,
    } as const;
    const invalidSource = createFieldDeskCorrection({
      correctedValue: "Corrected statement",
      id: ids.correction,
      original: sourceOriginal,
    });
    if (invalidSource.kind !== "sourceStatement") throw new Error("expected source statement");
    invalidSource.value.originalStatement = "";
    await expect(
      appendFieldReview({
        work: await deskWorkFor(sourceOriginal),
        review: reviewFor(sourceOriginal, { supersedingRecord: invalidSource }),
      }),
    ).rejects.toThrow("valid under the pinned Field Protocol");

    expect(() =>
      createFieldDeskCorrection({
        correctedValue: "not_a_governed_purpose",
        id: ids.correction,
        original: {
          kind: "evidenceAsset",
          value: structuredClone(examples.evidenceAsset) as unknown as EvidenceAsset,
        },
      }),
    ).toThrow("must use a governed option");
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
  return createFieldDeskCorrection({
    correctedValue: "75",
    id: ids.correction,
    original: { kind: "fieldObservation", value: structuredClone(exampleObservation) },
  });
}

function correctionCases(): Array<{
  correctedValue: string;
  kind: RecorderRecord["kind"];
  original: RecorderRecord;
}> {
  return [
    {
      kind: "fieldVisit",
      original: {
        kind: "fieldVisit",
        value: structuredClone(examples.fieldVisit) as unknown as FieldVisit,
      },
      correctedValue: "Corrected private visit context.",
    },
    {
      kind: "fieldObservation",
      original: { kind: "fieldObservation", value: structuredClone(exampleObservation) },
      correctedValue: "75",
    },
    {
      kind: "routeRun",
      original: {
        kind: "routeRun",
        value: structuredClone(examples.routeRun) as unknown as RouteRun,
      },
      correctedValue: "Two adults",
    },
    {
      kind: "sourceStatement",
      original: {
        kind: "sourceStatement",
        value: structuredClone(examples.sourceStatement) as unknown as SourceStatement,
      },
      correctedValue: "The corrected protected source statement.",
    },
    {
      kind: "statementTranslation",
      original: {
        kind: "statementTranslation",
        value: structuredClone(examples.statementTranslation) as unknown as StatementTranslation,
      },
      correctedValue: "Ang itinamang salin.",
    },
    {
      kind: "evidenceAsset",
      original: {
        kind: "evidenceAsset",
        value: structuredClone(examples.evidenceAsset) as unknown as EvidenceAsset,
      },
      correctedValue: "posted_information",
    },
    {
      kind: "captureException",
      original: {
        kind: "captureException",
        value: structuredClone(examples.captureException) as unknown as CaptureException,
      },
      correctedValue: "The corrected governed exception details.",
    },
    {
      kind: "schemaGap",
      original: {
        kind: "schemaGap",
        value: structuredClone(examples.schemaGap) as unknown as SchemaGap,
      },
      correctedValue: "The corrected governed schema-gap description.",
    },
  ];
}

async function deskWorkFor(original: RecorderRecord) {
  const recorderWork = closedWork();
  return createFieldDeskWork({
    archiveId: ids.archive,
    handedOffAt: "2026-08-23T02:00:00.000Z",
    recorderWork: {
      ...recorderWork,
      protocolPackageId: original.value.protocolPackageId,
      protocolPackageVersion: original.value.protocolPackageVersion,
      researcherId: original.value.researcherId,
      deviceId: original.value.deviceId,
      records: [structuredClone(original)],
    },
  });
}

function reviewFor(
  original: RecorderRecord,
  extra: { supersedingRecord: RecorderRecord },
): Parameters<typeof appendFieldReview>[0]["review"] {
  return {
    id: ids.review,
    recordId: original.value.id,
    reviewerId: original.value.researcherId,
    reviewerMatchesResearcher: true,
    reviewedAt: "2026-08-23T02:05:00.000Z",
    decision: "correct_by_supersession",
    ...extra,
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

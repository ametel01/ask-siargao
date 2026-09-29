import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import type { RecorderWork } from "@/features/field-recorder/field-recorder-types";
import { exampleObservation, recorderSnapshot } from "@/features/field-recorder/test-fixtures";
import { createFieldVaultKey, encryptFieldValue } from "@/features/field-security/crypto";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import { FieldDeskRepository } from "./field-desk-repository";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("Recorder to Desk custody", () => {
  test("atomically archives, retires the active pointer, is idempotent, and permits a new Plan", async () => {
    const vault = new IndexedDbFieldVault();
    const key = createFieldVaultKey();
    const opaqueRecordKey = "field_record_recorderroot123456";
    const work = closedWork();
    await vault.putRecorderRevision({
      envelope: encryptFieldValue({
        applicationVersion: "0.1.0",
        key,
        opaqueRecordKey,
        value: work,
      }),
      expectedPreviousRevision: 0,
      pointer: { opaqueRecordKey, revision: 1, updatedAt: work.updatedAt },
    });
    const repository = new FieldDeskRepository("0.1.0", vault);
    const archiveId = "0192f060-4f41-7aa1-b322-4aa9fc9f1501";
    const first = await repository.handoffClosedRecorder({
      archiveId,
      handedOffAt: "2026-08-23T02:00:00.000Z",
      key,
      validate: async () => undefined,
    });
    expect(first.status).toBe("archived");
    expect(await vault.getRecorderPointer()).toBeUndefined();
    expect(
      (
        await repository.handoffClosedRecorder({
          archiveId,
          handedOffAt: "2026-08-23T02:00:00.000Z",
          key,
          validate: async () => undefined,
        })
      ).status,
    ).toBe("already_archived");
    expect(await repository.list(key)).toHaveLength(1);

    const nextRoot = "field_record_nextrecorder123456";
    await vault.putRecorderRevision({
      envelope: encryptFieldValue({
        applicationVersion: "0.1.0",
        key,
        opaqueRecordKey: nextRoot,
        value: { revision: 1 },
      }),
      expectedPreviousRevision: 0,
      pointer: { opaqueRecordKey: nextRoot, revision: 1, updatedAt: "2026-08-23T03:00:00.000Z" },
    });
    expect((await vault.getRecorderPointer())?.opaqueRecordKey).toBe(nextRoot);
  });
});

function closedWork(): RecorderWork {
  const snapshot = recorderSnapshot(exampleObservation.assignmentId);
  return {
    schemaVersion: "field-recorder-work.v1",
    id: "0192f060-4f41-7aa1-b322-4aa9fc9f1507",
    revision: 1,
    planSnapshot: snapshot,
    planContentHash: snapshot.contentHash,
    protocolPackageId: exampleObservation.protocolPackageId,
    protocolPackageVersion: exampleObservation.protocolPackageVersion,
    researcherId: exampleObservation.researcherId,
    deviceId: exampleObservation.deviceId,
    selectedPartialCoverageSetIds: {},
    step: { assignmentId: exampleObservation.assignmentId, name: "outcome" },
    assignments: [],
    records: [{ kind: "fieldObservation", value: structuredClone(exampleObservation) }],
    mediaReceipts: [],
    objectiveCoverage: [],
    objectiveCoverageRecords: [],
    assignmentOutcomes: [],
    followUps: [],
    fieldDayClose: {
      schemaVersion: "field-day-close.v1",
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1502",
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

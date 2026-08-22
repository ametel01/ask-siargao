import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import { IndexedDbFieldVault } from "@/features/field-security/vault";

import { FieldRecorderRepository } from "./field-recorder-repository";
import type { RecorderWork } from "./field-recorder-types";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: {
      estimate: async () => ({ quota: 100 * 1024 * 1024, usage: 1024 }),
    },
  });
});

describe("Field Recorder encrypted repository", () => {
  test("atomically initializes and resumes the exact encrypted step", async () => {
    const repository = new FieldRecorderRepository({ applicationVersion: "0.1.0" });
    const key = createFieldVaultKey();
    const work = recorderWork(1, "briefing", "2026-08-23T08:00:00+08:00");
    await repository.initialize({ key, work });

    expect(await repository.load(key)).toEqual(work);
    const serialized = JSON.stringify(await new IndexedDbFieldVault().listEnvelopes());
    expect(serialized).not.toContain("assignment_home_base_readiness");
    expect(serialized).not.toContain("researcher_secret");
  });

  test("rejects stale concurrent saves and retains the last committed revision", async () => {
    const repository = new FieldRecorderRepository({ applicationVersion: "0.1.0" });
    const key = createFieldVaultKey();
    const initial = recorderWork(1, "briefing", "2026-08-23T08:00:00+08:00");
    await repository.initialize({ key, work: initial });
    const saved = recorderWork(2, "safety", "2026-08-23T08:01:00+08:00");
    await repository.save({ expectedPreviousRevision: 1, key, work: saved });

    await expect(
      repository.save({
        expectedPreviousRevision: 1,
        key,
        work: recorderWork(2, "start_visit", "2026-08-23T08:02:00+08:00"),
      }),
    ).rejects.toEqual(new FieldSecurityError("field_recorder_revision_conflict"));
    expect(await repository.load(key)).toEqual(saved);
  });

  test("fails closed for the wrong key and preserves ciphertext", async () => {
    const repository = new FieldRecorderRepository({ applicationVersion: "0.1.0" });
    const key = createFieldVaultKey();
    await repository.initialize({
      key,
      work: recorderWork(1, "objectives", "2026-08-23T08:00:00+08:00"),
    });
    await expect(repository.load(createFieldVaultKey())).rejects.toEqual(
      new FieldSecurityError("field_ciphertext_tampered"),
    );
    expect(await repository.load(key)).toBeDefined();
  });
});

function recorderWork(
  revision: number,
  name: RecorderWork["step"]["name"],
  updatedAt: string,
): RecorderWork {
  return {
    assignmentOutcomes: [],
    assignments: [
      {
        assignmentId: "assignment_home_base_readiness",
        status: "planned",
        unresolvedRequirementIds: ["coverage_offline_readiness"],
        visitIds: [],
      },
    ],
    createdAt: "2026-08-23T08:00:00+08:00",
    deviceId: "device_secret",
    followUps: [],
    id: "0192f060-4f41-7aa1-b322-4aa9fc9f1600",
    mediaReceipts: [],
    objectiveCoverage: [],
    objectiveCoverageRecords: [],
    planContentHash: "a".repeat(64),
    planSnapshot: {
      adjustments: [],
      confirmedAt: "2026-08-23T08:00:00+08:00",
      contentHash: "a".repeat(64),
      coverageSnapshot: {
        capturedAt: "2026-08-23T07:00:00+08:00",
        id: "coverage_snapshot_test",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.1",
        requirementStates: [],
        resolvedAssignmentAreaIds: {},
        version: "1.0.0",
      },
      deviceId: "device_secret",
      inputs: {
        assignmentGates: [],
        availableMinutes: 120,
        eligibilityEvidence: [],
        planningAt: "2026-08-23T07:00:00+08:00",
        reserveMinutes: { daylight: 10, documentation: 10, rest: 10, safety: 10 },
        startingAreaId: "area_del_carmen",
        transportMode: "walk",
      },
      invalidatedEvidenceIds: [],
      protocol: {
        campaignId: "campaign_island_baseline",
        campaignVersion: "1.0.1",
        geographyVersion: "1.0.0",
        packageId: "field-protocol-siargao-baseline",
        packageVersion: "1.0.1",
      },
      proposal: {
        availableMinutes: 120,
        consumedMinutes: 60,
        coverageSnapshotId: "coverage_snapshot_test",
        exclusions: [],
        plannedReturnMinutes: 20,
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.1",
        remainingMinutes: 20,
        reserveMinutes: 40,
        selected: [
          {
            areaId: "area_del_carmen",
            assignmentId: "assignment_home_base_readiness",
            consequences: [
              {
                coverageRequirementId: "coverage_offline_readiness",
                remainingDistinctWindows: 1,
                remainingRecords: 1,
              },
            ],
            outstandingRequiredCoverage: 1,
            reasons: [],
            returnToStartMinutes: 20,
            title: "Home-base readiness and practicalities",
            travelFromPreviousMinutes: 0,
            workMinutes: 40,
          },
        ],
        usableMinutes: 80,
      },
      researcherId: "researcher_secret",
      revision: 1,
      revisionReason: "Initial field day",
      schemaVersion: "field-plan-snapshot.v1",
      snapshotId: "snapshot_test",
    },
    protocolPackageId: "field-protocol-siargao-baseline",
    protocolPackageVersion: "1.0.1",
    records: [],
    researcherId: "researcher_secret",
    revision,
    schemaVersion: "field-recorder-work.v1",
    selectedPartialCoverageSetIds: {},
    step: { assignmentId: "assignment_home_base_readiness", name },
    updatedAt,
  };
}

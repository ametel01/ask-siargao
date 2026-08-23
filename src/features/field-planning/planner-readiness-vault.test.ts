import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import { createPlannerFixture } from "./fixtures/planner-fixtures";
import { loadPlannerProtocol } from "./load-planner-protocol";
import {
  assertReadinessHandoff,
  loadPlannerReadiness,
  savePlannerReadiness,
} from "./planner-readiness-vault";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("protected planner readiness handoff", () => {
  test("persists and reloads an approved local handoff only through the vault key", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createPlannerFixture(protocol);
    const key = createFieldVaultKey();
    const handoff = {
      version: 1 as const,
      handoffId: "0192f060-4f41-7aa1-b322-4aa9fc9f1599",
      handedOffAt: "2026-08-22T23:00:00.000Z",
      source: { kind: "approved_local_handoff" as const, id: "field_readiness_approved20260823" },
      protocolPackageId: protocol.packageId,
      protocolPackageVersion: protocol.packageVersion,
      coverageSnapshot: fixture.coverageSnapshot,
      inputs: {
        ...fixture.inputs,
        assignmentGates: fixture.inputs.assignmentGates.map((gate) => ({
          ...gate,
          sourceId: "field-readiness-authority",
          fingerprint: `authority-${gate.assignmentId}`,
        })),
        eligibilityEvidence: fixture.inputs.eligibilityEvidence.map((evidence) => ({
          ...evidence,
          sourceId: "field-preflight-authority",
          fingerprint: `authority-${evidence.assignmentId}-${evidence.kind}`,
        })),
      },
    };
    const vault = new IndexedDbFieldVault();
    await vault.putMetadata({
      key: "authorization-envelope",
      value: { opaqueRecordKey: "field_record_authorization123456", version: 1 },
    });
    await vault.putMetadata({
      key: "field-readiness",
      value: {
        buildId: "build",
        offlineShellPrepared: true,
        readinessEvidence: {
          offlineReloadVerified: true,
          permissionsVerified: true,
          restoreVerified: true,
          sampleCaptureVerified: true,
        },
        persisted: true,
        preparedAt: "2026-08-23T01:00:00.000Z",
        version: 2,
      },
    });
    await savePlannerReadiness(handoff, protocol, key, vault);
    expect(await vault.getMetadata("planner-readiness")).toMatchObject({
      value: { handoffId: handoff.handoffId, version: 1 },
    });
    expect(await loadPlannerReadiness(protocol, key, vault)).toEqual(handoff);
  });

  test("rejects a handoff pinned to a different protocol package", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createPlannerFixture(protocol);
    const key = createFieldVaultKey();
    const vault = new IndexedDbFieldVault();
    await vault.putMetadata({
      key: "authorization-envelope",
      value: { opaqueRecordKey: "field_record_authorization123456", version: 1 },
    });
    await vault.putMetadata({
      key: "field-readiness",
      value: {
        buildId: "build",
        offlineShellPrepared: true,
        readinessEvidence: {
          offlineReloadVerified: true,
          permissionsVerified: true,
          restoreVerified: true,
          sampleCaptureVerified: true,
        },
        persisted: true,
        preparedAt: "2026-08-23T01:00:00.000Z",
        version: 2,
      },
    });
    await expect(
      savePlannerReadiness(
        {
          version: 1,
          handoffId: "0192f060-4f41-7aa1-b322-4aa9fc9f1599",
          handedOffAt: "2026-08-22T23:00:00.000Z",
          source: { kind: "approved_local_handoff", id: "field_readiness_approved20260823" },
          protocolPackageId: "field-protocol-other",
          protocolPackageVersion: protocol.packageVersion,
          coverageSnapshot: fixture.coverageSnapshot,
          inputs: fixture.inputs,
        },
        protocol,
        key,
        vault,
      ),
    ).rejects.toMatchObject({ code: "field_artifact_invalid" });
  });

  test("rejects future-dated and fixture-sourced readiness evidence", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createPlannerFixture(protocol);
    const base = {
      version: 1 as const,
      handoffId: "0192f060-4f41-7aa1-b322-4aa9fc9f1599",
      handedOffAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      source: { kind: "approved_local_handoff" as const, id: "field_readiness_approved20260823" },
      protocolPackageId: protocol.packageId,
      protocolPackageVersion: protocol.packageVersion,
      coverageSnapshot: fixture.coverageSnapshot,
      inputs: fixture.inputs,
    };
    expect(() => assertReadinessHandoff(base, protocol)).toThrow("field_artifact_invalid");
    expect(() =>
      assertReadinessHandoff(
        {
          ...base,
          handedOffAt: new Date().toISOString(),
          source: { kind: "approved_local_handoff", id: "operator-preflight-fixture" },
        },
        protocol,
      ),
    ).toThrow("field_artifact_invalid");
  });
});

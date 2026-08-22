import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import { createPlannerFixture } from "./fixtures/planner-fixtures";
import { loadPlannerProtocol } from "./load-planner-protocol";
import { loadPlannerReadiness, savePlannerReadiness } from "./planner-readiness-vault";

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
      handedOffAt: "2026-08-23T02:00:00.000Z",
      source: { kind: "approved_local_handoff" as const, id: "operator-preflight-2026-08-23" },
      protocolPackageId: protocol.packageId,
      protocolPackageVersion: protocol.packageVersion,
      coverageSnapshot: fixture.coverageSnapshot,
      inputs: fixture.inputs,
    };
    const vault = new IndexedDbFieldVault();
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
    await expect(
      savePlannerReadiness(
        {
          version: 1,
          handoffId: "0192f060-4f41-7aa1-b322-4aa9fc9f1599",
          handedOffAt: "2026-08-23T02:00:00.000Z",
          source: { kind: "approved_local_handoff", id: "operator-preflight-2026-08-23" },
          protocolPackageId: "field-protocol-other",
          protocolPackageVersion: protocol.packageVersion,
          coverageSnapshot: fixture.coverageSnapshot,
          inputs: fixture.inputs,
        },
        protocol,
        key,
      ),
    ).rejects.toMatchObject({ code: "field_artifact_invalid" });
  });
});

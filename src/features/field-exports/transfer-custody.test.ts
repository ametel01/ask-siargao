import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import { type FieldTransferStateRow, IndexedDbFieldVault } from "@/features/field-security/vault";
import type { FieldBatchOuterReceipt } from "./artifact-schemas";
import {
  loadLatestOutstandingFieldBatchTransfer,
  persistOutstandingTransfer,
} from "./transfer-custody";

const transferId = "0192f060-4f41-7aa1-b322-4aa9fc9f1521";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("Field Transfer custody", () => {
  test("restores the encrypted source receipt and challenge after a new vault instance", async () => {
    const vaultKey = createFieldVaultKey();
    const vault = new IndexedDbFieldVault();
    const row = outstandingTransfer();
    const receipt = sourceReceipt();

    await persistOutstandingTransfer({ row, sourceReceipt: receipt, vault, vaultKey });

    const stored = await vault.listTransfers();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.nonce).toBe(row.nonce);
    expect(stored[0]?.sourceReceiptEnvelopeKey).toBeDefined();
    expect(JSON.stringify(await vault.listEnvelopes())).not.toContain(receipt.filename);
    await expect(
      loadLatestOutstandingFieldBatchTransfer({
        vault: new IndexedDbFieldVault(),
        vaultKey,
      }),
    ).resolves.toEqual({ receipt, transfer: stored[0] });
  });

  test("rejects a source receipt that is not bound to the outstanding transfer", async () => {
    const vault = new IndexedDbFieldVault();
    await expect(
      persistOutstandingTransfer({
        row: outstandingTransfer(),
        sourceReceipt: { ...sourceReceipt(), ciphertextSha256: "b".repeat(64) },
        vault,
        vaultKey: createFieldVaultKey(),
      }),
    ).rejects.toThrow("field_transfer_receipt_invalid");
    expect(await vault.listTransfers()).toEqual([]);
    expect(await vault.listEnvelopes()).toEqual([]);
  });
});

function outstandingTransfer(): FieldTransferStateRow {
  return {
    artifactKind: "field_batch",
    ciphertextSha256: "a".repeat(64),
    createdAt: "2026-08-23T02:00:00.000Z",
    nonce: "challenge-nonce-1234567890",
    recipientDeviceId: "field_device_1234567890123456",
    state: "outstanding",
    transferId,
  };
}

function sourceReceipt(): FieldBatchOuterReceipt {
  return {
    artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1522",
    ciphertextSha256: "a".repeat(64),
    createdAt: "2026-08-23T02:00:00.000Z",
    encryptedBytes: 4096,
    filename: "ask-siargao-field-batch-aaaaaaaaaaaa.asfbatch",
    formatVersion: "asf-batch-container.v1",
    recipientDeviceId: "field_device_1234567890123456",
    schemaVersion: "field-batch-outer-receipt.v1",
    state: "created",
    transferId,
  };
}

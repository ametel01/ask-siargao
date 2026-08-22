import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey, encryptFieldValue } from "@/features/field-security/crypto";
import { fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import { commitConfirmedRestore, createRestorePreview } from "./restore";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("authenticated restore preview", () => {
  test("previews additions, exact replays and quarantines before an explicit atomic commit", async () => {
    const key = createFieldVaultKey();
    const incoming = await Promise.all([
      item("add", "new content", key),
      item("same", "same content", key),
      item("conflict", "incoming content", key),
    ]);
    const destination = new Map([
      ["same", incoming[1].contentSha256],
      ["conflict", await sha256Hex(fieldTextEncoder.encode("destination content"))],
    ]);
    const preview = await createRestorePreview({
      artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1510",
      createdAt: "2026-08-23T02:00:00.000Z",
      destination,
      incoming,
      previewId: "0192f060-4f41-7aa1-b322-4aa9fc9f1512",
    });
    expect(preview.additions).toEqual(["add"]);
    expect(preview.exactReplays).toEqual(["same"]);
    expect(preview.quarantines.map((entry) => entry.immutableId)).toEqual(["conflict"]);
    const vault = new IndexedDbFieldVault();
    expect(await vault.getEnvelope(incoming[0].envelope.opaqueRecordKey)).toBeUndefined();
    await expect(
      commitConfirmedRestore({
        confirmedPreviewSha256: "0".repeat(64),
        incoming,
        key,
        now: "2026-08-23T02:01:00.000Z",
        preview,
        vault,
      }),
    ).rejects.toMatchObject({ code: "field_artifact_invalid" });
    expect(await vault.getEnvelope(incoming[0].envelope.opaqueRecordKey)).toBeUndefined();
    expect(
      await commitConfirmedRestore({
        confirmedPreviewSha256: preview.previewSha256,
        incoming,
        key,
        now: "2026-08-23T02:01:00.000Z",
        preview,
        vault,
      }),
    ).toEqual({ additions: 1, exactReplays: 1, quarantines: 1 });
    expect(await vault.getEnvelope(incoming[0].envelope.opaqueRecordKey)).toBeDefined();
  });

  test("restores the Legacy Capture index with its opaque source and preview envelopes", async () => {
    const key = createFieldVaultKey();
    const incoming = await Promise.all([
      item("legacy_source_restore", "encrypted source", key),
      item("legacy_preview_restore", "encrypted preview", key),
    ]);
    const preview = await createRestorePreview({
      artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1510",
      createdAt: "2026-08-23T02:00:00.000Z",
      destination: new Map(),
      incoming,
      previewId: "0192f060-4f41-7aa1-b322-4aa9fc9f1512",
    });
    const vault = new IndexedDbFieldVault();
    await commitConfirmedRestore({
      confirmedPreviewSha256: preview.previewSha256,
      incoming,
      key,
      legacyCaptureHeaders: [
        {
          decisionEnvelopeKeys: [],
          importedAt: "2026-08-23T02:00:00.000Z",
          originalBytesAvailable: true,
          previewEnvelopeKey: incoming[1].envelope.opaqueRecordKey,
          previewSha256: "d".repeat(64),
          recordCount: 2,
          sourceEnvelopeKey: incoming[0].envelope.opaqueRecordKey,
          sourceId: `legacy_source_${"e".repeat(64)}`,
          sourceSha256: "e".repeat(64),
          state: "quarantined_conflict",
          version: 1,
        },
      ],
      now: "2026-08-23T02:01:00.000Z",
      preview,
      vault,
    });
    expect(await vault.listLegacyCaptureHeaders()).toEqual([
      expect.objectContaining({ state: "quarantined_conflict" }),
    ]);
  });
});

async function item(id: string, content: string, key: Uint8Array) {
  return {
    immutableId: id,
    contentSha256: await sha256Hex(fieldTextEncoder.encode(content)),
    envelope: encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      opaqueRecordKey: `field_record_${id.padEnd(20, "x")}`,
      value: { id, content },
    }),
  };
}

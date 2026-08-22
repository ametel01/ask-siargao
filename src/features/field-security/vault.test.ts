import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey, encryptFieldValue } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import { decryptFieldMedia, encryptFieldMedia } from "@/features/field-security/media";
import { evaluateFieldReadiness, IndexedDbFieldVault } from "@/features/field-security/vault";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("encrypted IndexedDB vault", () => {
  test("commits opaque ciphertext rows atomically without plaintext indexes", async () => {
    const vault = new IndexedDbFieldVault();
    const key = createFieldVaultKey();
    const envelopes = ["protected alpha", "protected beta"].map((secret) =>
      encryptFieldValue({ applicationVersion: "0.1.0", key, value: { secret } }),
    );
    await vault.putEnvelopeBatch(envelopes);
    const serialized = JSON.stringify(await vault.listEnvelopes());
    expect(serialized).not.toContain("protected alpha");
    expect(serialized).not.toContain("protected beta");
    expect(await vault.getEnvelope(envelopes[0].opaqueRecordKey)).toEqual(envelopes[0]);
  });

  test("denies concurrent writers and requires an encrypted takeover receipt after suspension", async () => {
    const vault = new IndexedDbFieldVault();
    const visitReference = "visit_ref_1234567890123456";
    await vault.claimWriter({
      expiresAt: 2_000,
      explicitTakeover: false,
      nowMs: 1_000,
      visitReference,
      writerInstanceId: "writer-one",
    });
    await expect(
      vault.claimWriter({
        expiresAt: 2_500,
        explicitTakeover: false,
        nowMs: 1_500,
        visitReference,
        writerInstanceId: "writer-two",
      }),
    ).rejects.toEqual(new FieldSecurityError("field_writer_conflict"));
    await expect(
      vault.claimWriter({
        expiresAt: 4_000,
        explicitTakeover: false,
        nowMs: 3_000,
        visitReference,
        writerInstanceId: "writer-two",
      }),
    ).rejects.toEqual(new FieldSecurityError("field_writer_takeover_required"));
    const auditEnvelope = encryptFieldValue({
      applicationVersion: "0.1.0",
      key: createFieldVaultKey(),
      value: { operation: "writer_takeover" },
    });
    const result = await vault.claimWriter({
      auditEnvelope,
      expiresAt: 4_000,
      explicitTakeover: true,
      nowMs: 3_000,
      visitReference,
      writerInstanceId: "writer-two",
    });
    expect(result.lease.revision).toBe(2);
  });

  test("purges only exact scope with fresh authority and verified recovery", async () => {
    const vault = new IndexedDbFieldVault();
    const key = createFieldVaultKey();
    const keep = encryptFieldValue({ applicationVersion: "0.1.0", key, value: { id: "keep" } });
    const remove = encryptFieldValue({ applicationVersion: "0.1.0", key, value: { id: "remove" } });
    await vault.putEnvelopeBatch([keep, remove]);
    const auditEnvelope = encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      value: { operation: "purge" },
    });
    await expect(
      vault.purgeExactScope({
        auditEnvelope,
        authorityIssuedAtMs: 0,
        nowMs: 600_000,
        opaqueRecordKeys: [remove.opaqueRecordKey],
        recoveryVerified: true,
      }),
    ).rejects.toEqual(new FieldSecurityError("field_purge_not_authorized"));
    expect(
      await vault.purgeExactScope({
        auditEnvelope,
        authorityIssuedAtMs: 500_000,
        nowMs: 600_000,
        opaqueRecordKeys: [remove.opaqueRecordKey],
        recoveryVerified: true,
      }),
    ).toEqual({ purged: 1 });
    expect(await vault.getEnvelope(keep.opaqueRecordKey)).toBeDefined();
    expect(await vault.getEnvelope(remove.opaqueRecordKey)).toBeUndefined();
  });

  test("requires verified recovery, persistence and headroom for Field Readiness", () => {
    expect(
      evaluateFieldReadiness({
        availableBytes: 100_000_000,
        grantUsable: true,
        offlineShellPrepared: true,
        persisted: true,
        protocolVerified: true,
        recoveryVerified: false,
      }),
    ).toEqual({ ready: false, reasons: ["recovery_unverified"] });
  });

  test("atomically advances one opaque Recorder root and retains the last good revision", async () => {
    const vault = new IndexedDbFieldVault();
    const key = createFieldVaultKey();
    const opaqueRecordKey = "field_record_recorderroot123456";
    const first = encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      opaqueRecordKey,
      value: { revision: 1, step: "briefing" },
    });
    await vault.putRecorderRevision({
      envelope: first,
      expectedPreviousRevision: 0,
      pointer: { opaqueRecordKey, revision: 1, updatedAt: "2026-08-23T01:00:00.000Z" },
    });

    const second = encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      opaqueRecordKey,
      value: { revision: 2, step: "safety" },
    });
    await vault.putRecorderRevision({
      envelope: second,
      expectedPreviousRevision: 1,
      pointer: { opaqueRecordKey, revision: 2, updatedAt: "2026-08-23T01:01:00.000Z" },
    });
    expect(await vault.getRecorderPointer()).toEqual({
      opaqueRecordKey,
      revision: 2,
      updatedAt: "2026-08-23T01:01:00.000Z",
      version: 1,
    });

    await expect(
      vault.putRecorderRevision({
        envelope: first,
        expectedPreviousRevision: 1,
        pointer: { opaqueRecordKey, revision: 2, updatedAt: "2026-08-23T01:02:00.000Z" },
      }),
    ).rejects.toEqual(new FieldSecurityError("field_recorder_revision_conflict"));
    expect(await vault.getEnvelope(opaqueRecordKey)).toEqual(second);
    expect((await vault.getRecorderPointer())?.revision).toBe(2);
  });

  test("fences Recorder saves with the active writer lease", async () => {
    const vault = new IndexedDbFieldVault();
    const opaqueRecordKey = "field_record_recorderroot123456";
    const visitReference = "visit_ref_1234567890123456";
    const envelope = encryptFieldValue({
      applicationVersion: "0.1.0",
      key: createFieldVaultKey(),
      opaqueRecordKey,
      value: { revision: 1 },
    });
    await vault.claimWriter({
      expiresAt: 2_000,
      explicitTakeover: false,
      nowMs: 1_000,
      visitReference,
      writerInstanceId: "writer-one",
    });
    await expect(
      vault.putRecorderRevision({
        envelope,
        expectedPreviousRevision: 0,
        pointer: { opaqueRecordKey, revision: 1, updatedAt: "2026-08-23T01:00:00.000Z" },
        writerLease: { nowMs: 1_500, visitReference, writerInstanceId: "writer-two" },
      }),
    ).rejects.toEqual(new FieldSecurityError("field_writer_conflict"));
    expect(await vault.getRecorderPointer()).toBeUndefined();

    await vault.putRecorderRevision({
      envelope,
      expectedPreviousRevision: 0,
      pointer: { opaqueRecordKey, revision: 1, updatedAt: "2026-08-23T01:00:00.000Z" },
      writerLease: { nowMs: 1_500, visitReference, writerInstanceId: "writer-one" },
    });
    expect((await vault.getRecorderPointer())?.revision).toBe(1);
  });

  test("stores encrypted media and Recorder metadata in one transaction without false success", async () => {
    const vault = new IndexedDbFieldVault();
    const key = createFieldVaultKey();
    const opaqueRecordKey = "field_record_recorderroot123456";
    const envelope = encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      opaqueRecordKey,
      value: { assets: ["field_media_1234567890123456"], revision: 1 },
    });
    const media = await encryptFieldMedia({
      bytes: new Uint8Array([4, 8, 15, 16, 23, 42]),
      contentType: "image/jpeg",
      key,
      opaqueMediaKey: "field_media_1234567890123456",
    });
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) {
      if (typeof value === "object" && value !== null && "chunkKey" in value) {
        throw new DOMException("", "QuotaExceededError");
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try {
      await expect(
        vault.putRecorderRevision({
          envelope,
          expectedPreviousRevision: 0,
          media: [media],
          pointer: { opaqueRecordKey, revision: 1, updatedAt: "2026-08-23T01:00:00.000Z" },
        }),
      ).rejects.toEqual(new FieldSecurityError("field_storage_unavailable"));
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect(await vault.getRecorderPointer()).toBeUndefined();
    expect(await vault.getEnvelope(opaqueRecordKey)).toBeUndefined();
    expect(await vault.getEncryptedMedia(media.manifest.opaqueMediaKey)).toBeUndefined();

    await vault.putRecorderRevision({
      envelope,
      expectedPreviousRevision: 0,
      media: [media],
      pointer: { opaqueRecordKey, revision: 1, updatedAt: "2026-08-23T01:00:00.000Z" },
    });
    const stored = await vault.getEncryptedMedia(media.manifest.opaqueMediaKey);
    if (!stored) throw new Error("expected stored encrypted media");
    expect((await decryptFieldMedia(stored, key)).bytes).toEqual(
      new Uint8Array([4, 8, 15, 16, 23, 42]),
    );
  });
});

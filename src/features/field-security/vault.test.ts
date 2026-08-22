import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey, encryptFieldValue } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
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
});

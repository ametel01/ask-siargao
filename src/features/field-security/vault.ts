import { FieldSecurityError } from "@/features/field-security/errors";
import type {
  FieldDeviceWrap,
  FieldEncryptedEnvelope,
  FieldRecoveryWrap,
} from "@/features/field-security/types";
import type { DeviceBoundCredentialEvidence } from "@/features/field-security/webauthn";

const databaseName = "ask-siargao-protected-field-vault";
const databaseVersion = 1;
const envelopeStore = "opaque-envelopes";
const metadataStore = "crypto-metadata";
const leaseStore = "writer-leases";
const auditStore = "encrypted-audit";
const deviceKeyStore = "device-keys";

export type FieldWriterLease = {
  expiresAt: number;
  revision: number;
  visitReference: string;
  writerInstanceId: string;
};

export type FieldVaultMetadata =
  | { key: "recovery-wrap"; value: FieldRecoveryWrap }
  | { key: "recovery-verified"; value: { at: string; version: 1 } }
  | { key: "trusted-wall-clock"; value: { observedAtMs: number; version: 1 } }
  | { key: "authorization-envelope"; value: { opaqueRecordKey: string; version: 1 } }
  | { key: "device-wrap"; value: FieldDeviceWrap }
  | { key: "unlock-credential"; value: DeviceBoundCredentialEvidence };

export type WriterClaimResult =
  | { status: "acquired"; lease: FieldWriterLease }
  | { status: "renewed"; lease: FieldWriterLease };

export class IndexedDbFieldVault {
  async putDeviceKeys(input: {
    agreementPrivateKey: CryptoKey;
    signingPrivateKey: CryptoKey;
  }): Promise<void> {
    await this.withTransaction([deviceKeyStore], "readwrite", async (transaction) => {
      const store = transaction.objectStore(deviceKeyStore);
      store.put({ key: "agreement-private", value: input.agreementPrivateKey });
      store.put({ key: "signing-private", value: input.signingPrivateKey });
    });
  }

  async getDeviceKey(key: "agreement-private" | "signing-private"): Promise<CryptoKey> {
    const row = await this.withTransaction([deviceKeyStore], "readonly", async (transaction) =>
      requestResult<{ key: string; value: CryptoKey } | undefined>(
        transaction.objectStore(deviceKeyStore).get(key),
      ),
    );
    if (!row) throw new FieldSecurityError("field_key_unavailable");
    return row.value;
  }

  async putEnvelopeBatch(envelopes: readonly FieldEncryptedEnvelope[]): Promise<void> {
    if (envelopes.length === 0) return;
    await this.withTransaction([envelopeStore], "readwrite", async (transaction) => {
      const store = transaction.objectStore(envelopeStore);
      for (const envelope of envelopes) store.put(envelope);
    });
  }

  async getEnvelope(opaqueRecordKey: string): Promise<FieldEncryptedEnvelope | undefined> {
    return this.withTransaction([envelopeStore], "readonly", async (transaction) => {
      const result = await requestResult<FieldEncryptedEnvelope | undefined>(
        transaction.objectStore(envelopeStore).get(opaqueRecordKey),
      );
      return result;
    });
  }

  async listEnvelopes(): Promise<FieldEncryptedEnvelope[]> {
    return this.withTransaction([envelopeStore], "readonly", async (transaction) =>
      requestResult<FieldEncryptedEnvelope[]>(transaction.objectStore(envelopeStore).getAll()),
    );
  }

  async putMetadata(metadata: FieldVaultMetadata): Promise<void> {
    await this.withTransaction([metadataStore], "readwrite", async (transaction) => {
      transaction.objectStore(metadataStore).put(metadata);
    });
  }

  async getMetadata<K extends FieldVaultMetadata["key"]>(
    key: K,
  ): Promise<Extract<FieldVaultMetadata, { key: K }> | undefined> {
    return this.withTransaction([metadataStore], "readonly", async (transaction) =>
      requestResult<Extract<FieldVaultMetadata, { key: K }> | undefined>(
        transaction.objectStore(metadataStore).get(key),
      ),
    );
  }

  async claimWriter(input: {
    auditEnvelope?: FieldEncryptedEnvelope;
    expiresAt: number;
    explicitTakeover: boolean;
    nowMs: number;
    visitReference: string;
    writerInstanceId: string;
  }): Promise<WriterClaimResult> {
    if (!/^visit_ref_[A-Za-z0-9_-]{16,}$/u.test(input.visitReference)) {
      throw new FieldSecurityError("field_writer_conflict");
    }
    return this.withTransaction([leaseStore, auditStore], "readwrite", async (transaction) => {
      const leases = transaction.objectStore(leaseStore);
      const existing = await requestResult<FieldWriterLease | undefined>(
        leases.get(input.visitReference),
      );
      if (existing && existing.writerInstanceId !== input.writerInstanceId) {
        if (existing.expiresAt > input.nowMs) {
          throw new FieldSecurityError("field_writer_conflict");
        }
        if (!input.explicitTakeover || !input.auditEnvelope) {
          throw new FieldSecurityError("field_writer_takeover_required");
        }
        transaction.objectStore(auditStore).put(input.auditEnvelope);
      }
      const lease: FieldWriterLease = {
        expiresAt: input.expiresAt,
        revision: (existing?.revision ?? 0) + 1,
        visitReference: input.visitReference,
        writerInstanceId: input.writerInstanceId,
      };
      leases.put(lease);
      return {
        lease,
        status: existing?.writerInstanceId === input.writerInstanceId ? "renewed" : "acquired",
      };
    });
  }

  async purgeExactScope(input: {
    auditEnvelope: FieldEncryptedEnvelope;
    authorityIssuedAtMs: number;
    nowMs: number;
    opaqueRecordKeys: readonly string[];
    recoveryVerified: boolean;
    retentionOrWithdrawalBasis?: "consent_withdrawal" | "retention_expired";
  }): Promise<{ purged: number }> {
    if (
      input.opaqueRecordKeys.length === 0 ||
      input.nowMs - input.authorityIssuedAtMs > 5 * 60 * 1_000 ||
      input.authorityIssuedAtMs > input.nowMs + 2 * 60 * 1_000 ||
      (!input.recoveryVerified && !input.retentionOrWithdrawalBasis)
    ) {
      throw new FieldSecurityError("field_purge_not_authorized");
    }
    const uniqueKeys = new Set(input.opaqueRecordKeys);
    if (uniqueKeys.size !== input.opaqueRecordKeys.length) {
      throw new FieldSecurityError("field_purge_not_authorized");
    }
    await this.withTransaction([envelopeStore, auditStore], "readwrite", async (transaction) => {
      const envelopes = transaction.objectStore(envelopeStore);
      for (const key of uniqueKeys) {
        const existing = await requestResult<FieldEncryptedEnvelope | undefined>(
          envelopes.get(key),
        );
        if (!existing) throw new FieldSecurityError("field_purge_not_authorized");
      }
      for (const key of uniqueKeys) envelopes.delete(key);
      transaction.objectStore(auditStore).put(input.auditEnvelope);
    });
    return { purged: uniqueKeys.size };
  }

  private async withTransaction<T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    callback: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const database = await openFieldVaultDatabase();
    try {
      const transaction = database.transaction([...stores], mode);
      const completion = transactionCompletion(transaction);
      let result: T;
      try {
        result = await callback(transaction);
      } catch (error) {
        transaction.abort();
        await completion.catch(() => undefined);
        throw error;
      }
      await completion;
      return result;
    } catch (error) {
      if (error instanceof FieldSecurityError) throw error;
      throw new FieldSecurityError("field_storage_unavailable");
    } finally {
      database.close();
    }
  }
}

export async function requestPersistentFieldStorage(): Promise<{
  availableBytes: number;
  persisted: boolean;
}> {
  if (!navigator.storage?.persist || !navigator.storage.estimate) {
    return { availableBytes: 0, persisted: false };
  }
  const persisted = await navigator.storage.persist().catch(() => false);
  const estimate = await navigator.storage
    .estimate()
    .catch((): StorageEstimate => ({ quota: 0, usage: 0 }));
  return {
    availableBytes: Math.max(0, (estimate.quota ?? 0) - (estimate.usage ?? 0)),
    persisted,
  };
}

export function evaluateFieldReadiness(input: {
  availableBytes: number;
  grantUsable: boolean;
  minimumAvailableBytes?: number;
  offlineShellPrepared: boolean;
  persisted: boolean;
  protocolVerified: boolean;
  recoveryVerified: boolean;
}): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.grantUsable) reasons.push("offline_grant_unavailable");
  if (!input.protocolVerified) reasons.push("protocol_unverified");
  if (!input.recoveryVerified) reasons.push("recovery_unverified");
  if (!input.offlineShellPrepared) reasons.push("offline_shell_unprepared");
  if (!input.persisted) reasons.push("persistent_storage_unavailable");
  if (input.availableBytes < (input.minimumAvailableBytes ?? 50 * 1024 * 1024)) {
    reasons.push("storage_headroom_insufficient");
  }
  return { ready: reasons.length === 0, reasons };
}

function openFieldVaultDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      for (const [store, keyPath] of [
        [envelopeStore, "opaqueRecordKey"],
        [metadataStore, "key"],
        [leaseStore, "visitReference"],
        [auditStore, "opaqueRecordKey"],
        [deviceKeyStore, "key"],
      ] as const) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store, { keyPath });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

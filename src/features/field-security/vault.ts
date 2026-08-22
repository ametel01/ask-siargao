import type { FieldDeskArchiveHeader } from "@/features/field-desk/desk-schemas";
import { FieldSecurityError } from "@/features/field-security/errors";
import type {
  EncryptedFieldMediaBundle,
  FieldEncryptedMediaChunk,
  FieldEncryptedMediaManifest,
} from "@/features/field-security/media";
import type {
  FieldDeviceWrap,
  FieldEncryptedEnvelope,
  FieldRecoveryWrap,
} from "@/features/field-security/types";
import type { DeviceBoundCredentialEvidence } from "@/features/field-security/webauthn";

const databaseName = "ask-siargao-protected-field-vault";
const databaseVersion = 3;
const envelopeStore = "opaque-envelopes";
const metadataStore = "crypto-metadata";
const leaseStore = "writer-leases";
const auditStore = "encrypted-audit";
const deviceKeyStore = "device-keys";
const mediaChunkStore = "encrypted-media-chunks";
const mediaManifestStore = "encrypted-media-manifests";
const deskArchiveStore = "desk-archive-index";
const restoreQuarantineStore = "encrypted-restore-quarantine";
const transferStateStore = "field-transfer-state";

export type FieldRestoreQuarantineRow = {
  quarantineId: string;
  immutableId: string;
  destinationSha256: string;
  incomingEnvelope: FieldEncryptedEnvelope;
  incomingSha256: string;
  quarantinedAt: string;
};

export type FieldTransferStateRow = {
  transferId: string;
  artifactKind: "field_batch" | "field_recovery";
  ciphertextSha256: string;
  recipientDeviceId: string;
  nonce: string;
  state: "outstanding" | "accepted";
  createdAt: string;
  acceptedReceiptId?: string;
};

export type FieldRecorderPointer = {
  opaqueRecordKey: string;
  revision: number;
  updatedAt: string;
  version: 1;
};

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
  | {
      key: "field-readiness";
      value: {
        buildId: string;
        offlineShellPrepared: boolean;
        persisted: boolean;
        preparedAt: string;
        version: 1;
      };
    }
  | { key: "recorder-pointer"; value: FieldRecorderPointer }
  | { key: "device-wrap"; value: FieldDeviceWrap }
  | { key: "device-role"; value: { role: "desk" | "recorder"; version: 1 } }
  | { key: "unlock-credential"; value: DeviceBoundCredentialEvidence };

export type WriterClaimResult =
  | { status: "acquired"; lease: FieldWriterLease }
  | { status: "renewed"; lease: FieldWriterLease };

export class IndexedDbFieldVault {
  async archiveClosedRecorder(input: {
    deskEnvelope: FieldEncryptedEnvelope;
    header: FieldDeskArchiveHeader;
    recorderPointer: FieldRecorderPointer;
  }): Promise<{ status: "already_archived" | "archived" }> {
    if (
      input.header.recorderOpaqueRecordKey !== input.recorderPointer.opaqueRecordKey ||
      input.header.latestEnvelopeKey !== input.deskEnvelope.opaqueRecordKey ||
      input.header.latestRevision !== 1
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    return this.withTransaction(
      [envelopeStore, metadataStore, deskArchiveStore],
      "readwrite",
      async (transaction) => {
        const metadata = transaction.objectStore(metadataStore);
        const current = await requestResult<
          Extract<FieldVaultMetadata, { key: "recorder-pointer" }> | undefined
        >(metadata.get("recorder-pointer"));
        const archives = transaction.objectStore(deskArchiveStore);
        const existing = await requestResult<FieldDeskArchiveHeader | undefined>(
          archives.get(input.header.archiveId),
        );
        if (existing) {
          if (
            existing.sourceRecorderSha256 !== input.header.sourceRecorderSha256 ||
            existing.recorderOpaqueRecordKey !== input.header.recorderOpaqueRecordKey
          ) {
            throw new FieldSecurityError("field_artifact_invalid");
          }
          if (current?.value.opaqueRecordKey === input.recorderPointer.opaqueRecordKey) {
            metadata.delete("recorder-pointer");
          }
          return { status: "already_archived" as const };
        }
        if (
          !current ||
          current.value.opaqueRecordKey !== input.recorderPointer.opaqueRecordKey ||
          current.value.revision !== input.recorderPointer.revision
        ) {
          throw new FieldSecurityError("field_recorder_revision_conflict");
        }
        const source = await requestResult<FieldEncryptedEnvelope | undefined>(
          transaction.objectStore(envelopeStore).get(input.recorderPointer.opaqueRecordKey),
        );
        if (!source) throw new FieldSecurityError("field_recorder_resume_invalid");
        transaction.objectStore(envelopeStore).put(input.deskEnvelope);
        archives.put(input.header);
        metadata.delete("recorder-pointer");
        return { status: "archived" as const };
      },
    );
  }

  async updateDeskArchive(input: {
    envelope: FieldEncryptedEnvelope;
    expectedRevision: number;
    header: FieldDeskArchiveHeader;
  }): Promise<void> {
    if (
      input.header.latestRevision !== input.expectedRevision + 1 ||
      input.header.latestEnvelopeKey !== input.envelope.opaqueRecordKey
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    await this.withTransaction(
      [envelopeStore, deskArchiveStore],
      "readwrite",
      async (transaction) => {
        const archives = transaction.objectStore(deskArchiveStore);
        const current = await requestResult<FieldDeskArchiveHeader | undefined>(
          archives.get(input.header.archiveId),
        );
        if (!current || current.latestRevision !== input.expectedRevision) {
          throw new FieldSecurityError("field_recorder_revision_conflict");
        }
        transaction.objectStore(envelopeStore).put(input.envelope);
        archives.put(input.header);
      },
    );
  }

  async getDeskArchive(archiveId: string): Promise<FieldDeskArchiveHeader | undefined> {
    return this.withTransaction([deskArchiveStore], "readonly", async (transaction) =>
      requestResult<FieldDeskArchiveHeader | undefined>(
        transaction.objectStore(deskArchiveStore).get(archiveId),
      ),
    );
  }

  iterateDeskArchives(): AsyncIterable<FieldDeskArchiveHeader> {
    return iterateObjectStore<FieldDeskArchiveHeader>(deskArchiveStore);
  }

  iterateEnvelopes(): AsyncIterable<FieldEncryptedEnvelope> {
    return iterateObjectStore<FieldEncryptedEnvelope>(envelopeStore);
  }

  iterateEncryptedMediaChunks(): AsyncIterable<FieldEncryptedMediaChunk> {
    return iterateObjectStore<FieldEncryptedMediaChunk>(mediaChunkStore);
  }

  iterateEncryptedMediaManifests(): AsyncIterable<FieldEncryptedMediaManifest> {
    return iterateObjectStore<FieldEncryptedMediaManifest>(mediaManifestStore);
  }

  async commitRestore(input: {
    additions: readonly FieldEncryptedEnvelope[];
    auditEnvelope: FieldEncryptedEnvelope;
    quarantines: readonly FieldRestoreQuarantineRow[];
  }): Promise<void> {
    await this.withTransaction(
      [envelopeStore, restoreQuarantineStore, auditStore],
      "readwrite",
      async (transaction) => {
        const envelopes = transaction.objectStore(envelopeStore);
        for (const addition of input.additions) {
          if (await requestResult(envelopes.getKey(addition.opaqueRecordKey))) {
            throw new FieldSecurityError("field_artifact_invalid");
          }
        }
        for (const addition of input.additions) envelopes.put(addition);
        const quarantines = transaction.objectStore(restoreQuarantineStore);
        for (const quarantine of input.quarantines) quarantines.add(quarantine);
        transaction.objectStore(auditStore).add(input.auditEnvelope);
      },
    );
  }

  async putOutstandingTransfer(row: FieldTransferStateRow): Promise<void> {
    if (row.state !== "outstanding") throw new FieldSecurityError("field_artifact_invalid");
    await this.withTransaction([transferStateStore], "readwrite", async (transaction) => {
      const store = transaction.objectStore(transferStateStore);
      if (await requestResult(store.getKey(row.transferId))) {
        throw new FieldSecurityError("field_artifact_replay");
      }
      store.add(row);
    });
  }

  async acceptTransfer(input: { receiptId: string; transferId: string }): Promise<void> {
    await this.withTransaction([transferStateStore], "readwrite", async (transaction) => {
      const store = transaction.objectStore(transferStateStore);
      const row = await requestResult<FieldTransferStateRow | undefined>(
        store.get(input.transferId),
      );
      if (row?.state !== "outstanding") {
        throw new FieldSecurityError("field_artifact_replay");
      }
      store.put({ ...row, acceptedReceiptId: input.receiptId, state: "accepted" });
    });
  }

  async getTransfer(transferId: string): Promise<FieldTransferStateRow | undefined> {
    return this.withTransaction([transferStateStore], "readonly", async (transaction) =>
      requestResult<FieldTransferStateRow | undefined>(
        transaction.objectStore(transferStateStore).get(transferId),
      ),
    );
  }

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

  async putRecorderRevision(input: {
    envelope: FieldEncryptedEnvelope;
    expectedPreviousRevision: number;
    media?: readonly EncryptedFieldMediaBundle[];
    pointer: Omit<FieldRecorderPointer, "version">;
    writerLease?: {
      nowMs: number;
      visitReference: string;
      writerInstanceId: string;
    };
  }): Promise<void> {
    assertRecorderRevision(input);
    await this.withTransaction(
      [envelopeStore, metadataStore, mediaManifestStore, mediaChunkStore, leaseStore],
      "readwrite",
      async (transaction) => {
        const existing = await requestResult<
          Extract<FieldVaultMetadata, { key: "recorder-pointer" }> | undefined
        >(transaction.objectStore(metadataStore).get("recorder-pointer"));
        if (
          (existing?.value.revision ?? 0) !== input.expectedPreviousRevision ||
          (existing && existing.value.opaqueRecordKey !== input.pointer.opaqueRecordKey)
        ) {
          throw new FieldSecurityError("field_recorder_revision_conflict");
        }
        if (input.writerLease) {
          const lease = await requestResult<FieldWriterLease | undefined>(
            transaction.objectStore(leaseStore).get(input.writerLease.visitReference),
          );
          if (
            !lease ||
            lease.writerInstanceId !== input.writerLease.writerInstanceId ||
            lease.expiresAt <= input.writerLease.nowMs
          ) {
            throw new FieldSecurityError("field_writer_conflict");
          }
        }
        transaction.objectStore(envelopeStore).put(input.envelope);
        for (const bundle of input.media ?? []) putMediaBundle(transaction, bundle);
        transaction.objectStore(metadataStore).put({
          key: "recorder-pointer",
          value: { ...input.pointer, version: 1 },
        });
      },
    );
  }

  async getRecorderPointer(): Promise<FieldRecorderPointer | undefined> {
    return (await this.getMetadata("recorder-pointer"))?.value;
  }

  async putEncryptedMedia(bundle: EncryptedFieldMediaBundle): Promise<void> {
    assertMediaBundle(bundle);
    await this.withTransaction(
      [mediaManifestStore, mediaChunkStore],
      "readwrite",
      async (transaction) => putMediaBundle(transaction, bundle),
    );
  }

  async getEncryptedMedia(opaqueMediaKey: string): Promise<EncryptedFieldMediaBundle | undefined> {
    if (!/^field_media_[A-Za-z0-9_-]{16,}$/u.test(opaqueMediaKey)) {
      throw new FieldSecurityError("field_media_integrity_failed");
    }
    return this.withTransaction(
      [mediaManifestStore, mediaChunkStore],
      "readonly",
      async (transaction) => {
        const manifest = await requestResult<FieldEncryptedMediaManifest | undefined>(
          transaction.objectStore(mediaManifestStore).get(opaqueMediaKey),
        );
        if (!manifest) return undefined;
        const index = transaction.objectStore(mediaChunkStore).index("opaqueMediaKey");
        const chunks = await requestResult<FieldEncryptedMediaChunk[]>(
          index.getAll(IDBKeyRange.only(opaqueMediaKey)),
        );
        const bundle = { chunks: chunks.sort((left, right) => left.index - right.index), manifest };
        assertMediaBundle(bundle);
        return bundle;
      },
    );
  }

  async hasDeviceKeys(): Promise<boolean> {
    return this.withTransaction([deviceKeyStore], "readonly", async (transaction) => {
      const store = transaction.objectStore(deviceKeyStore);
      const [agreement, signing] = await Promise.all([
        requestResult(store.getKey("agreement-private")),
        requestResult(store.getKey("signing-private")),
      ]);
      return agreement !== undefined && signing !== undefined;
    });
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

export async function estimateFieldStorage(): Promise<{
  availableBytes: number;
  quotaBytes: number;
  usageBytes: number;
}> {
  if (!navigator.storage?.estimate) {
    return { availableBytes: 0, quotaBytes: 0, usageBytes: 0 };
  }
  const estimate = await navigator.storage
    .estimate()
    .catch((): StorageEstimate => ({ quota: 0, usage: 0 }));
  const quotaBytes = estimate.quota ?? 0;
  const usageBytes = estimate.usage ?? 0;
  return {
    availableBytes: Math.max(0, quotaBytes - usageBytes),
    quotaBytes,
    usageBytes,
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
        [mediaManifestStore, "opaqueMediaKey"],
        [deskArchiveStore, "archiveId"],
        [restoreQuarantineStore, "quarantineId"],
        [transferStateStore, "transferId"],
      ] as const) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store, { keyPath });
        }
      }
      if (!request.result.objectStoreNames.contains(mediaChunkStore)) {
        const chunks = request.result.createObjectStore(mediaChunkStore, { keyPath: "chunkKey" });
        chunks.createIndex("opaqueMediaKey", "opaqueMediaKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function iterateObjectStore<T>(storeName: string): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let finished = false;
      let lastKey: IDBValidKey | undefined;
      return {
        async next(): Promise<IteratorResult<T>> {
          if (finished) return { done: true, value: undefined };
          const database = await openFieldVaultDatabase();
          try {
            const transaction = database.transaction(storeName, "readonly");
            const range = lastKey === undefined ? undefined : IDBKeyRange.lowerBound(lastKey, true);
            const cursor = await requestResult<IDBCursorWithValue | null>(
              transaction.objectStore(storeName).openCursor(range),
            );
            if (!cursor) {
              finished = true;
              return { done: true, value: undefined };
            }
            lastKey = cursor.key;
            return { done: false, value: cursor.value as T };
          } catch (error) {
            finished = true;
            throw error instanceof FieldSecurityError
              ? error
              : new FieldSecurityError("field_storage_unavailable");
          } finally {
            database.close();
          }
        },
        async return(): Promise<IteratorResult<T>> {
          finished = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function assertRecorderRevision(input: {
  envelope: FieldEncryptedEnvelope;
  expectedPreviousRevision: number;
  media?: readonly EncryptedFieldMediaBundle[];
  pointer: Omit<FieldRecorderPointer, "version">;
  writerLease?: {
    nowMs: number;
    visitReference: string;
    writerInstanceId: string;
  };
}): void {
  if (
    input.pointer.opaqueRecordKey !== input.envelope.opaqueRecordKey ||
    !Number.isSafeInteger(input.expectedPreviousRevision) ||
    input.expectedPreviousRevision < 0 ||
    !Number.isSafeInteger(input.pointer.revision) ||
    input.pointer.revision !== input.expectedPreviousRevision + 1 ||
    !Number.isFinite(Date.parse(input.pointer.updatedAt))
  ) {
    throw new FieldSecurityError("field_recorder_revision_conflict");
  }
  if (
    input.writerLease &&
    (!/^visit_ref_[A-Za-z0-9_-]{16,}$/u.test(input.writerLease.visitReference) ||
      input.writerLease.writerInstanceId.length < 1 ||
      !Number.isFinite(input.writerLease.nowMs))
  ) {
    throw new FieldSecurityError("field_writer_conflict");
  }
  for (const bundle of input.media ?? []) assertMediaBundle(bundle);
}

function assertMediaBundle(bundle: EncryptedFieldMediaBundle): void {
  const { manifest } = bundle;
  if (
    !/^field_media_[A-Za-z0-9_-]{16,}$/u.test(manifest.opaqueMediaKey) ||
    manifest.chunkCount < 1 ||
    manifest.chunkCount !== bundle.chunks.length
  ) {
    throw new FieldSecurityError("field_media_integrity_failed");
  }
  const indexes = new Set<number>();
  for (const chunk of bundle.chunks) {
    if (
      chunk.opaqueMediaKey !== manifest.opaqueMediaKey ||
      chunk.index < 0 ||
      chunk.index >= manifest.chunkCount ||
      chunk.chunkKey !== `${manifest.opaqueMediaKey}:${chunk.index}` ||
      indexes.has(chunk.index)
    ) {
      throw new FieldSecurityError("field_media_integrity_failed");
    }
    indexes.add(chunk.index);
  }
}

function putMediaBundle(transaction: IDBTransaction, bundle: EncryptedFieldMediaBundle): void {
  assertMediaBundle(bundle);
  transaction.objectStore(mediaManifestStore).put(bundle.manifest);
  const chunks = transaction.objectStore(mediaChunkStore);
  for (const chunk of bundle.chunks) chunks.put(chunk);
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

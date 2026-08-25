import { decryptFieldValue, encryptFieldValue } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import type { EncryptedFieldMediaPreparation } from "@/features/field-security/media";
import { estimateFieldStorage, IndexedDbFieldVault } from "@/features/field-security/vault";

import type { RecorderWork } from "./field-recorder-types";

export type RecorderWriterFence = Readonly<{
  visitReference: string;
  writerInstanceId: string;
  nowMs: number;
}>;

export class FieldRecorderRepository {
  readonly #applicationVersion: string;
  readonly #vault: IndexedDbFieldVault;

  constructor(input: { applicationVersion: string; vault?: IndexedDbFieldVault }) {
    this.#applicationVersion = input.applicationVersion;
    this.#vault = input.vault ?? new IndexedDbFieldVault();
  }

  async initialize(input: { key: Uint8Array; work: RecorderWork }): Promise<void> {
    const existing = await this.#vault.getRecorderPointer();
    if (existing) throw new FieldSecurityError("field_recorder_revision_conflict");
    const envelope = encryptFieldValue({
      applicationVersion: this.#applicationVersion,
      key: input.key,
      value: input.work,
    });
    await this.#vault.putRecorderRevision({
      envelope,
      expectedPreviousRevision: 0,
      pointer: {
        opaqueRecordKey: envelope.opaqueRecordKey,
        revision: input.work.revision,
        updatedAt: input.work.updatedAt,
      },
    });
  }

  async load(key: Uint8Array): Promise<RecorderWork | undefined> {
    const pointer = await this.#vault.getRecorderPointer();
    if (!pointer) return undefined;
    const envelope = await this.#vault.getEnvelope(pointer.opaqueRecordKey);
    if (!envelope) throw new FieldSecurityError("field_recorder_resume_invalid");
    const work = decryptFieldValue<RecorderWork>(envelope, key);
    if (
      work.schemaVersion !== "field-recorder-work.v1" ||
      work.revision !== pointer.revision ||
      work.updatedAt !== pointer.updatedAt ||
      work.planContentHash !== work.planSnapshot.contentHash ||
      work.protocolPackageId !== work.planSnapshot.protocol.packageId ||
      work.protocolPackageVersion !== work.planSnapshot.protocol.packageVersion
    ) {
      throw new FieldSecurityError("field_recorder_resume_invalid");
    }
    return work;
  }

  async save(input: {
    key: Uint8Array;
    work: RecorderWork;
    expectedPreviousRevision: number;
    writerFence?: RecorderWriterFence;
    media?: readonly EncryptedFieldMediaPreparation[];
  }): Promise<{ availableBytes: number; savedAt: string }> {
    if (input.work.revision !== input.expectedPreviousRevision + 1) {
      throw new FieldSecurityError("field_recorder_revision_conflict");
    }
    const pointer = await this.#vault.getRecorderPointer();
    if (!pointer || pointer.revision !== input.expectedPreviousRevision) {
      throw new FieldSecurityError("field_recorder_revision_conflict");
    }
    const before = await estimateFieldStorage();
    const mediaBytes = (input.media ?? []).reduce(
      (total, bundle) => total + bundle.confirmation.plaintextBytes,
      0,
    );
    if (before.availableBytes <= mediaBytes + 1024 * 1024) {
      throw new FieldSecurityError("field_storage_unavailable");
    }
    const envelope = encryptFieldValue({
      applicationVersion: this.#applicationVersion,
      key: input.key,
      opaqueRecordKey: pointer.opaqueRecordKey,
      value: input.work,
    });
    await this.#vault.putRecorderRevision({
      envelope,
      expectedPreviousRevision: input.expectedPreviousRevision,
      media: input.media,
      pointer: {
        opaqueRecordKey: pointer.opaqueRecordKey,
        revision: input.work.revision,
        updatedAt: input.work.updatedAt,
      },
      writerLease: input.writerFence,
    });
    const after = await estimateFieldStorage();
    return { availableBytes: after.availableBytes, savedAt: input.work.updatedAt };
  }
}

import { decryptFieldValue, encryptFieldValue } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import {
  FIELD_DESK_ARCHIVE_VERSION,
  type FieldDeskArchiveHeader,
  fieldDeskArchiveHeaderSchema,
} from "./desk-schemas";
import { createFieldDeskWork } from "./field-desk-state";
import type { FieldDeskWork } from "./field-desk-types";

export type ClosedRecorderValidator = (work: FieldDeskWork["recorderWork"]) => Promise<void>;

export class FieldDeskRepository {
  constructor(
    private readonly applicationVersion: string,
    private readonly vault = new IndexedDbFieldVault(),
  ) {}

  async handoffClosedRecorder(input: {
    archiveId: string;
    handedOffAt: string;
    key: Uint8Array;
    validate: ClosedRecorderValidator;
  }): Promise<{ status: "already_archived" | "archived"; work: FieldDeskWork }> {
    const existing = await this.vault.getDeskArchive(input.archiveId);
    if (existing) {
      const work = await this.load(input.archiveId, input.key);
      return { status: "already_archived", work };
    }
    const pointer = await this.vault.getRecorderPointer();
    if (!pointer) throw new FieldSecurityError("field_recorder_resume_invalid");
    const recorderEnvelope = await this.vault.getEnvelope(pointer.opaqueRecordKey);
    if (!recorderEnvelope) throw new FieldSecurityError("field_recorder_resume_invalid");
    const recorderWork = decryptFieldValue<FieldDeskWork["recorderWork"]>(
      recorderEnvelope,
      input.key,
    );
    if (!recorderWork.fieldDayClose) throw new FieldSecurityError("field_recorder_resume_invalid");
    await input.validate(recorderWork);
    const work = await createFieldDeskWork({
      archiveId: input.archiveId,
      handedOffAt: input.handedOffAt,
      recorderWork,
    });
    const deskEnvelope = encryptFieldValue({
      applicationVersion: this.applicationVersion,
      key: input.key,
      value: work,
    });
    const header = fieldDeskArchiveHeaderSchema.parse({
      schemaVersion: FIELD_DESK_ARCHIVE_VERSION,
      archiveId: input.archiveId,
      recorderWorkId: recorderWork.id,
      recorderOpaqueRecordKey: pointer.opaqueRecordKey,
      sourceRecorderSha256: work.sourceRecorderSha256,
      handedOffAt: input.handedOffAt,
      protocolPackageId: recorderWork.protocolPackageId,
      protocolPackageVersion: recorderWork.protocolPackageVersion,
      latestRevision: 1,
      latestEnvelopeKey: deskEnvelope.opaqueRecordKey,
    });
    const result = await this.vault.archiveClosedRecorder({
      deskEnvelope,
      header,
      recorderPointer: pointer,
    });
    return { status: result.status, work };
  }

  async load(archiveId: string, key: Uint8Array): Promise<FieldDeskWork> {
    const header = await this.vault.getDeskArchive(archiveId);
    if (!header) throw new FieldSecurityError("field_recorder_resume_invalid");
    const envelope = await this.vault.getEnvelope(header.latestEnvelopeKey);
    if (!envelope) throw new FieldSecurityError("field_recorder_resume_invalid");
    const work = decryptFieldValue<FieldDeskWork>(envelope, key);
    if (
      work.archiveId !== header.archiveId ||
      work.revision !== header.latestRevision ||
      work.sourceRecorderSha256 !== header.sourceRecorderSha256
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    return work;
  }

  async list(key: Uint8Array): Promise<readonly FieldDeskWork[]> {
    const works: FieldDeskWork[] = [];
    for await (const header of this.vault.iterateDeskArchives()) {
      works.push(await this.load(header.archiveId, key));
    }
    return works.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async save(input: {
    key: Uint8Array;
    previous: FieldDeskWork;
    work: FieldDeskWork;
  }): Promise<FieldDeskArchiveHeader> {
    if (
      input.work.archiveId !== input.previous.archiveId ||
      input.work.sourceRecorderSha256 !== input.previous.sourceRecorderSha256 ||
      input.work.revision !== input.previous.revision + 1
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    const current = await this.vault.getDeskArchive(input.work.archiveId);
    if (!current) throw new FieldSecurityError("field_recorder_resume_invalid");
    const envelope = encryptFieldValue({
      applicationVersion: this.applicationVersion,
      key: input.key,
      value: input.work,
    });
    const header = fieldDeskArchiveHeaderSchema.parse({
      ...current,
      latestEnvelopeKey: envelope.opaqueRecordKey,
      latestRevision: input.work.revision,
    });
    await this.vault.updateDeskArchive({
      envelope,
      expectedRevision: input.previous.revision,
      header,
    });
    return header;
  }
}

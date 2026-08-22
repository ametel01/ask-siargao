import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { decryptFieldValue, encryptFieldValue } from "@/features/field-security/crypto";
import { encodeBase64Url, fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import {
  IndexedDbFieldVault,
  type LegacyCaptureVaultHeader,
} from "@/features/field-security/vault";
import {
  type DiscoveredLegacyFieldRecord,
  discoverLegacyFieldRecords,
} from "./field-ingestion-store";
import { createLegacyCapturePreview, type LegacyCapturePreview } from "./legacy-field-capture";

const applicationVersion = "0.1.0";

export type LegacyCaptureDecision = Readonly<{
  schemaVersion: "legacy-capture-decision.v1";
  decisionId: string;
  sourceId: string;
  previewSha256: string;
  destinationStateSha256: string;
  disposition: "preserve_quarantined" | "defer_resolution";
  decidedAt: string;
  rationale: string;
  supersedesDecisionId?: string;
}>;

export class LegacyCaptureRepository {
  constructor(private readonly vault = new IndexedDbFieldVault()) {}

  async preserveSource(input: {
    bytes: Uint8Array;
    importedAt: string;
    key: Uint8Array;
    sourceName: string;
  }): Promise<{ preview: LegacyCapturePreview; result: "exact_replay" | "preserved" }> {
    const sourceSha256 = await sha256Hex(input.bytes);
    const sourceId = `legacy_source_${sourceSha256}`;
    const existing = await this.vault.getLegacyCaptureHeader(sourceId);
    if (existing) {
      const envelope = await this.vault.getEnvelope(existing.previewEnvelopeKey);
      if (!envelope) throw new FieldSecurityError("field_artifact_invalid");
      return {
        preview: decryptFieldValue<LegacyCapturePreview>(envelope, input.key),
        result: "exact_replay",
      };
    }
    const preview = await createLegacyCapturePreview({
      bytes: input.bytes,
      destination: await this.destinationVariants(input.key),
      importedAt: input.importedAt,
      sourceName: input.sourceName,
    });
    const sourceEnvelopeKey = `legacy_bytes_${sourceSha256}`;
    // A deterministic preview can be shared by byte-distinct sources (for example,
    // reordered JSONL). Keep its encrypted envelope source-specific so each immutable
    // source lineage can be committed without colliding with another source's custody.
    const previewEnvelopeKey = `legacy_preview_${preview.source.sha256}`;
    const header: LegacyCaptureVaultHeader = {
      decisionEnvelopeKeys: [],
      importedAt: input.importedAt,
      originalBytesAvailable: true,
      previewEnvelopeKey,
      previewSha256: preview.previewSha256,
      recordCount: preview.records.length,
      sourceEnvelopeKey,
      sourceId,
      sourceSha256,
      state: preview.state,
      version: 1,
    };
    const result = await this.vault.putLegacyCaptureCustody({
      header,
      previewEnvelope: encryptFieldValue({
        applicationVersion,
        key: input.key,
        opaqueRecordKey: previewEnvelopeKey,
        value: preview,
      }),
      sourceEnvelope: encryptFieldValue({
        applicationVersion,
        key: input.key,
        opaqueRecordKey: sourceEnvelopeKey,
        value: {
          schemaVersion: "legacy-capture-source.v1",
          originalFilename: input.sourceName,
          importedAt: input.importedAt,
          sha256: sourceSha256,
          bytes: encodeBase64Url(input.bytes),
        },
      }),
    });
    if (preview.sameIdConflicts.length > 0) {
      await this.vault.markLegacyCaptureConflicts(
        await this.sourceIdsContaining(preview.sameIdConflicts, input.key),
      );
    }
    return { preview, result };
  }

  async recordDecision(input: {
    decidedAt: string;
    disposition: LegacyCaptureDecision["disposition"];
    expectedDestinationStateSha256: string;
    expectedPreviewSha256: string;
    key: Uint8Array;
    rationale: string;
    sourceId: string;
    supersedesDecisionId?: string;
  }): Promise<LegacyCaptureDecision> {
    const header = await this.vault.getLegacyCaptureHeader(input.sourceId);
    if (!header || header.previewSha256 !== input.expectedPreviewSha256) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    const previewEnvelope = await this.vault.getEnvelope(header.previewEnvelopeKey);
    if (!previewEnvelope) throw new FieldSecurityError("field_artifact_invalid");
    const preview = decryptFieldValue<LegacyCapturePreview>(previewEnvelope, input.key);
    const destinationStateSha256 = await this.destinationStateSha256(input.key, input.sourceId);
    if (
      preview.destinationStateSha256 !== input.expectedDestinationStateSha256 ||
      destinationStateSha256 !== input.expectedDestinationStateSha256
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    const decisionId = `legacy_decision_${(
      await sha256Hex(
        fieldTextEncoder.encode(
          canonicalStringify({
            decidedAt: input.decidedAt,
            disposition: input.disposition,
            previewSha256: input.expectedPreviewSha256,
            rationale: input.rationale,
            sourceId: input.sourceId,
            ...(input.supersedesDecisionId
              ? { supersedesDecisionId: input.supersedesDecisionId }
              : {}),
          }),
        ),
      )
    ).slice(0, 32)}`;
    const decision: LegacyCaptureDecision = {
      schemaVersion: "legacy-capture-decision.v1",
      decisionId,
      sourceId: input.sourceId,
      previewSha256: input.expectedPreviewSha256,
      destinationStateSha256,
      disposition: input.disposition,
      decidedAt: input.decidedAt,
      rationale: input.rationale,
      ...(input.supersedesDecisionId ? { supersedesDecisionId: input.supersedesDecisionId } : {}),
    };
    await this.vault.appendLegacyCaptureDecision({
      decisionEnvelope: encryptFieldValue({
        applicationVersion,
        key: input.key,
        opaqueRecordKey: decisionId,
        value: decision,
      }),
      expectedPreviewSha256: input.expectedPreviewSha256,
      sourceId: input.sourceId,
    });
    return decision;
  }

  async discoverOldBrowserCustody(input: {
    importedAt: string;
    key: Uint8Array;
  }): Promise<readonly { lineage: "original_bytes_unavailable"; sourceId: string }[]> {
    const records = await discoverLegacyFieldRecords();
    const results = [];
    for (const record of records) {
      results.push(await this.preserveDiscoveredRecord(record, input));
    }
    return results;
  }

  private async preserveDiscoveredRecord(
    record: DiscoveredLegacyFieldRecord,
    input: { importedAt: string; key: Uint8Array },
  ): Promise<{ lineage: "original_bytes_unavailable"; sourceId: string }> {
    const sourceSha256 = await sha256Hex(
      fieldTextEncoder.encode(
        canonicalStringify({
          importedAt: record.importedAt,
          signature: record.signature,
          sourceName: record.sourceName,
          storageKey: record.storageKey,
        }),
      ),
    );
    const sourceId = `legacy_discovered_${sourceSha256}`;
    if (await this.vault.getLegacyCaptureHeader(sourceId)) {
      return { lineage: "original_bytes_unavailable", sourceId };
    }
    const synthesizedBytes = fieldTextEncoder.encode(canonicalStringify(record.record));
    const preview = await createLegacyCapturePreview({
      bytes: synthesizedBytes,
      destination: await this.destinationVariants(input.key),
      importedAt: record.importedAt || input.importedAt,
      sourceName: record.sourceName,
    });
    const sourceEnvelopeKey = `legacy_lineage_${sourceSha256}`;
    const previewEnvelopeKey = `legacy_discovered_preview_${sourceSha256}`;
    await this.vault.putLegacyCaptureCustody({
      header: {
        decisionEnvelopeKeys: [],
        importedAt: record.importedAt || input.importedAt,
        originalBytesAvailable: false,
        previewEnvelopeKey,
        previewSha256: preview.previewSha256,
        recordCount: 1,
        sourceEnvelopeKey,
        sourceId,
        sourceSha256,
        state: preview.state,
        version: 1,
      },
      previewEnvelope: encryptFieldValue({
        applicationVersion,
        key: input.key,
        opaqueRecordKey: previewEnvelopeKey,
        value: preview,
      }),
      sourceEnvelope: encryptFieldValue({
        applicationVersion,
        key: input.key,
        opaqueRecordKey: sourceEnvelopeKey,
        value: {
          schemaVersion: "legacy-capture-missing-source.v1",
          sourceName: record.sourceName,
          importedAt: record.importedAt,
          canonicalSignature: record.signature,
          lineage: "original_bytes_unavailable",
        },
      }),
    });
    return { lineage: "original_bytes_unavailable", sourceId };
  }

  private async destinationVariants(
    key: Uint8Array,
    excludeSourceId?: string,
  ): Promise<Map<string, Set<string>>> {
    const destination = new Map<string, Set<string>>();
    const headers = (await this.vault.listLegacyCaptureHeaders()).filter(
      (header) => header.sourceId !== excludeSourceId,
    );
    const envelopes = await Promise.all(
      headers.map((header) => this.vault.getEnvelope(header.previewEnvelopeKey)),
    );
    for (const envelope of envelopes) {
      if (!envelope) throw new FieldSecurityError("field_artifact_invalid");
      const preview = decryptFieldValue<LegacyCapturePreview>(envelope, key);
      for (const record of preview.records) {
        const hashes = destination.get(record.recordId) ?? new Set<string>();
        hashes.add(record.originalSha256);
        destination.set(record.recordId, hashes);
      }
    }
    return destination;
  }

  private async sourceIdsContaining(
    recordIds: readonly string[],
    key: Uint8Array,
  ): Promise<string[]> {
    const wanted = new Set(recordIds);
    const sourceIds: string[] = [];
    const headers = await this.vault.listLegacyCaptureHeaders();
    const envelopes = await Promise.all(
      headers.map((header) => this.vault.getEnvelope(header.previewEnvelopeKey)),
    );
    for (const [index, header] of headers.entries()) {
      const envelope = envelopes[index];
      if (!envelope) throw new FieldSecurityError("field_artifact_invalid");
      const preview = decryptFieldValue<LegacyCapturePreview>(envelope, key);
      if (preview.records.some((record) => wanted.has(record.recordId))) {
        sourceIds.push(header.sourceId);
      }
    }
    return sourceIds;
  }

  private async destinationStateSha256(key: Uint8Array, excludeSourceId?: string): Promise<string> {
    const destination = await this.destinationVariants(key, excludeSourceId);
    return sha256Hex(
      fieldTextEncoder.encode(
        canonicalStringify(
          [...destination.entries()]
            .map(([id, hashes]) => [id, [...hashes].toSorted()] as const)
            .toSorted(([left], [right]) => left.localeCompare(right)),
        ),
      ),
    );
  }
}

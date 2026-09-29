import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey, encryptFieldValue } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import { legacyOpeningObservation, legacyVisit } from "./fixtures/legacy-capture-corpus";
import { LegacyCaptureRepository } from "./legacy-capture-repository";

const importedAt = "2026-08-23T08:00:00+08:00";

beforeEach(async () => {
  for (const name of ["ask-siargao-protected-field-vault", "ask-siargao-field-ingestion"]) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
});

describe("encrypted Legacy Capture custody", () => {
  test("preserves exact source bytes and preview once, encrypted and append-only", async () => {
    const key = createFieldVaultKey();
    const repository = new LegacyCaptureRepository();
    const bytes = new TextEncoder().encode(
      JSON.stringify([legacyVisit, { ...legacyOpeningObservation, privateNote: "secret lagoon" }]),
    );
    const first = await repository.preserveSource({
      bytes,
      importedAt,
      key,
      sourceName: "private-research.json",
    });
    const replay = await repository.preserveSource({
      bytes,
      importedAt: "2026-08-23T09:00:00+08:00",
      key,
      sourceName: "renamed.json",
    });

    expect(first.result).toBe("preserved");
    expect(replay.result).toBe("exact_replay");
    expect(replay.preview.previewSha256).toBe(first.preview.previewSha256);
    const vault = new IndexedDbFieldVault();
    expect(await vault.listLegacyCaptureHeaders()).toHaveLength(1);
    const serialized = JSON.stringify(await vault.listEnvelopes());
    expect(serialized).not.toContain("secret lagoon");
    expect(serialized).not.toContain("private-research.json");
  });

  test("preserves byte-distinct source lineage when the deterministic corpus is identical", async () => {
    const key = createFieldVaultKey();
    const repository = new LegacyCaptureRepository();
    const first = await repository.preserveSource({
      bytes: new TextEncoder().encode(
        `${JSON.stringify(legacyVisit)}\n${JSON.stringify(legacyOpeningObservation)}`,
      ),
      importedAt,
      key,
      sourceName: "ordered.jsonl",
    });
    const reordered = await repository.preserveSource({
      bytes: new TextEncoder().encode(
        `${JSON.stringify(legacyOpeningObservation)}\n${JSON.stringify(legacyVisit)}`,
      ),
      importedAt,
      key,
      sourceName: "reordered.jsonl",
    });

    expect(reordered.preview.source.canonicalCorpusSha256).toBe(
      first.preview.source.canonicalCorpusSha256,
    );
    expect(reordered.preview.exactReplays).toHaveLength(2);
    const headers = await new IndexedDbFieldVault().listLegacyCaptureHeaders();
    expect(headers).toHaveLength(2);
    expect(new Set(headers.map((header) => header.previewEnvelopeKey)).size).toBe(2);
  });

  test("keeps same-ID variants quarantined across repository reopen", async () => {
    const key = createFieldVaultKey();
    const firstRepository = new LegacyCaptureRepository();
    await firstRepository.preserveSource({
      bytes: new TextEncoder().encode(JSON.stringify([legacyVisit, legacyOpeningObservation])),
      importedAt,
      key,
      sourceName: "first.json",
    });
    const changed = { ...legacyOpeningObservation, value: { state: "closed" } };
    const second = await new LegacyCaptureRepository().preserveSource({
      bytes: new TextEncoder().encode(JSON.stringify([legacyVisit, changed])),
      importedAt,
      key,
      sourceName: "variant.json",
    });

    expect(second.preview.sameIdConflicts).toContain(legacyOpeningObservation.id);
    expect(second.preview.state).toBe("quarantined_conflict");
    expect(
      (await new IndexedDbFieldVault().listLegacyCaptureHeaders()).map((row) => row.state),
    ).toEqual(["quarantined_conflict", "quarantined_conflict"]);
  });

  test("rejects stale preview confirmation after protected destination changes", async () => {
    const key = createFieldVaultKey();
    const repository = new LegacyCaptureRepository();
    const first = await repository.preserveSource({
      bytes: new TextEncoder().encode(JSON.stringify([legacyVisit, legacyOpeningObservation])),
      importedAt,
      key,
      sourceName: "first.json",
    });
    await repository.preserveSource({
      bytes: new TextEncoder().encode(
        JSON.stringify([{ ...legacyVisit, id: "0192f060-4f41-7aa1-b322-4aa9fc9f1555" }]),
      ),
      importedAt,
      key,
      sourceName: "destination-change.json",
    });

    await expect(
      repository.recordDecision({
        decidedAt: importedAt,
        disposition: "preserve_quarantined",
        expectedDestinationStateSha256: first.preview.destinationStateSha256,
        expectedPreviewSha256: first.preview.previewSha256,
        key,
        rationale: "Keep quarantined.",
        sourceId: `legacy_source_${first.preview.source.sha256}`,
      }),
    ).rejects.toEqual(new FieldSecurityError("field_artifact_invalid"));
  });

  test("records append-only decisions without changing quarantine state", async () => {
    const key = createFieldVaultKey();
    const repository = new LegacyCaptureRepository();
    const result = await repository.preserveSource({
      bytes: new TextEncoder().encode(JSON.stringify([legacyVisit, legacyOpeningObservation])),
      importedAt,
      key,
      sourceName: "decision.json",
    });
    const sourceId = `legacy_source_${result.preview.source.sha256}`;
    await repository.recordDecision({
      decidedAt: importedAt,
      disposition: "preserve_quarantined",
      expectedDestinationStateSha256: result.preview.destinationStateSha256,
      expectedPreviewSha256: result.preview.previewSha256,
      key,
      rationale: "Keep outside current custody.",
      sourceId,
    });
    const header = await new IndexedDbFieldVault().getLegacyCaptureHeader(sourceId);
    expect(header?.decisionEnvelopeKeys).toHaveLength(1);
    expect(header?.state).toBe("needs_resolution");
  });

  test("discovers old IndexedDB rows read-only and records unavailable original-byte lineage", async () => {
    await seedHistoricalDatabase();
    const databaseBefore = await openHistoricalDatabase();
    const countBefore = await countRows(databaseBefore);
    databaseBefore.close();

    const result = await new LegacyCaptureRepository().discoverOldBrowserCustody({
      importedAt,
      key: createFieldVaultKey(),
    });

    expect(result).toEqual([expect.objectContaining({ lineage: "original_bytes_unavailable" })]);
    const headers = await new IndexedDbFieldVault().listLegacyCaptureHeaders();
    expect(headers).toHaveLength(1);
    expect(headers[0]?.originalBytesAvailable).toBe(false);
    const databaseAfter = await openHistoricalDatabase();
    expect(await countRows(databaseAfter)).toBe(countBefore);
    databaseAfter.close();
  });

  test("restores legacy indexes atomically with opaque recovery envelopes", async () => {
    const vault = new IndexedDbFieldVault();
    const key = createFieldVaultKey();
    const envelope = encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      opaqueRecordKey: "legacy_bytes_restore",
      value: { secret: "restored legacy source" },
    });
    const previewEnvelope = encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      opaqueRecordKey: "legacy_preview_restore",
      value: { preview: "quarantined" },
    });
    const audit = encryptFieldValue({
      applicationVersion: "0.1.0",
      key,
      value: { operation: "restore" },
    });
    await vault.commitRestore({
      additions: [envelope, previewEnvelope],
      auditEnvelope: audit,
      legacyCaptureHeaders: [
        {
          decisionEnvelopeKeys: [],
          importedAt,
          originalBytesAvailable: true,
          previewEnvelopeKey: previewEnvelope.opaqueRecordKey,
          previewSha256: "b".repeat(64),
          recordCount: 2,
          sourceEnvelopeKey: envelope.opaqueRecordKey,
          sourceId: `legacy_source_${"a".repeat(64)}`,
          sourceSha256: "a".repeat(64),
          state: "quarantined_conflict",
          version: 1,
        },
      ],
      quarantines: [],
    });
    expect(await vault.listLegacyCaptureHeaders()).toEqual([
      expect.objectContaining({ state: "quarantined_conflict" }),
    ]);
  });
});

async function seedHistoricalDatabase() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ask-siargao-field-ingestion", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("field-records", { keyPath: "storageKey" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("field-records", "readwrite");
    transaction.objectStore("field-records").put({
      importedAt,
      record: legacyVisit,
      signature: JSON.stringify(legacyVisit),
      sourceName: "lost-original.json",
      storageKey: "legacy-row-1",
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function openHistoricalDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ask-siargao-field-ingestion");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function countRows(database: IDBDatabase) {
  return new Promise<number>((resolve, reject) => {
    const request = database
      .transaction("field-records", "readonly")
      .objectStore("field-records")
      .count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

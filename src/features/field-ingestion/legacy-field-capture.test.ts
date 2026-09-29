import { describe, expect, test } from "bun:test";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import {
  legacyAdversarialCorpus,
  legacyClientBatchId,
  legacyConnectivityObservation,
  legacyOpeningObservation,
  legacyVisit,
} from "./fixtures/legacy-capture-corpus";
import {
  createLegacyCapturePreview,
  LegacyCaptureRecognitionError,
  recognizeLegacyCaptureArtifact,
} from "./legacy-field-capture";

const importedAt = "2026-08-23T08:00:00+08:00";

describe("Legacy Capture recognition and Protocol Migration preview", () => {
  test("recognizes only exact historical record transports", async () => {
    for (const [name, value, kind] of [
      ["record.json", legacyVisit, "record"],
      ["records.json", [legacyVisit, legacyOpeningObservation], "record_array"],
    ] as const) {
      const recognized = await recognizeLegacyCaptureArtifact(
        name,
        fieldTextEncoder.encode(JSON.stringify(value)),
      );
      expect(recognized.artifactKind).toBe(kind);
      expect(recognized.records.length).toBe(Array.isArray(value) ? value.length : 1);
    }
    const jsonl = `${JSON.stringify(legacyVisit)}\n${JSON.stringify(legacyOpeningObservation)}\n`;
    expect(
      (await recognizeLegacyCaptureArtifact("records.jsonl", fieldTextEncoder.encode(jsonl)))
        .artifactKind,
    ).toBe("jsonl");
  });

  test("validates the exact embedded field-batch.v1 identity, counts, and canonical hash", async () => {
    const records = [legacyVisit, legacyOpeningObservation];
    const envelope = {
      schemaVersion: "field-batch.v1",
      clientBatchId: legacyClientBatchId,
      campaignSlug: "island-baseline-2026",
      createdAt: importedAt,
      localTimezone: "Asia/Manila",
      recordCounts: { visit: 1, observation: 1, statement: 0, routeRun: 0, asset: 0 },
      payloadSha256: await sha256Hex(fieldTextEncoder.encode(canonicalStringify(records))),
      records,
    };
    const recognized = await recognizeLegacyCaptureArtifact(
      "legacy-batch.json",
      fieldTextEncoder.encode(JSON.stringify(envelope)),
    );
    expect(recognized.artifactKind).toBe("embedded_batch");

    for (const tampered of [
      { ...envelope, payloadSha256: "0".repeat(64) },
      { ...envelope, recordCounts: { ...envelope.recordCounts, observation: 2 } },
      { ...envelope, clientBatchId: "0192f060-4f41-7aa1-b322-4aa9fc9f1599" },
    ]) {
      await expect(
        recognizeLegacyCaptureArtifact(
          "legacy-batch.json",
          fieldTextEncoder.encode(JSON.stringify(tampered)),
        ),
      ).rejects.toBeInstanceOf(LegacyCaptureRecognitionError);
    }
  });

  test("rejects missing, mixed, unknown, current, and generic envelope versions", async () => {
    const cases = [
      { ...legacyVisit, schemaVersion: undefined },
      { ...legacyVisit, schemaVersion: "field-record.v2" },
      [legacyVisit, { ...legacyOpeningObservation, schemaVersion: "field-record.v2" }],
      { schemaVersion: "field-batch.v2", records: [legacyVisit] },
      { records: [legacyVisit] },
    ];
    for (const [index, value] of cases.entries()) {
      await expect(
        recognizeLegacyCaptureArtifact(
          `unsupported-${index}.json`,
          fieldTextEncoder.encode(JSON.stringify(value)),
        ),
      ).rejects.toBeInstanceOf(LegacyCaptureRecognitionError);
    }
  });

  test("builds a deterministic, non-mutating preview across repeat and input ordering", async () => {
    const records = [legacyVisit, legacyOpeningObservation, legacyConnectivityObservation];
    const original = structuredClone(records);
    const first = await preview(records);
    const repeated = await preview(records);
    const reordered = await preview([...records].reverse());

    expect(records).toEqual(original);
    expect(first.previewSha256).toBe(repeated.previewSha256);
    expect(first.previewSha256).toBe(reordered.previewSha256);
    expect(first.previewId).toBe(reordered.previewId);
    expect(first.records.map((record) => record.originalSha256)).toEqual(
      reordered.records.map((record) => record.originalSha256),
    );
    expect(first.records.find((record) => record.recordType === "observation")?.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceValue: "opening_hours", targetValue: "opening_signal" }),
      ]),
    );
    expect(first.promotion).toBe("quarantined_only");
    expect(canonicalStringify(first)).not.toContain('"ready"');
  });

  test("reports adversarial rights, references, omissions, ambiguity, and Schema Gaps", async () => {
    const result = await preview(legacyAdversarialCorpus);
    const allGaps = result.records.flatMap((record) => record.gaps);

    expect(allGaps.map((gap) => gap.code)).toEqual(
      expect.arrayContaining([
        "permission_escalation",
        "rights_gap",
        "redaction_blocker",
        "reference_gap",
        "passthrough_omission",
        "schema_gap_candidate",
      ]),
    );
    const escalated = result.records.find(
      (record) => record.recordId === "0192f060-4f41-7aa1-b322-4aa9fc9f1529",
    );
    expect(escalated?.status).toBe("needs_resolution");
    expect(escalated?.candidateTargetSha256).toBeUndefined();
    expect(result.records.some((record) => record.status === "rejected")).toBe(true);
    expect(result.records.find((record) => record.recordType === "routeRun")?.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "schema_gap_candidate", path: "routeRun" }),
      ]),
    );
  });

  test("quarantines every same-ID/different-content variant and detects destination conflicts", async () => {
    const changed = { ...legacyOpeningObservation, value: { state: "closed" } };
    const within = await preview([legacyVisit, legacyOpeningObservation, changed]);
    expect(
      within.records
        .filter((record) => record.recordId === legacyOpeningObservation.id)
        .map((record) => record.status),
    ).toEqual(["quarantined_conflict", "quarantined_conflict"]);

    const originalHash = await sha256Hex(
      fieldTextEncoder.encode(canonicalStringify(legacyOpeningObservation)),
    );
    const destination = new Map([[legacyOpeningObservation.id, new Set([originalHash])]]);
    const replay = await createLegacyCapturePreview({
      bytes: fieldTextEncoder.encode(JSON.stringify([legacyVisit, legacyOpeningObservation])),
      destination,
      importedAt,
      sourceName: "replay.json",
    });
    expect(replay.exactReplays).toContain(legacyOpeningObservation.id);

    destination.set(legacyOpeningObservation.id, new Set(["f".repeat(64)]));
    const conflict = await createLegacyCapturePreview({
      bytes: fieldTextEncoder.encode(JSON.stringify([legacyVisit, legacyOpeningObservation])),
      destination,
      importedAt,
      sourceName: "conflict.json",
    });
    expect(conflict.sameIdConflicts).toContain(legacyOpeningObservation.id);
  });
});

function preview(records: readonly unknown[]) {
  return createLegacyCapturePreview({
    bytes: fieldTextEncoder.encode(JSON.stringify(records)),
    destination: new Map(),
    importedAt,
    sourceName: "legacy-corpus.json",
  });
}

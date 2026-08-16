import { describe, expect, test } from "bun:test";

import {
  analyzeFieldRecords,
  createFieldBatchEnvelope,
  createFieldTemplate,
  mergeFieldRecords,
  parseFieldFile,
  toStoredFieldRecord,
} from "@/features/field-ingestion/field-capture";

describe("field capture import", () => {
  test("parses the standard template and infers canonical JSON Lines record types", () => {
    const [visit, observation] = createFieldTemplate(new Date("2026-08-22T01:00:00.000Z"));
    const visitWithoutType = { ...visit, recordType: undefined };
    const observationWithoutType = { ...observation, recordType: undefined };

    const visitResult = parseFieldFile("visits.jsonl", JSON.stringify(visitWithoutType));
    const observationResult = parseFieldFile(
      "observations.jsonl",
      JSON.stringify(observationWithoutType),
    );

    expect(visitResult.issues).toEqual([]);
    expect(visitResult.records[0]?.record.recordType).toBe("visit");
    expect(observationResult.issues).toEqual([]);
    expect(observationResult.records[0]?.record.recordType).toBe("observation");
  });

  test("rejects malformed JSON and missing required observation fields", () => {
    const malformed = parseFieldFile("observations.jsonl", "{not-json}");
    expect(malformed.records).toHaveLength(0);
    expect(malformed.issues[0]?.code).toBe("invalid_json_line");

    const incomplete = parseFieldFile(
      "record.json",
      JSON.stringify({
        schemaVersion: "field-record.v1",
        recordType: "observation",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f15f0",
        clientBatchId: "0192f060-4f41-7aa1-b322-4aa9fc9f15f1",
        campaignSlug: "island-baseline-2026",
        capturedAt: "2026-08-22T09:30:00+08:00",
        localTimezone: "Asia/Manila",
      }),
    );
    expect(incomplete.records).toHaveLength(0);
    expect(incomplete.issues.some((issue) => issue.message.includes("visitId"))).toBe(true);
  });
});

describe("field capture queue analysis", () => {
  test("deduplicates identical retries but preserves conflicting payloads", () => {
    const records = createFieldTemplate(new Date("2026-08-22T01:00:00.000Z"));
    const stored = records.map((record) => toStoredFieldRecord(record, "capture.json"));
    const duplicateMerge = mergeFieldRecords(stored, stored);

    expect(duplicateMerge).toHaveLength(2);

    const changedObservation = {
      ...records[1],
      value: { text: "Different content with the same immutable ID" },
    };
    const conflictMerge = mergeFieldRecords(duplicateMerge, [
      toStoredFieldRecord(changedObservation, "corrected.json"),
    ]);
    const analyzed = analyzeFieldRecords(conflictMerge);
    const conflicts = analyzed.filter((entry) => entry.record.id === changedObservation.id);

    expect(conflicts).toHaveLength(2);
    expect(conflicts.every((entry) => entry.state === "conflict")).toBe(true);
    expect(conflicts[0]?.issues[0]?.code).toBe("id_payload_conflict");
  });

  test("blocks missing visits, capture-time permission escalation, and mixed batches", () => {
    const records = createFieldTemplate(new Date("2026-08-22T01:00:00.000Z"));
    const unsafeObservation = {
      ...records[1],
      visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f15f9",
      clientBatchId: "0192f060-4f41-7aa1-b322-4aa9fc9f15f8",
      llmUseAllowed: true,
    };
    const analyzed = analyzeFieldRecords([
      toStoredFieldRecord(records[0], "visit.json"),
      toStoredFieldRecord(unsafeObservation, "observation.json"),
    ]);
    const observation = analyzed.find((entry) => entry.record.recordType === "observation");
    const codes = observation?.issues.map((issue) => issue.code);

    expect(codes).toContain("mixed_client_batches");
    expect(codes).toContain("missing_visit");
    expect(codes).toContain("capture_permission_escalation");
    expect(observation?.state).toBe("attention");
  });
});

describe("field batch export", () => {
  test("creates a deterministic, hashed envelope only for a ready workspace", async () => {
    const records = createFieldTemplate(new Date("2026-08-22T01:00:00.000Z"));
    const stored = records.map((record) => toStoredFieldRecord(record, "capture.json"));

    const first = await createFieldBatchEnvelope(stored, "2026-08-22T02:00:00.000Z");
    const second = await createFieldBatchEnvelope(
      [...stored].reverse(),
      "2026-08-22T02:00:00.000Z",
    );

    expect(first.schemaVersion).toBe("field-batch.v1");
    expect(first.recordCounts.visit).toBe(1);
    expect(first.recordCounts.observation).toBe(1);
    expect(first.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.payloadSha256).toBe(first.payloadSha256);
    expect(second.records).toEqual(first.records);
  });

  test("refuses to export an empty or blocked workspace", async () => {
    await expect(createFieldBatchEnvelope([])).rejects.toThrow("non-empty workspace");

    const records = createFieldTemplate(new Date("2026-08-22T01:00:00.000Z"));
    const unsafe = { ...records[1], articleUseAllowed: true };
    await expect(
      createFieldBatchEnvelope([
        toStoredFieldRecord(records[0], "visit.json"),
        toStoredFieldRecord(unsafe, "observation.json"),
      ]),
    ).rejects.toThrow("blocking issues");
  });
});

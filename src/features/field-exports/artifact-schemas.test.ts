import { describe, expect, test } from "bun:test";

import { artifactKindForAction } from "./artifact-dispatch";
import { artifactRootManifestSchema, fieldRecoveryOuterReceiptSchema } from "./artifact-schemas";
import { filterMapAsync, requireAuthorizationEnvelopeKey } from "./recovery-export";

describe("distinct artifact contracts", () => {
  test("never dispatches Recovery through Batch verification or Batch through restore", () => {
    expect(
      artifactKindForAction({
        action: "restore_recovery",
        filename: "ask-siargao-field-recovery-abcdef123456.asfrecovery",
      }),
    ).toBe("field_recovery");
    expect(() =>
      artifactKindForAction({
        action: "restore_recovery",
        filename: "ask-siargao-field-batch-abcdef123456.asfbatch",
      }),
    ).toThrow();
  });

  test("rejects Protected Field Data and caller counts from the public Recovery receipt", () => {
    const safe = {
      schemaVersion: "field-recovery-outer-receipt.v1",
      artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1510",
      filename: "ask-siargao-field-recovery-0192f0604f41.asfrecovery",
      formatVersion: "asf-recovery-container.v1",
      createdAtMinute: "2026-08-23T02:10Z",
      encryptedBytes: 100,
      ciphertextSha256: "a".repeat(64),
      encryption: "xchacha20-poly1305",
      keyId: "field-recovery-wrap.v1",
      restoreInstructionsVersion: "1.0.0",
    } as const;
    expect(fieldRecoveryOuterReceiptSchema.parse(safe)).toEqual(safe);
    for (const protectedField of [
      "campaignId",
      "subjectId",
      "recordCount",
      "location",
      "researcherId",
    ]) {
      expect(() =>
        fieldRecoveryOuterReceiptSchema.parse({ ...safe, [protectedField]: "must-not-leak" }),
      ).toThrow();
    }
  });

  test("requires every Recovery authority exclusion exactly once", () => {
    const manifest = {
      schemaVersion: "field-artifact-root-manifest.v1",
      artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1510",
      artifactKind: "field_recovery",
      transferId: "0192f060-4f41-7aa1-b322-4aa9fc9f1511",
      payloadChunkCount: 1,
      plaintextBytes: 1,
      payloadCiphertextBytes: 17,
      payloadCiphertextSha256: "a".repeat(64),
      files: [
        {
          path: "key-recovery.jsonl",
          recordType: "recoveryKeyMaterial",
          recordCount: 1,
          byteSize: 1,
          sha256: "b".repeat(64),
        },
      ],
      authorityExclusions: [
        "device_private_keys",
        "webauthn_credentials",
        "session_authority",
        "offline_field_grants",
      ],
    } as const;
    expect(() => artifactRootManifestSchema.parse(manifest)).not.toThrow();
    expect(() =>
      artifactRootManifestSchema.parse({
        ...manifest,
        authorityExclusions: [
          "device_private_keys",
          "webauthn_credentials",
          "session_authority",
          "session_authority",
        ],
      }),
    ).toThrow();
  });

  test("filters the stored authorization envelope out of Recovery custody", async () => {
    async function* source() {
      yield { opaqueRecordKey: "grant-envelope" };
      yield { opaqueRecordKey: "recorder-envelope" };
    }
    const records: Array<{ opaqueRecordKey: string }> = [];
    for await (const record of filterMapAsync(source(), (value) =>
      value.opaqueRecordKey === "grant-envelope" ? undefined : value,
    )) {
      records.push(record);
    }
    expect(records).toEqual([{ opaqueRecordKey: "recorder-envelope" }]);
    expect(() => requireAuthorizationEnvelopeKey(undefined)).toThrow("field_artifact_invalid");
  });
});

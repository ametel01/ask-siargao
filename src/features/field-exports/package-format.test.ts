import { describe, expect, test } from "bun:test";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import {
  type ActiveRecipientDevice,
  FIELD_BATCH_CONTAINER_VERSION,
  FIELD_RECOVERY_CONTAINER_VERSION,
} from "./artifact-schemas";
import {
  MemoryStagedArtifactSink,
  openCanonicalArtifact,
  packageCanonicalArtifact,
  type StagedArtifactSink,
} from "./package-format";
import { sealContentKeyForRecipient } from "./recipient-envelope";

const artifactId = "0192f060-4f41-7aa1-b322-4aa9fc9f1510";
const transferId = "0192f060-4f41-7aa1-b322-4aa9fc9f1511";

describe("bounded authenticated artifact container", () => {
  test("round-trips fixed-order canonical files and verifies the staged artifact after close", async () => {
    const contentKey = createFieldVaultKey();
    const { recipient } = await recipientFixture();
    const sink = new MemoryStagedArtifactSink();
    const envelope = await sealContentKeyForRecipient({
      artifactKind: "field_recovery",
      contentKey,
      recipient,
      transferId,
    });
    const packaged = await packageCanonicalArtifact({
      authorityExclusions: authorityExclusions(),
      contentKey,
      files: [
        {
          path: "records.jsonl",
          recordType: "testRecord",
          records: [
            { id: "a", nested: { z: 1, a: 2 } },
            { id: "b", nested: { z: 3, a: 4 } },
          ],
        },
      ],
      preamble: {
        containerVersion: FIELD_RECOVERY_CONTAINER_VERSION,
        artifactKind: "field_recovery",
        artifactId,
        transferId,
        createdAt: "2026-08-23T02:00:00.000Z",
        chunkSize: 16 * 1024,
        contentKeyEnvelope: envelope,
      },
      sink,
    });
    const restored: unknown[] = [];
    const opened = await openCanonicalArtifact({
      expectedCiphertextSha256: packaged.ciphertextSha256,
      expectedKind: "field_recovery",
      openContentKey: async () => contentKey.slice(),
      onRecord: ({ value }) => {
        restored.push(value);
      },
      source: sink.reopen(),
    });
    expect(restored).toEqual([
      { id: "a", nested: { a: 2, z: 1 } },
      { id: "b", nested: { a: 4, z: 3 } },
    ]);
    expect(opened.rootManifest.files).toEqual([...packaged.files]);
    expect(packaged.files[0].recordCount).toBe(2);
  });

  test("keeps write size bounded independently of total record count", async () => {
    const contentKey = createFieldVaultKey();
    const { recipient } = await recipientFixture();
    const sink = new MeasuringSink();
    const envelope = await sealContentKeyForRecipient({
      artifactKind: "field_batch",
      contentKey,
      recipient,
      transferId,
    });
    const records = Array.from({ length: 2_000 }, (_, index) => ({
      id: index.toString().padStart(6, "0"),
      value: "x".repeat(1_000),
    }));
    await packageCanonicalArtifact({
      authorityExclusions: authorityExclusions(),
      contentKey,
      files: [{ path: "records.jsonl", recordType: "testRecord", records }],
      preamble: {
        containerVersion: FIELD_BATCH_CONTAINER_VERSION,
        artifactKind: "field_batch",
        artifactId,
        transferId,
        createdAt: "2026-08-23T02:00:00.000Z",
        chunkSize: 16 * 1024,
        contentKeyEnvelope: envelope,
      },
      sink,
    });
    expect(sink.maximumWriteBytes).toBeLessThan(17 * 1024);
    expect(sink.maximumWritesInFlight).toBe(1);
    expect(sink.totalBytes).toBeGreaterThan(2_000_000);
  });

  test("fails closed on partial output and wrong artifact dispatch", async () => {
    const contentKey = createFieldVaultKey();
    const { recipient } = await recipientFixture();
    const envelope = await sealContentKeyForRecipient({
      artifactKind: "field_recovery",
      contentKey,
      recipient,
      transferId,
    });
    await expect(
      packageCanonicalArtifact({
        authorityExclusions: authorityExclusions(),
        contentKey,
        files: [{ path: "records.jsonl", recordType: "testRecord", records: [{ id: "a" }] }],
        preamble: {
          containerVersion: FIELD_RECOVERY_CONTAINER_VERSION,
          artifactKind: "field_recovery",
          artifactId,
          transferId,
          createdAt: "2026-08-23T02:00:00.000Z",
          chunkSize: 16 * 1024,
          contentKeyEnvelope: envelope,
        },
        sink: new FailingSink(),
      }),
    ).rejects.toMatchObject({ code: "field_artifact_incomplete" });

    const sink = new MemoryStagedArtifactSink();
    const packaged = await packageCanonicalArtifact({
      authorityExclusions: authorityExclusions(),
      contentKey,
      files: [{ path: "records.jsonl", recordType: "testRecord", records: [{ id: "a" }] }],
      preamble: {
        containerVersion: FIELD_RECOVERY_CONTAINER_VERSION,
        artifactKind: "field_recovery",
        artifactId,
        transferId,
        createdAt: "2026-08-23T02:00:00.000Z",
        chunkSize: 16 * 1024,
        contentKeyEnvelope: envelope,
      },
      sink,
    });
    await expect(
      openCanonicalArtifact({
        expectedCiphertextSha256: packaged.ciphertextSha256,
        expectedKind: "field_batch",
        openContentKey: async () => contentKey.slice(),
        onRecord: () => undefined,
        source: sink.reopen(),
      }),
    ).rejects.toMatchObject({ code: "field_artifact_invalid" });
  });

  test("fails closed on wrong key, tampering, chunk-index alteration, truncation, and extra bytes", async () => {
    const contentKey = createFieldVaultKey();
    const { recipient } = await recipientFixture();
    const envelope = await sealContentKeyForRecipient({
      artifactKind: "field_recovery",
      contentKey,
      recipient,
      transferId,
    });
    const sink = new MemoryStagedArtifactSink();
    const packaged = await packageCanonicalArtifact({
      authorityExclusions: authorityExclusions(),
      contentKey,
      files: [
        {
          path: "records.jsonl",
          recordType: "testRecord",
          records: Array.from({ length: 80 }, (_, index) => ({
            id: index.toString().padStart(4, "0"),
            value: "x".repeat(1_000),
          })),
        },
      ],
      preamble: {
        containerVersion: FIELD_RECOVERY_CONTAINER_VERSION,
        artifactKind: "field_recovery",
        artifactId,
        transferId,
        createdAt: "2026-08-23T02:00:00.000Z",
        chunkSize: 16 * 1024,
        contentKeyEnvelope: envelope,
      },
      sink,
    });
    const complete = await collectBytes(sink.reopen());
    const preambleLength = new DataView(complete.buffer).getUint32(8, false);
    const firstFrame = 12 + preambleLength;
    const firstCiphertext = firstFrame + 1 + 4 + 24 + 4;
    const variants = [
      complete.slice(0, -1),
      new Uint8Array([...complete, 0]),
      changedByte(complete, firstCiphertext),
      changedByte(complete, firstFrame + 4),
    ];
    for (const variant of variants) {
      await expect(
        openCanonicalArtifact({
          expectedCiphertextSha256: packaged.ciphertextSha256,
          expectedKind: "field_recovery",
          openContentKey: async () => contentKey.slice(),
          onRecord: () => undefined,
          source: byteSource(variant),
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/^field_artifact_(?:incomplete|invalid)$/),
      });
    }
    await expect(
      openCanonicalArtifact({
        expectedCiphertextSha256: packaged.ciphertextSha256,
        expectedKind: "field_recovery",
        openContentKey: async () => createFieldVaultKey(),
        onRecord: () => undefined,
        source: byteSource(complete),
      }),
    ).rejects.toMatchObject({ code: "field_artifact_invalid" });
  });
});

class MeasuringSink implements StagedArtifactSink {
  private readonly chunks: Uint8Array[] = [];
  maximumWriteBytes = 0;
  maximumWritesInFlight = 0;
  totalBytes = 0;
  private writesInFlight = 0;

  async write(bytes: Uint8Array) {
    this.writesInFlight += 1;
    this.maximumWritesInFlight = Math.max(this.maximumWritesInFlight, this.writesInFlight);
    this.maximumWriteBytes = Math.max(this.maximumWriteBytes, bytes.length);
    this.totalBytes += bytes.length;
    this.chunks.push(bytes.slice());
    this.writesInFlight -= 1;
  }

  async close() {}
  async abort() {}
  async *reopen() {
    for (const chunk of this.chunks) yield chunk;
  }
}

class FailingSink implements StagedArtifactSink {
  private writes = 0;
  async write() {
    this.writes += 1;
    if (this.writes > 1) throw new DOMException("low storage", "QuotaExceededError");
  }
  async close() {}
  async abort() {}
  async *reopen() {}
}

async function recipientFixture(): Promise<{ recipient: ActiveRecipientDevice }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const signing = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    recipient: {
      id: "field_device_1234567890123456",
      role: "desk",
      agreementPublicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
      agreementPublicKeyFingerprint: "a".repeat(64),
      signingPublicKey: await crypto.subtle.exportKey("jwk", signing.publicKey),
      signingPublicKeyFingerprint: "b".repeat(64),
    },
  };
}

function authorityExclusions() {
  return [
    "device_private_keys",
    "webauthn_credentials",
    "session_authority",
    "offline_field_grants",
  ] as const;
}

async function collectBytes(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function changedByte(bytes: Uint8Array, index: number): Uint8Array {
  const changed = bytes.slice();
  changed[index] ^= 1;
  return changed;
}

async function* byteSource(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += 997) {
    yield bytes.slice(offset, offset + 997);
  }
}

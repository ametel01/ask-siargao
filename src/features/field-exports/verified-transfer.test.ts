import { describe, expect, test } from "bun:test";

import {
  canonicalStringify,
  compareCanonicalStrings,
} from "@/features/field-protocol/canonical-json";
import { exampleObservation, exampleVisit } from "@/features/field-recorder/test-fixtures";
import { fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import type { ActiveRecipientDevice, FieldBatchOuterReceipt } from "./artifact-schemas";
import {
  DEFAULT_ARTIFACT_CHUNK_SIZE,
  MemoryStagedArtifactSink,
  packageCanonicalArtifact,
} from "./package-format";
import { sealContentKeyForRecipient } from "./recipient-envelope";
import { destinationReceiptFilename, verifyReceivedFieldBatch } from "./verified-transfer";

const ids = {
  artifact: "0192f060-4f41-7aa1-b322-4aa9fc9f1620",
  batch: "0192f060-4f41-7aa1-b322-4aa9fc9f1621",
  receipt: "0192f060-4f41-7aa1-b322-4aa9fc9f1622",
  review: "0192f060-4f41-7aa1-b322-4aa9fc9f1623",
  transfer: "0192f060-4f41-7aa1-b322-4aa9fc9f1624",
} as const;
const createdAt = new Date("2026-08-23T04:00:00.000Z");
const challengeNonce = "source-challenge-1234567890";

describe("production recipient Verified Field Transfer", () => {
  test("opens a real recipient envelope, validates references, signs, and returns a public receipt", async () => {
    const fixture = await transferFixture();
    const receipt = await verifyReceivedFieldBatch({
      agreementPrivateKey: fixture.agreementPrivateKey,
      challengeNonce,
      expectedRecipient: fixture.recipient,
      now: new Date("2026-08-23T04:05:00.000Z"),
      receiptId: ids.receipt,
      signingPrivateKey: fixture.signingPrivateKey,
      source: fixture.sink.reopen(),
      sourceReceipt: fixture.sourceReceipt,
    });

    expect(receipt).toMatchObject({
      artifactCiphertextSha256: fixture.sourceReceipt.ciphertextSha256,
      challengeNonce,
      recipientDeviceId: fixture.recipient.id,
      result: "verified",
      transferId: ids.transfer,
    });
    expect(destinationReceiptFilename(receipt)).toBe(
      "ask-siargao-field-transfer-0192f0604f41.asftransferreceipt",
    );
    const publicReceipt = JSON.stringify(receipt);
    expect(publicReceipt).not.toContain(exampleObservation.value.item);
    expect(publicReceipt).not.toContain(exampleObservation.researcherId);
  });

  test("fails before signing when authenticated records omit a required reference edge", async () => {
    const fixture = await transferFixture({
      removeEdge: `${exampleObservation.id}:visitId->${exampleVisit.id}`,
    });

    await expect(
      verifyReceivedFieldBatch({
        agreementPrivateKey: fixture.agreementPrivateKey,
        challengeNonce,
        expectedRecipient: fixture.recipient,
        now: new Date("2026-08-23T04:05:00.000Z"),
        receiptId: ids.receipt,
        signingPrivateKey: fixture.signingPrivateKey,
        source: fixture.sink.reopen(),
        sourceReceipt: fixture.sourceReceipt,
      }),
    ).rejects.toMatchObject({ code: "field_artifact_invalid" });
  });

  test("rejects a source receipt for a different recipient before artifact decryption", async () => {
    const fixture = await transferFixture();
    await expect(
      verifyReceivedFieldBatch({
        agreementPrivateKey: fixture.agreementPrivateKey,
        challengeNonce,
        expectedRecipient: { ...fixture.recipient, id: "field_device_abcdefghijklmnop" },
        now: new Date("2026-08-23T04:05:00.000Z"),
        receiptId: ids.receipt,
        signingPrivateKey: fixture.signingPrivateKey,
        source: fixture.sink.reopen(),
        sourceReceipt: fixture.sourceReceipt,
      }),
    ).rejects.toMatchObject({ code: "field_artifact_invalid" });
  });
});

async function transferFixture(input: { removeEdge?: string } = {}) {
  const recipientKeys = await recipientFixture();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const sink = new MemoryStagedArtifactSink();
  const allEdges = batchEdges().filter((edge) => edge !== input.removeEdge);
  const referentialClosureSha256 = await sha256Hex(
    fieldTextEncoder.encode(canonicalStringify(allEdges)),
  );
  const reviewWithoutHash = {
    schemaVersion: "field-desk-review-audit.v1",
    id: ids.review,
    protocolPackageId: exampleObservation.protocolPackageId,
    protocolPackageVersion: exampleObservation.protocolPackageVersion,
    recordId: exampleObservation.id,
    recordKind: "fieldObservation",
    reviewerId: "reviewer_desk",
    researcherId: exampleObservation.researcherId,
    reviewerMatchesResearcher: false,
    reviewedAt: "2026-08-23T03:55:00.000Z",
    decision: "include",
    conflictDisposition: "not_applicable",
  } as const;
  const review = {
    ...reviewWithoutHash,
    entrySha256: await sha256Hex(fieldTextEncoder.encode(canonicalStringify(reviewWithoutHash))),
  };
  const envelope = await sealContentKeyForRecipient({
    artifactKind: "field_batch",
    contentKey,
    recipient: recipientKeys.recipient,
    transferId: ids.transfer,
  });
  const packaged = await packageCanonicalArtifact({
    authorityExclusions: [
      "device_private_keys",
      "webauthn_credentials",
      "session_authority",
      "offline_field_grants",
    ],
    contentKey,
    files: [
      {
        path: "batch-selection.jsonl",
        recordType: "fieldBatchSelection",
        records: [
          {
            edgeSet: allEdges,
            id: ids.batch,
            schemaVersion: "field-batch-selection.v1",
            selectedRecordIds: [exampleVisit.id, exampleObservation.id].toSorted(
              compareCanonicalStrings,
            ),
          },
        ],
      },
      {
        path: "field-observations.jsonl",
        recordType: "fieldObservation",
        records: [exampleObservation],
      },
      { path: "field-reviews.jsonl", recordType: "fieldReview", records: [review] },
      { path: "field-visits.jsonl", recordType: "fieldVisit", records: [exampleVisit] },
    ],
    preamble: {
      artifactId: ids.artifact,
      artifactKind: "field_batch",
      chunkSize: DEFAULT_ARTIFACT_CHUNK_SIZE,
      containerVersion: "asf-batch-container.v1",
      contentKeyEnvelope: envelope,
      createdAt: createdAt.toISOString(),
      transferId: ids.transfer,
    },
    referentialClosureSha256,
    sink,
  });
  const sourceReceipt: FieldBatchOuterReceipt = {
    artifactId: ids.artifact,
    ciphertextSha256: packaged.ciphertextSha256,
    createdAt: createdAt.toISOString(),
    encryptedBytes: packaged.encryptedBytes,
    filename: "ask-siargao-field-batch-0192f0604f41.asfbatch",
    formatVersion: "asf-batch-container.v1",
    recipientDeviceId: recipientKeys.recipient.id,
    schemaVersion: "field-batch-outer-receipt.v1",
    state: "created",
    transferId: ids.transfer,
  };
  contentKey.fill(0);
  return { ...recipientKeys, sink, sourceReceipt };
}

function batchEdges(): string[] {
  return [
    `${exampleObservation.id}:assignmentId->${exampleObservation.assignmentId}`,
    `${exampleObservation.id}:campaignId->${exampleObservation.campaignId}`,
    `${exampleObservation.id}:coverageRequirementId->${exampleObservation.coverageRequirementId}`,
    `${exampleObservation.id}:objectiveId->${exampleObservation.objectiveId}`,
    `${exampleObservation.id}:visitId->${exampleVisit.id}`,
    `${exampleVisit.id}:assignmentId->${exampleVisit.assignmentId}`,
    `${exampleVisit.id}:campaignId->${exampleVisit.campaignId}`,
    `review:${ids.review}->record:${exampleObservation.id}`,
  ].toSorted(compareCanonicalStrings);
}

async function recipientFixture() {
  const signing = await nonExtractableSigningKeys();
  const agreement = await nonExtractableAgreementKeys();
  const [signingPublicKey, agreementPublicKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", signing.publicKey),
    crypto.subtle.exportKey("jwk", agreement.publicKey),
  ]);
  const recipient: ActiveRecipientDevice = {
    agreementPublicKey,
    agreementPublicKeyFingerprint: await jwkFingerprint(agreementPublicKey),
    id: "field_device_1234567890123456",
    role: "desk",
    signingPublicKey,
    signingPublicKeyFingerprint: await jwkFingerprint(signingPublicKey),
  };
  return {
    agreementPrivateKey: agreement.privateKey,
    recipient,
    signingPrivateKey: signing.privateKey,
  };
}

async function nonExtractableSigningKeys() {
  const generated = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", generated.privateKey);
  return {
    privateKey: await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    ),
    publicKey: generated.publicKey,
  };
}

async function nonExtractableAgreementKeys() {
  const generated = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const privateJwk = await crypto.subtle.exportKey("jwk", generated.privateKey);
  return {
    privateKey: await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    ),
    publicKey: generated.publicKey,
  };
}

async function jwkFingerprint(key: JsonWebKey): Promise<string> {
  return sha256Hex(
    fieldTextEncoder.encode(canonicalStringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y })),
  );
}

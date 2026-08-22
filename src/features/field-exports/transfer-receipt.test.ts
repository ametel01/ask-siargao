import { beforeEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";

import { type FieldTransferStateRow, IndexedDbFieldVault } from "@/features/field-security/vault";
import type { ActiveRecipientDevice } from "./artifact-schemas";
import {
  completeDestinationVerification,
  completeSourceVerification,
  signDestinationTransferReceipt,
  verifyDestinationTransferReceipt,
} from "./transfer-receipt";

const receiptId = "0192f060-4f41-7aa1-b322-4aa9fc9f1520";
const transferId = "0192f060-4f41-7aa1-b322-4aa9fc9f1521";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("Verified Field Transfer receipt", () => {
  test("binds the exact nonce, hash, device and non-extractable signing key", async () => {
    const fixture = await signingFixture();
    const outstanding = outstandingTransfer();
    const receipt = await signDestinationTransferReceipt({
      artifactCiphertextSha256: outstanding.ciphertextSha256,
      artifactKind: outstanding.artifactKind,
      challengeNonce: outstanding.nonce,
      receiptId,
      recipient: fixture.recipient,
      signingPrivateKey: fixture.privateKey,
      transferId,
      verifiedAt: "2026-08-23T02:10:00.000Z",
    });
    expect(
      await verifyDestinationTransferReceipt({
        outstanding,
        receipt,
        recipient: fixture.recipient,
      }),
    ).toEqual(receipt);
    await expect(
      verifyDestinationTransferReceipt({
        outstanding: { ...outstanding, nonce: "altered-nonce-1234567890" },
        receipt,
        recipient: fixture.recipient,
      }),
    ).rejects.toMatchObject({ code: "field_transfer_receipt_invalid" });
  });

  test("persists one outstanding nonce and rejects receipt replay", async () => {
    const vault = new IndexedDbFieldVault();
    const outstanding = outstandingTransfer();
    await vault.putOutstandingTransfer(outstanding);
    await vault.acceptTransfer({ receiptId, transferId });
    await expect(vault.acceptTransfer({ receiptId, transferId })).rejects.toMatchObject({
      code: "field_artifact_replay",
    });
  });

  test("enforces decrypt/reference validation before signing and receipt verification before source completion", async () => {
    const events: string[] = [];
    const fixture = await signingFixture();
    const outstanding = outstandingTransfer();
    const receipt = await completeDestinationVerification({
      decryptIntegrityAndReferenceValidate: async () => {
        events.push("destination_validated");
        return true;
      },
      signReceipt: async () => {
        events.push("destination_signed");
        return signDestinationTransferReceipt({
          artifactCiphertextSha256: outstanding.ciphertextSha256,
          artifactKind: outstanding.artifactKind,
          challengeNonce: outstanding.nonce,
          receiptId,
          recipient: fixture.recipient,
          signingPrivateKey: fixture.privateKey,
          transferId,
          verifiedAt: "2026-08-23T02:10:00.000Z",
        });
      },
    });
    await completeSourceVerification({
      verifyReceipt: async () => {
        events.push("source_verified_receipt");
        return verifyDestinationTransferReceipt({
          outstanding,
          receipt,
          recipient: fixture.recipient,
        });
      },
      markSourceVerified: async () => {
        events.push("source_marked_verified");
      },
    });
    expect(events).toEqual([
      "destination_validated",
      "destination_signed",
      "source_verified_receipt",
      "source_marked_verified",
    ]);
  });
});

function outstandingTransfer(): FieldTransferStateRow {
  return {
    transferId,
    artifactKind: "field_batch",
    ciphertextSha256: "a".repeat(64),
    recipientDeviceId: "field_device_1234567890123456",
    nonce: "challenge-nonce-1234567890",
    state: "outstanding",
    createdAt: "2026-08-23T02:00:00.000Z",
  };
}

async function signingFixture() {
  const pair = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const agreement = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const recipient: ActiveRecipientDevice = {
    id: "field_device_1234567890123456",
    role: "desk",
    agreementPublicKey: await crypto.subtle.exportKey("jwk", agreement.publicKey),
    agreementPublicKeyFingerprint: "b".repeat(64),
    signingPublicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    signingPublicKeyFingerprint: "c".repeat(64),
  };
  return { privateKey, recipient };
}

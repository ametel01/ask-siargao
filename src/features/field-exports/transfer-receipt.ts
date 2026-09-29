import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  asArrayBuffer,
  decodeBase64Url,
  encodeBase64Url,
  fieldTextEncoder,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import type { FieldTransferStateRow } from "@/features/field-security/vault";
import {
  type ActiveRecipientDevice,
  type ArtifactKind,
  FIELD_TRANSFER_RECEIPT_VERSION,
  type TransferReceipt,
  transferReceiptSchema,
} from "./artifact-schemas";

type UnsignedReceipt = Omit<TransferReceipt, "signature">;

export async function signDestinationTransferReceipt(input: {
  artifactCiphertextSha256: string;
  artifactKind: ArtifactKind;
  challengeNonce: string;
  receiptId: string;
  recipient: ActiveRecipientDevice;
  signingPrivateKey: CryptoKey;
  transferId: string;
  verifiedAt: string;
}): Promise<TransferReceipt> {
  if (input.signingPrivateKey.extractable || !input.signingPrivateKey.usages.includes("sign")) {
    throw new FieldSecurityError("field_transfer_receipt_invalid");
  }
  const unsigned: UnsignedReceipt = {
    version: FIELD_TRANSFER_RECEIPT_VERSION,
    receiptId: input.receiptId,
    transferId: input.transferId,
    artifactKind: input.artifactKind,
    artifactCiphertextSha256: input.artifactCiphertextSha256,
    challengeNonce: input.challengeNonce,
    recipientDeviceId: input.recipient.id,
    recipientSigningKeyFingerprint: input.recipient.signingPublicKeyFingerprint,
    result: "verified",
    verifiedAt: input.verifiedAt,
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.signingPrivateKey,
    asArrayBuffer(receiptSigningBytes(unsigned)),
  );
  return transferReceiptSchema.parse({
    ...unsigned,
    signature: encodeBase64Url(new Uint8Array(signature)),
  });
}

export async function verifyDestinationTransferReceipt(input: {
  outstanding: FieldTransferStateRow;
  receipt: TransferReceipt;
  recipient: ActiveRecipientDevice;
}): Promise<TransferReceipt> {
  const receipt = transferReceiptSchema.parse(input.receipt);
  if (
    input.outstanding.state !== "outstanding" ||
    receipt.transferId !== input.outstanding.transferId ||
    receipt.artifactKind !== input.outstanding.artifactKind ||
    receipt.artifactCiphertextSha256 !== input.outstanding.ciphertextSha256 ||
    receipt.challengeNonce !== input.outstanding.nonce ||
    receipt.recipientDeviceId !== input.outstanding.recipientDeviceId ||
    receipt.recipientDeviceId !== input.recipient.id ||
    receipt.recipientSigningKeyFingerprint !== input.recipient.signingPublicKeyFingerprint
  ) {
    throw new FieldSecurityError("field_transfer_receipt_invalid");
  }
  const { signature, ...unsigned } = receipt;
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    input.recipient.signingPublicKey,
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    { hash: "SHA-256", name: "ECDSA" },
    publicKey,
    asArrayBuffer(decodeBase64Url(signature)),
    asArrayBuffer(receiptSigningBytes(unsigned)),
  );
  if (!verified) throw new FieldSecurityError("field_transfer_receipt_invalid");
  return receipt;
}

export async function completeDestinationVerification<T>(input: {
  decryptIntegrityAndReferenceValidate: () => Promise<T>;
  signReceipt: (validated: T) => Promise<TransferReceipt>;
}): Promise<TransferReceipt> {
  const validated = await input.decryptIntegrityAndReferenceValidate();
  return input.signReceipt(validated);
}

export async function completeSourceVerification(input: {
  markSourceVerified: (receipt: TransferReceipt) => Promise<void>;
  verifyReceipt: () => Promise<TransferReceipt>;
}): Promise<TransferReceipt> {
  const receipt = await input.verifyReceipt();
  await input.markSourceVerified(receipt);
  return receipt;
}

function receiptSigningBytes(receipt: UnsignedReceipt): Uint8Array {
  return fieldTextEncoder.encode(
    canonicalStringify({ domain: FIELD_TRANSFER_RECEIPT_VERSION, receipt }),
  );
}

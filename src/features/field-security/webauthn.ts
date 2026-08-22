import {
  asArrayBuffer,
  decodeBase64Url,
  encodeBase64Url,
  fieldTextDecoder,
  sha256Bytes,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";

export type DeviceBoundCredentialEvidence = {
  backupEligible: boolean;
  credentialId: string;
  publicKey: JsonWebKey;
  userVerified: boolean;
};

export function requireDeviceBoundCredential(
  evidence: DeviceBoundCredentialEvidence,
): DeviceBoundCredentialEvidence {
  if (
    !evidence.userVerified ||
    evidence.backupEligible ||
    !evidence.credentialId ||
    evidence.publicKey.kty !== "EC" ||
    evidence.publicKey.crv !== "P-256"
  ) {
    throw new FieldSecurityError("field_unlock_credential_ineligible");
  }
  return evidence;
}

export async function verifyOfflineWebAuthnAssertion(input: {
  assertion: {
    authenticatorData: string;
    clientDataJson: string;
    credentialId: string;
    signature: string;
  };
  challenge: Uint8Array;
  credential: DeviceBoundCredentialEvidence;
  expectedOrigin: string;
  rpId: string;
}): Promise<boolean> {
  try {
    requireDeviceBoundCredential(input.credential);
    if (input.assertion.credentialId !== input.credential.credentialId) return false;
    const authenticatorData = decodeBase64Url(input.assertion.authenticatorData);
    if (authenticatorData.length < 37) return false;
    const expectedRpHash = await sha256Bytes(new TextEncoder().encode(input.rpId));
    if (!constantTimeEqual(authenticatorData.slice(0, 32), expectedRpHash)) return false;
    const flags = authenticatorData[32] ?? 0;
    if ((flags & 0x01) === 0 || (flags & 0x04) === 0 || (flags & 0x08) !== 0) return false;

    const clientDataBytes = decodeBase64Url(input.assertion.clientDataJson);
    const clientData = JSON.parse(fieldTextDecoder.decode(clientDataBytes)) as Record<
      string,
      unknown
    >;
    if (
      clientData.type !== "webauthn.get" ||
      clientData.origin !== input.expectedOrigin ||
      clientData.challenge !== encodeBase64Url(input.challenge) ||
      clientData.crossOrigin === true
    ) {
      return false;
    }
    const signed = concatenate(authenticatorData, await sha256Bytes(clientDataBytes));
    const key = await crypto.subtle.importKey(
      "jwk",
      input.credential.publicKey,
      { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      key,
      asArrayBuffer(p256DerSignatureToRaw(decodeBase64Url(input.assertion.signature))),
      asArrayBuffer(signed),
    );
  } catch {
    return false;
  }
}

function p256DerSignatureToRaw(signature: Uint8Array): Uint8Array {
  if (signature.length < 8 || signature[0] !== 0x30) return signature;
  let offset = signature[1] === 0x81 ? 3 : 2;
  if (signature[offset] !== 0x02) throw new Error("invalid_signature");
  const rLength = signature[offset + 1] ?? 0;
  const r = signature.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) throw new Error("invalid_signature");
  const sLength = signature[offset + 1] ?? 0;
  const s = signature.slice(offset + 2, offset + 2 + sLength);
  const raw = new Uint8Array(64);
  raw.set(r.slice(Math.max(0, r.length - 32)), Math.max(0, 32 - r.length));
  raw.set(s.slice(Math.max(0, s.length - 32)), 32 + Math.max(0, 32 - s.length));
  return raw;
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

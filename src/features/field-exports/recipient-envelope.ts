import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  decodeBase64Url,
  encodeBase64Url,
  fieldTextEncoder,
  randomFieldBytes,
  zeroize,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import {
  type ActiveRecipientDevice,
  type ArtifactKind,
  type AuthenticatedRegistrySnapshot,
  authenticatedRegistrySnapshotSchema,
  FIELD_RECIPIENT_ENVELOPE_VERSION,
  MAX_REGISTRY_SNAPSHOT_AGE_MS,
  type RecipientEnvelope,
  recipientEnvelopeSchema,
} from "./artifact-schemas";

export function assertRecipientAuthority(input: {
  deviceId: string;
  now: Date;
  registry: AuthenticatedRegistrySnapshot;
}): ActiveRecipientDevice {
  const registry = authenticatedRegistrySnapshotSchema.parse(input.registry);
  const authenticatedAt = Date.parse(registry.authenticatedAt);
  const expiresAt = Date.parse(registry.expiresAt);
  if (
    authenticatedAt > input.now.getTime() + 120_000 ||
    input.now.getTime() > expiresAt ||
    expiresAt - authenticatedAt > MAX_REGISTRY_SNAPSHOT_AGE_MS ||
    (registry.source === "encrypted_registry_snapshot" &&
      input.now.getTime() - authenticatedAt > MAX_REGISTRY_SNAPSHOT_AGE_MS)
  ) {
    throw new FieldSecurityError("field_artifact_recipient_invalid");
  }
  const device = registry.devices.find((candidate) => candidate.id === input.deviceId);
  if (!device) throw new FieldSecurityError("field_artifact_recipient_invalid");
  return device;
}

export async function sealContentKeyForRecipient(input: {
  artifactKind: ArtifactKind;
  contentKey: Uint8Array;
  recipient: ActiveRecipientDevice;
  transferId: string;
}): Promise<RecipientEnvelope> {
  if (input.contentKey.length !== 32) throw new FieldSecurityError("field_key_unavailable");
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    input.recipient.agreementPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: recipientPublicKey },
      ephemeral.privateKey,
      256,
    ),
  );
  const wrappingKey = deriveRecipientKey(shared, input);
  const nonce = randomFieldBytes(24);
  const aad = recipientAad(input);
  try {
    return recipientEnvelopeSchema.parse({
      version: FIELD_RECIPIENT_ENVELOPE_VERSION,
      algorithm: "P-256-ECDH+XChaCha20-Poly1305",
      transferId: input.transferId,
      artifactKind: input.artifactKind,
      recipientDeviceId: input.recipient.id,
      recipientAgreementKeyFingerprint: input.recipient.agreementPublicKeyFingerprint,
      ephemeralPublicKey: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
      nonce: encodeBase64Url(nonce),
      ciphertext: encodeBase64Url(
        xchacha20poly1305(wrappingKey, nonce, aad).encrypt(input.contentKey),
      ),
    });
  } finally {
    zeroize(shared);
    zeroize(wrappingKey);
  }
}

export async function openRecipientContentKey(input: {
  agreementPrivateKey: CryptoKey;
  artifactKind: ArtifactKind;
  envelope: RecipientEnvelope;
  expectedRecipient: ActiveRecipientDevice;
  transferId: string;
}): Promise<Uint8Array> {
  const envelope = recipientEnvelopeSchema.parse(input.envelope);
  if (
    envelope.transferId !== input.transferId ||
    envelope.artifactKind !== input.artifactKind ||
    envelope.recipientDeviceId !== input.expectedRecipient.id ||
    envelope.recipientAgreementKeyFingerprint !==
      input.expectedRecipient.agreementPublicKeyFingerprint
  ) {
    throw new FieldSecurityError("field_artifact_recipient_invalid");
  }
  let shared: Uint8Array | undefined;
  let wrappingKey: Uint8Array | undefined;
  try {
    const ephemeralPublicKey = await crypto.subtle.importKey(
      "jwk",
      envelope.ephemeralPublicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: ephemeralPublicKey },
        input.agreementPrivateKey,
        256,
      ),
    );
    wrappingKey = deriveRecipientKey(shared, {
      artifactKind: input.artifactKind,
      recipient: input.expectedRecipient,
      transferId: input.transferId,
    });
    const key = xchacha20poly1305(
      wrappingKey,
      decodeBase64Url(envelope.nonce),
      recipientAad({
        artifactKind: input.artifactKind,
        recipient: input.expectedRecipient,
        transferId: input.transferId,
      }),
    ).decrypt(decodeBase64Url(envelope.ciphertext));
    if (key.length !== 32) throw new Error("invalid content key");
    return key;
  } catch (error) {
    if (error instanceof FieldSecurityError) throw error;
    throw new FieldSecurityError("field_artifact_recipient_invalid");
  } finally {
    if (shared) zeroize(shared);
    if (wrappingKey) zeroize(wrappingKey);
  }
}

function deriveRecipientKey(
  shared: Uint8Array,
  input: {
    artifactKind: ArtifactKind;
    recipient: ActiveRecipientDevice;
    transferId: string;
  },
): Uint8Array {
  return hkdf(
    sha256,
    shared,
    fieldTextEncoder.encode(FIELD_RECIPIENT_ENVELOPE_VERSION),
    recipientAad(input),
    32,
  );
}

function recipientAad(input: {
  artifactKind: ArtifactKind;
  recipient: ActiveRecipientDevice;
  transferId: string;
}): Uint8Array {
  return fieldTextEncoder.encode(
    canonicalStringify({
      version: FIELD_RECIPIENT_ENVELOPE_VERSION,
      artifactKind: input.artifactKind,
      recipientDeviceId: input.recipient.id,
      recipientAgreementKeyFingerprint: input.recipient.agreementPublicKeyFingerprint,
      transferId: input.transferId,
    }),
  );
}

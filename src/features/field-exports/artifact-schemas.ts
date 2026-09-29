import { z } from "zod";

import { publicJwkSchema } from "@/features/field-security/types";

export const FIELD_RECOVERY_CONTAINER_VERSION = "asf-recovery-container.v1" as const;
export const FIELD_BATCH_CONTAINER_VERSION = "asf-batch-container.v1" as const;
export const FIELD_RECIPIENT_ENVELOPE_VERSION = "field-recipient-envelope.v1" as const;
export const FIELD_TRANSFER_RECEIPT_VERSION = "field-transfer-receipt.v1" as const;
export const FIELD_RESTORE_PREVIEW_VERSION = "field-restore-preview.v1" as const;
export const FIELD_REGISTRY_SNAPSHOT_VERSION = "field-device-registry-snapshot.v1" as const;
export const MAX_REGISTRY_SNAPSHOT_AGE_MS = 15 * 60 * 1_000;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const uuidSchema = z.string().uuid();
const instantSchema = z.string().datetime({ offset: true });

export const artifactKindSchema = z.enum(["field_recovery", "field_batch"]);

export const recipientEnvelopeSchema = z.strictObject({
  version: z.literal(FIELD_RECIPIENT_ENVELOPE_VERSION),
  algorithm: z.literal("P-256-ECDH+XChaCha20-Poly1305"),
  transferId: uuidSchema,
  artifactKind: artifactKindSchema,
  recipientDeviceId: z.string().regex(/^field_device_[A-Za-z0-9_-]{16,}$/u),
  recipientAgreementKeyFingerprint: sha256Schema,
  ephemeralPublicKey: publicJwkSchema,
  nonce: z.string().min(32).max(80),
  ciphertext: z.string().min(32).max(500),
});

export const artifactPreambleSchema = z.strictObject({
  containerVersion: z.enum([FIELD_RECOVERY_CONTAINER_VERSION, FIELD_BATCH_CONTAINER_VERSION]),
  artifactKind: artifactKindSchema,
  artifactId: uuidSchema,
  transferId: uuidSchema,
  createdAt: instantSchema,
  chunkSize: z
    .number()
    .int()
    .min(16 * 1024)
    .max(4 * 1024 * 1024),
  contentKeyEnvelope: recipientEnvelopeSchema,
});

export const artifactFileManifestSchema = z.strictObject({
  path: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9]+)?$/u),
  recordType: z.string().regex(/^[a-z][A-Za-z0-9]*$/u),
  recordCount: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(),
  sha256: sha256Schema,
});

export const artifactRootManifestSchema = z.strictObject({
  schemaVersion: z.literal("field-artifact-root-manifest.v1"),
  artifactId: uuidSchema,
  artifactKind: artifactKindSchema,
  transferId: uuidSchema,
  payloadChunkCount: z.number().int().positive(),
  plaintextBytes: z.number().int().positive(),
  payloadCiphertextBytes: z.number().int().positive(),
  payloadCiphertextSha256: sha256Schema,
  files: z.array(artifactFileManifestSchema).min(1),
  referentialClosureSha256: sha256Schema.optional(),
  authorityExclusions: z
    .array(
      z.enum([
        "device_private_keys",
        "webauthn_credentials",
        "session_authority",
        "offline_field_grants",
      ]),
    )
    .length(4)
    .refine((values) => new Set(values).size === 4, "Every authority exclusion is required"),
});

export const fieldRecoveryOuterReceiptSchema = z.strictObject({
  schemaVersion: z.literal("field-recovery-outer-receipt.v1"),
  artifactId: uuidSchema,
  filename: z.string().regex(/^ask-siargao-field-recovery-[a-f0-9]{12}\.asfrecovery$/u),
  formatVersion: z.literal(FIELD_RECOVERY_CONTAINER_VERSION),
  createdAtMinute: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/u),
  encryptedBytes: z.number().int().positive(),
  ciphertextSha256: sha256Schema,
  encryption: z.literal("xchacha20-poly1305"),
  keyId: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/u),
  restoreInstructionsVersion: z.literal("1.0.0"),
});

export const fieldBatchOuterReceiptSchema = z.strictObject({
  schemaVersion: z.literal("field-batch-outer-receipt.v1"),
  artifactId: uuidSchema,
  filename: z.string().regex(/^ask-siargao-field-batch-[a-f0-9]{12}\.asfbatch$/u),
  formatVersion: z.literal(FIELD_BATCH_CONTAINER_VERSION),
  createdAt: instantSchema,
  encryptedBytes: z.number().int().positive(),
  ciphertextSha256: sha256Schema,
  recipientDeviceId: z.string().regex(/^field_device_[A-Za-z0-9_-]{16,}$/u),
  transferId: uuidSchema,
  state: z.enum(["created", "destination_verified", "source_verified"]),
});

export const transferReceiptSchema = z.strictObject({
  version: z.literal(FIELD_TRANSFER_RECEIPT_VERSION),
  receiptId: uuidSchema,
  transferId: uuidSchema,
  artifactKind: artifactKindSchema,
  artifactCiphertextSha256: sha256Schema,
  challengeNonce: z.string().min(22).max(200),
  recipientDeviceId: z.string().regex(/^field_device_[A-Za-z0-9_-]{16,}$/u),
  recipientSigningKeyFingerprint: sha256Schema,
  result: z.literal("verified"),
  verifiedAt: instantSchema,
  signature: z.string().min(32).max(500),
});

export const restorePreviewSchema = z.strictObject({
  schemaVersion: z.literal(FIELD_RESTORE_PREVIEW_VERSION),
  previewId: uuidSchema,
  artifactId: uuidSchema,
  createdAt: instantSchema,
  additions: z.array(z.string().min(1)).max(100_000),
  exactReplays: z.array(z.string().min(1)).max(100_000),
  quarantines: z.array(
    z.strictObject({
      immutableId: z.string().min(1),
      destinationSha256: sha256Schema,
      incomingSha256: sha256Schema,
    }),
  ),
  blockers: z.array(z.string().min(1)).max(1_000),
  destinationStateSha256: sha256Schema,
  previewSha256: sha256Schema,
});

export const activeRecipientDeviceSchema = z.strictObject({
  id: z.string().regex(/^field_device_[A-Za-z0-9_-]{16,}$/u),
  role: z.literal("desk"),
  agreementPublicKey: publicJwkSchema,
  agreementPublicKeyFingerprint: sha256Schema,
  signingPublicKey: publicJwkSchema,
  signingPublicKeyFingerprint: sha256Schema,
});

export const authenticatedRegistrySnapshotSchema = z.strictObject({
  version: z.literal(FIELD_REGISTRY_SNAPSHOT_VERSION),
  authenticatedAt: instantSchema,
  expiresAt: instantSchema,
  accountId: z.string().min(1).max(200),
  devices: z.array(activeRecipientDeviceSchema),
  source: z.enum(["authenticated_live_registry", "encrypted_registry_snapshot"]),
});

export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type RecipientEnvelope = z.infer<typeof recipientEnvelopeSchema>;
export type ArtifactPreamble = z.infer<typeof artifactPreambleSchema>;
export type ArtifactRootManifest = z.infer<typeof artifactRootManifestSchema>;
export type ArtifactFileManifest = z.infer<typeof artifactFileManifestSchema>;
export type FieldRecoveryOuterReceipt = z.infer<typeof fieldRecoveryOuterReceiptSchema>;
export type FieldBatchOuterReceipt = z.infer<typeof fieldBatchOuterReceiptSchema>;
export type TransferReceipt = z.infer<typeof transferReceiptSchema>;
export type RestorePreview = z.infer<typeof restorePreviewSchema>;
export type ActiveRecipientDevice = z.infer<typeof activeRecipientDeviceSchema>;
export type AuthenticatedRegistrySnapshot = z.infer<typeof authenticatedRegistrySnapshotSchema>;

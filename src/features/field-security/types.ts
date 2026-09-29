import { z } from "zod";

export const FIELD_GRANT_VERSION = "offline-field-grant.v1" as const;
export const FIELD_ENVELOPE_VERSION = "field-envelope.v1" as const;
export const FIELD_RECOVERY_WRAP_VERSION = "field-recovery-wrap.v1" as const;
export const FIELD_DEVICE_WRAP_VERSION = "field-device-wrap.v1" as const;
export const DEFAULT_OFFLINE_FIELD_GRANT_MS = 72 * 60 * 60 * 1_000;
export const MAX_OFFLINE_FIELD_GRANT_MS = DEFAULT_OFFLINE_FIELD_GRANT_MS;
export const FIELD_CLOCK_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1_000;

export const fieldDeviceRoleSchema = z.enum(["recorder", "desk"]);
export type FieldDeviceRole = z.infer<typeof fieldDeviceRoleSchema>;

export const publicJwkSchema = z
  .strictObject({
    crv: z.literal("P-256"),
    ext: z.boolean().optional(),
    key_ops: z.array(z.string()).optional(),
    kty: z.literal("EC"),
    x: z.string().min(1).max(200),
    y: z.string().min(1).max(200),
  })
  .transform(
    (value) =>
      ({ crv: value.crv, ext: true, kty: value.kty, x: value.x, y: value.y }) as JsonWebKey,
  );

export const offlineFieldGrantClaimsSchema = z.strictObject({
  accountId: z.string().min(1).max(200),
  applicationBuildId: z.string().min(1).max(200),
  applicationVersion: z.string().min(1).max(50),
  deviceId: z.string().regex(/^field_device_[a-zA-Z0-9_-]{16,}$/),
  devicePublicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime({ offset: true }),
  grantId: z.string().regex(/^field_grant_[a-zA-Z0-9_-]{16,}$/),
  issuedAt: z.string().datetime({ offset: true }),
  protocolPackageId: z.string().min(1).max(200),
  protocolPackageVersion: z.string().min(1).max(50),
  researcherRole: fieldDeviceRoleSchema,
  signerKeyId: z.string().min(1).max(100),
  version: z.literal(FIELD_GRANT_VERSION),
});

export type OfflineFieldGrantClaims = z.infer<typeof offlineFieldGrantClaimsSchema>;

export const signedOfflineFieldGrantSchema = z.strictObject({
  claims: offlineFieldGrantClaimsSchema,
  signature: z.string().min(1).max(500),
});

export type SignedOfflineFieldGrant = z.infer<typeof signedOfflineFieldGrantSchema>;

export type FieldEncryptedEnvelope = {
  aadVersion: typeof FIELD_ENVELOPE_VERSION;
  algorithm: "xchacha20-poly1305";
  applicationVersion: string;
  ciphertext: string;
  nonce: string;
  opaqueRecordKey: string;
};

export type FieldRecoveryWrap = {
  algorithm: "xchacha20-poly1305";
  ciphertext: string;
  kdf: "argon2id";
  kdfMemoryKiB: number;
  kdfParallelism: number;
  kdfTimeCost: number;
  nonce: string;
  salt: string;
  version: typeof FIELD_RECOVERY_WRAP_VERSION;
};

export type FieldDeviceWrap = {
  algorithm: "xchacha20-poly1305";
  ciphertext: string;
  ephemeralPublicKey: JsonWebKey;
  nonce: string;
  version: typeof FIELD_DEVICE_WRAP_VERSION;
};

export type FieldGrantValidationContext = {
  applicationBuildId: string;
  applicationVersion: string;
  deviceId: string;
  devicePublicKeyFingerprint: string;
  learnedRevokedDeviceIds?: ReadonlySet<string>;
  lastTrustedWallClockMs?: number;
  now: Date;
  trustedSignerKeys: ReadonlyMap<string, JsonWebKey>;
};

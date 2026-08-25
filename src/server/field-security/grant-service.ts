import { randomUUID } from "node:crypto";
import { z } from "zod";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import { encodeBase64Url, sha256Hex } from "@/features/field-security/encoding";
import {
  DEFAULT_OFFLINE_FIELD_GRANT_MS,
  FIELD_GRANT_VERSION,
  MAX_OFFLINE_FIELD_GRANT_MS,
  type OfflineFieldGrantClaims,
  type SignedOfflineFieldGrant,
} from "@/features/field-security/types";
import type { DatabaseQueryClient } from "@/server/db/query-client";

export const issueOfflineFieldGrantSchema = z.strictObject({
  applicationBuildId: z.string().min(1).max(200),
  applicationVersion: z.string().min(1).max(50),
  deviceId: z.string().regex(/^field_device_[A-Za-z0-9_-]{16,}$/),
  durationHours: z.number().int().positive().max(72).optional(),
  protocolPackageId: z.string().min(1).max(200),
  protocolPackageVersion: z.string().min(1).max(50),
});

export type FieldGrantSigningConfig = {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
  signerKeyId: string;
};

export function readFieldGrantSigningConfig(
  env: Record<string, string | undefined> = process.env,
): FieldGrantSigningConfig {
  const signerKeyId = env.FIELD_GRANT_SIGNER_KEY_ID?.trim();
  const privateValue = env.FIELD_GRANT_SIGNING_PRIVATE_JWK?.trim();
  const publicValue = env.FIELD_GRANT_SIGNING_PUBLIC_JWK?.trim();
  if (!signerKeyId || !privateValue || !publicValue) {
    throw new Error("field_grant_signing_not_configured");
  }
  try {
    return {
      privateKey: JSON.parse(privateValue) as JsonWebKey,
      publicKey: JSON.parse(publicValue) as JsonWebKey,
      signerKeyId,
    };
  } catch {
    throw new Error("field_grant_signing_not_configured");
  }
}

export async function issueOfflineFieldGrant(input: {
  accountId: string;
  db: DatabaseQueryClient;
  now: Date;
  request: z.input<typeof issueOfflineFieldGrantSchema>;
  signing: FieldGrantSigningConfig;
}): Promise<{ grant: SignedOfflineFieldGrant; signerPublicKey: JsonWebKey }> {
  const request = issueOfflineFieldGrantSchema.parse(input.request);
  if (
    request.protocolPackageId !== baselineFieldProtocolPackage.manifest.packageId ||
    request.protocolPackageVersion !== baselineFieldProtocolPackage.manifest.packageVersion
  ) {
    throw new Error("field_protocol_incompatible");
  }
  const durationMs = (request.durationHours ?? 72) * 60 * 60 * 1_000;
  if (durationMs > MAX_OFFLINE_FIELD_GRANT_MS || durationMs <= 0) {
    throw new Error("field_grant_duration_invalid");
  }
  const result = await withTransaction(input.db, async (db) => {
    const deviceResult = await db.query<{
      role: "desk" | "recorder";
      signing_public_key_fingerprint: string;
      status: string;
    }>(
      `select role, signing_public_key_fingerprint, status
       from field_authorized_devices
       where id = $1 and account_id = $2 for update`,
      [request.deviceId, input.accountId],
    );
    const device = deviceResult.rows[0];
    if (device?.status !== "active") throw new Error("field_device_not_authorized");
    const grantId = `field_grant_${randomUUID().replaceAll("-", "")}`;
    const claims: OfflineFieldGrantClaims = {
      accountId: input.accountId,
      applicationBuildId: request.applicationBuildId,
      applicationVersion: request.applicationVersion,
      deviceId: request.deviceId,
      devicePublicKeyFingerprint: device.signing_public_key_fingerprint,
      expiresAt: new Date(input.now.getTime() + durationMs).toISOString(),
      grantId,
      issuedAt: input.now.toISOString(),
      protocolPackageId: request.protocolPackageId,
      protocolPackageVersion: request.protocolPackageVersion,
      researcherRole: device.role,
      signerKeyId: input.signing.signerKeyId,
      version: FIELD_GRANT_VERSION,
    };
    const signature = await signClaims(claims, input.signing.privateKey);
    await db.query(
      `insert into field_offline_grants (
         id, device_id, account_id, issued_at, expires_at, grant_version,
         signer_key_id, signature_fingerprint, grant_claims, status, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'active', $4)`,
      [
        grantId,
        request.deviceId,
        input.accountId,
        input.now,
        new Date(input.now.getTime() + durationMs),
        FIELD_GRANT_VERSION,
        input.signing.signerKeyId,
        await sha256Hex(new TextEncoder().encode(signature)),
        JSON.stringify(claims),
      ],
    );
    await db.query(
      `insert into field_device_audit_events
         (id, device_id, account_id, operation, outcome_code, occurred_at)
       values ($1, $2, $3, 'grant_issued', 'issued', $4)`,
      [
        `field_audit_${randomUUID().replaceAll("-", "")}`,
        request.deviceId,
        input.accountId,
        input.now,
      ],
    );
    return { claims, signature };
  });
  return { grant: result, signerPublicKey: input.signing.publicKey };
}

export function offlineFieldGrantPolicy() {
  return {
    clockRollbackToleranceMinutes: 2,
    defaultDurationHours: DEFAULT_OFFLINE_FIELD_GRANT_MS / 3_600_000,
    maxDurationHours: MAX_OFFLINE_FIELD_GRANT_MS / 3_600_000,
    revocationSemantics: "learned_during_explicit_online_preflight",
  } as const;
}

async function signClaims(claims: OfflineFieldGrantClaims, privateJwk: JsonWebKey) {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    key,
    new TextEncoder().encode(canonicalStringify(claims)),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

async function withTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
): Promise<T> {
  if (db.transaction) return db.transaction(callback);
  if (db.inTransaction) return callback(db);
  throw new Error("field_grant_transaction_required");
}

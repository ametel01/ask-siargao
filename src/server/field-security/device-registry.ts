import { randomUUID } from "node:crypto";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { convertCOSEtoPKCS } from "@simplewebauthn/server/helpers";
import { z } from "zod";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { sha256Hex } from "@/features/field-security/encoding";
import { fieldDeviceRoleSchema, publicJwkSchema } from "@/features/field-security/types";
import type { DatabaseQueryClient } from "@/server/db/query-client";

export const registerFieldDeviceSchema = z.strictObject({
  agreementPublicKey: publicJwkSchema,
  agreementPublicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  applicationVersion: z.string().min(1).max(50),
  registrationResponse: z.unknown(),
  role: fieldDeviceRoleSchema,
  signingPublicKey: publicJwkSchema,
  signingPublicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export type RegisterFieldDeviceInput = z.input<typeof registerFieldDeviceSchema>;

export type ActiveFieldDevice = {
  agreementPublicKey: JsonWebKey;
  agreementPublicKeyFingerprint: string;
  id: string;
  role: "desk" | "recorder";
  signingPublicKey: JsonWebKey;
  signingPublicKeyFingerprint: string;
};

export type RegisteredFieldDevice = ActiveFieldDevice & {
  unlockCredential: {
    backupEligible: false;
    credentialId: string;
    publicKey: JsonWebKey;
    userVerified: true;
  };
};

export async function registerFieldDevice(input: {
  accountId: string;
  challenge: string;
  db: DatabaseQueryClient;
  expectedOrigin: string;
  expectedRpId: string;
  now: Date;
  request: RegisterFieldDeviceInput;
}): Promise<RegisteredFieldDevice> {
  const request = registerFieldDeviceSchema.parse(input.request);
  const [actualSigningFingerprint, actualAgreementFingerprint] = await Promise.all([
    fingerprintJwk(request.signingPublicKey),
    fingerprintJwk(request.agreementPublicKey),
  ]);
  if (
    actualSigningFingerprint !== request.signingPublicKeyFingerprint ||
    actualAgreementFingerprint !== request.agreementPublicKeyFingerprint
  ) {
    throw new Error("field_device_key_fingerprint_invalid");
  }
  const verification = await verifyRegistrationResponse({
    expectedChallenge: input.challenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRpId,
    requireUserPresence: true,
    requireUserVerification: true,
    response: request.registrationResponse as RegistrationResponseJSON,
    supportedAlgorithmIDs: [-7],
  });
  const info = verification.registrationInfo;
  if (
    !verification.verified ||
    !info?.userVerified ||
    info.credentialDeviceType !== "singleDevice" ||
    info.credentialBackedUp
  ) {
    throw new Error("field_unlock_credential_ineligible");
  }
  const spki = convertCOSEtoPKCS(info.credential.publicKey);
  const imported = await crypto.subtle.importKey(
    "spki",
    spki,
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const webauthnPublicKey = await crypto.subtle.exportKey("jwk", imported);
  const id = `field_device_${randomUUID().replaceAll("-", "")}`;
  await withTransaction(input.db, async (db) => {
    await db.query(
      `insert into field_authorized_devices (
         id, account_id, role, signing_public_key, signing_public_key_fingerprint,
         agreement_public_key, agreement_public_key_fingerprint,
         webauthn_credential_id, webauthn_public_key, webauthn_backup_eligible,
         webauthn_user_verified, application_version, registration_version,
         status, registered_at, updated_at
       ) values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9::jsonb,
         false, true, $10, 'field-device-registration.v1', 'active', $11, $11)`,
      [
        id,
        input.accountId,
        request.role,
        JSON.stringify(request.signingPublicKey),
        request.signingPublicKeyFingerprint,
        JSON.stringify(request.agreementPublicKey),
        request.agreementPublicKeyFingerprint,
        info.credential.id,
        JSON.stringify(webauthnPublicKey),
        request.applicationVersion,
        input.now,
      ],
    );
    await db.query(
      `insert into field_device_audit_events
         (id, device_id, account_id, operation, outcome_code, occurred_at)
       values ($1, $2, $3, 'device_registered', 'registered', $4)`,
      [`field_audit_${randomUUID().replaceAll("-", "")}`, id, input.accountId, input.now],
    );
  });
  return {
    agreementPublicKey: request.agreementPublicKey,
    agreementPublicKeyFingerprint: request.agreementPublicKeyFingerprint,
    id,
    role: request.role,
    signingPublicKey: request.signingPublicKey,
    signingPublicKeyFingerprint: request.signingPublicKeyFingerprint,
    unlockCredential: {
      backupEligible: false,
      credentialId: info.credential.id,
      publicKey: webauthnPublicKey,
      userVerified: true,
    },
  };
}

export async function listActiveFieldDevices(input: {
  accountId: string;
  db: DatabaseQueryClient;
}): Promise<ActiveFieldDevice[]> {
  const result = await input.db.query<{
    agreement_public_key: JsonWebKey;
    agreement_public_key_fingerprint: string;
    id: string;
    role: "desk" | "recorder";
    signing_public_key: JsonWebKey;
    signing_public_key_fingerprint: string;
  }>(
    `select id, role, signing_public_key, signing_public_key_fingerprint,
       agreement_public_key, agreement_public_key_fingerprint
     from field_authorized_devices
     where account_id = $1 and status = 'active'
     order by registered_at, id`,
    [input.accountId],
  );
  return result.rows.map((row) => ({
    agreementPublicKey: row.agreement_public_key,
    agreementPublicKeyFingerprint: row.agreement_public_key_fingerprint,
    id: row.id,
    role: row.role,
    signingPublicKey: row.signing_public_key,
    signingPublicKeyFingerprint: row.signing_public_key_fingerprint,
  }));
}

export async function revokeFieldDevice(input: {
  accountId: string;
  db: DatabaseQueryClient;
  deviceId: string;
  now: Date;
}): Promise<{ status: "already_revoked" | "revoked" }> {
  return withTransaction(input.db, async (db) => {
    const current = await db.query<{ status: string }>(
      `select status from field_authorized_devices
       where id = $1 and account_id = $2 for update`,
      [input.deviceId, input.accountId],
    );
    const device = current.rows[0];
    if (!device) throw new Error("field_device_not_found");
    if (device.status === "revoked") return { status: "already_revoked" };
    await db.query(
      `update field_authorized_devices
       set status = 'revoked', revoked_at = $3, updated_at = $3
       where id = $1 and account_id = $2 and status = 'active'`,
      [input.deviceId, input.accountId, input.now],
    );
    await db.query(
      `update field_offline_grants set status = 'revoked', revoked_at = $3
       where device_id = $1 and account_id = $2 and status = 'active'`,
      [input.deviceId, input.accountId, input.now],
    );
    await db.query(
      `insert into field_device_audit_events
         (id, device_id, account_id, operation, outcome_code, occurred_at)
       values ($1, $2, $3, 'device_revoked', 'future_trust_removed', $4)`,
      [
        `field_audit_${randomUUID().replaceAll("-", "")}`,
        input.deviceId,
        input.accountId,
        input.now,
      ],
    );
    return { status: "revoked" };
  });
}

async function fingerprintJwk(jwk: JsonWebKey): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalStringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
    ),
  );
}

async function withTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
): Promise<T> {
  if (db.transaction) return db.transaction(callback);
  if (db.inTransaction) return callback(db);
  throw new Error("field_device_transaction_required");
}

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { resolveProtocolForWork } from "@/features/field-protocol/field-protocol";
import {
  asArrayBuffer,
  decodeBase64Url,
  fieldTextEncoder,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import {
  FIELD_CLOCK_ROLLBACK_TOLERANCE_MS,
  type FieldGrantValidationContext,
  type OfflineFieldGrantClaims,
  type SignedOfflineFieldGrant,
  signedOfflineFieldGrantSchema,
} from "@/features/field-security/types";

export async function verifyOfflineFieldGrant(input: {
  context: FieldGrantValidationContext;
  grant: unknown;
  installedProtocolBundles?: readonly unknown[];
}): Promise<OfflineFieldGrantClaims> {
  const parsed = signedOfflineFieldGrantSchema.safeParse(input.grant);
  if (!parsed.success) throw new FieldSecurityError("field_grant_invalid");
  const { claims, signature } = parsed.data;
  const signer = input.context.trustedSignerKeys.get(claims.signerKeyId);
  if (!signer || !(await verifyClaimsSignature(claims, signature, signer))) {
    throw new FieldSecurityError("field_grant_invalid");
  }

  const nowMs = input.context.now.getTime();
  if (
    input.context.lastTrustedWallClockMs !== undefined &&
    nowMs + FIELD_CLOCK_ROLLBACK_TOLERANCE_MS < input.context.lastTrustedWallClockMs
  ) {
    throw new FieldSecurityError("field_clock_rollback_detected");
  }
  if (nowMs < Date.parse(claims.issuedAt) - FIELD_CLOCK_ROLLBACK_TOLERANCE_MS) {
    throw new FieldSecurityError("field_clock_rollback_detected");
  }
  if (nowMs >= Date.parse(claims.expiresAt)) {
    throw new FieldSecurityError("field_grant_expired");
  }
  if (
    claims.deviceId !== input.context.deviceId ||
    claims.devicePublicKeyFingerprint !== input.context.devicePublicKeyFingerprint
  ) {
    throw new FieldSecurityError("field_device_not_authorized");
  }
  if (input.context.learnedRevokedDeviceIds?.has(claims.deviceId)) {
    throw new FieldSecurityError("field_device_revoked");
  }
  if (
    claims.applicationVersion !== input.context.applicationVersion ||
    claims.applicationBuildId !== input.context.applicationBuildId
  ) {
    throw new FieldSecurityError("field_grant_version_incompatible");
  }

  const installed = input.installedProtocolBundles;
  if (installed) {
    try {
      await resolveProtocolForWork(
        {
          protocolPackageId: claims.protocolPackageId,
          protocolPackageVersion: claims.protocolPackageVersion,
        },
        installed,
        { applicationVersion: input.context.applicationVersion },
      );
    } catch {
      throw new FieldSecurityError("field_protocol_incompatible");
    }
  }
  return claims;
}

export async function verifyDeviceKeyProof(input: {
  challenge: Uint8Array;
  publicKey: JsonWebKey;
  signature: string;
}): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      input.publicKey,
      { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      key,
      asArrayBuffer(decodeBase64Url(input.signature)),
      asArrayBuffer(input.challenge),
    );
  } catch {
    return false;
  }
}

async function verifyClaimsSignature(
  claims: OfflineFieldGrantClaims,
  signature: string,
  signer: JsonWebKey,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      signer,
      { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      key,
      asArrayBuffer(decodeBase64Url(signature)),
      asArrayBuffer(fieldTextEncoder.encode(canonicalStringify(claims))),
    );
  } catch {
    return false;
  }
}

export type { SignedOfflineFieldGrant };

import {
  baselineFieldProtocolPackage,
  verifyFieldProtocolPackage,
} from "@/features/field-protocol/field-protocol";
import { FieldSecurityError } from "@/features/field-security/errors";
import { verifyOfflineFieldGrant } from "@/features/field-security/grant";
import {
  type OfflineFieldGrantClaims,
  signedOfflineFieldGrantSchema,
} from "@/features/field-security/types";
import { evaluateFieldReadiness, type FieldVaultMetadata } from "@/features/field-security/vault";

type FieldReadinessMetadata = Extract<FieldVaultMetadata, { key: "field-readiness" }>;

export async function verifyFirstUseFieldAuthority(input: {
  applicationBuildId: string;
  applicationVersion: string;
  deviceId: string;
  devicePublicKeyFingerprint: string;
  grantResponse: unknown;
  now?: Date;
  protocolBundle?: unknown;
}): Promise<OfflineFieldGrantClaims> {
  const protocol = await verifyFieldProtocolPackage({
    applicationVersion: input.applicationVersion,
    bundle: input.protocolBundle ?? baselineFieldProtocolPackage,
  });
  if (!protocol.success) {
    throw new FieldSecurityError("field_protocol_incompatible");
  }

  const response = input.grantResponse as {
    grant?: unknown;
    signerPublicKey?: JsonWebKey;
  };
  const parsedGrant = signedOfflineFieldGrantSchema.safeParse(response?.grant);
  if (!parsedGrant.success || !response.signerPublicKey) {
    throw new FieldSecurityError("field_grant_invalid");
  }

  return verifyOfflineFieldGrant({
    context: {
      applicationBuildId: input.applicationBuildId,
      applicationVersion: input.applicationVersion,
      deviceId: input.deviceId,
      devicePublicKeyFingerprint: input.devicePublicKeyFingerprint,
      now: input.now ?? new Date(),
      trustedSignerKeys: new Map([[parsedGrant.data.claims.signerKeyId, response.signerPublicKey]]),
    },
    grant: parsedGrant.data,
    installedProtocolBundles: [input.protocolBundle ?? baselineFieldProtocolPackage],
  });
}

export function isVerifiedFieldGrantUsable(expiresAt: string | undefined, nowMs = Date.now()) {
  return (
    expiresAt !== undefined &&
    Number.isFinite(Date.parse(expiresAt)) &&
    nowMs < Date.parse(expiresAt)
  );
}

export function completeFirstUseFieldReadiness(input: {
  availableBytes: number;
  buildId: string;
  grantUsable: boolean;
  offlineShellPrepared: boolean;
  persisted: boolean;
  preparedAt: string;
  protocolVerified: boolean;
  recoveryVerified: boolean;
}): { ready: false; reasons: string[] } | { ready: true; metadata: FieldReadinessMetadata } {
  const readiness = evaluateFieldReadiness(input);
  if (!readiness.ready) return { ready: false, reasons: readiness.reasons };
  return {
    ready: true,
    metadata: {
      key: "field-readiness",
      value: {
        buildId: input.buildId,
        offlineShellPrepared: true,
        persisted: true,
        preparedAt: input.preparedAt,
        version: 1,
      },
    },
  };
}

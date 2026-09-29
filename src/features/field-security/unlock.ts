import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import { decryptFieldValue, unwrapFieldVaultKeyForDevice } from "@/features/field-security/crypto";
import {
  asArrayBuffer,
  encodeBase64Url,
  randomFieldBytes,
  zeroize,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import { verifyDeviceKeyProof, verifyOfflineFieldGrant } from "@/features/field-security/grant";
import {
  type OfflineFieldGrantClaims,
  signedOfflineFieldGrantSchema,
} from "@/features/field-security/types";
import { IndexedDbFieldVault } from "./vault";
import { type DeviceBoundCredentialEvidence, verifyOfflineWebAuthnAssertion } from "./webauthn";

export type StoredFieldAuthorization = {
  device: {
    id: string;
    signingPublicKey: JsonWebKey;
    signingPublicKeyFingerprint: string;
  };
  grantResponse: unknown;
  version: 1;
};

export async function createOfflineUnlockRequest(
  vault: IndexedDbFieldVault = new IndexedDbFieldVault(),
): Promise<{
  challenge: Uint8Array;
  credential: DeviceBoundCredentialEvidence;
}> {
  const credential = await vault.getMetadata("unlock-credential");
  if (!credential) throw new FieldSecurityError("field_key_unavailable");
  return { challenge: randomFieldBytes(32), credential: credential.value };
}

export async function unlockFieldVault(input: {
  applicationBuildId: string;
  applicationVersion: string;
  assertion: {
    authenticatorData: string;
    clientDataJson: string;
    credentialId: string;
    signature: string;
  };
  challenge: Uint8Array;
  expectedOrigin: string;
  learnedRevokedDeviceIds?: ReadonlySet<string>;
  now: Date;
  rpId: string;
  vault?: IndexedDbFieldVault;
}): Promise<{ claims: OfflineFieldGrantClaims; vaultKey: Uint8Array }> {
  const vault = input.vault ?? new IndexedDbFieldVault();
  const [credential, deviceWrap, authorizationPointer, trustedClock] = await Promise.all([
    vault.getMetadata("unlock-credential"),
    vault.getMetadata("device-wrap"),
    vault.getMetadata("authorization-envelope"),
    vault.getMetadata("trusted-wall-clock"),
  ]);
  if (!credential || !deviceWrap || !authorizationPointer) {
    throw new FieldSecurityError("field_key_unavailable");
  }
  if (
    !(await verifyOfflineWebAuthnAssertion({
      assertion: input.assertion,
      challenge: input.challenge,
      credential: credential.value,
      expectedOrigin: input.expectedOrigin,
      rpId: input.rpId,
    }))
  ) {
    throw new FieldSecurityError("field_unlock_failed");
  }

  let vaultKey: Uint8Array | undefined;
  try {
    const agreementPrivateKey = await vault.getDeviceKey("agreement-private");
    vaultKey = await unwrapFieldVaultKeyForDevice({
      agreementPrivateKey,
      wrap: deviceWrap.value,
    });
    const envelope = await vault.getEnvelope(authorizationPointer.value.opaqueRecordKey);
    if (!envelope) throw new FieldSecurityError("field_key_unavailable");
    const authorization = decryptFieldValue<StoredFieldAuthorization>(envelope, vaultKey);
    if (authorization.version !== 1) {
      throw new FieldSecurityError("field_grant_version_incompatible");
    }
    const grantResponse = authorization.grantResponse as {
      grant?: unknown;
      signerPublicKey?: JsonWebKey;
    };
    const parsedGrant = signedOfflineFieldGrantSchema.safeParse(grantResponse.grant);
    if (!parsedGrant.success || !grantResponse.signerPublicKey) {
      throw new FieldSecurityError("field_grant_invalid");
    }

    const proofChallenge = randomFieldBytes(32);
    const signingPrivateKey = await vault.getDeviceKey("signing-private");
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { hash: "SHA-256", name: "ECDSA" },
        signingPrivateKey,
        asArrayBuffer(proofChallenge),
      ),
    );
    if (
      !(await verifyDeviceKeyProof({
        challenge: proofChallenge,
        publicKey: authorization.device.signingPublicKey,
        signature: encodeBase64Url(signature),
      }))
    ) {
      throw new FieldSecurityError("field_device_not_authorized");
    }

    const claims = await verifyOfflineFieldGrant({
      context: {
        applicationBuildId: input.applicationBuildId,
        applicationVersion: input.applicationVersion,
        deviceId: authorization.device.id,
        devicePublicKeyFingerprint: authorization.device.signingPublicKeyFingerprint,
        lastTrustedWallClockMs: trustedClock?.value.observedAtMs,
        learnedRevokedDeviceIds: input.learnedRevokedDeviceIds,
        now: input.now,
        trustedSignerKeys: new Map([
          [parsedGrant.data.claims.signerKeyId, grantResponse.signerPublicKey],
        ]),
      },
      grant: parsedGrant.data,
      installedProtocolBundles: [baselineFieldProtocolPackage],
    });
    await vault.putMetadata({
      key: "trusted-wall-clock",
      value: { observedAtMs: input.now.getTime(), version: 1 },
    });
    return { claims, vaultKey };
  } catch (error) {
    if (vaultKey) zeroize(vaultKey);
    throw error instanceof FieldSecurityError
      ? error
      : new FieldSecurityError("field_unlock_failed");
  }
}

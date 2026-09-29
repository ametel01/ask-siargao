import { describe, expect, test } from "bun:test";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import {
  createFieldVaultKey,
  encryptFieldValue,
  wrapFieldVaultKeyForDevice,
} from "@/features/field-security/crypto";
import { asArrayBuffer, encodeBase64Url, sha256Bytes } from "@/features/field-security/encoding";
import { FIELD_GRANT_VERSION, type OfflineFieldGrantClaims } from "./types";
import { type StoredFieldAuthorization, unlockFieldVault } from "./unlock";
import type { IndexedDbFieldVault } from "./vault";

describe("device-bound offline unlock", () => {
  test("requires WebAuthn before device keys, device proof, grant and protocol verification", async () => {
    const fixture = await unlockFixture();
    const result = await unlockFieldVault({
      applicationBuildId: "build-239",
      applicationVersion: "0.1.0",
      assertion: fixture.assertion,
      challenge: fixture.challenge,
      expectedOrigin: fixture.origin,
      now: new Date("2026-08-24T00:00:00.000Z"),
      rpId: fixture.rpId,
      vault: fixture.vault,
    });

    expect(result.claims.grantId).toBe("field_grant_1234567890123456");
    expect(result.vaultKey).toEqual(fixture.vaultKey);
    expect(fixture.observations.deviceKeyReads).toBe(2);
    expect(fixture.observations.trustedClock).toBe(Date.parse("2026-08-24T00:00:00.000Z"));
  });

  test("rejects backup-eligible assertion flags before reading device keys", async () => {
    const fixture = await unlockFixture({ flags: 0x0d });
    await expect(
      unlockFieldVault({
        applicationBuildId: "build-239",
        applicationVersion: "0.1.0",
        assertion: fixture.assertion,
        challenge: fixture.challenge,
        expectedOrigin: fixture.origin,
        now: new Date("2026-08-24T00:00:00.000Z"),
        rpId: fixture.rpId,
        vault: fixture.vault,
      }),
    ).rejects.toMatchObject({ code: "field_unlock_failed" });
    expect(fixture.observations.deviceKeyReads).toBe(0);
  });
});

async function unlockFixture(options: { flags?: number } = {}) {
  const agreementKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const signingKeys = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const webauthnKeys = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const grantSigner = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const signingPublicKey = await crypto.subtle.exportKey("jwk", signingKeys.publicKey);
  const claims: OfflineFieldGrantClaims = {
    accountId: "account_field_researcher",
    applicationBuildId: "build-239",
    applicationVersion: "0.1.0",
    deviceId: "field_device_1234567890123456",
    devicePublicKeyFingerprint: "a".repeat(64),
    expiresAt: "2026-08-26T00:00:00.000Z",
    grantId: "field_grant_1234567890123456",
    issuedAt: "2026-08-23T00:00:00.000Z",
    protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
    protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
    researcherRole: "recorder",
    signerKeyId: "field-signer-1",
    version: FIELD_GRANT_VERSION,
  };
  const grant = {
    claims,
    signature: encodeBase64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          { hash: "SHA-256", name: "ECDSA" },
          grantSigner.privateKey,
          new TextEncoder().encode(canonicalStringify(claims)),
        ),
      ),
    ),
  };
  const vaultKey = createFieldVaultKey();
  const authorization: StoredFieldAuthorization = {
    device: {
      id: claims.deviceId,
      signingPublicKey,
      signingPublicKeyFingerprint: claims.devicePublicKeyFingerprint,
    },
    grantResponse: {
      grant,
      signerPublicKey: await crypto.subtle.exportKey("jwk", grantSigner.publicKey),
    },
    version: 1,
  };
  const envelope = encryptFieldValue({
    applicationVersion: "0.1.0",
    key: vaultKey,
    value: authorization,
  });
  const wrap = await wrapFieldVaultKeyForDevice({
    agreementPrivateKey: agreementKeys.privateKey,
    vaultKey,
  });
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpId = "field.asksiargao.test";
  const origin = `https://${rpId}`;
  const credentialId = "device-credential";
  const assertion = await signedAssertion({
    challenge,
    credentialId,
    flags: options.flags ?? 0x05,
    key: webauthnKeys.privateKey,
    origin,
    rpId,
  });
  const observations = { deviceKeyReads: 0, trustedClock: undefined as number | undefined };
  const metadata = new Map<string, unknown>([
    [
      "authorization-envelope",
      {
        key: "authorization-envelope",
        value: { opaqueRecordKey: envelope.opaqueRecordKey, version: 1 },
      },
    ],
    ["device-wrap", { key: "device-wrap", value: wrap }],
    [
      "unlock-credential",
      {
        key: "unlock-credential",
        value: {
          backupEligible: false,
          credentialId,
          publicKey: await crypto.subtle.exportKey("jwk", webauthnKeys.publicKey),
          userVerified: true,
        },
      },
    ],
  ]);
  const vault = {
    getDeviceKey: async (key: string) => {
      observations.deviceKeyReads += 1;
      return key === "agreement-private" ? agreementKeys.privateKey : signingKeys.privateKey;
    },
    getEnvelope: async () => envelope,
    getMetadata: async (key: string) => metadata.get(key),
    putMetadata: async (row: { key: string; value: { observedAtMs?: number } }) => {
      metadata.set(row.key, row);
      if (row.key === "trusted-wall-clock") observations.trustedClock = row.value.observedAtMs;
    },
  } as unknown as IndexedDbFieldVault;
  return { assertion, challenge, observations, origin, rpId, vault, vaultKey };
}

async function signedAssertion(input: {
  challenge: Uint8Array;
  credentialId: string;
  flags: number;
  key: CryptoKey;
  origin: string;
  rpId: string;
}) {
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(await sha256Bytes(new TextEncoder().encode(input.rpId)));
  authenticatorData[32] = input.flags;
  authenticatorData[36] = 1;
  const clientDataJson = new TextEncoder().encode(
    JSON.stringify({
      challenge: encodeBase64Url(input.challenge),
      crossOrigin: false,
      origin: input.origin,
      type: "webauthn.get",
    }),
  );
  const clientHash = await sha256Bytes(clientDataJson);
  const signed = new Uint8Array(authenticatorData.length + clientHash.length);
  signed.set(authenticatorData);
  signed.set(clientHash, authenticatorData.length);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ hash: "SHA-256", name: "ECDSA" }, input.key, asArrayBuffer(signed)),
  );
  return {
    authenticatorData: encodeBase64Url(authenticatorData),
    clientDataJson: encodeBase64Url(clientDataJson),
    credentialId: input.credentialId,
    signature: encodeBase64Url(signature),
  };
}

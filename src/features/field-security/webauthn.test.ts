import { describe, expect, test } from "bun:test";

import { asArrayBuffer, encodeBase64Url, sha256Bytes } from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import {
  requireDeviceBoundCredential,
  verifyOfflineWebAuthnAssertion,
} from "@/features/field-security/webauthn";

const publicKey = { crv: "P-256", kty: "EC", x: "x", y: "y" };

describe("device-bound offline unlock credential", () => {
  test("requires user verification and rejects backup-eligible passkeys", () => {
    expect(
      requireDeviceBoundCredential({
        backupEligible: false,
        credentialId: "credential",
        publicKey,
        userVerified: true,
      }),
    ).toMatchObject({ credentialId: "credential" });
    for (const evidence of [
      { backupEligible: true, userVerified: true },
      { backupEligible: false, userVerified: false },
    ]) {
      expect(() =>
        requireDeviceBoundCredential({
          ...evidence,
          credentialId: "credential",
          publicKey,
        }),
      ).toThrow(new FieldSecurityError("field_unlock_credential_ineligible"));
    }
  });

  test("verifies a local assertion with UV and rejects a backup-eligible assertion", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rpId = "field.asksiargao.test";
    const origin = `https://${rpId}`;
    const credential = {
      backupEligible: false,
      credentialId: "device-credential",
      publicKey: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
      userVerified: true,
    };

    const assertion = await signedAssertion({
      challenge,
      credentialId: credential.credentialId,
      flags: 0x05,
      key: keyPair.privateKey,
      origin,
      rpId,
    });
    expect(
      await verifyOfflineWebAuthnAssertion({
        assertion,
        challenge,
        credential,
        expectedOrigin: origin,
        rpId,
      }),
    ).toBe(true);
    expect(
      await verifyOfflineWebAuthnAssertion({
        assertion: await signedAssertion({
          challenge,
          credentialId: credential.credentialId,
          flags: 0x0d,
          key: keyPair.privateKey,
          origin,
          rpId,
        }),
        challenge,
        credential,
        expectedOrigin: origin,
        rpId,
      }),
    ).toBe(false);
  });
});

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

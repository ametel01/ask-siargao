import { describe, expect, test } from "bun:test";

import {
  createFieldRecoverySecret,
  createFieldVaultKey,
  decryptFieldValue,
  encryptFieldValue,
  unwrapFieldVaultKey,
  unwrapFieldVaultKeyForDevice,
  verifyFieldRecoveryExercise,
  wrapFieldVaultKey,
  wrapFieldVaultKeyForDevice,
} from "@/features/field-security/crypto";
import { encodeBase64Url } from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";

const fastTestKdf = { memoryKiB: 32, parallelism: 1, timeCost: 1 };

describe("Protected Field Data cryptography", () => {
  test("encrypts with unique XChaCha nonces and authenticated metadata", () => {
    const key = createFieldVaultKey();
    const value = { coordinates: "9.781,-126.158", privateNote: "protected sentinel" };
    const first = encryptFieldValue({ applicationVersion: "0.1.0", key, value });
    const second = encryptFieldValue({ applicationVersion: "0.1.0", key, value });

    expect(first.algorithm).toBe("xchacha20-poly1305");
    expect(first.nonce).not.toBe(second.nonce);
    expect(JSON.stringify(first)).not.toContain("protected sentinel");
    expect(JSON.stringify(first)).not.toContain("9.781");
    expect(decryptFieldValue<typeof value>(first, key)).toEqual(value);
  });

  test("fails closed for a wrong key, changed ciphertext, and changed AAD", () => {
    const key = createFieldVaultKey();
    const envelope = encryptFieldValue({ applicationVersion: "0.1.0", key, value: { safe: true } });
    for (const candidate of [
      { envelope, key: createFieldVaultKey() },
      { envelope: { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}A` }, key },
      { envelope: { ...envelope, applicationVersion: "0.2.0" }, key },
      { envelope: { ...envelope, opaqueRecordKey: `${envelope.opaqueRecordKey}x` }, key },
    ]) {
      expect(() => decryptFieldValue(candidate.envelope, candidate.key)).toThrow(
        new FieldSecurityError("field_ciphertext_tampered"),
      );
    }
  });

  test("wraps a vault key with Argon2id and requires a successful recovery exercise", async () => {
    const key = createFieldVaultKey();
    const secret = createFieldRecoverySecret();
    const wrap = await wrapFieldVaultKey({ secret, vaultKey: key, kdfPolicy: fastTestKdf });
    expect(wrap.kdf).toBe("argon2id");
    expect(await unwrapFieldVaultKey(wrap, secret)).toEqual(key);
    expect(
      await verifyFieldRecoveryExercise({
        expectedVaultKey: key,
        secretConfirmation: secret,
        wrap,
      }),
    ).toBe(true);
    expect(
      await verifyFieldRecoveryExercise({
        expectedVaultKey: key,
        secretConfirmation: `${secret}wrong`,
        wrap,
      }),
    ).toBe(false);
  });

  test("requires the nonextractable Authorized Field Device key to unwrap the vault key", async () => {
    const deviceKeys = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const otherDeviceKeys = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const vaultKey = createFieldVaultKey();
    const wrap = await wrapFieldVaultKeyForDevice({
      agreementPrivateKey: deviceKeys.privateKey,
      vaultKey,
    });

    expect(
      await unwrapFieldVaultKeyForDevice({
        agreementPrivateKey: deviceKeys.privateKey,
        wrap,
      }),
    ).toEqual(vaultKey);
    await expect(
      unwrapFieldVaultKeyForDevice({
        agreementPrivateKey: otherDeviceKeys.privateKey,
        wrap,
      }),
    ).rejects.toEqual(new FieldSecurityError("field_key_unavailable"));
    expect(JSON.stringify(wrap)).not.toContain(encodeBase64Url(vaultKey));
  });
});

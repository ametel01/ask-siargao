import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  decodeBase64Url,
  encodeBase64Url,
  fieldTextDecoder,
  fieldTextEncoder,
  randomFieldBytes,
  sha256Bytes,
  zeroize,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import {
  FIELD_DEVICE_WRAP_VERSION,
  FIELD_ENVELOPE_VERSION,
  FIELD_RECOVERY_WRAP_VERSION,
  type FieldDeviceWrap,
  type FieldEncryptedEnvelope,
  type FieldRecoveryWrap,
} from "@/features/field-security/types";

export const fieldRecoveryKdfPolicy = {
  memoryKiB: 65_536,
  parallelism: 1,
  timeCost: 3,
} as const;

export function createFieldVaultKey(): Uint8Array {
  return randomFieldBytes(32);
}

export function createFieldRecoverySecret(): string {
  return encodeBase64Url(randomFieldBytes(32));
}

export function encryptFieldValue(input: {
  applicationVersion: string;
  key: Uint8Array;
  opaqueRecordKey?: string;
  value: unknown;
}): FieldEncryptedEnvelope {
  assertKey(input.key);
  const opaqueRecordKey =
    input.opaqueRecordKey ?? `field_record_${encodeBase64Url(randomFieldBytes(18))}`;
  const nonce = randomFieldBytes(24);
  const aad = envelopeAad(opaqueRecordKey, input.applicationVersion);
  const plaintext = fieldTextEncoder.encode(canonicalStringify(input.value));
  try {
    const ciphertext = xchacha20poly1305(input.key, nonce, aad).encrypt(plaintext);
    return {
      aadVersion: FIELD_ENVELOPE_VERSION,
      algorithm: "xchacha20-poly1305",
      applicationVersion: input.applicationVersion,
      ciphertext: encodeBase64Url(ciphertext),
      nonce: encodeBase64Url(nonce),
      opaqueRecordKey,
    };
  } finally {
    zeroize(plaintext);
  }
}

export function decryptFieldValue<T>(envelope: FieldEncryptedEnvelope, key: Uint8Array): T {
  assertKey(key);
  if (
    envelope.aadVersion !== FIELD_ENVELOPE_VERSION ||
    envelope.algorithm !== "xchacha20-poly1305"
  ) {
    throw new FieldSecurityError("field_grant_version_incompatible");
  }
  try {
    const plaintext = xchacha20poly1305(
      key,
      decodeBase64Url(envelope.nonce),
      envelopeAad(envelope.opaqueRecordKey, envelope.applicationVersion),
    ).decrypt(decodeBase64Url(envelope.ciphertext));
    try {
      return JSON.parse(fieldTextDecoder.decode(plaintext)) as T;
    } finally {
      zeroize(plaintext);
    }
  } catch (error) {
    if (error instanceof FieldSecurityError) throw error;
    throw new FieldSecurityError("field_ciphertext_tampered");
  }
}

export async function wrapFieldVaultKey(input: {
  secret: string;
  vaultKey: Uint8Array;
  kdfPolicy?: { memoryKiB: number; parallelism: number; timeCost: number };
}): Promise<FieldRecoveryWrap> {
  assertKey(input.vaultKey);
  const policy = input.kdfPolicy ?? fieldRecoveryKdfPolicy;
  const salt = randomFieldBytes(16);
  const nonce = randomFieldBytes(24);
  const kek = await deriveRecoveryKey(input.secret, salt, policy);
  try {
    const ciphertext = xchacha20poly1305(
      kek,
      nonce,
      fieldTextEncoder.encode(FIELD_RECOVERY_WRAP_VERSION),
    ).encrypt(input.vaultKey);
    return {
      algorithm: "xchacha20-poly1305",
      ciphertext: encodeBase64Url(ciphertext),
      kdf: "argon2id",
      kdfMemoryKiB: policy.memoryKiB,
      kdfParallelism: policy.parallelism,
      kdfTimeCost: policy.timeCost,
      nonce: encodeBase64Url(nonce),
      salt: encodeBase64Url(salt),
      version: FIELD_RECOVERY_WRAP_VERSION,
    };
  } finally {
    zeroize(kek);
  }
}

export async function unwrapFieldVaultKey(
  wrap: FieldRecoveryWrap,
  secret: string,
): Promise<Uint8Array> {
  if (
    wrap.version !== FIELD_RECOVERY_WRAP_VERSION ||
    wrap.algorithm !== "xchacha20-poly1305" ||
    wrap.kdf !== "argon2id"
  ) {
    throw new FieldSecurityError("field_grant_version_incompatible");
  }
  const kek = await deriveRecoveryKey(secret, decodeBase64Url(wrap.salt), {
    memoryKiB: wrap.kdfMemoryKiB,
    parallelism: wrap.kdfParallelism,
    timeCost: wrap.kdfTimeCost,
  });
  try {
    const key = xchacha20poly1305(
      kek,
      decodeBase64Url(wrap.nonce),
      fieldTextEncoder.encode(FIELD_RECOVERY_WRAP_VERSION),
    ).decrypt(decodeBase64Url(wrap.ciphertext));
    assertKey(key);
    return key;
  } catch {
    throw new FieldSecurityError("field_key_unavailable");
  } finally {
    zeroize(kek);
  }
}

export async function verifyFieldRecoveryExercise(input: {
  expectedVaultKey: Uint8Array;
  secretConfirmation: string;
  wrap: FieldRecoveryWrap;
}): Promise<boolean> {
  let restored: Uint8Array | undefined;
  try {
    restored = await unwrapFieldVaultKey(input.wrap, input.secretConfirmation);
    return constantTimeEqual(restored, input.expectedVaultKey);
  } catch {
    return false;
  } finally {
    if (restored) zeroize(restored);
  }
}

export async function wrapFieldVaultKeyForDevice(input: {
  agreementPrivateKey: CryptoKey;
  vaultKey: Uint8Array;
}): Promise<FieldDeviceWrap> {
  assertKey(input.vaultKey);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: ephemeral.publicKey },
      input.agreementPrivateKey,
      256,
    ),
  );
  const nonce = randomFieldBytes(24);
  const kek = await deriveDeviceWrappingKey(sharedSecret);
  try {
    return {
      algorithm: "xchacha20-poly1305",
      ciphertext: encodeBase64Url(
        xchacha20poly1305(kek, nonce, fieldTextEncoder.encode(FIELD_DEVICE_WRAP_VERSION)).encrypt(
          input.vaultKey,
        ),
      ),
      ephemeralPublicKey: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
      nonce: encodeBase64Url(nonce),
      version: FIELD_DEVICE_WRAP_VERSION,
    };
  } finally {
    zeroize(kek);
    zeroize(sharedSecret);
  }
}

export async function unwrapFieldVaultKeyForDevice(input: {
  agreementPrivateKey: CryptoKey;
  wrap: FieldDeviceWrap;
}): Promise<Uint8Array> {
  if (
    input.wrap.version !== FIELD_DEVICE_WRAP_VERSION ||
    input.wrap.algorithm !== "xchacha20-poly1305"
  ) {
    throw new FieldSecurityError("field_key_unavailable");
  }
  let sharedSecret: Uint8Array | undefined;
  let kek: Uint8Array | undefined;
  try {
    const ephemeralPublicKey = await crypto.subtle.importKey(
      "jwk",
      input.wrap.ephemeralPublicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    sharedSecret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: ephemeralPublicKey },
        input.agreementPrivateKey,
        256,
      ),
    );
    kek = await deriveDeviceWrappingKey(sharedSecret);
    const vaultKey = xchacha20poly1305(
      kek,
      decodeBase64Url(input.wrap.nonce),
      fieldTextEncoder.encode(FIELD_DEVICE_WRAP_VERSION),
    ).decrypt(decodeBase64Url(input.wrap.ciphertext));
    assertKey(vaultKey);
    return vaultKey;
  } catch {
    throw new FieldSecurityError("field_key_unavailable");
  } finally {
    if (kek) zeroize(kek);
    if (sharedSecret) zeroize(sharedSecret);
  }
}

async function deriveDeviceWrappingKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
  const domain = fieldTextEncoder.encode(FIELD_DEVICE_WRAP_VERSION);
  const material = new Uint8Array(domain.length + sharedSecret.length);
  material.set(domain);
  material.set(sharedSecret, domain.length);
  try {
    return sha256Bytes(material);
  } finally {
    zeroize(material);
  }
}

async function deriveRecoveryKey(
  secret: string,
  salt: Uint8Array,
  policy: { memoryKiB: number; parallelism: number; timeCost: number },
): Promise<Uint8Array> {
  if (secret.length < 32 || salt.length !== 16) {
    throw new FieldSecurityError("field_key_unavailable");
  }
  return argon2idAsync(fieldTextEncoder.encode(secret), salt, {
    asyncTick: 8,
    dkLen: 32,
    m: policy.memoryKiB,
    maxmem: Math.max(128 * 1024 * 1024, policy.memoryKiB * 1024 + 1024 * 1024),
    p: policy.parallelism,
    t: policy.timeCost,
    version: 0x13,
  });
}

function envelopeAad(opaqueRecordKey: string, applicationVersion: string): Uint8Array {
  return fieldTextEncoder.encode(
    canonicalStringify({ applicationVersion, opaqueRecordKey, version: FIELD_ENVELOPE_VERSION }),
  );
}

function assertKey(key: Uint8Array): void {
  if (key.length !== 32) throw new FieldSecurityError("field_key_unavailable");
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

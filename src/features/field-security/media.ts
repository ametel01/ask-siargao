import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

import {
  decodeBase64Url,
  encodeBase64Url,
  fieldTextDecoder,
  fieldTextEncoder,
  randomFieldBytes,
  sha256Hex,
  zeroize,
} from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";

export const MAX_FIELD_MEDIA_BYTES = 8 * 1024 * 1024;
export const FIELD_MEDIA_CHUNK_BYTES = 512 * 1024;
export const FIELD_MEDIA_VERSION = "field-media.v1" as const;

export type FieldEncryptedMediaManifest = {
  algorithm: "xchacha20-poly1305";
  chunkCount: number;
  metadataCiphertext: Uint8Array;
  metadataNonce: string;
  opaqueMediaKey: string;
  version: typeof FIELD_MEDIA_VERSION;
};

export type FieldEncryptedMediaChunk = {
  chunkKey: string;
  ciphertext: Uint8Array;
  index: number;
  nonce: string;
  opaqueMediaKey: string;
};

export type EncryptedFieldMediaBundle = {
  chunks: FieldEncryptedMediaChunk[];
  manifest: FieldEncryptedMediaManifest;
};

export type EncryptedFieldMediaPreparation = EncryptedFieldMediaBundle & {
  confirmation: FieldMediaMetadata;
};

export type DecryptedFieldMedia = FieldMediaMetadata & { bytes: Uint8Array };

export type FieldMediaMetadata = {
  contentType: string;
  plaintextBytes: number;
  sha256: string;
};

export async function encryptFieldMedia(input: {
  bytes: Uint8Array;
  contentType: string;
  key: Uint8Array;
  opaqueMediaKey?: string;
}): Promise<EncryptedFieldMediaPreparation> {
  assertMediaInput(input);
  const opaqueMediaKey =
    input.opaqueMediaKey ?? `field_media_${encodeBase64Url(randomFieldBytes(18))}`;
  if (!/^field_media_[A-Za-z0-9_-]{16,}$/u.test(opaqueMediaKey)) {
    throw new FieldSecurityError("field_media_integrity_failed");
  }
  const sha256 = await sha256Hex(input.bytes);
  const chunkCount = Math.ceil(input.bytes.byteLength / FIELD_MEDIA_CHUNK_BYTES);
  const confirmation = {
    contentType: input.contentType,
    plaintextBytes: input.bytes.byteLength,
    sha256,
  };
  const metadataNonce = randomFieldBytes(24);
  const metadataPlaintext = fieldTextEncoder.encode(JSON.stringify(confirmation));
  let metadataCiphertext: Uint8Array;
  try {
    metadataCiphertext = xchacha20poly1305(
      input.key,
      metadataNonce,
      mediaMetadataAad(opaqueMediaKey),
    ).encrypt(metadataPlaintext);
  } finally {
    zeroize(metadataPlaintext);
  }
  const encodedMetadataNonce = encodeBase64Url(metadataNonce);
  zeroize(metadataNonce);
  const chunks: FieldEncryptedMediaChunk[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * FIELD_MEDIA_CHUNK_BYTES;
    const plaintext = input.bytes.slice(start, start + FIELD_MEDIA_CHUNK_BYTES);
    const nonce = randomFieldBytes(24);
    try {
      chunks.push({
        chunkKey: `${opaqueMediaKey}:${index}`,
        ciphertext: xchacha20poly1305(
          input.key,
          nonce,
          mediaChunkAad({ chunkCount, index, opaqueMediaKey }),
        ).encrypt(plaintext),
        index,
        nonce: encodeBase64Url(nonce),
        opaqueMediaKey,
      });
    } finally {
      zeroize(plaintext);
      zeroize(nonce);
    }
  }
  return {
    chunks,
    confirmation,
    manifest: {
      algorithm: "xchacha20-poly1305",
      chunkCount,
      metadataCiphertext,
      metadataNonce: encodedMetadataNonce,
      opaqueMediaKey,
      version: FIELD_MEDIA_VERSION,
    },
  };
}

export async function decryptFieldMedia(
  bundle: EncryptedFieldMediaBundle,
  key: Uint8Array,
): Promise<DecryptedFieldMedia> {
  const { manifest } = bundle;
  if (
    key.length !== 32 ||
    manifest.version !== FIELD_MEDIA_VERSION ||
    manifest.algorithm !== "xchacha20-poly1305" ||
    manifest.chunkCount < 1 ||
    manifest.chunkCount > Math.ceil(MAX_FIELD_MEDIA_BYTES / FIELD_MEDIA_CHUNK_BYTES) ||
    manifest.chunkCount !== bundle.chunks.length
  ) {
    throw new FieldSecurityError("field_media_integrity_failed");
  }
  let metadataPlaintext: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    metadataPlaintext = xchacha20poly1305(
      key,
      decodeBase64Url(manifest.metadataNonce),
      mediaMetadataAad(manifest.opaqueMediaKey),
    ).decrypt(manifest.metadataCiphertext);
    const metadata = parseMediaMetadata(fieldTextDecoder.decode(metadataPlaintext));
    plaintext = new Uint8Array(metadata.plaintextBytes);
    let offset = 0;
    for (const [expectedIndex, chunk] of [...bundle.chunks]
      .sort((left, right) => left.index - right.index)
      .entries()) {
      if (
        chunk.index !== expectedIndex ||
        chunk.opaqueMediaKey !== manifest.opaqueMediaKey ||
        chunk.chunkKey !== `${manifest.opaqueMediaKey}:${expectedIndex}`
      ) {
        throw new FieldSecurityError("field_media_integrity_failed");
      }
      const decrypted = xchacha20poly1305(
        key,
        decodeBase64Url(chunk.nonce),
        mediaChunkAad({
          chunkCount: manifest.chunkCount,
          index: expectedIndex,
          opaqueMediaKey: manifest.opaqueMediaKey,
        }),
      ).decrypt(chunk.ciphertext);
      plaintext.set(decrypted, offset);
      offset += decrypted.byteLength;
      zeroize(decrypted);
    }
    if (offset !== metadata.plaintextBytes || (await sha256Hex(plaintext)) !== metadata.sha256) {
      throw new FieldSecurityError("field_media_integrity_failed");
    }
    return { ...metadata, bytes: plaintext };
  } catch (error) {
    if (plaintext) zeroize(plaintext);
    throw error instanceof FieldSecurityError
      ? error
      : new FieldSecurityError("field_media_integrity_failed");
  } finally {
    if (metadataPlaintext) zeroize(metadataPlaintext);
  }
}

function assertMediaInput(input: {
  bytes: Uint8Array;
  contentType: string;
  key: Uint8Array;
}): void {
  if (input.key.length !== 32) throw new FieldSecurityError("field_key_unavailable");
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_FIELD_MEDIA_BYTES) {
    throw new FieldSecurityError("field_media_too_large");
  }
  if (!/^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,127}$/iu.test(input.contentType)) {
    throw new FieldSecurityError("field_media_integrity_failed");
  }
}

function mediaChunkAad(input: {
  chunkCount: number;
  index: number;
  opaqueMediaKey: string;
}): Uint8Array {
  return fieldTextEncoder.encode(JSON.stringify({ ...input, version: FIELD_MEDIA_VERSION }));
}

function mediaMetadataAad(opaqueMediaKey: string): Uint8Array {
  return fieldTextEncoder.encode(JSON.stringify({ opaqueMediaKey, version: FIELD_MEDIA_VERSION }));
}

function parseMediaMetadata(value: string): FieldMediaMetadata {
  const parsed = JSON.parse(value) as Partial<FieldMediaMetadata>;
  if (
    typeof parsed.contentType !== "string" ||
    !/^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,127}$/iu.test(parsed.contentType) ||
    !Number.isSafeInteger(parsed.plaintextBytes) ||
    (parsed.plaintextBytes ?? 0) < 1 ||
    (parsed.plaintextBytes ?? 0) > MAX_FIELD_MEDIA_BYTES ||
    typeof parsed.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(parsed.sha256)
  ) {
    throw new FieldSecurityError("field_media_integrity_failed");
  }
  return parsed as FieldMediaMetadata;
}

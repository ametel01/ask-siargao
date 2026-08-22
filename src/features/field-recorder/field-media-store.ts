import { FieldSecurityError } from "@/features/field-security/errors";
import {
  decryptFieldMedia,
  type EncryptedFieldMediaPreparation,
  encryptFieldMedia,
  MAX_FIELD_MEDIA_BYTES,
} from "@/features/field-security/media";
import { estimateFieldStorage, IndexedDbFieldVault } from "@/features/field-security/vault";

const supportedRecorderMediaTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);

export type PreparedRecorderMedia = Readonly<{
  bundle: EncryptedFieldMediaPreparation;
  byteSize: number;
  contentSha256: string;
  mediaType: "image/jpeg" | "image/png" | "application/pdf";
  opaqueMediaKey: string;
}>;

export async function prepareRecorderMedia(input: {
  bytes: Uint8Array;
  key: Uint8Array;
  mediaType: string;
}): Promise<PreparedRecorderMedia> {
  if (!supportedRecorderMediaTypes.has(input.mediaType)) {
    throw new FieldSecurityError("field_media_integrity_failed");
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_FIELD_MEDIA_BYTES) {
    throw new FieldSecurityError("field_media_too_large");
  }
  const storage = await estimateFieldStorage();
  if (storage.availableBytes <= input.bytes.byteLength + 1024 * 1024) {
    throw new FieldSecurityError("field_storage_unavailable");
  }
  const bundle = await encryptFieldMedia({
    bytes: input.bytes,
    contentType: input.mediaType,
    key: input.key,
  });
  return {
    bundle,
    byteSize: bundle.confirmation.plaintextBytes,
    contentSha256: bundle.confirmation.sha256,
    mediaType: input.mediaType as PreparedRecorderMedia["mediaType"],
    opaqueMediaKey: bundle.manifest.opaqueMediaKey,
  };
}

export async function readRecorderMedia(input: {
  key: Uint8Array;
  opaqueMediaKey: string;
  vault?: IndexedDbFieldVault;
}): Promise<Uint8Array> {
  const bundle = await (input.vault ?? new IndexedDbFieldVault()).getEncryptedMedia(
    input.opaqueMediaKey,
  );
  if (!bundle) throw new FieldSecurityError("field_media_integrity_failed");
  return (await decryptFieldMedia(bundle, input.key)).bytes;
}

export function withRecorderObjectUrl<T>(
  bytes: Uint8Array,
  mediaType: string,
  callback: (url: string) => T,
): T {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
  try {
    return callback(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

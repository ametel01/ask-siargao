import { describe, expect, test } from "bun:test";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import {
  decryptFieldMedia,
  encryptFieldMedia,
  FIELD_MEDIA_CHUNK_BYTES,
  MAX_FIELD_MEDIA_BYTES,
} from "@/features/field-security/media";

describe("bounded encrypted field media", () => {
  test("hashes before confirmation and round-trips encrypted chunks", async () => {
    const bytes = new Uint8Array(FIELD_MEDIA_CHUNK_BYTES + 7).fill(17);
    const key = createFieldVaultKey();
    const bundle = await encryptFieldMedia({ bytes, contentType: "image/jpeg", key });

    expect(bundle.manifest.chunkCount).toBe(2);
    expect(bundle.confirmation.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(bundle.manifest)).not.toContain(bundle.confirmation.sha256);
    expect(JSON.stringify(bundle.manifest)).not.toContain("image/jpeg");
    expect(JSON.stringify(bundle)).not.toContain(String.fromCharCode(...bytes.slice(0, 20)));
    expect(await decryptFieldMedia(bundle, key)).toEqual({
      bytes,
      ...bundle.confirmation,
    });
  });

  test("rejects empty and over-limit assets before returning a capture bundle", async () => {
    const key = createFieldVaultKey();
    await expect(
      encryptFieldMedia({ bytes: new Uint8Array(), contentType: "image/jpeg", key }),
    ).rejects.toEqual(new FieldSecurityError("field_media_too_large"));
    await expect(
      encryptFieldMedia({
        bytes: new Uint8Array(MAX_FIELD_MEDIA_BYTES + 1),
        contentType: "image/jpeg",
        key,
      }),
    ).rejects.toEqual(new FieldSecurityError("field_media_too_large"));
  });

  test("fails closed on a changed chunk or manifest digest", async () => {
    const key = createFieldVaultKey();
    const bundle = await encryptFieldMedia({
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "application/pdf",
      key,
    });
    bundle.chunks[0].ciphertext[0] ^= 1;
    await expect(decryptFieldMedia(bundle, key)).rejects.toEqual(
      new FieldSecurityError("field_media_integrity_failed"),
    );
  });
});

import { beforeEach, describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import { MAX_FIELD_MEDIA_BYTES } from "@/features/field-security/media";
import { IndexedDbFieldVault } from "@/features/field-security/vault";

import {
  prepareRecorderMedia,
  readRecorderMedia,
  withRecorderObjectUrl,
} from "./field-media-store";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("ask-siargao-protected-field-vault");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: { estimate: async () => ({ quota: 32 * 1024 * 1024, usage: 1024 }) },
  });
});

describe("Recorder media", () => {
  test("hashes, encrypts, stores, and verifies bounded media without plaintext metadata", async () => {
    const key = createFieldVaultKey();
    const bytes = new TextEncoder().encode("synthetic camera bytes");
    const prepared = await prepareRecorderMedia({ bytes, key, mediaType: "image/jpeg" });
    expect(prepared.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared.byteSize).toBe(bytes.byteLength);
    expect(JSON.stringify(prepared.bundle.manifest)).not.toContain("image/jpeg");
    expect(JSON.stringify(prepared.bundle.manifest)).not.toContain(prepared.contentSha256);

    const vault = new IndexedDbFieldVault();
    await vault.putEncryptedMedia(prepared.bundle);
    expect(
      await readRecorderMedia({ key, opaqueMediaKey: prepared.opaqueMediaKey, vault }),
    ).toEqual(bytes);
  });

  test("fails before confirmation for oversized, unsupported, and low-headroom capture", async () => {
    await expect(
      prepareRecorderMedia({
        bytes: new Uint8Array(MAX_FIELD_MEDIA_BYTES + 1),
        key: createFieldVaultKey(),
        mediaType: "image/jpeg",
      }),
    ).rejects.toEqual(new FieldSecurityError("field_media_too_large"));
    await expect(
      prepareRecorderMedia({
        bytes: new Uint8Array([1]),
        key: createFieldVaultKey(),
        mediaType: "video/mp4",
      }),
    ).rejects.toEqual(new FieldSecurityError("field_media_integrity_failed"));

    Object.defineProperty(globalThis.navigator, "storage", {
      configurable: true,
      value: { estimate: async () => ({ quota: 10, usage: 9 }) },
    });
    await expect(
      prepareRecorderMedia({
        bytes: new Uint8Array([1]),
        key: createFieldVaultKey(),
        mediaType: "image/png",
      }),
    ).rejects.toEqual(new FieldSecurityError("field_storage_unavailable"));
  });

  test("always revokes temporary object URLs", () => {
    const create = mock(() => "blob:synthetic");
    const revoke = mock(() => undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    expect(withRecorderObjectUrl(new Uint8Array([1, 2]), "image/png", (url) => url)).toBe(
      "blob:synthetic",
    );
    expect(revoke).toHaveBeenCalledWith("blob:synthetic");
  });
});

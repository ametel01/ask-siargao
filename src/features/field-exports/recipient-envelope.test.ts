import { describe, expect, test } from "bun:test";

import { createFieldVaultKey } from "@/features/field-security/crypto";
import type { ActiveRecipientDevice, AuthenticatedRegistrySnapshot } from "./artifact-schemas";
import {
  assertRecipientAuthority,
  openRecipientContentKey,
  sealContentKeyForRecipient,
} from "./recipient-envelope";

const transferId = "0192f060-4f41-7aa1-b322-4aa9fc9f1511";

describe("authorized recipient envelope", () => {
  test("seals through ephemeral ECDH and opens only for the exact registered recipient", async () => {
    const fixture = await device();
    const key = createFieldVaultKey();
    const envelope = await sealContentKeyForRecipient({
      artifactKind: "field_batch",
      contentKey: key,
      recipient: fixture.recipient,
      transferId,
    });
    expect(
      await openRecipientContentKey({
        agreementPrivateKey: fixture.privateKey,
        artifactKind: "field_batch",
        envelope,
        expectedRecipient: fixture.recipient,
        transferId,
      }),
    ).toEqual(key);

    const wrong = await device("field_device_abcdefghijklmnop");
    await expect(
      openRecipientContentKey({
        agreementPrivateKey: wrong.privateKey,
        artifactKind: "field_batch",
        envelope,
        expectedRecipient: fixture.recipient,
        transferId,
      }),
    ).rejects.toMatchObject({ code: "field_artifact_recipient_invalid" });
  });

  test("accepts only a live or bounded-age authenticated registry, never a QR claim", async () => {
    const fixture = await device();
    const now = new Date("2026-08-23T02:10:00.000Z");
    const registry: AuthenticatedRegistrySnapshot = {
      version: "field-device-registry-snapshot.v1",
      accountId: "account-one",
      authenticatedAt: "2026-08-23T02:00:00.000Z",
      expiresAt: "2026-08-23T02:15:00.000Z",
      devices: [fixture.recipient],
      source: "encrypted_registry_snapshot",
    };
    expect(assertRecipientAuthority({ deviceId: fixture.recipient.id, now, registry }).id).toBe(
      fixture.recipient.id,
    );
    await expect(() =>
      assertRecipientAuthority({
        deviceId: fixture.recipient.id,
        now: new Date("2026-08-23T02:16:00.000Z"),
        registry,
      }),
    ).toThrow();
  });
});

async function device(id = "field_device_1234567890123456") {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const signing = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const recipient: ActiveRecipientDevice = {
    id,
    role: "desk",
    agreementPublicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    agreementPublicKeyFingerprint:
      id === "field_device_1234567890123456" ? "a".repeat(64) : "c".repeat(64),
    signingPublicKey: await crypto.subtle.exportKey("jwk", signing.publicKey),
    signingPublicKeyFingerprint: "b".repeat(64),
  };
  return { privateKey: pair.privateKey, recipient };
}

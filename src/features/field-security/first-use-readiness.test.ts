import { describe, expect, test } from "bun:test";
import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import { encodeBase64Url } from "@/features/field-security/encoding";
import {
  completeFirstUseFieldReadiness,
  isVerifiedFieldGrantUsable,
  verifyFirstUseFieldAuthority,
} from "@/features/field-security/first-use-readiness";
import { FIELD_GRANT_VERSION, type OfflineFieldGrantClaims } from "@/features/field-security/types";

describe("first-use Field Readiness authority", () => {
  test("requires a signed grant bound to the verified installed protocol", async () => {
    const fixture = await grantFixture();

    await expect(
      verifyFirstUseFieldAuthority({
        ...fixture.context,
        grantResponse: fixture.grantResponse,
      }),
    ).resolves.toEqual(fixture.claims);

    await expect(
      verifyFirstUseFieldAuthority({
        ...fixture.context,
        grantResponse: {
          ...fixture.grantResponse,
          grant: { claims: fixture.claims, signature: "x" },
        },
      }),
    ).rejects.toMatchObject({ code: "field_grant_invalid" });
  });

  test("fails closed when the installed protocol package is not verified", async () => {
    const fixture = await grantFixture();
    const tampered = structuredClone(baselineFieldProtocolPackage) as unknown as {
      manifest: { signature: { value: string } };
    };
    tampered.manifest.signature.value = "invalid";

    await expect(
      verifyFirstUseFieldAuthority({
        ...fixture.context,
        grantResponse: fixture.grantResponse,
        protocolBundle: tampered,
      }),
    ).rejects.toMatchObject({ code: "field_protocol_incompatible" });
  });

  test("treats missing, malformed, and expired verified-grant evidence as unusable", () => {
    expect(isVerifiedFieldGrantUsable(undefined, 0)).toBe(false);
    expect(isVerifiedFieldGrantUsable("not-a-date", 0)).toBe(false);
    expect(isVerifiedFieldGrantUsable("2026-08-23T01:00:00.000Z", Date.parse("2026-08-23"))).toBe(
      true,
    );
    expect(
      isVerifiedFieldGrantUsable(
        "2026-08-23T01:00:00.000Z",
        Date.parse("2026-08-23T01:00:00.000Z"),
      ),
    ).toBe(false);
  });

  test("persists readiness only after every first-use check passes", () => {
    const ready = {
      availableBytes: 100_000_000,
      buildId: "build-readiness",
      grantUsable: true,
      offlineShellPrepared: true,
      persisted: true,
      preparedAt: "2026-08-24T00:00:00.000Z",
      protocolVerified: true,
      recoveryVerified: true,
    };
    expect(completeFirstUseFieldReadiness(ready)).toEqual({
      ready: true,
      metadata: {
        key: "field-readiness",
        value: {
          buildId: ready.buildId,
          offlineShellPrepared: true,
          persisted: true,
          preparedAt: ready.preparedAt,
          version: 1,
        },
      },
    });

    for (const incomplete of [
      { ...ready, availableBytes: 0 },
      { ...ready, grantUsable: false },
      { ...ready, offlineShellPrepared: false },
      { ...ready, persisted: false },
      { ...ready, protocolVerified: false },
      { ...ready, recoveryVerified: false },
    ]) {
      expect(completeFirstUseFieldReadiness(incomplete)).toMatchObject({ ready: false });
    }
  });
});

async function grantFixture() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const signerPublicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const claims: OfflineFieldGrantClaims = {
    accountId: "account_field_researcher",
    applicationBuildId: "build-readiness",
    applicationVersion: "0.1.0",
    deviceId: "field_device_1234567890123456",
    devicePublicKeyFingerprint: "a".repeat(64),
    expiresAt: "2026-08-26T00:00:00.000Z",
    grantId: "field_grant_1234567890123456",
    issuedAt: "2026-08-23T00:00:00.000Z",
    protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
    protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
    researcherRole: "recorder",
    signerKeyId: "field-grant-signer",
    version: FIELD_GRANT_VERSION,
  };
  const signature = encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        { hash: "SHA-256", name: "ECDSA" },
        keys.privateKey,
        new TextEncoder().encode(canonicalStringify(claims)),
      ),
    ),
  );
  return {
    claims,
    context: {
      applicationBuildId: claims.applicationBuildId,
      applicationVersion: claims.applicationVersion,
      deviceId: claims.deviceId,
      devicePublicKeyFingerprint: claims.devicePublicKeyFingerprint,
      now: new Date("2026-08-24T00:00:00.000Z"),
    },
    grantResponse: {
      grant: { claims, signature },
      signerPublicKey,
    },
  };
}

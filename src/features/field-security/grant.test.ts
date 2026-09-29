import { describe, expect, test } from "bun:test";
import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import { encodeBase64Url } from "@/features/field-security/encoding";
import { verifyOfflineFieldGrant } from "@/features/field-security/grant";
import {
  FIELD_GRANT_VERSION,
  type FieldGrantValidationContext,
  type OfflineFieldGrantClaims,
} from "@/features/field-security/types";

describe("Offline Field Grant", () => {
  test("verifies signature, device, version, protocol, expiry and learned revocation", async () => {
    const fixture = await grantFixture();
    await expectGrantCode(fixture, {}, undefined);
    await expectGrantCode(
      fixture,
      { deviceId: "field_device_wrongwrongwrongwrong" },
      "field_device_not_authorized",
    );
    await expectGrantCode(
      fixture,
      { now: new Date("2026-08-27T00:00:00.000Z") },
      "field_grant_expired",
    );
    await expectGrantCode(
      fixture,
      { lastTrustedWallClockMs: Date.parse("2026-08-24T00:10:01.000Z") },
      "field_clock_rollback_detected",
    );
    await expectGrantCode(
      fixture,
      { learnedRevokedDeviceIds: new Set([fixture.claims.deviceId]) },
      "field_device_revoked",
    );
    await expectGrantCode(
      fixture,
      { applicationBuildId: "stale-build" },
      "field_grant_version_incompatible",
    );
  });

  test("rejects tampered claims and unknown signers without diagnostic values", async () => {
    const fixture = await grantFixture();
    const tampered = {
      ...fixture.grant,
      claims: { ...fixture.claims, accountId: "sensitive-account" },
    };
    await expect(
      verifyOfflineFieldGrant({ context: fixture.context, grant: tampered }),
    ).rejects.toMatchObject({ code: "field_grant_invalid", message: "field_grant_invalid" });
    await expect(
      verifyOfflineFieldGrant({
        context: { ...fixture.context, trustedSignerKeys: new Map() },
        grant: fixture.grant,
      }),
    ).rejects.toMatchObject({ code: "field_grant_invalid" });
  });
});

async function grantFixture() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
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
  const signature = encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        { hash: "SHA-256", name: "ECDSA" },
        keys.privateKey,
        new TextEncoder().encode(canonicalStringify(claims)),
      ),
    ),
  );
  const context: FieldGrantValidationContext = {
    applicationBuildId: claims.applicationBuildId,
    applicationVersion: claims.applicationVersion,
    deviceId: claims.deviceId,
    devicePublicKeyFingerprint: claims.devicePublicKeyFingerprint,
    now: new Date("2026-08-24T00:00:00.000Z"),
    trustedSignerKeys: new Map([[claims.signerKeyId, publicKey]]),
  };
  return {
    claims,
    context,
    grant: { claims, signature },
  };
}

async function expectGrantCode(
  fixture: Awaited<ReturnType<typeof grantFixture>>,
  overrides: Partial<(typeof fixture)["context"]>,
  expected: string | undefined,
) {
  const operation = verifyOfflineFieldGrant({
    context: { ...fixture.context, ...overrides },
    grant: fixture.grant,
    installedProtocolBundles: [baselineFieldProtocolPackage],
  });
  if (expected) await expect(operation).rejects.toMatchObject({ code: expected });
  else expect((await operation).grantId).toBe(fixture.claims.grantId);
}

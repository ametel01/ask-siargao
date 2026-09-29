import { describe, expect, test } from "bun:test";
import { createFieldVaultKey } from "@/features/field-security/crypto";
import {
  consumeOfflineReloadEvidence,
  createEncryptedReadinessSample,
  isFieldOriginReachable,
  isVerifiedOfflineReload,
  verifyAttendedLocalTimeAndTimezone,
  verifyCameraScanPermission,
  verifyEncryptedReadinessSample,
} from "@/features/field-security/first-use-evidence";
import type { FieldVaultMetadata, IndexedDbFieldVault } from "@/features/field-security/vault";

describe("first-use attended readiness evidence", () => {
  test("requires the recovered key to decrypt the persisted synthetic sample", () => {
    const vaultKey = createFieldVaultKey();
    const sample = createEncryptedReadinessSample({ applicationVersion: "0.1.0", vaultKey });

    expect(verifyEncryptedReadinessSample(sample, vaultKey)).toBe(true);
    expect(verifyEncryptedReadinessSample(sample, createFieldVaultKey())).toBe(false);
    expect(JSON.stringify(sample)).not.toContain("synthetic-non-protected-capture");
  });

  test("exercises camera access and always releases every track", async () => {
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [{ stop: () => stopped.push("video") }],
      getVideoTracks: () => [{ readyState: "live" }],
    } as unknown as MediaStream;

    expect(await verifyCameraScanPermission(async () => stream)).toBe(true);
    expect(stopped).toEqual(["video"]);

    expect(
      await verifyCameraScanPermission(async () => {
        throw new DOMException("denied", "NotAllowedError");
      }),
    ).toBe(false);
  });

  test("requires attended confirmation of a valid Asia/Manila clock", () => {
    const now = new Date("2026-08-25T10:00:00.000+08:00");
    expect(
      verifyAttendedLocalTimeAndTimezone({ confirmed: true, now, timeZone: "Asia/Manila" }),
    ).toBe(true);
    expect(
      verifyAttendedLocalTimeAndTimezone({ confirmed: false, now, timeZone: "Asia/Manila" }),
    ).toBe(false);
    expect(
      verifyAttendedLocalTimeAndTimezone({ confirmed: true, now, timeZone: "Pacific/Honolulu" }),
    ).toBe(false);
  });

  test("accepts only the matching challenge after an actual offline reload", () => {
    const ready = {
      expectedChallenge: "123e4567-e89b-12d3-a456-426614174000",
      navigationType: "reload",
      online: false,
      sessionChallenge: "123e4567-e89b-12d3-a456-426614174000",
    };
    expect(isVerifiedOfflineReload(ready)).toBe(true);
    expect(isVerifiedOfflineReload({ ...ready, navigationType: "navigate" })).toBe(false);
    expect(isVerifiedOfflineReload({ ...ready, online: true })).toBe(false);
    expect(isVerifiedOfflineReload({ ...ready, sessionChallenge: "different" })).toBe(false);
  });

  test("treats only an unreachable same-origin probe as offline", async () => {
    expect(
      await isFieldOriginReachable(async () => new Response("unhealthy", { status: 503 })),
    ).toBe(true);
    expect(
      await isFieldOriginReachable(async () => {
        throw new TypeError("network unavailable");
      }),
    ).toBe(false);
  });

  test("consumes an offline reload challenge once and rejects online, mismatch, and replay", async () => {
    const challenge = "123e4567-e89b-12d3-a456-426614174000";
    const createFixture = (sessionChallenge: string | null) => {
      let row: Extract<FieldVaultMetadata, { key: "field-readiness-evidence" }> = {
        key: "field-readiness-evidence",
        value: {
          buildId: "build-ready",
          offlineReloadChallenge: challenge,
          readinessEvidence: {
            offlineReloadVerified: false,
            cameraScanPermissionVerified: true,
            restoreVerified: true,
            sampleCaptureVerified: true,
            timeAndTimezoneVerified: true,
          },
          updatedAt: "2026-08-25T00:00:00.000Z",
          version: 1,
        },
      };
      const storage = new Map<string, string>();
      if (sessionChallenge)
        storage.set("ask-siargao-field-offline-reload-challenge", sessionChallenge);
      return {
        get row() {
          return row;
        },
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          removeItem: (key: string) => storage.delete(key),
        },
        vault: {
          getMetadata: async () => row,
          putMetadata: async (next: FieldVaultMetadata) => {
            row = next as Extract<FieldVaultMetadata, { key: "field-readiness-evidence" }>;
          },
        } as unknown as IndexedDbFieldVault,
      };
    };

    const verified = createFixture(challenge);
    expect(
      await consumeOfflineReloadEvidence({
        buildId: "build-ready",
        navigationType: "reload",
        online: false,
        sessionStorage: verified.sessionStorage,
        vault: verified.vault,
      }),
    ).toBe(true);
    expect(verified.row.value.readinessEvidence.offlineReloadVerified).toBe(true);
    expect(verified.row.value.offlineReloadChallenge).toBeUndefined();
    expect(
      await consumeOfflineReloadEvidence({
        buildId: "build-ready",
        navigationType: "reload",
        online: false,
        sessionStorage: verified.sessionStorage,
        vault: verified.vault,
      }),
    ).toBe(false);

    for (const candidate of [
      { online: true, sessionChallenge: challenge },
      { online: false, sessionChallenge: "00000000-0000-0000-0000-000000000000" },
    ]) {
      const rejected = createFixture(candidate.sessionChallenge);
      expect(
        await consumeOfflineReloadEvidence({
          buildId: "build-ready",
          navigationType: "reload",
          online: candidate.online,
          sessionStorage: rejected.sessionStorage,
          vault: rejected.vault,
        }),
      ).toBe(false);
      expect(rejected.row.value.readinessEvidence.offlineReloadVerified).toBe(false);
      expect(rejected.row.value.offlineReloadChallenge).toBeUndefined();
    }
  });
});

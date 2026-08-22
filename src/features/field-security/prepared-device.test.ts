import { describe, expect, test } from "bun:test";

import { discoverPreparedFieldDevice } from "@/features/field-security/prepared-device";
import type { IndexedDbFieldVault } from "@/features/field-security/vault";

describe("prepared field device discovery", () => {
  test("reports only identity-free preparation facts", async () => {
    const rows = new Set([
      "authorization-envelope",
      "device-wrap",
      "recovery-verified",
      "recovery-wrap",
      "unlock-credential",
      "field-readiness",
    ]);
    const vault = {
      getMetadata: async (key: string) =>
        rows.has(key)
          ? {
              key,
              value:
                key === "field-readiness" ? { offlineShellPrepared: true, persisted: true } : true,
            }
          : undefined,
      hasDeviceKeys: async () => true,
    } as unknown as IndexedDbFieldVault;

    expect(await discoverPreparedFieldDevice(vault)).toEqual({
      hasAuthorization: true,
      hasDeviceKeys: true,
      hasDeviceWrap: true,
      hasRecoveryVerification: true,
      hasRecoveryWrap: true,
      hasUnlockCredential: true,
      hasOfflineShell: true,
      hasPersistentStorage: true,
      prepared: true,
    });
  });

  test("fails closed when any local preparation seam is absent", async () => {
    const vault = {
      getMetadata: async (key: string) =>
        key === "recovery-verified" ? undefined : { key, value: true },
      hasDeviceKeys: async () => true,
    } as unknown as IndexedDbFieldVault;

    expect((await discoverPreparedFieldDevice(vault)).prepared).toBe(false);
  });
});

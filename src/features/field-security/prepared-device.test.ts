import { describe, expect, test } from "bun:test";

import {
  discoverPreparedFieldDevice,
  extractFieldOfflineStaticDependencies,
  fieldOfflineDependencyManifestPath,
  fieldOfflineShellPath,
  isCompletePreparedFieldCache,
} from "@/features/field-security/prepared-device";
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
                key === "field-readiness"
                  ? {
                      offlineShellPrepared: true,
                      persisted: true,
                      readinessEvidence: {
                        offlineReloadVerified: true,
                        cameraScanPermissionVerified: true,
                        restoreVerified: true,
                        sampleCaptureVerified: true,
                        timeAndTimezoneVerified: true,
                      },
                    }
                  : true,
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

  test("requires every offline-shell App Router dependency declared by the cached shell", async () => {
    const shellHtml = `
      <link href="/_next/static/css/field.css" rel="stylesheet">
      <script src="/_next/static/chunks/main.js"></script>
      <script>self.__next_f.push([1, "static/chunks/field-dependency.js static/chunks/app/operator/field/offline-shell/page.js"])</script>
    `;
    const assets = extractFieldOfflineStaticDependencies(shellHtml);
    expect(assets).toEqual([
      "/_next/static/chunks/app/operator/field/offline-shell/page.js",
      "/_next/static/chunks/field-dependency.js",
      "/_next/static/chunks/main.js",
      "/_next/static/css/field.css",
    ]);
    const completeEntries = new Map<string, Response>([
      [fieldOfflineShellPath, new Response(shellHtml)],
      [fieldOfflineDependencyManifestPath, new Response(JSON.stringify({ assets, version: 1 }))],
      ...assets.map((path) => [path, new Response(path)] as const),
    ]);

    expect(await isCompletePreparedFieldCache(cacheReader(completeEntries))).toBe(true);
    for (const missing of [
      "/_next/static/chunks/app/operator/field/offline-shell/page.js",
      "/_next/static/chunks/field-dependency.js",
    ]) {
      const incompleteEntries = new Map(completeEntries);
      incompleteEntries.delete(missing);
      expect(await isCompletePreparedFieldCache(cacheReader(incompleteEntries))).toBe(false);
    }
  });
});

function cacheReader(entries: ReadonlyMap<string, Response>): Pick<Cache, "match"> {
  return {
    match: async (request) => {
      const key =
        typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      return entries.get(key)?.clone();
    },
  };
}

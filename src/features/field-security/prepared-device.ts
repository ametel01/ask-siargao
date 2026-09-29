import { type FieldReadinessEvidence, IndexedDbFieldVault } from "@/features/field-security/vault";

export const fieldOfflineShellPath = "/operator/field/offline-shell";
export const fieldOfflineDependencyManifestPath = "/__ask-siargao-field-shell-dependencies__";

export type PreparedFieldDeviceDiscovery = {
  hasAuthorization: boolean;
  hasDeviceKeys: boolean;
  hasDeviceWrap: boolean;
  hasRecoveryVerification: boolean;
  hasRecoveryWrap: boolean;
  hasOfflineShell: boolean;
  hasPersistentStorage: boolean;
  hasUnlockCredential: boolean;
  prepared: boolean;
};

export async function discoverPreparedFieldDevice(
  vault: IndexedDbFieldVault = new IndexedDbFieldVault(),
): Promise<PreparedFieldDeviceDiscovery> {
  const [authorization, deviceKeys, deviceWrap, recovery, recoveryWrap, credential, readiness] =
    await Promise.all([
      vault.getMetadata("authorization-envelope"),
      vault.hasDeviceKeys(),
      vault.getMetadata("device-wrap"),
      vault.getMetadata("recovery-verified"),
      vault.getMetadata("recovery-wrap"),
      vault.getMetadata("unlock-credential"),
      vault.getMetadata("field-readiness"),
    ]);
  const result = {
    hasAuthorization: Boolean(authorization),
    hasDeviceKeys: deviceKeys,
    hasDeviceWrap: Boolean(deviceWrap),
    hasRecoveryVerification: Boolean(recovery),
    hasRecoveryWrap: Boolean(recoveryWrap),
    hasUnlockCredential: Boolean(credential),
    hasOfflineShell: await hasLivePreparedShell(readiness?.value),
    hasPersistentStorage: await hasLivePersistentStorage(readiness?.value.persisted === true),
  };
  return { ...result, prepared: Object.values(result).every(Boolean) };
}

async function hasLivePreparedShell(
  readiness:
    | {
        buildId: string;
        offlineShellPrepared: boolean;
        persisted: boolean;
        readinessEvidence?: FieldReadinessEvidence;
      }
    | undefined,
): Promise<boolean> {
  if (
    !readiness?.offlineShellPrepared ||
    !readiness.readinessEvidence?.cameraScanPermissionVerified ||
    !readiness.readinessEvidence.sampleCaptureVerified ||
    !readiness.readinessEvidence.restoreVerified ||
    !readiness.readinessEvidence.offlineReloadVerified ||
    !readiness.readinessEvidence.timeAndTimezoneVerified
  ) {
    return false;
  }
  return hasCompletePreparedFieldShell(readiness.buildId);
}

export async function hasCompletePreparedFieldShell(buildId: string): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof caches === "undefined"
  ) {
    return true;
  }
  const [registration, keys] = await Promise.all([
    navigator.serviceWorker.getRegistration("/").catch(() => undefined),
    caches.keys().catch((): string[] => []),
  ]);
  if (!registration || !keys.includes(`ask-siargao-field-shell-${buildId}`)) return false;
  const cache = await caches.open(`ask-siargao-field-shell-${buildId}`);
  if (!(await isCompletePreparedFieldCache(cache))) return false;
  const activeCache = await caches.open("ask-siargao-field-shell-active");
  const marker = await activeCache.match("/__ask-siargao-active-field-build__");
  if (!marker) return false;
  try {
    const selected = (await marker.json()) as {
      buildId?: string;
      preparationId?: string;
    };
    return (
      selected.buildId === buildId &&
      typeof selected.preparationId === "string" &&
      /^[A-Za-z0-9-]{16,200}$/.test(selected.preparationId)
    );
  } catch {
    return false;
  }
}

export async function isCompletePreparedFieldCache(cache: Pick<Cache, "match">): Promise<boolean> {
  const [shell, manifestResponse] = await Promise.all([
    cache.match(fieldOfflineShellPath),
    cache.match(fieldOfflineDependencyManifestPath),
  ]);
  if (!shell || !manifestResponse) return false;
  const expectedAssets = extractFieldOfflineStaticDependencies(await shell.clone().text());
  if (expectedAssets.length === 0) return false;
  let manifest: unknown;
  try {
    manifest = await manifestResponse.json();
  } catch {
    return false;
  }
  if (!isFieldOfflineDependencyManifest(manifest, expectedAssets)) return false;
  for (const path of expectedAssets) {
    if (!(await cache.match(path))) return false;
  }
  return true;
}

export function extractFieldOfflineStaticDependencies(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(
    /(?:\/_next\/)?static\/(?:chunks|css|media)\/[A-Za-z0-9._%/-]+/gu,
  )) {
    const path = match[0].startsWith("/_next/") ? match[0] : `/_next/${match[0]}`;
    if (isSafeFieldStaticPath(path)) paths.add(path);
  }
  return [...paths].sort();
}

function isFieldOfflineDependencyManifest(
  value: unknown,
  expectedAssets: readonly string[],
): boolean {
  if (!value || typeof value !== "object") return false;
  const manifest = value as { assets?: unknown; version?: unknown };
  return (
    manifest.version === 1 &&
    Array.isArray(manifest.assets) &&
    manifest.assets.length === expectedAssets.length &&
    manifest.assets.every(
      (path, index) =>
        typeof path === "string" && isSafeFieldStaticPath(path) && path === expectedAssets[index],
    )
  );
}

function isSafeFieldStaticPath(path: string): boolean {
  return (
    /^\/_next\/static\/(?:chunks|css|media)\/[A-Za-z0-9._%/-]+$/u.test(path) && !path.includes("..")
  );
}

async function hasLivePersistentStorage(recordedPersisted: boolean): Promise<boolean> {
  if (!recordedPersisted) return false;
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return true;
  return navigator.storage.persisted().catch(() => false);
}

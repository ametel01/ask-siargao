import { IndexedDbFieldVault } from "@/features/field-security/vault";

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
  readiness: { buildId: string; offlineShellPrepared: boolean; persisted: boolean } | undefined,
): Promise<boolean> {
  if (!readiness?.offlineShellPrepared) return false;
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
  return Boolean(registration && keys.includes(`ask-siargao-field-shell-${readiness.buildId}`));
}

async function hasLivePersistentStorage(recordedPersisted: boolean): Promise<boolean> {
  if (!recordedPersisted) return false;
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return true;
  return navigator.storage.persisted().catch(() => false);
}

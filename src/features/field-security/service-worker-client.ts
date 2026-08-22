export const fieldServiceWorkerPath = "/field-service-worker";
export const fieldOfflineShellPath = "/operator/field/offline-shell";

export async function prepareFieldOfflineShell(input: {
  activeVisit: boolean;
  buildId: string;
}): Promise<{ persistentStorageRequested: boolean; waitingForSafeUpdate: boolean }> {
  if (!("serviceWorker" in navigator)) throw new Error("field_offline_shell_unavailable");
  const registration = await navigator.serviceWorker.register(fieldServiceWorkerPath, {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  const target = registration.active ?? registration.waiting ?? registration.installing;
  target?.postMessage({
    activeVisit: input.activeVisit,
    buildId: input.buildId,
    shellPath: fieldOfflineShellPath,
    type: "PREPARE_FIELD_OFFLINE",
  });
  const persistentStorageRequested = await navigator.storage?.persist?.().catch(() => false);
  return {
    persistentStorageRequested: persistentStorageRequested === true,
    waitingForSafeUpdate: Boolean(registration.waiting && input.activeVisit),
  };
}

export async function activateSafeFieldUpdate(activeVisit: boolean): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration?.waiting || activeVisit) return false;
  registration.waiting.postMessage({ type: "ACTIVATE_SAFE_FIELD_UPDATE" });
  return true;
}

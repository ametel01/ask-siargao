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
  postToFieldWorkers(registration, {
    activeVisit: input.activeVisit,
    buildId: input.buildId,
    shellPath: fieldOfflineShellPath,
    type: "PREPARE_FIELD_OFFLINE",
  });
  await waitForPreparedShell(input.buildId);
  const persistentStorageRequested = await navigator.storage?.persist?.().catch(() => false);
  return {
    persistentStorageRequested: persistentStorageRequested === true,
    waitingForSafeUpdate: Boolean(registration.waiting && input.activeVisit),
  };
}

async function waitForPreparedShell(buildId: string): Promise<void> {
  if (typeof caches === "undefined") throw new Error("field_offline_shell_unavailable");
  const cacheName = `ask-siargao-field-shell-${buildId}`;
  const activeCache = await caches.open("ask-siargao-field-shell-active");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const cache = await caches.open(cacheName);
    const [shell, marker] = await Promise.all([
      cache.match(fieldOfflineShellPath),
      activeCache.match("/__ask-siargao-active-field-build__"),
    ]);
    if (shell && marker) {
      try {
        const selected = (await marker.json()) as { buildId?: string };
        if (selected.buildId === buildId) return;
      } catch {
        // Keep waiting for the service worker to publish a complete marker.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("field_offline_shell_prepare_timeout");
}

export async function notifyFieldVisitState(input: {
  activeVisit: boolean;
  buildId: string;
}): Promise<{ updateWaiting: boolean }> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("field_offline_shell_unavailable");
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) throw new Error("field_offline_shell_unavailable");
  postToFieldWorkers(registration, {
    activeVisit: input.activeVisit,
    buildId: input.buildId,
    type: "FIELD_VISIT_STATE",
  });
  return { updateWaiting: Boolean(registration.waiting) };
}

export async function activateSafeFieldUpdate(activeVisit: boolean): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration?.waiting || activeVisit) return false;
  registration.waiting.postMessage({ type: "ACTIVATE_SAFE_FIELD_UPDATE" });
  return true;
}

function postToFieldWorkers(registration: ServiceWorkerRegistration, message: object): void {
  const workers = new Set(
    [registration.active, registration.waiting, registration.installing].filter(
      (worker): worker is ServiceWorker => Boolean(worker),
    ),
  );
  for (const worker of workers) worker.postMessage(message);
}

const databaseName = "ask-siargao-field-ingestion";
const storeName = "field-records";

export type DiscoveredLegacyFieldRecord = Readonly<{
  importedAt: string;
  record: unknown;
  signature: string;
  sourceName: string;
  storageKey: string;
}>;

/**
 * Read-only retirement adapter for PR #226 browser data. It never creates, upgrades, writes,
 * deletes, or clears the historical database.
 */
export async function discoverLegacyFieldRecords(): Promise<DiscoveredLegacyFieldRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const databases = await indexedDB.databases?.();
  if (databases && !databases.some((database) => database.name === databaseName)) return [];
  const database = await openExistingDatabase();
  if (!database) return [];
  try {
    if (!database.objectStoreNames.contains(storeName)) return [];
    return await new Promise<DiscoveredLegacyFieldRecord[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as DiscoveredLegacyFieldRecord[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function openExistingDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    let created = false;
    request.onupgradeneeded = () => {
      created = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      if (created) {
        request.result.close();
        resolve(undefined);
      } else resolve(request.result);
    };
    request.onerror = () => {
      if (created && request.error?.name === "AbortError") resolve(undefined);
      else reject(request.error);
    };
  });
}

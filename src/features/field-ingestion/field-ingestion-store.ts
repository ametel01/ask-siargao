import type { StoredFieldRecord } from "@/features/field-ingestion/field-capture";

const databaseName = "ask-siargao-field-ingestion";
const storeName = "field-records";
const databaseVersion = 1;

export async function loadStoredFieldRecords(): Promise<StoredFieldRecord[]> {
  const database = await openDatabase();
  return await new Promise<StoredFieldRecord[]>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as StoredFieldRecord[]);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export async function saveStoredFieldRecords(records: StoredFieldRecord[]): Promise<void> {
  if (records.length === 0) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const record of records) store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}

export async function deleteStoredFieldRecord(storageKey: string): Promise<void> {
  const database = await openDatabase();
  await requestCompletion(database, (store) => store.delete(storageKey));
}

export async function clearStoredFieldRecords(): Promise<void> {
  const database = await openDatabase();
  await requestCompletion(database, (store) => store.clear());
}

async function requestCompletion(
  database: IDBDatabase,
  requestFactory: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    requestFactory(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "storageKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

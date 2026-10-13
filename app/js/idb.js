import { DB_NAME, META_KEY } from "./constants.js";

let dbPromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("abort"));
  });
}

export function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
        if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

export async function closeDatabase() {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

export async function idbGet(store, key) {
  const db = await openDatabase();
  const result = await requestToPromise(db.transaction(store, "readonly").objectStore(store).get(key));
  return result ?? null;
}

export async function idbAll(store) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(store, "readonly").objectStore(store).getAll());
}

export async function idbPut(store, value, key) {
  const db = await openDatabase();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value, key);
  await transactionDone(tx);
}

export async function getMeta() {
  return idbGet("meta", META_KEY);
}

export async function saveMeta(meta) {
  await idbPut("meta", meta, META_KEY);
}

export async function putRecordsAndAudio(recordRows, audioRow) {
  const db = await openDatabase();
  const stores = audioRow ? ["records", "audio"] : ["records"];
  const tx = db.transaction(stores, "readwrite");
  const records = tx.objectStore("records");
  for (const row of recordRows) records.put(row);
  if (audioRow) tx.objectStore("audio").put(audioRow);
  await transactionDone(tx);
}

export async function commitVault({ meta, recordRows, audioRows }) {
  const db = await openDatabase();
  const tx = db.transaction(["meta", "records", "audio"], "readwrite");
  const records = tx.objectStore("records");
  const audios = tx.objectStore("audio");
  records.clear();
  audios.clear();
  tx.objectStore("meta").put(meta, META_KEY);
  for (const row of recordRows) records.put(row);
  for (const row of audioRows) audios.put(row);
  await transactionDone(tx);
}

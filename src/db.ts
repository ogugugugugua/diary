import type { Trip, Settings } from './types';
let database: Promise<IDBDatabase> | undefined;
export function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('xingji-family-journal', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('trips', { keyPath: 'id' }); db.createObjectStore('blobs'); db.createObjectStore('meta');
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error || new Error('无法打开本地数据库。')); };
    request.onblocked = () => { database = undefined; reject(new Error('数据库被另一个窗口占用，请关闭旧窗口再试。')); };
  });
  return database;
}
export async function listTrips(): Promise<Trip[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const request = db.transaction('trips').objectStore('trips').getAll();
    request.onsuccess = () => resolve((request.result as Trip[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error); });
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const request = db.transaction('meta').objectStore('meta').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(value, key);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error); });
}
export const saveSettings = (settings: Settings) => setMeta('settings', settings);
export async function saveTrip(trip: Trip, blobs: {key: string; blob: Blob}[] = []): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const tx = db.transaction(['trips', 'blobs', 'meta'], 'readwrite');
    for (const item of blobs) { tx.objectStore('blobs').put(item.blob, item.key); tx.objectStore('meta').put(trip.id, `owner:${item.key}`); }
    tx.objectStore('trips').put(trip);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('保存失败，请检查磁盘可用空间。'));
    tx.onerror = () => reject(tx.error); });
}
export async function getBlob(key?: string): Promise<Blob | undefined> {
  if (!key) return undefined;
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const request = db.transaction('blobs').objectStore('blobs').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function deleteTrip(trip: Trip): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const tx = db.transaction(['trips', 'blobs', 'meta'], 'readwrite');
    tx.objectStore('trips').delete(trip.id);
    for (const asset of trip.assets) for (const key of [asset.blobKey, asset.thumbnailKey]) if (key) tx.objectStore('blobs').delete(key);
    for (const memory of trip.memories) if (memory.audioKey) tx.objectStore('blobs').delete(memory.audioKey);
    const cursor=tx.objectStore('meta').openCursor();cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;if(typeof entry.key==='string'&&entry.key.startsWith('owner:')&&entry.value===trip.id){tx.objectStore('blobs').delete(entry.key.slice(6));entry.delete();}entry.continue();};
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
}

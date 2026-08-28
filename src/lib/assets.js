/* Photographs.

   Everything else in this app is JSON and goes through storage.js. Photos do
   not: they are blobs, they are large, and a Firestore document is capped at
   1 MB. So they live here instead — in IndexedDB on this device now, and in
   Firebase Storage as well once sync is on (Phase 4).

   The shape deliberately mirrors the storage facade: one backend at a time,
   and reads are cache-first, so turning sync on later is a swap rather than a
   rewrite. Recipes only ever hold an asset id. */

const DB_NAME = 'cookbook-assets';
const STORE = 'photos';
const VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const request = fn(store);
    transaction.onerror = () => reject(transaction.error);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* Object URLs are cached per id and never revoked while the app is running.
   Revoking on unmount would be tidier, but the same photo reappears every time
   its page is turned back to, and a revoked URL renders as a broken image. */
const urls = new Map();

/* The other half, when signed in: Firebase Storage. IndexedDB stays the first
   place looked, so a photo already on this device costs nothing; the cloud is
   only reached for one that is not here yet. */
let cloud = null;

export const assets = {
  /** @param {{upload, download, remove}|null} next */
  useCloud(next) {
    cloud = next;
  },

  async put(id, blob) {
    await tx('readwrite', (store) => store.put(blob, id));
    urls.delete(id);
    // Uploading is deliberately not awaited: adding a photograph should not
    // wait on the network, and Storage retries on its own.
    cloud?.upload(id, blob).catch((err) => console.warn('Photo did not upload.', err));
    return id;
  },

  async get(id) {
    const local = await tx('readonly', (store) => store.get(id));
    if (local || !cloud) return local;

    // Not on this device — another one added it. Fetch once and keep it.
    try {
      const blob = await cloud.download(id);
      await tx('readwrite', (store) => store.put(blob, id));
      return blob;
    } catch (err) {
      console.warn(`Photo ${id} is not on this device and could not be fetched.`, err);
      return null;
    }
  },

  /** A URL for <img src>. Cached, so repeated renders do not re-allocate. */
  async url(id) {
    if (urls.has(id)) return urls.get(id);
    const blob = await this.get(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  },

  async remove(id) {
    await tx('readwrite', (store) => store.delete(id));
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
    cloud?.remove(id).catch(() => { /* already gone, or never went up */ });
  },

  async keys() {
    return tx('readonly', (store) => store.getAllKeys());
  },

  /** Every stored photo, for the backup file. */
  async all() {
    const ids = await this.keys();
    const out = [];
    for (const id of ids) out.push({ id, blob: await this.get(id) });
    return out;
  },
};

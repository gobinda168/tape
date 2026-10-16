// IndexedDB store for recordings. Shared by every extension page (same origin):
// the offscreen recorder writes, the library reads.

const DB_NAME = "tape";
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("recordings")) {
        db.createObjectStore("recordings", { keyPath: "id" }).createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs");
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result;
        Promise.resolve(fn(t)).then((r) => (result = r), reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export function newId() {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint8Array(6));
  return t + Array.from(r, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 8);
}

export async function addRecording(meta, blob) {
  await tx(["recordings", "blobs"], "readwrite", (t) => {
    t.objectStore("recordings").put(meta);
    t.objectStore("blobs").put(blob, meta.id);
  });
  return meta;
}

export async function listRecordings() {
  const all = await tx(["recordings"], "readonly", (t) => req(t.objectStore("recordings").getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const getRecording = (id) =>
  tx(["recordings"], "readonly", (t) => req(t.objectStore("recordings").get(id)));

export async function updateRecording(id, patch) {
  return tx(["recordings"], "readwrite", async (t) => {
    const store = t.objectStore("recordings");
    const cur = await req(store.get(id));
    if (!cur) return null;
    const next = typeof patch === "function" ? patch(structuredClone(cur)) : { ...cur, ...patch };
    store.put(next);
    return next;
  });
}

export const getBlob = (id) => tx(["blobs"], "readonly", (t) => req(t.objectStore("blobs").get(id)));
export const getThumb = (id) => tx(["thumbs"], "readonly", (t) => req(t.objectStore("thumbs").get(id)));
export const putThumb = (id, blob) => tx(["thumbs"], "readwrite", (t) => { t.objectStore("thumbs").put(blob, id); });

export const deleteRecording = (id) =>
  tx(["recordings", "blobs", "thumbs"], "readwrite", (t) => {
    t.objectStore("recordings").delete(id);
    t.objectStore("blobs").delete(id);
    t.objectStore("thumbs").delete(id);
  });

export const kvGet = (key) => tx(["kv"], "readonly", (t) => req(t.objectStore("kv").get(key)));
export const kvSet = (key, value) => tx(["kv"], "readwrite", (t) => { t.objectStore("kv").put(value, key); });
export const kvDelete = (key) => tx(["kv"], "readwrite", (t) => { t.objectStore("kv").delete(key); });

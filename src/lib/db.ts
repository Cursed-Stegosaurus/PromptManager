import type { LibraryState, Prompt } from "./schema";

const DB_NAME = "prompt-library";
const DB_VERSION = 1;
const STORE = "prompts";
const META = "meta";

export interface Meta {
  key: string;
  value: any;
}

export async function openDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("by_deletedAt", "deletedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putPrompt(p: Prompt) {
  const db = await openDb();
  await tx(db, STORE, "readwrite", store => store.put(p));
}

export async function getPrompt(id: string): Promise<Prompt | undefined> {
  const db = await openDb();
  return await tx(db, STORE, "readonly", store => reqPromise<Prompt | undefined>(store.get(id)));
}

export async function listPrompts(includeDeleted = false): Promise<Prompt[]> {
  const db = await openDb();
  return await tx(db, STORE, "readonly", store => new Promise((resolve, reject) => {
    const out: Prompt[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(out);
      const val = cur.value as Prompt;
      if (!val.deletedAt || includeDeleted) out.push(val);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function putMeta(key: string, value: any) {
  const db = await openDb();
  await tx(db, META, "readwrite", store => store.put({ key, value }));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return await tx(db, META, "readonly", store => reqPromise<T | undefined>(store.get(key)).then(r => r?.value));
}

function tx<T>(db: IDBDatabase, name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => any): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(name, mode);
    const store = t.objectStore(name);
    let result: any;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqPromise<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

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
        s.createIndex("by_hidden", "hidden", { unique: false });
        s.createIndex("by_favorite", "favorite", { unique: false });
        s.createIndex("by_source", "source", { unique: false });
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
      const cur = req.result as IDBCursorWithValue | null;
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

export async function deletePrompt(id: string) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt) {
    prompt.deletedAt = new Date().toISOString();
    prompt.updatedAt = new Date().toISOString();
    // Clear favorite flag when deleting
    prompt.favorite = false;
    await putPrompt(prompt);
  }
}

export async function restorePrompt(id: string) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt && prompt.deletedAt) {
    prompt.deletedAt = undefined;
    prompt.updatedAt = new Date().toISOString();
    await putPrompt(prompt);
  }
}

export async function toggleFavorite(id: string) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt) {
    prompt.favorite = !prompt.favorite;
    prompt.updatedAt = new Date().toISOString();
    await putPrompt(prompt);
  }
}

export async function toggleHidden(id: string) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt) {
    prompt.hidden = !prompt.hidden;
    prompt.updatedAt = new Date().toISOString();
    // Clear favorite flag when hiding (but not when unhiding)
    if (prompt.hidden) {
      prompt.favorite = false;
    }
    await putPrompt(prompt);
  }
}

export async function permanentlyDeletePrompt(id: string) {
  const db = await openDb();
  return await tx(db, STORE, "readwrite", store => {
    return reqPromise(store.delete(id));
  });
}

export async function purgeDeletedPrompts(olderThanDays: number = 30) {
  const db = await openDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  
  return await tx(db, STORE, "readwrite", store => new Promise((resolve, reject) => {
    const req = store.openCursor();
    const deletedIds: string[] = [];
    
    req.onsuccess = () => {
      const cur = req.result as IDBCursorWithValue | null;
      if (!cur) return resolve(deletedIds);
      
      const prompt = cur.value as Prompt;
      if (prompt.deletedAt && new Date(prompt.deletedAt) < cutoff) {
        deletedIds.push(prompt.id);
        store.delete(prompt.id);
      }
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  }));
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

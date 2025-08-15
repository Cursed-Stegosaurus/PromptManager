import type { LibraryState, Prompt } from "./schema";

const DB_NAME = "prompt-library";
const DB_VERSION = 2; // Bumped to force schema upgrade
const STORE = "prompts";
const META = "meta";

export interface Meta {
  key: string;
  value: any;
}

export async function openDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    
    req.onupgradeneeded = (event) => {
      console.log('Database upgrade needed, creating schema...');
      const db = req.result;
      
      // Create prompts store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE)) {
        console.log('Creating prompts store...');
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        
        // Create indexes
        console.log('Creating database indexes...');
        try {
          s.createIndex("by_deletedAt", "deletedAt", { unique: false });
          s.createIndex("by_hidden", "hidden", { unique: false });
          s.createIndex("by_favorite", "favorite", { unique: false });
          s.createIndex("by_source", "source", { unique: false });
          console.log('All indexes created successfully');
        } catch (indexError) {
          console.error('Error creating indexes:', indexError);
          // Continue anyway - indexes are optional
        }
      }
      
      // Create meta store if it doesn't exist
      if (!db.objectStoreNames.contains(META)) {
        console.log('Creating meta store...');
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    
    req.onsuccess = () => {
      console.log('Database opened successfully');
      resolve(req.result);
    };
    
    req.onerror = () => {
      console.error('Database open error:', req.error);
      reject(req.error);
    };
  });
}

export async function putPrompt(p: Prompt) {
  const db = await openDb();
  await tx(db, STORE, "readwrite", store => store.put(p));
}

// Raw database functions (without migration)
async function getPromptRaw(id: string): Promise<Prompt | undefined> {
  try {
    console.log('getPromptRaw: Getting prompt with ID:', id);
    const db = await openDb();
    const result = await tx<Prompt | undefined>(db, STORE, "readonly", store => reqPromise<Prompt | undefined>(store.get(id)));
    console.log('getPromptRaw: Result:', result);
    return result;
  } catch (error) {
    console.error('getPromptRaw: Error:', error);
    throw error;
  }
}

async function listPromptsRaw(includeDeleted = false): Promise<Prompt[]> {
  try {
    console.log('listPromptsRaw: Starting with includeDeleted =', includeDeleted);
    const db = await openDb();
    console.log('listPromptsRaw: Database opened successfully');
    
    const result = await tx<Prompt[]>(db, STORE, "readonly", store => new Promise<Prompt[]>((resolve, reject) => {
      const out: Prompt[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result as IDBCursorWithValue | null;
        if (!cur) {
          console.log('listPromptsRaw: Cursor completed, total prompts found:', out.length);
          return resolve(out);
        }
        const val = cur.value as Prompt;
        if (!val.deletedAt || includeDeleted) out.push(val);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    }));
    
    console.log('listPromptsRaw: Final result:', result.length, result);
    
    // Get usage analytics for sorting
    const { topUsedPrompts } = await getAnalytics();
    
    // Sort prompts: first by usage count (descending), then alphabetically by title
    const sortedResult = result.sort((a, b) => {
      // Get usage count for each prompt
      const aUsage = topUsedPrompts.find((p: { promptId: string; usageCount: number; lastUsed: string }) => p.promptId === a.id)?.usageCount || 0;
      const bUsage = topUsedPrompts.find((p: { promptId: string; usageCount: number; lastUsed: string }) => p.promptId === b.id)?.usageCount || 0;
      
      // First sort by usage count (descending)
      if (aUsage !== bUsage) {
        return bUsage - aUsage;
      }
      
      // Then sort alphabetically by title
      return a.title.localeCompare(b.title);
    });
    
    return sortedResult;
  } catch (error) {
    console.error('listPromptsRaw: Error:', error);
    throw error;
  }
}

// Enhanced getPrompt with auto-migration
export async function getPrompt(id: string): Promise<Prompt | null> {
  try {
    const prompt = await getPromptRaw(id);
    if (prompt && (prompt.source as any) === 'seed') {
      // Auto-migrate legacy data
      console.log(`Auto-migrating prompt ${id} from 'seed' to 'starter'`);
      (prompt as any).source = 'starter';
      await putPrompt(prompt); // Save migrated version
    }
    return prompt || null;
  } catch (error) {
    console.error('Failed to get prompt:', error);
    return null;
  }
}

// Enhanced listPrompts with auto-migration
export async function listPrompts(includeDeleted = false): Promise<Prompt[]> {
  try {
    console.log('listPrompts: Starting with includeDeleted =', includeDeleted);
    const prompts = await listPromptsRaw(includeDeleted);
    console.log('listPrompts: Raw prompts from DB:', prompts.length, prompts);
    
    // Check if any prompts need migration
    let needsMigration = false;
    const migratedPrompts = prompts.map(prompt => {
      if ((prompt.source as any) === 'seed') {
        needsMigration = true;
        return { ...prompt, source: 'starter' as const };
      }
      return prompt;
    });
    
    console.log('listPrompts: Migration needed?', needsMigration);
    console.log('listPrompts: Migrated prompts:', migratedPrompts.length, migratedPrompts);
    
    // Save migrated prompts if needed
    if (needsMigration) {
      console.log(`Auto-migrating ${migratedPrompts.filter(p => (p.source as any) === 'seed').length} prompts`);
      await Promise.all(migratedPrompts.map(p => putPrompt(p)));
      
      // Mark migration as completed
      await putMeta('migrationCompleted', true);
      await putMeta('migrationTimestamp', new Date().toISOString());
      await putMeta('migrationVersion', '2.0.0');
      
      console.log('Auto-migration completed and marked as complete');
    }
    
    // Get usage analytics for sorting
    const { topUsedPrompts } = await getAnalytics();
    
    // Sort prompts: first by usage count (descending), then alphabetically by title
    const sortedPrompts = migratedPrompts.sort((a, b) => {
      // Get usage count for each prompt
      const aUsage = topUsedPrompts.find((p: { promptId: string; usageCount: number; lastUsed: string }) => p.promptId === a.id)?.usageCount || 0;
      const bUsage = topUsedPrompts.find((p: { promptId: string; usageCount: number; lastUsed: string }) => p.promptId === b.id)?.usageCount || 0;
      
      // First sort by usage count (descending)
      if (aUsage !== bUsage) {
        return bUsage - aUsage;
      }
      
      // Then sort alphabetically by title
      return a.title.localeCompare(b.title);
    });
    
    return sortedPrompts;
  } catch (error) {
    console.error('Failed to list prompts:', error);
    return [];
  }
}

export async function putMeta(key: string, value: any) {
  const db = await openDb();
  await tx(db, META, "readwrite", store => store.put({ key, value }));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return await tx(db, META, "readonly", store => {
    const req = store.get(key);
    return reqPromise<{ key: string; value: T } | undefined>(req).then(r => r?.value);
  });
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

// Analytics functions
export async function incrementPromptUsage(promptId: string) {
  try {
    // Get current analytics data
    const totalUsed = await getMeta<number>('totalPromptsUsed') ?? 0;
    const topUsed = await getMeta<Array<{ promptId: string; usageCount: number; lastUsed: string }>>('topUsedPrompts') ?? [];
    
    // Increment total counter
    await putMeta('totalPromptsUsed', totalUsed + 1);
    
    // Update individual prompt usage
    const now = new Date().toISOString();
    const existingIndex = topUsed.findIndex(p => p.promptId === promptId);
    
    if (existingIndex >= 0) {
      // Update existing entry
      topUsed[existingIndex].usageCount += 1;
      topUsed[existingIndex].lastUsed = now;
    } else {
      // Add new entry
      topUsed.push({ promptId, usageCount: 1, lastUsed: now });
    }
    
    // Sort by usage count (highest first) and keep top 5
    topUsed.sort((a, b) => b.usageCount - a.usageCount);
    const top5 = topUsed.slice(0, 5);
    
    // Save updated top 5
    await putMeta('topUsedPrompts', top5);
    
    return { totalUsed: totalUsed + 1, topUsed: top5 };
  } catch (error) {
    console.error('Failed to increment prompt usage:', error);
    throw error;
  }
}

export async function getAnalytics() {
  try {
    const totalUsed = await getMeta<number>('totalPromptsUsed') ?? 0;
    const topUsed = await getMeta<Array<{ promptId: string; usageCount: number; lastUsed: string }>>('topUsedPrompts') ?? [];
    
    return {
      totalPromptsUsed: totalUsed,
      topUsedPrompts: topUsed
    };
  } catch (error) {
    console.error('Failed to get analytics:', error);
    return {
      totalPromptsUsed: 0,
      topUsedPrompts: []
    };
  }
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

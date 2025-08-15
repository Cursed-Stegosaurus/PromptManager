var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/db.ts
var db_exports = {};
__export(db_exports, {
  deletePrompt: () => deletePrompt,
  getAnalytics: () => getAnalytics,
  getMeta: () => getMeta,
  getPrompt: () => getPrompt,
  incrementPromptUsage: () => incrementPromptUsage,
  listPrompts: () => listPrompts,
  openDb: () => openDb,
  permanentlyDeletePrompt: () => permanentlyDeletePrompt,
  purgeDeletedPrompts: () => purgeDeletedPrompts,
  putMeta: () => putMeta,
  putPrompt: () => putPrompt,
  restorePrompt: () => restorePrompt,
  toggleFavorite: () => toggleFavorite,
  toggleHidden: () => toggleHidden
});
async function openDb() {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      console.log("Database upgrade needed, creating schema...");
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        console.log("Creating prompts store...");
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        console.log("Creating database indexes...");
        try {
          s.createIndex("by_deletedAt", "deletedAt", { unique: false });
          s.createIndex("by_hidden", "hidden", { unique: false });
          s.createIndex("by_favorite", "favorite", { unique: false });
          s.createIndex("by_source", "source", { unique: false });
          console.log("All indexes created successfully");
        } catch (indexError) {
          console.error("Error creating indexes:", indexError);
        }
      }
      if (!db.objectStoreNames.contains(META)) {
        console.log("Creating meta store...");
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      console.log("Database opened successfully");
      resolve(req.result);
    };
    req.onerror = () => {
      console.error("Database open error:", req.error);
      reject(req.error);
    };
  });
}
async function putPrompt(p) {
  const db = await openDb();
  await tx(db, STORE, "readwrite", (store) => store.put(p));
}
async function getPromptRaw(id) {
  try {
    console.log("getPromptRaw: Getting prompt with ID:", id);
    const db = await openDb();
    const result = await tx(db, STORE, "readonly", (store) => reqPromise(store.get(id)));
    console.log("getPromptRaw: Result:", result);
    return result;
  } catch (error) {
    console.error("getPromptRaw: Error:", error);
    throw error;
  }
}
async function listPromptsRaw(includeDeleted = false) {
  try {
    console.log("listPromptsRaw: Starting with includeDeleted =", includeDeleted);
    const db = await openDb();
    console.log("listPromptsRaw: Database opened successfully");
    const result = await tx(db, STORE, "readonly", (store) => new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          console.log("listPromptsRaw: Cursor completed, total prompts found:", out.length);
          return resolve(out);
        }
        const val = cur.value;
        if (!val.deletedAt || includeDeleted)
          out.push(val);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    }));
    console.log("listPromptsRaw: Final result:", result.length, result);
    const { topUsedPrompts } = await getAnalytics();
    const sortedResult = result.sort((a, b) => {
      const aUsage = topUsedPrompts.find((p) => p.promptId === a.id)?.usageCount || 0;
      const bUsage = topUsedPrompts.find((p) => p.promptId === b.id)?.usageCount || 0;
      if (aUsage !== bUsage) {
        return bUsage - aUsage;
      }
      return a.title.localeCompare(b.title);
    });
    return sortedResult;
  } catch (error) {
    console.error("listPromptsRaw: Error:", error);
    throw error;
  }
}
async function getPrompt(id) {
  try {
    const prompt = await getPromptRaw(id);
    if (prompt && prompt.source === "seed") {
      console.log(`Auto-migrating prompt ${id} from 'seed' to 'starter'`);
      prompt.source = "starter";
      await putPrompt(prompt);
    }
    return prompt || null;
  } catch (error) {
    console.error("Failed to get prompt:", error);
    return null;
  }
}
async function listPrompts(includeDeleted = false) {
  try {
    console.log("listPrompts: Starting with includeDeleted =", includeDeleted);
    const prompts = await listPromptsRaw(includeDeleted);
    console.log("listPrompts: Raw prompts from DB:", prompts.length, prompts);
    let needsMigration = false;
    const migratedPrompts = prompts.map((prompt) => {
      if (prompt.source === "seed") {
        needsMigration = true;
        return { ...prompt, source: "starter" };
      }
      return prompt;
    });
    console.log("listPrompts: Migration needed?", needsMigration);
    console.log("listPrompts: Migrated prompts:", migratedPrompts.length, migratedPrompts);
    if (needsMigration) {
      console.log(`Auto-migrating ${migratedPrompts.filter((p) => p.source === "seed").length} prompts`);
      await Promise.all(migratedPrompts.map((p) => putPrompt(p)));
      await putMeta("migrationCompleted", true);
      await putMeta("migrationTimestamp", (/* @__PURE__ */ new Date()).toISOString());
      await putMeta("migrationVersion", "2.0.0");
      console.log("Auto-migration completed and marked as complete");
    }
    const { topUsedPrompts } = await getAnalytics();
    const sortedPrompts = migratedPrompts.sort((a, b) => {
      const aUsage = topUsedPrompts.find((p) => p.promptId === a.id)?.usageCount || 0;
      const bUsage = topUsedPrompts.find((p) => p.promptId === b.id)?.usageCount || 0;
      if (aUsage !== bUsage) {
        return bUsage - aUsage;
      }
      return a.title.localeCompare(b.title);
    });
    return sortedPrompts;
  } catch (error) {
    console.error("Failed to list prompts:", error);
    return [];
  }
}
async function putMeta(key, value) {
  const db = await openDb();
  await tx(db, META, "readwrite", (store) => store.put({ key, value }));
}
async function getMeta(key) {
  const db = await openDb();
  return await tx(db, META, "readonly", (store) => {
    const req = store.get(key);
    return reqPromise(req).then((r) => r?.value);
  });
}
async function deletePrompt(id) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt) {
    prompt.deletedAt = (/* @__PURE__ */ new Date()).toISOString();
    prompt.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    prompt.favorite = false;
    await putPrompt(prompt);
  }
}
async function restorePrompt(id) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt && prompt.deletedAt) {
    prompt.deletedAt = void 0;
    prompt.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await putPrompt(prompt);
  }
}
async function toggleFavorite(id) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt) {
    prompt.favorite = !prompt.favorite;
    prompt.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await putPrompt(prompt);
  }
}
async function toggleHidden(id) {
  const db = await openDb();
  const prompt = await getPrompt(id);
  if (prompt) {
    prompt.hidden = !prompt.hidden;
    prompt.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (prompt.hidden) {
      prompt.favorite = false;
    }
    await putPrompt(prompt);
  }
}
async function permanentlyDeletePrompt(id) {
  const db = await openDb();
  return await tx(db, STORE, "readwrite", (store) => {
    return reqPromise(store.delete(id));
  });
}
async function purgeDeletedPrompts(olderThanDays = 30) {
  const db = await openDb();
  const cutoff = /* @__PURE__ */ new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  return await tx(db, STORE, "readwrite", (store) => new Promise((resolve, reject) => {
    const req = store.openCursor();
    const deletedIds = [];
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur)
        return resolve(deletedIds);
      const prompt = cur.value;
      if (prompt.deletedAt && new Date(prompt.deletedAt) < cutoff) {
        deletedIds.push(prompt.id);
        store.delete(prompt.id);
      }
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}
async function incrementPromptUsage(promptId) {
  try {
    const totalUsed = await getMeta("totalPromptsUsed") ?? 0;
    const topUsed = await getMeta("topUsedPrompts") ?? [];
    await putMeta("totalPromptsUsed", totalUsed + 1);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existingIndex = topUsed.findIndex((p) => p.promptId === promptId);
    if (existingIndex >= 0) {
      topUsed[existingIndex].usageCount += 1;
      topUsed[existingIndex].lastUsed = now;
    } else {
      topUsed.push({ promptId, usageCount: 1, lastUsed: now });
    }
    topUsed.sort((a, b) => b.usageCount - a.usageCount);
    const top5 = topUsed.slice(0, 5);
    await putMeta("topUsedPrompts", top5);
    return { totalUsed: totalUsed + 1, topUsed: top5 };
  } catch (error) {
    console.error("Failed to increment prompt usage:", error);
    throw error;
  }
}
async function getAnalytics() {
  try {
    const totalUsed = await getMeta("totalPromptsUsed") ?? 0;
    const topUsed = await getMeta("topUsedPrompts") ?? [];
    return {
      totalPromptsUsed: totalUsed,
      topUsedPrompts: topUsed
    };
  } catch (error) {
    console.error("Failed to get analytics:", error);
    return {
      totalPromptsUsed: 0,
      topUsedPrompts: []
    };
  }
}
function tx(db, name, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(name, mode);
    const store = t.objectStore(name);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
var DB_NAME, DB_VERSION, STORE, META;
var init_db = __esm({
  "src/lib/db.ts"() {
    "use strict";
    DB_NAME = "prompt-library";
    DB_VERSION = 2;
    STORE = "prompts";
    META = "meta";
  }
});

// src/lib/migration.ts
var migration_exports = {};
__export(migration_exports, {
  MigrationManager: () => MigrationManager
});
var MigrationManager;
var init_migration = __esm({
  "src/lib/migration.ts"() {
    "use strict";
    MigrationManager = class _MigrationManager {
      static getInstance() {
        if (!_MigrationManager.instance) {
          _MigrationManager.instance = new _MigrationManager();
        }
        return _MigrationManager.instance;
      }
      async migrateSeedToStarter() {
        const result = {
          success: false,
          migratedCount: 0,
          errors: [],
          backupCreated: false
        };
        try {
          console.log("Starting migration from seed to starter...");
          result.backupCreated = await this.createBackup();
          if (!result.backupCreated) {
            throw new Error("Failed to create backup");
          }
          result.migratedCount = await this.updateExistingData();
          await this.updateSchema();
          await this.validateMigration();
          result.success = true;
          console.log(`Migration completed successfully. Migrated ${result.migratedCount} prompts.`);
        } catch (error) {
          result.errors.push(error instanceof Error ? error.message : "Unknown error");
          console.error("Migration failed:", error);
          try {
            await this.rollback();
            console.log("Rollback completed successfully");
          } catch (rollbackError) {
            result.errors.push(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : "Unknown error"}`);
            console.error("Rollback failed:", rollbackError);
          }
        }
        return result;
      }
      async createBackup() {
        try {
          const { openDb: openDb2, listPrompts: listPrompts2 } = await Promise.resolve().then(() => (init_db(), db_exports));
          const db = await openDb2();
          const prompts = await listPrompts2(true);
          const backup = {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            version: "1.0.0",
            prompts
          };
          const { putMeta: putMeta2 } = await Promise.resolve().then(() => (init_db(), db_exports));
          await putMeta2("migrationBackup", backup);
          console.log(`Backup created with ${prompts.length} prompts`);
          return true;
        } catch (error) {
          console.error("Failed to create backup:", error);
          return false;
        }
      }
      async updateExistingData() {
        try {
          const { openDb: openDb2, listPrompts: listPrompts2, putPrompt: putPrompt3 } = await Promise.resolve().then(() => (init_db(), db_exports));
          const db = await openDb2();
          const prompts = await listPrompts2(true);
          let migratedCount = 0;
          for (const prompt of prompts) {
            if (prompt.source === "seed") {
              const updatedPrompt = { ...prompt, source: "starter" };
              await putPrompt3(updatedPrompt);
              migratedCount++;
            }
          }
          console.log(`Updated ${migratedCount} prompts from seed to starter`);
          return migratedCount;
        } catch (error) {
          console.error("Failed to update existing data:", error);
          throw error;
        }
      }
      async updateSchema() {
        try {
          const { putMeta: putMeta2 } = await Promise.resolve().then(() => (init_db(), db_exports));
          await putMeta2("migrationCompleted", true);
          await putMeta2("migrationTimestamp", (/* @__PURE__ */ new Date()).toISOString());
          await putMeta2("migrationVersion", "2.0.0");
          console.log("Schema updated successfully");
        } catch (error) {
          console.error("Failed to update schema:", error);
          throw error;
        }
      }
      async validateMigration() {
        try {
          const { listPrompts: listPrompts2 } = await Promise.resolve().then(() => (init_db(), db_exports));
          const prompts = await listPrompts2(true);
          const remainingSeedPrompts = prompts.filter((p) => p.source === "seed");
          if (remainingSeedPrompts.length > 0) {
            throw new Error(`Migration validation failed: ${remainingSeedPrompts.length} prompts still have 'seed' source`);
          }
          console.log("Migration validation passed");
        } catch (error) {
          console.error("Migration validation failed:", error);
          throw error;
        }
      }
      async rollback() {
        try {
          const { putMeta: putMeta2, getMeta: getMeta2 } = await Promise.resolve().then(() => (init_db(), db_exports));
          const backup = await getMeta2("migrationBackup");
          if (!backup) {
            throw new Error("No backup found for rollback");
          }
          const { putPrompt: putPrompt3 } = await Promise.resolve().then(() => (init_db(), db_exports));
          for (const prompt of backup.prompts) {
            await putPrompt3(prompt);
          }
          await putMeta2("migrationCompleted", false);
          await putMeta2("migrationTimestamp", "");
          await putMeta2("migrationVersion", "");
          console.log("Rollback completed successfully");
        } catch (error) {
          console.error("Rollback failed:", error);
          throw error;
        }
      }
      async checkMigrationStatus() {
        try {
          const { getMeta: getMeta2 } = await Promise.resolve().then(() => (init_db(), db_exports));
          const completed = await getMeta2("migrationCompleted");
          const timestamp = await getMeta2("migrationTimestamp");
          const version = await getMeta2("migrationVersion");
          return {
            version: version || "1.0.0",
            timestamp: timestamp || "",
            status: completed ? "completed" : "pending"
          };
        } catch (error) {
          console.error("Failed to check migration status:", error);
          return {
            version: "1.0.0",
            timestamp: "",
            status: "failed"
          };
        }
      }
    };
  }
});

// src/background/background.ts
init_db();
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "purge-recycle-bin") {
      try {
        console.log("Recycle bin purge requested (not yet implemented)");
      } catch (error) {
        console.error("Failed to purge recycle bin:", error);
      }
    }
  });
} else {
  console.log("Chrome alarms API not available - recycle bin auto-purge disabled");
}
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      console.log("Extension icon clicked, opening sidebar...");
      if (chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        console.log("Sidebar opened successfully");
      } else {
        console.log("SidePanel API not available");
      }
    } catch (error) {
      console.error("Failed to open sidebar:", error);
    }
  });
} else {
  console.log("Chrome action API not available - extension icon click disabled");
}
if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    try {
      await ensureStarterLoaded();
    } catch (error) {
      console.error("Failed to ensure starters loaded on startup:", error);
    }
  });
} else {
  console.log("Chrome runtime startup API not available");
}
if (chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(async (details) => {
    try {
      if (details.reason === "install") {
        await ensureStarterLoaded();
      } else if (details.reason === "update") {
        console.log("Extension updated, checking for migration needs...");
        const needsMigration = await checkIfMigrationNeeded();
        if (needsMigration) {
          console.log("Migration needed after update, executing...");
          const { MigrationManager: MigrationManager2 } = await Promise.resolve().then(() => (init_migration(), migration_exports));
          const migrationManager = MigrationManager2.getInstance();
          const result = await migrationManager.migrateSeedToStarter();
          if (result.success) {
            console.log(`Migration completed successfully after update. Migrated ${result.migratedCount} prompts.`);
          } else {
            console.error("Migration failed after update:", result.errors);
          }
        }
        await ensureStarterLoaded();
      }
    } catch (error) {
      console.error("Failed to handle extension installation/update:", error);
    }
  });
} else {
  console.log("Chrome runtime installed API not available");
}
if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    console.log("Background: Received message:", msg.type, "from:", sender);
    try {
      if (msg.type === "insert") {
        const tabId = sender.tab?.id;
        if (tabId && chrome.scripting) {
          await insertIntoTab(tabId, msg.text);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "Scripting API not available" });
        }
      } else if (msg.type === "starter:ensure") {
        console.log("Background: Processing starter:ensure message...");
        await ensureStarterLoaded();
        console.log("Background: starter:ensure completed");
        sendResponse({ success: true });
      } else if (msg.type === "starter:reload") {
        await putMeta("starterLoaded", false);
        await putMeta("starterSchemaVersion", "");
        await ensureStarterLoaded();
        sendResponse({ success: true });
      } else if (msg.type === "incrementUsage") {
        await incrementPromptUsage(msg.promptId);
        sendResponse({ success: true });
      } else if (msg.type === "migration:status") {
        const { MigrationManager: MigrationManager2 } = await Promise.resolve().then(() => (init_migration(), migration_exports));
        const migrationManager = MigrationManager2.getInstance();
        const status = await migrationManager.checkMigrationStatus();
        sendResponse({ success: true, status });
      }
    } catch (error) {
      console.error("Message handling error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      sendResponse({ success: false, error: errorMessage });
    }
    return true;
  });
} else {
  console.log("Chrome runtime message API not available");
}
async function insertIntoTab(tabId, text) {
  try {
    if (!chrome.scripting) {
      throw new Error("Chrome scripting API not available");
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (textToInsert) => {
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
          const start = activeElement.selectionStart || 0;
          const end = activeElement.selectionEnd || 0;
          const value = activeElement.value;
          activeElement.value = value.substring(0, start) + textToInsert + value.substring(end);
          activeElement.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
          activeElement.focus();
        }
      },
      args: [text]
    });
  } catch (error) {
    console.error("Failed to insert text into tab:", error);
    throw error;
  }
}
async function ensureStarterLoaded() {
  try {
    console.log("ensureStarterLoaded: Starting...");
    const needsMigration = await checkIfMigrationNeeded();
    console.log("ensureStarterLoaded: Migration needed?", needsMigration);
    if (needsMigration) {
      console.log("Migration needed, executing...");
      const { MigrationManager: MigrationManager2 } = await Promise.resolve().then(() => (init_migration(), migration_exports));
      const migrationManager = MigrationManager2.getInstance();
      const result = await migrationManager.migrateSeedToStarter();
      if (result.success) {
        console.log(`Migration completed successfully. Migrated ${result.migratedCount} prompts.`);
      } else {
        console.error("Migration failed:", result.errors);
      }
    }
    const seeded = await getMeta("starterLoaded");
    const currentSchemaVersion = await getMeta("starterSchemaVersion");
    console.log("ensureStarterLoaded: Current state - seeded:", seeded, "version:", currentSchemaVersion);
    const url = chrome.runtime.getURL("data/starter.json");
    console.log("ensureStarterLoaded: Loading from URL:", url);
    const res = await fetch(url);
    if (!res.ok)
      throw new Error("Failed to load starter.json");
    const json = await res.json();
    console.log("ensureStarterLoaded: Loaded starter.json with", json.prompts.length, "prompts");
    if (seeded && currentSchemaVersion === json.schemaVersion) {
      console.log("Starters already loaded with current version");
      return;
    }
    console.log("Loading starter prompts...");
    const db = await openDb();
    const tx2 = db.transaction("prompts", "readwrite");
    const store = tx2.objectStore("prompts");
    let existingStarters = [];
    try {
      if (store.indexNames.contains("by_source")) {
        existingStarters = await new Promise((resolve, reject) => {
          const req = store.index("by_source").getAll("starter");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      } else {
        console.log("Source index not found, scanning all prompts manually...");
        existingStarters = await new Promise((resolve, reject) => {
          const out = [];
          const req = store.openCursor();
          req.onsuccess = () => {
            const cur = req.result;
            if (!cur)
              return resolve(out);
            const val = cur.value;
            if (val.source === "starter")
              out.push(val);
            cur.continue();
          };
          req.onerror = () => reject(req.error);
        });
      }
    } catch (indexError) {
      console.log("Index access failed, scanning all prompts manually...");
      existingStarters = await new Promise((resolve, reject) => {
        const out = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur)
            return resolve(out);
          const val = cur.value;
          if (val.source === "starter")
            out.push(val);
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    }
    console.log("ensureStarterLoaded: Found", existingStarters.length, "existing starters to clear");
    for (const existing of existingStarters) {
      store.delete(existing.id);
    }
    for (const promptData of json.prompts) {
      const starter = {
        ...promptData,
        source: "starter",
        createdAt: promptData.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: promptData.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
      };
      store.put(starter);
    }
    await new Promise((resolve, reject) => {
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
    });
    await putMeta("starterLoaded", true);
    await putMeta("starterSchemaVersion", json.schemaVersion);
    console.log(`Loaded ${json.prompts.length} starter prompts successfully`);
  } catch (e) {
    console.error("Starter load error:", e);
  }
}
async function checkIfMigrationNeeded() {
  try {
    const migrationCompleted = await getMeta("migrationCompleted");
    if (migrationCompleted) {
      console.log("Migration already completed");
      return false;
    }
    const { listPrompts: listPrompts2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    const prompts = await listPrompts2(true);
    const hasSeedPrompts = prompts.some((p) => p.source === "seed");
    if (hasSeedPrompts) {
      console.log("Found prompts with seed source, migration needed");
      return true;
    }
    console.log("No seed prompts found, migration not needed");
    return false;
  } catch (error) {
    console.error("Error checking migration status:", error);
    return false;
  }
}
//# sourceMappingURL=background.js.map

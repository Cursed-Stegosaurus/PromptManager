import { openDb, putPrompt, getMeta, putMeta, incrementPromptUsage } from '../lib/db.js';
import type { Prompt } from '../lib/schema.js';

// Daily purge of recycle bin (placeholder for future implementation)
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "purge-recycle-bin") {
      try {
        // TODO: Implement purgeRecycleBin function
        console.log("Recycle bin purge requested (not yet implemented)");
      } catch (error) {
        console.error("Failed to purge recycle bin:", error);
      }
    }
  });
} else {
  console.log("Chrome alarms API not available - recycle bin auto-purge disabled");
}

// Handle extension icon click to open sidebar
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      console.log('Extension icon clicked, opening sidebar...');
      if (chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        console.log('Sidebar opened successfully');
      } else {
        console.log('SidePanel API not available');
      }
    } catch (error) {
      console.error('Failed to open sidebar:', error);
    }
  });
} else {
  console.log("Chrome action API not available - extension icon click disabled");
}

// Ensure starters are loaded when extension starts
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
      if (details.reason === 'install') {
        // Fresh installation - just load starters
        await ensureStarterLoaded();
      } else if (details.reason === 'update') {
        // Extension update - check if migration is needed
        console.log('Extension updated, checking for migration needs...');
        const needsMigration = await checkIfMigrationNeeded();
        if (needsMigration) {
          console.log('Migration needed after update, executing...');
          const { MigrationManager } = await import('../lib/migration.js');
          const migrationManager = MigrationManager.getInstance();
          const result = await migrationManager.migrateSeedToStarter();
          
          if (result.success) {
            console.log(`Migration completed successfully after update. Migrated ${result.migratedCount} prompts.`);
          } else {
            console.error('Migration failed after update:', result.errors);
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

// Handle messages from content scripts and sidepanel
if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    console.log('Background: Received message:', msg.type, 'from:', sender);
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
        console.log('Background: Processing starter:ensure message...');
        await ensureStarterLoaded();
        console.log('Background: starter:ensure completed');
        sendResponse({ success: true });
      } else if (msg.type === "starter:reload") {
        // Force reload starters by clearing the starter flag
        await putMeta("starterLoaded", false);
        await putMeta("starterSchemaVersion", "");
        await ensureStarterLoaded();
        sendResponse({ success: true });
      } else if (msg.type === "incrementUsage") {
        await incrementPromptUsage(msg.promptId);
        sendResponse({ success: true });
      } else if (msg.type === "migration:status") {
        const { MigrationManager } = await import('../lib/migration.js');
        const migrationManager = MigrationManager.getInstance();
        const status = await migrationManager.checkMigrationStatus();
        sendResponse({ success: true, status });
      }
    } catch (error) {
      console.error("Message handling error:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      sendResponse({ success: false, error: errorMessage });
    }
    return true; // Keep message channel open for async response
  });
} else {
  console.log("Chrome runtime message API not available");
}

// Insert text into a tab
async function insertIntoTab(tabId: number, text: string) {
  try {
    if (!chrome.scripting) {
      throw new Error("Chrome scripting API not available");
    }
    
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (textToInsert) => {
        const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
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

// Load starter prompts from packaged file on first run
async function ensureStarterLoaded() {
  try {
    console.log('ensureStarterLoaded: Starting...');
    
    // Check if migration is needed first
    const needsMigration = await checkIfMigrationNeeded();
    console.log('ensureStarterLoaded: Migration needed?', needsMigration);
    
    if (needsMigration) {
      console.log('Migration needed, executing...');
      const { MigrationManager } = await import('../lib/migration.js');
      const migrationManager = MigrationManager.getInstance();
      const result = await migrationManager.migrateSeedToStarter();
      
      if (result.success) {
        console.log(`Migration completed successfully. Migrated ${result.migratedCount} prompts.`);
      } else {
        console.error('Migration failed:', result.errors);
      }
    }
    
    const seeded = await getMeta<boolean>("starterLoaded");
    const currentSchemaVersion = await getMeta<string>("starterSchemaVersion");
    console.log('ensureStarterLoaded: Current state - seeded:', seeded, 'version:', currentSchemaVersion);
    
    // Get starter data first
    const url = chrome.runtime.getURL("data/starter.json");
    console.log('ensureStarterLoaded: Loading from URL:', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load starter.json");
    const json = await res.json();
    console.log('ensureStarterLoaded: Loaded starter.json with', json.prompts.length, 'prompts');
    
    // Check if we need to reload starters (new version or never loaded)
    if (seeded && currentSchemaVersion === json.schemaVersion) {
      console.log("Starters already loaded with current version");
      return;
    }
    
    console.log("Loading starter prompts...");
    const db = await openDb();
    const tx = db.transaction("prompts", "readwrite");
    const store = tx.objectStore("prompts");
    
    // Clear existing starters first
    let existingStarters: Prompt[] = [];
    try {
      // Try to use the index if it exists
      if (store.indexNames.contains("by_source")) {
        existingStarters = await new Promise<Prompt[]>((resolve, reject) => {
          const req = store.index("by_source").getAll("starter");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      } else {
        // Fallback: scan all prompts manually
        console.log('Source index not found, scanning all prompts manually...');
        existingStarters = await new Promise<Prompt[]>((resolve, reject) => {
          const out: Prompt[] = [];
          const req = store.openCursor();
          req.onsuccess = () => {
            const cur = req.result as IDBCursorWithValue | null;
            if (!cur) return resolve(out);
            const val = cur.value as Prompt;
            if (val.source === 'starter') out.push(val);
            cur.continue();
          };
          req.onerror = () => reject(req.error);
        });
      }
    } catch (indexError) {
      console.log('Index access failed, scanning all prompts manually...');
      // Fallback: scan all prompts manually
      existingStarters = await new Promise<Prompt[]>((resolve, reject) => {
        const out: Prompt[] = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cur = req.result as IDBCursorWithValue | null;
          if (!cur) return resolve(out);
          const val = cur.value as Prompt;
          if (val.source === 'starter') out.push(val);
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    }
    
    console.log('ensureStarterLoaded: Found', existingStarters.length, 'existing starters to clear');
    
    for (const existing of existingStarters) {
      store.delete(existing.id);
    }
    
    // Load new starters
    for (const promptData of json.prompts) {
      const starter: Prompt = {
        ...promptData,
        source: "starter",
        createdAt: promptData.createdAt || new Date().toISOString(),
        updatedAt: promptData.updatedAt || new Date().toISOString()
      };
      store.put(starter);
    }
    
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    
    await putMeta("starterLoaded", true);
    await putMeta("starterSchemaVersion", json.schemaVersion);
    console.log(`Loaded ${json.prompts.length} starter prompts successfully`);
  } catch (e) {
    // Non-fatal, extension still works without starters.
    console.error("Starter load error:", e);
  }
}

// Check if migration from seed to starter is needed
async function checkIfMigrationNeeded(): Promise<boolean> {
  try {
    const migrationCompleted = await getMeta<boolean>("migrationCompleted");
    if (migrationCompleted) {
      console.log('Migration already completed');
      return false;
    }
    
    // Check if any prompts still have 'seed' source
    const { listPrompts } = await import('../lib/db.js');
    const prompts = await listPrompts(true);
    const hasSeedPrompts = prompts.some(p => (p.source as any) === 'seed');
    
    if (hasSeedPrompts) {
      console.log('Found prompts with seed source, migration needed');
      return true;
    }
    
    console.log('No seed prompts found, migration not needed');
    return false;
  } catch (error) {
    console.error('Error checking migration status:', error);
    return false;
  }
}

import { openDb, putPrompt, getMeta, putMeta } from '../lib/db.js';
import type { Prompt } from '../lib/schema.js';

// Daily purge of recycle bin
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name === "purge") {
      await purgeRecycleBin();
    }
  });
  
  // Create daily purge alarm
  chrome.alarms.create("purge", { periodInMinutes: 24 * 60 });
}

// Ensure seeds are loaded when extension starts
chrome.runtime.onStartup.addListener(async () => {
  await ensureSeedLoaded();
});

// Handle extension installation and setup
chrome.runtime.onInstalled.addListener(async () => {
  await ensureSeedLoaded();
  
  // Create context menu for inserting prompts
  chrome.contextMenus.create({
    id: "insert-prompt",
    title: "Insert Prompt",
    contexts: ["editable"]
  });
});

// Handle extension icon click to open sidebar
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "insert-prompt" && tab?.id) {
    const lastUsedId = await getMeta<string>("lastUsedPromptId");
    if (lastUsedId) {
      const prompt = await getPrompt(lastUsedId);
      if (prompt) {
        await insertIntoTab(tab.id, prompt.body);
      }
    }
  }
});

// Message channel from side panel or options
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (msg.type === "insert") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) {
        await insertIntoTab(tab.id, msg.text as string);
        send({ ok: true });
      }
    } else if (msg.type === "seed:ensure") {
      await ensureSeedLoaded();
      send({ ok: true });
    } else if (msg.type === "seed:reload") {
      // Force reload seeds by clearing the seed flag
      await putMeta("seedLoaded", false);
      await putMeta("seedSchemaVersion", "");
      await ensureSeedLoaded();
      send({ ok: true });
    }
  })();
  return true;
});

// Load seed prompts from packaged file on first run
async function ensureSeedLoaded() {
  try {
    const seeded = await getMeta<boolean>("seedLoaded");
    const currentSchemaVersion = await getMeta<string>("seedSchemaVersion");
    
    // Get seed data first
    const url = chrome.runtime.getURL("data/seed.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load seed.json");
    const json = await res.json() as { schemaVersion: string; prompts: Prompt[] };
    
    // Check if we need to reload seeds (new version or never loaded)
    if (seeded && currentSchemaVersion === json.schemaVersion) {
      return;
    }
    const db = await openDb();
    const tx = db.transaction("prompts", "readwrite");
    const store = tx.objectStore("prompts");

    await new Promise<void>((resolve, reject) => {
      const now = new Date().toISOString();
      for (const p of json.prompts) {
        const seed: Prompt = {
          ...p,
          source: "seed",
          favorite: p.favorite ?? false,
          hidden: p.hidden ?? false,
          createdAt: p.createdAt ?? now,
          updatedAt: p.updatedAt ?? now,
          version: p.version ?? 1
        };
        store.put(seed);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    await putMeta("seedLoaded", true);
    await putMeta("seedSchemaVersion", json.schemaVersion);
  } catch (e) {
    // Non-fatal, extension still works without seeds.
    console.error("Seed load error:", e);
  }
}

// Remove items in recycle bin older than 30 days
async function purgeRecycleBin() {
  try {
    const db = await openDb();
    const t = db.transaction("prompts", "readwrite");
    const store = t.objectStore("prompts");
    const req = store.openCursor();
    const now = Date.now();
    const cutoff = now - (30 * 24 * 60 * 60 * 1000); // 30 days

    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const cur = req.result as IDBCursorWithValue | null;
        if (!cur) return resolve();
        const p = cur.value as Prompt;
        if (p.deletedAt && new Date(p.deletedAt).getTime() < cutoff) {
          store.delete(p.id);
        }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error("Purge error:", error);
  }
}

// Try to insert text into the focused element in the tab
async function insertIntoTab(tabId: number, text: string) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t: string) => {
        const ok = tryInsert(document.activeElement as HTMLElement | null, t) || tryFrames(t);
        if (!ok) {
          // Clipboard fallback
          void navigator.clipboard.writeText(t);
        }

        function tryInsert(node: HTMLElement | null, val: string): boolean {
          if (!node) return false;
          
          // Inputs and textareas
          if ((node as HTMLInputElement).value !== undefined) {
            const input = node as HTMLInputElement;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            input.setRangeText(val, start, end, "end");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          }
          
          // Contenteditable
          if (node.isContentEditable) {
            const sel = window.getSelection();
            if (!sel) return false;
            sel.deleteFromDocument();
            const textNode = document.createTextNode(val);
            if (sel.rangeCount === 0) {
              const r = document.createRange();
              r.selectNodeContents(node);
              sel.addRange(r);
            }
            const range = sel.getRangeAt(0);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
          }
          
          return false;
        }

        function tryFrames(val: string): boolean {
          for (const f of Array.from(window.frames)) {
            try {
              const d = f.document;
              const el = d.activeElement as HTMLElement | null;
              if (el && tryInsert(el, val)) {
                return true;
              }
            } catch {
              // Cross-origin frame, skip
            }
          }
          return false;
        }
      },
      args: [text]
    });
  } catch (error) {
    console.error("Insert failed:", error);
    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(text);
    } catch (clipboardError) {
      console.error("Clipboard fallback failed:", clipboardError);
    }
  }
}

// Helper function to get prompt from database
async function getPrompt(id: string): Promise<Prompt | undefined> {
  try {
    const db = await openDb();
    const tx = db.transaction("prompts", "readonly");
    const store = tx.objectStore("prompts");
    return await new Promise<Prompt | undefined>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error("Failed to get prompt:", error);
    return undefined;
  }
}

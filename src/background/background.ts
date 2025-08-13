import { listPrompts, putPrompt, getMeta, putMeta, openDb } from "../lib/db";
import type { Prompt } from "../lib/schema";

/**
 * One-time seed loader on first run.
 */
chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === "install") {
    await ensureSeedLoaded();
  }
  chrome.contextMenus.create({ id: "insert-last", title: "Insert last prompt", contexts: ["editable"] });
  chrome.alarms.create("purge", { periodInMinutes: 60 * 24 });
});

/**
 * Toolbar click opens the side panel.
 */
chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    // Side panel may not be available on very old Chrome versions.
  }
});

/**
 * Context menu to insert the last used prompt.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "insert-last" || !tab?.id) return;
  const lastId = await getMeta<string>("lastUsedPromptId");
  if (!lastId) return;
  const all = await listPrompts();
  const p = all.find(x => x.id === lastId);
  if (!p) return;
  await insertIntoTab(tab.id, p.body);
});

/**
 * Daily purge of recycle bin.
 */
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === "purge") await purgeRecycleBin();
});

/**
 * Message channel from side panel or options.
 */
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (msg.type === "insert") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) await insertIntoTab(tab.id, msg.text as string);
      send({ ok: true });
    } else if (msg.type === "seed:ensure") {
      await ensureSeedLoaded();
      send({ ok: true });
    }
  })();
  return true;
});

/**
 * Load seed prompts from packaged file on first run.
 * Seeds are read only and can be hidden or cloned.
 */
async function ensureSeedLoaded() {
  try {
    const seeded = await getMeta<boolean>("seedLoaded");
    if (seeded) return;

    const url = chrome.runtime.getURL("data/seed.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load seed.json");
    const json = await res.json() as { schemaVersion: string; prompts: Prompt[] };

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
  } catch (e) {
    // Non-fatal, extension still works without seeds.
    console.error("Seed load error:", e);
  }
}

/**
 * Remove items in recycle bin older than 30 days.
 */
async function purgeRecycleBin() {
  const db = await openDb();
  const t = db.transaction("prompts", "readwrite");
  const store = t.objectStore("prompts");
  const req = store.openCursor();
  const now = Date.now();

  req.onsuccess = () => {
    const cur = req.result as IDBCursorWithValue | null;
    if (!cur) return;
    const p = cur.value as Prompt;
    if (p.deletedAt) {
      const age = now - new Date(p.deletedAt).getTime();
      if (age > 30 * 24 * 60 * 60 * 1000) {
        store.delete(p.id);
      }
    }
    cur.continue();
  };
}

/**
 * Try to insert text into the focused element in the tab.
 * Fallback to clipboard if blocked by page restrictions or CSP.
 */
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
              if (tryInsert(el, val)) return true;
            } catch {
              // Cross-origin frames will throw, ignore
            }
          }
          return false;
        }
      },
      args: [text]
    });
  } catch {
    // Best effort clipboard fallback on any injection error
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (t: string) => void navigator.clipboard.writeText(t),
        args: [text]
      });
    } catch {
      // Swallow
    }
  }
}

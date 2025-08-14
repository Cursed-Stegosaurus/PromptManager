// src/lib/db.ts
var DB_NAME = "prompt-library";
var DB_VERSION = 1;
var STORE = "prompts";
var META = "meta";
async function openDb() {
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
async function putMeta(key, value) {
  const db = await openDb();
  await tx(db, META, "readwrite", (store) => store.put({ key, value }));
}
async function getMeta(key) {
  const db = await openDb();
  return await tx(db, META, "readonly", (store) => reqPromise(store.get(key)).then((r) => r?.value));
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

// src/background/background.ts
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name === "purge") {
      await purgeRecycleBin();
    }
  });
  chrome.alarms.create("purge", { periodInMinutes: 24 * 60 });
}
chrome.runtime.onStartup.addListener(async () => {
  await ensureSeedLoaded();
});
chrome.runtime.onInstalled.addListener(async () => {
  await ensureSeedLoaded();
  chrome.contextMenus.create({
    id: "insert-prompt",
    title: "Insert Prompt",
    contexts: ["editable"]
  });
});
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "insert-prompt" && tab?.id) {
    const lastUsedId = await getMeta("lastUsedPromptId");
    if (lastUsedId) {
      const prompt = await getPrompt(lastUsedId);
      if (prompt) {
        await insertIntoTab(tab.id, prompt.body);
      }
    }
  }
});
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (msg.type === "insert") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) {
        await insertIntoTab(tab.id, msg.text);
        send({ ok: true });
      }
    } else if (msg.type === "seed:ensure") {
      await ensureSeedLoaded();
      send({ ok: true });
    } else if (msg.type === "seed:reload") {
      await putMeta("seedLoaded", false);
      await putMeta("seedSchemaVersion", "");
      await ensureSeedLoaded();
      send({ ok: true });
    }
  })();
  return true;
});
async function ensureSeedLoaded() {
  try {
    const seeded = await getMeta("seedLoaded");
    const currentSchemaVersion = await getMeta("seedSchemaVersion");
    const url = chrome.runtime.getURL("data/seed.json");
    const res = await fetch(url);
    if (!res.ok)
      throw new Error("Failed to load seed.json");
    const json = await res.json();
    if (seeded && currentSchemaVersion === json.schemaVersion) {
      return;
    }
    const db = await openDb();
    const tx2 = db.transaction("prompts", "readwrite");
    const store = tx2.objectStore("prompts");
    await new Promise((resolve, reject) => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      for (const p of json.prompts) {
        const seed = {
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
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
      tx2.onabort = () => reject(tx2.error);
    });
    await putMeta("seedLoaded", true);
    await putMeta("seedSchemaVersion", json.schemaVersion);
  } catch (e) {
    console.error("Seed load error:", e);
  }
}
async function purgeRecycleBin() {
  try {
    const db = await openDb();
    const t = db.transaction("prompts", "readwrite");
    const store = t.objectStore("prompts");
    const req = store.openCursor();
    const now = Date.now();
    const cutoff = now - 30 * 24 * 60 * 60 * 1e3;
    await new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur)
          return resolve();
        const p = cur.value;
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
async function insertIntoTab(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t) => {
        const ok = tryInsert(document.activeElement, t) || tryFrames(t);
        if (!ok) {
          void navigator.clipboard.writeText(t);
        }
        function tryInsert(node, val) {
          if (!node)
            return false;
          if (node.value !== void 0) {
            const input = node;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            input.setRangeText(val, start, end, "end");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          }
          if (node.isContentEditable) {
            const sel = window.getSelection();
            if (!sel)
              return false;
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
        function tryFrames(val) {
          for (const f of Array.from(window.frames)) {
            try {
              const d = f.document;
              const el = d.activeElement;
              if (el && tryInsert(el, val)) {
                return true;
              }
            } catch {
            }
          }
          return false;
        }
      },
      args: [text]
    });
  } catch (error) {
    console.error("Insert failed:", error);
    try {
      await navigator.clipboard.writeText(text);
    } catch (clipboardError) {
      console.error("Clipboard fallback failed:", clipboardError);
    }
  }
}
async function getPrompt(id) {
  try {
    const db = await openDb();
    const tx2 = db.transaction("prompts", "readonly");
    const store = tx2.objectStore("prompts");
    return await new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error("Failed to get prompt:", error);
    return void 0;
  }
}
//# sourceMappingURL=background.js.map

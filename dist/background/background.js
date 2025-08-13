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
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function listPrompts(includeDeleted = false) {
  const db = await openDb();
  return await tx(db, STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const out = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(out);
      const val = cur.value;
      if (!val.deletedAt || includeDeleted) out.push(val);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  }));
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
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await ensureSeedLoaded();
  }
  chrome.contextMenus.create({ id: "insert-last", title: "Insert last prompt", contexts: ["editable"] });
  chrome.alarms.create("purge", { periodInMinutes: 60 * 24 });
});
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
  }
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "insert-last" || !tab?.id) return;
  const lastId = await getMeta("lastUsedPromptId");
  if (!lastId) return;
  const all = await listPrompts();
  const p = all.find((x) => x.id === lastId);
  if (!p) return;
  await insertIntoTab(tab.id, p.body);
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "purge") await purgeRecycleBin();
});
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (msg.type === "insert") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) await insertIntoTab(tab.id, msg.text);
      send({ ok: true });
    } else if (msg.type === "seed:ensure") {
      await ensureSeedLoaded();
      send({ ok: true });
    }
  })();
  return true;
});
async function ensureSeedLoaded() {
  try {
    const seeded = await getMeta("seedLoaded");
    if (seeded) return;
    const url = chrome.runtime.getURL("data/seed.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load seed.json");
    const json = await res.json();
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
  } catch (e) {
    console.error("Seed load error:", e);
  }
}
async function purgeRecycleBin() {
  const db = await openDb();
  const t = db.transaction("prompts", "readwrite");
  const store = t.objectStore("prompts");
  const req = store.openCursor();
  const now = Date.now();
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return;
    const p = cur.value;
    if (p.deletedAt) {
      const age = now - new Date(p.deletedAt).getTime();
      if (age > 30 * 24 * 60 * 60 * 1e3) {
        store.delete(p.id);
      }
    }
    cur.continue();
  };
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
          if (!node) return false;
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
        function tryFrames(val) {
          for (const f of Array.from(window.frames)) {
            try {
              const d = f.document;
              const el = d.activeElement;
              if (tryInsert(el, val)) return true;
            } catch {
            }
          }
          return false;
        }
      },
      args: [text]
    });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (t) => void navigator.clipboard.writeText(t),
        args: [text]
      });
    } catch {
    }
  }
}
//# sourceMappingURL=background.js.map

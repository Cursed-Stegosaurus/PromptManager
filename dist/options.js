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
async function putPrompt(p) {
  const db = await openDb();
  await tx(db, STORE, "readwrite", (store) => store.put(p));
}
async function listPrompts(includeDeleted = false) {
  const db = await openDb();
  return await tx(db, STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const out = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur)
        return resolve(out);
      const val = cur.value;
      if (!val.deletedAt || includeDeleted)
        out.push(val);
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

// src/options/options.ts
var exportButton = document.getElementById("btn-export");
var importButton = document.getElementById("btn-import");
var importFile = document.getElementById("import-file");
var encryptionEnabled = document.getElementById("encryption-enabled");
var encryptionControls = document.getElementById("encryption-controls");
var encryptionPassphrase = document.getElementById("encryption-passphrase");
var confirmPassphrase = document.getElementById("confirm-passphrase");
var setPassphraseButton = document.getElementById("btn-set-passphrase");
var telemetryEnabled = document.getElementById("telemetry-enabled");
var recyclePurgeDays = document.getElementById("recycle-purge-days");
var reloadSeedsButton = document.getElementById("btn-reload-seeds");
var resetSeedsButton = document.getElementById("btn-reset-seeds");
var toastContainer = document.getElementById("toast-container");
async function init() {
  try {
    await loadSettings();
    wireEvents();
  } catch (error) {
    console.error("Failed to initialize options:", error);
    showToast("Failed to initialize options", "error");
  }
}
async function loadSettings() {
  try {
    const encryptionOn = await getMeta("encryptionEnabled") ?? false;
    encryptionEnabled.checked = encryptionOn;
    if (encryptionOn) {
      encryptionControls.classList.remove("hidden");
    } else {
      encryptionControls.classList.add("hidden");
    }
    const telemetry = await getMeta("telemetryEnabled") ?? false;
    telemetryEnabled.checked = telemetry;
    const purgeDays = await getMeta("recycleAutoPurgeDays") ?? 30;
    recyclePurgeDays.value = purgeDays.toString();
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
}
function wireEvents() {
  exportButton.addEventListener("click", exportPrompts);
  importButton.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", handleImport);
  encryptionEnabled.addEventListener("change", async () => {
    const enabled = encryptionEnabled.checked;
    if (enabled) {
      encryptionControls.classList.remove("hidden");
      showToast("Encryption enabled. Set a passphrase to secure your prompts.", "info");
    } else {
      encryptionControls.classList.add("hidden");
    }
    await putMeta("encryptionEnabled", enabled);
  });
  setPassphraseButton.addEventListener("click", setEncryptionPassphrase);
  telemetryEnabled.addEventListener("change", async () => {
    await putMeta("telemetryEnabled", telemetryEnabled.checked);
  });
  recyclePurgeDays.addEventListener("change", async () => {
    await putMeta("recycleAutoPurgeDays", parseInt(recyclePurgeDays.value));
  });
  reloadSeedsButton.addEventListener("click", reloadSeeds);
  resetSeedsButton.addEventListener("click", resetSeeds);
}
async function exportPrompts() {
  try {
    const prompts = await listPrompts();
    const exportData = {
      schemaVersion: "1.0.0",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      prompts: prompts.filter((p) => p.source === "user")
      // Only export user prompts
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prompt-library-export-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Export completed successfully", "success");
  } catch (error) {
    console.error("Export failed:", error);
    showToast("Export failed", "error");
  }
}
async function handleImport(event) {
  const target = event.target;
  const file = target.files?.[0];
  if (!file)
    return;
  try {
    const text = await file.text();
    const importData = JSON.parse(text);
    if (!importData.prompts || !Array.isArray(importData.prompts)) {
      throw new Error("Invalid import file format");
    }
    await mergePrompts(importData.prompts);
    showToast("Import completed successfully", "success");
  } catch (error) {
    console.error("Import failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    showToast(`Import failed: ${errorMessage}`, "error");
  } finally {
    target.value = "";
  }
}
async function mergePrompts(importedPrompts) {
  const existingPrompts = await listPrompts();
  const existingMap = new Map(existingPrompts.map((p) => [p.id, p]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const imported of importedPrompts) {
    const existing = existingMap.get(imported.id);
    if (!existing) {
      await putPrompt(imported);
      added++;
    } else if (existing.source === "seed") {
      skipped++;
    } else if (new Date(imported.updatedAt) > new Date(existing.updatedAt)) {
      await putPrompt(imported);
      updated++;
    } else {
      skipped++;
    }
  }
  showToast(`Merge completed: ${added} added, ${updated} updated, ${skipped} skipped`, "info");
}
async function setEncryptionPassphrase() {
  const passphrase = encryptionPassphrase.value;
  const confirm2 = confirmPassphrase.value;
  if (!passphrase || passphrase.length < 8) {
    showToast("Passphrase must be at least 8 characters long", "error");
    return;
  }
  if (passphrase !== confirm2) {
    showToast("Passphrases do not match", "error");
    return;
  }
  try {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const saltB64 = btoa(String.fromCharCode(...salt));
    await putMeta("saltB64", saltB64);
    showToast("Encryption passphrase set successfully", "success");
    encryptionPassphrase.value = "";
    confirmPassphrase.value = "";
  } catch (error) {
    console.error("Failed to set passphrase:", error);
    showToast("Failed to set passphrase", "error");
  }
}
async function reloadSeeds() {
  try {
    reloadSeedsButton.disabled = true;
    reloadSeedsButton.textContent = "Reloading...";
    await chrome.runtime.sendMessage({ type: "seed:reload" });
    showToast("Seed prompts reloaded successfully", "success");
  } catch (error) {
    console.error("Failed to reload seeds:", error);
    showToast("Failed to reload seed prompts", "error");
  } finally {
    reloadSeedsButton.disabled = false;
    reloadSeedsButton.textContent = "Reload Seed Prompts";
  }
}
async function resetSeeds() {
  if (!confirm("This will remove all existing seed prompts and reload them fresh. This action cannot be undone. Continue?")) {
    return;
  }
  try {
    resetSeedsButton.disabled = true;
    resetSeedsButton.textContent = "Resetting...";
    const db = await openDb();
    const tx2 = db.transaction("prompts", "readwrite");
    const store = tx2.objectStore("prompts");
    const seedPrompts = await listPrompts();
    const seedIds = seedPrompts.filter((p) => p.source === "seed").map((p) => p.id);
    for (const id of seedIds) {
      await store.delete(id);
    }
    await putMeta("seedLoaded", false);
    await putMeta("seedSchemaVersion", "");
    await chrome.runtime.sendMessage({ type: "seed:ensure" });
    showToast("Seed prompts reset successfully", "success");
  } catch (error) {
    console.error("Failed to reset seeds:", error);
    showToast("Failed to reset seed prompts", "error");
  } finally {
    resetSeedsButton.disabled = false;
    resetSeedsButton.textContent = "Reset All Seeds";
  }
}
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
      <button class="toast-close" onclick="this.parentElement.parentElement.remove()">\xD7</button>
    </div>
    <div class="toast-message">${message}</div>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 5e3);
}
document.addEventListener("DOMContentLoaded", init);
//# sourceMappingURL=options.js.map

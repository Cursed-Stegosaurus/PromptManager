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

// src/lib/auth.chrome.ts
async function getChromeAccessToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError?.message || "No token");
      } else {
        resolve(token);
      }
    });
  });
}

// src/lib/drive.ts
var DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
var DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
var APPDATA_Q = "name = 'prompt-library-backup.json' and 'appDataFolder' in parents";
async function backupToDrive(payload) {
  const token = await getChromeAccessToken();
  const id = await findExisting(token);
  if (id) {
    await uploadContent(token, id, JSON.stringify(payload));
  } else {
    const newId = await createFile(token);
    await uploadContent(token, newId, JSON.stringify(payload));
  }
}
async function restoreFromDrive() {
  const token = await getChromeAccessToken();
  const id = await findExisting(token);
  if (!id) return null;
  const res = await fetch(`${DRIVE_FILES}/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Restore failed");
  return res.json();
}
async function findExisting(token) {
  const url = `${DRIVE_FILES}?spaces=appDataFolder&q=${encodeURIComponent(APPDATA_Q)}&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Drive list failed");
  const json = await res.json();
  return json.files?.[0]?.id || null;
}
async function createFile(token) {
  const meta = { name: "prompt-library-backup.json", parents: ["appDataFolder"] };
  const init2 = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/json"
    },
    body: JSON.stringify(meta)
  });
  if (!init2.ok) throw new Error("Init upload failed");
  const loc = init2.headers.get("location");
  if (!loc) throw new Error("No upload session");
  const put = await fetch(loc, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: "{}" });
  if (!put.ok) throw new Error("Create file failed");
  const created = await put.json();
  return created.id;
}
async function uploadContent(token, id, body) {
  const res = await fetch(`${DRIVE_UPLOAD}/${id}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body
  });
  if (!res.ok) throw new Error("Backup failed");
}

// src/options/options.ts
var enableDrive = document.getElementById("enableDrive");
var btnBackup = document.getElementById("btnBackup");
var btnRestore = document.getElementById("btnRestore");
var status = document.getElementById("backupStatus");
var enableEnc = document.getElementById("enableEnc");
var pass1 = document.getElementById("pass1");
var pass2 = document.getElementById("pass2");
var btnSetPass = document.getElementById("btnSetPass");
var fileImport = document.getElementById("fileImport");
var btnImport = document.getElementById("btnImport");
var btnExport = document.getElementById("btnExport");
init();
async function init() {
  const drive = await getMeta("driveBackupEnabled");
  enableDrive.checked = !!drive;
  const last = await getMeta("driveLastBackupAt");
  status.textContent = `Last backup: ${last || "never"}`;
}
enableDrive.onchange = async () => {
  await putMeta("driveBackupEnabled", enableDrive.checked);
};
btnBackup.onclick = async () => {
  const payload = { schemaVersion: "1.0.0", exportedAt: (/* @__PURE__ */ new Date()).toISOString(), prompts: await listPrompts(true) };
  try {
    await backupToDrive(payload);
    await putMeta("driveLastBackupAt", (/* @__PURE__ */ new Date()).toISOString());
    status.textContent = `Last backup: ${(/* @__PURE__ */ new Date()).toLocaleString()}`;
    alert("Backup complete");
  } catch (e) {
    alert("Backup failed: " + e.message);
  }
};
btnRestore.onclick = async () => {
  try {
    const data = await restoreFromDrive();
    if (!data) {
      alert("No backup found");
      return;
    }
    alert(`Backup found. Prompts: ${data.prompts?.length ?? 0}`);
  } catch (e) {
    alert("Restore failed: " + e.message);
  }
};
btnSetPass.onclick = async () => {
  if (!enableEnc.checked) {
    alert("Enable the checkbox first");
    return;
  }
  if (!pass1.value || pass1.value !== pass2.value) {
    alert("Passphrases do not match");
    return;
  }
  await putMeta("encryptionEnabled", true);
  alert("Encryption enabled. Remember your passphrase.");
};
btnImport.onclick = async () => {
  const file = fileImport.files?.[0];
  if (!file) {
    alert("Choose a file");
    return;
  }
  const text = await file.text();
  const json = JSON.parse(text);
  alert(`Import preview: prompts ${json.prompts?.length ?? 0}`);
};
btnExport.onclick = async () => {
  const payload = { schemaVersion: "1.0.0", exportedAt: (/* @__PURE__ */ new Date()).toISOString(), prompts: await listPrompts(true) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prompt-library-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
//# sourceMappingURL=options.js.map

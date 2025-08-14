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
async function putPrompt(p) {
  const db = await openDb();
  await tx(db, STORE, "readwrite", (store) => store.put(p));
}
async function getPrompt(id) {
  const db = await openDb();
  return await tx(db, STORE, "readonly", (store) => reqPromise(store.get(id)));
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

// src/sidepanel/main.ts
var q;
var list;
var titleEl;
var bodyEl;
var toast;
var currentId = null;
var searchWorker = null;
var allPrompts = [];
var selectedItems = /* @__PURE__ */ new Set();
var isMultiSelectMode = false;
var searchState = {
  showHidden: false,
  includeBin: false,
  sortBy: "relevance",
  sortOrder: "desc"
};
init();
async function init() {
  await ensureSeeds();
  initSearchWorker();
  wireEvents();
  refresh();
}
function initSearchWorker() {
  try {
    searchWorker = new Worker(chrome.runtime.getURL("lib/searchWorker.js"));
    searchWorker.onmessage = (e) => {
      const results = e.data;
      displayResults(results);
    };
  } catch (error) {
    console.warn("Search worker not available, falling back to basic search");
  }
}
function wireEvents() {
  q = document.getElementById("search");
  list = document.getElementById("list");
  titleEl = document.getElementById("title");
  bodyEl = document.getElementById("body");
  toast = document.getElementById("toast");
  q.oninput = () => performSearch();
  document.addEventListener("keydown", (e) => {
    if (e.altKey) {
      switch (e.key.toLowerCase()) {
        case "p":
          e.preventDefault();
          if (currentId) {
            document.getElementById("btn-insert")?.click();
          }
          break;
        case "i":
          e.preventDefault();
          if (bodyEl.value) {
            document.getElementById("btn-copy")?.click();
          }
          break;
      }
    }
  });
  const filterControls = document.getElementById("filter-controls");
  if (filterControls) {
    const hiddenToggle = filterControls.querySelector("#show-hidden");
    const binToggle = filterControls.querySelector("#show-bin");
    const sortSelect = filterControls.querySelector("#sort-by");
    const orderToggle = filterControls.querySelector("#sort-order");
    if (hiddenToggle) hiddenToggle.onchange = () => {
      searchState.showHidden = hiddenToggle.checked;
      performSearch();
    };
    if (binToggle) binToggle.onchange = () => {
      searchState.includeBin = binToggle.checked;
      performSearch();
    };
    if (sortSelect) sortSelect.onchange = () => {
      searchState.sortBy = sortSelect.value;
      performSearch();
    };
    if (orderToggle) orderToggle.onclick = () => {
      searchState.sortOrder = searchState.sortOrder === "asc" ? "desc" : "asc";
      orderToggle.textContent = searchState.sortOrder === "asc" ? "\u2191" : "\u2193";
      performSearch();
    };
  }
  const multiSelectBtn = document.getElementById("btn-multi-select");
  if (multiSelectBtn) multiSelectBtn.onclick = toggleMultiSelect;
  const selectAllBtn = document.getElementById("btn-select-all");
  if (selectAllBtn) selectAllBtn.onclick = selectAll;
  const bulkFavoriteBtn = document.getElementById("btn-bulk-favorite");
  if (bulkFavoriteBtn) bulkFavoriteBtn.onclick = bulkFavorite;
  const bulkHideBtn = document.getElementById("btn-bulk-hide");
  if (bulkHideBtn) bulkHideBtn.onclick = bulkHide;
  const bulkDeleteBtn = document.getElementById("btn-bulk-delete");
  if (bulkDeleteBtn) bulkDeleteBtn.onclick = bulkDelete;
  document.getElementById("btn-insert").onclick = async () => {
    if (!currentId) return;
    const p = await getPrompt(currentId);
    if (!p) return;
    await chrome.runtime.sendMessage({ type: "insert", text: bodyEl.value });
    showToast("Inserted or copied");
  };
  document.getElementById("btn-copy").onclick = async () => {
    await navigator.clipboard.writeText(bodyEl.value);
    showToast("Copied to clipboard");
  };
  document.getElementById("btn-fav").onclick = toggleFavorite;
  document.getElementById("btn-hide").onclick = toggleHidden;
  document.getElementById("btn-clone").onclick = cloneCurrent;
  document.getElementById("btn-delete").onclick = trashCurrent;
}
async function ensureSeeds() {
  await chrome.runtime.sendMessage({ type: "seed:ensure" }).catch(() => {
  });
}
async function performSearch() {
  const query = q.value.trim();
  if (searchWorker) {
    searchWorker.postMessage({
      items: allPrompts,
      query: {
        q: query,
        showHidden: searchState.showHidden,
        includeBin: searchState.includeBin,
        sortBy: searchState.sortBy,
        sortOrder: searchState.sortOrder
      }
    });
  } else {
    const results = performBasicSearch(query);
    displayResults(results);
  }
}
function performBasicSearch(query) {
  if (!query) {
    return allPrompts.filter((p) => !p.hidden && !p.deletedAt);
  }
  const terms = query.toLowerCase().split(/\s+/);
  const filtered = allPrompts.filter((p) => {
    if (!searchState.showHidden && p.hidden) return false;
    if (!searchState.includeBin && p.deletedAt) return false;
    const searchableText = `${p.title} ${p.tags.join(" ")} ${p.body}`.toLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
  if (searchState.sortBy === "favorite") {
    filtered.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  } else if (searchState.sortBy === "title") {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else if (searchState.sortBy === "updatedAt") {
    filtered.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }
  if (searchState.sortOrder === "asc") {
    filtered.reverse();
  }
  return filtered;
}
function displayResults(results) {
  list.innerHTML = "";
  for (const p of results) {
    const div = document.createElement("div");
    const isSelected = selectedItems.has(p.id);
    div.className = `item ${p.id === currentId ? "active" : ""} ${p.favorite ? "favorite" : ""} ${p.hidden ? "hidden" : ""} ${isSelected ? "selected" : ""}`;
    div.innerHTML = `
      ${isMultiSelectMode ? `<input type="checkbox" class="item-checkbox" ${isSelected ? "checked" : ""} />` : ""}
      <div class="item-content">
        <div class="item-title">${escapeHtml(p.title)}</div>
        <div class="item-meta">
          ${p.favorite ? '<span class="favorite-icon">\u2605</span>' : ""}
          ${p.hidden ? '<span class="hidden-icon">\u{1F441}\uFE0F</span>' : ""}
          ${p.deletedAt ? '<span class="deleted-icon">\u{1F5D1}\uFE0F</span>' : ""}
          <span class="category">${p.category || "General"}</span>
        </div>
      </div>
    `;
    if (isMultiSelectMode) {
      const checkbox = div.querySelector(".item-checkbox");
      if (checkbox) {
        checkbox.onclick = (e) => {
          e.stopPropagation();
          toggleItemSelection(p.id);
        };
      }
      div.onclick = () => toggleItemSelection(p.id);
    } else {
      div.onclick = () => select(p.id);
    }
    list.appendChild(div);
  }
  if (!currentId && results[0]) {
    select(results[0].id);
  }
}
async function refresh() {
  allPrompts = await listPrompts(true);
  performSearch();
}
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function toggleMultiSelect() {
  isMultiSelectMode = !isMultiSelectMode;
  selectedItems.clear();
  const multiSelectBtn = document.getElementById("btn-multi-select");
  const selectAllBtn = document.getElementById("btn-select-all");
  if (multiSelectBtn) {
    multiSelectBtn.textContent = isMultiSelectMode ? "Exit Multi-Select" : "Multi-Select";
    multiSelectBtn.className = isMultiSelectMode ? "btn btn-secondary active" : "btn btn-secondary";
  }
  if (selectAllBtn) {
    selectAllBtn.style.display = isMultiSelectMode ? "inline-block" : "none";
  }
  const bulkActions = document.getElementById("bulk-actions");
  if (bulkActions) {
    bulkActions.style.display = isMultiSelectMode ? "flex" : "none";
  }
  refreshListClasses();
  updateBulkActionsState();
  updateSelectionCount();
}
function selectAll() {
  if (selectedItems.size === allPrompts.length) {
    selectedItems.clear();
  } else {
    allPrompts.forEach((p) => selectedItems.add(p.id));
  }
  refreshListClasses();
  updateBulkActionsState();
  updateSelectionCount();
}
function toggleItemSelection(id) {
  if (selectedItems.has(id)) {
    selectedItems.delete(id);
  } else {
    selectedItems.add(id);
  }
  refreshListClasses();
  updateBulkActionsState();
  updateSelectionCount();
}
function updateSelectionCount() {
  const countElement = document.getElementById("bulk-selection-count");
  if (countElement) {
    countElement.textContent = `${selectedItems.size} item${selectedItems.size !== 1 ? "s" : ""} selected`;
  }
}
function updateBulkActionsState() {
  const hasSelection = selectedItems.size > 0;
  const bulkFavoriteBtn = document.getElementById("btn-bulk-favorite");
  const bulkHideBtn = document.getElementById("btn-bulk-hide");
  const bulkDeleteBtn = document.getElementById("btn-bulk-delete");
  if (bulkFavoriteBtn) bulkFavoriteBtn.disabled = !hasSelection;
  if (bulkHideBtn) bulkHideBtn.disabled = !hasSelection;
  if (bulkDeleteBtn) bulkDeleteBtn.disabled = !hasSelection;
}
async function bulkFavorite() {
  if (selectedItems.size === 0) return;
  for (const id of selectedItems) {
    const p = await getPrompt(id);
    if (p) {
      p.favorite = !p.favorite;
      p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await putPrompt(p);
    }
  }
  selectedItems.clear();
  await refresh();
  showToast(`Updated ${selectedItems.size} prompts`);
}
async function bulkHide() {
  if (selectedItems.size === 0) return;
  for (const id of selectedItems) {
    const p = await getPrompt(id);
    if (p) {
      p.hidden = !p.hidden;
      p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await putPrompt(p);
    }
  }
  selectedItems.clear();
  await refresh();
  showToast(`Updated ${selectedItems.size} prompts`);
}
async function bulkDelete() {
  if (selectedItems.size === 0) return;
  if (!confirm(`Are you sure you want to move ${selectedItems.size} prompts to the bin?`)) {
    return;
  }
  for (const id of selectedItems) {
    const p = await getPrompt(id);
    if (p) {
      p.deletedAt = (/* @__PURE__ */ new Date()).toISOString();
      await putPrompt(p);
    }
  }
  selectedItems.clear();
  await refresh();
  showToast(`Moved ${selectedItems.size} prompts to bin`);
}
async function select(id) {
  currentId = id;
  const p = await getPrompt(id);
  if (!p) return;
  titleEl.textContent = p.title;
  bodyEl.value = p.body;
  await putMeta("lastUsedPromptId", id);
  refreshListClasses();
}
function refreshListClasses() {
  for (const el of Array.from(list.children)) {
    el.classList.toggle("active", el.textContent === titleEl.textContent);
  }
}
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => toast.hidden = true, 1200);
}
async function toggleFavorite() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.favorite = !p.favorite;
  p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await putPrompt(p);
  await refresh();
  await select(p.id);
}
async function toggleHidden() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.hidden = !p.hidden;
  p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await putPrompt(p);
  currentId = null;
  await refresh();
}
async function cloneCurrent() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  const clone = {
    ...p,
    id: crypto.randomUUID(),
    source: "user",
    originId: p.source === "seed" ? p.id : p.originId,
    title: p.title + " (copy)",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    version: 1
  };
  await putPrompt(clone);
  await select(clone.id);
  showToast("Cloned");
}
async function trashCurrent() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.deletedAt = (/* @__PURE__ */ new Date()).toISOString();
  await putPrompt(p);
  currentId = null;
  titleEl.textContent = "";
  bodyEl.value = "";
  await refresh();
  showToast("Moved to bin");
}
//# sourceMappingURL=main.js.map

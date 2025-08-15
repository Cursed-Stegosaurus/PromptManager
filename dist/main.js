// src/lib/db.ts
var DB_NAME = "prompt-library";
var DB_VERSION = 2;
var STORE = "prompts";
var META = "meta";
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
    const prompts2 = await listPromptsRaw(includeDeleted);
    console.log("listPrompts: Raw prompts from DB:", prompts2.length, prompts2);
    let needsMigration = false;
    const migratedPrompts = prompts2.map((prompt) => {
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

// src/sidepanel/main.ts
var searchInput = document.getElementById("search");
var clearSearchBtn = document.getElementById("clear-search");
var promptsList = document.getElementById("prompts-list");
var hiddenToggle = document.getElementById("hidden-toggle");
var hiddenContent = document.getElementById("hidden-content");
var hiddenPromptsList = document.getElementById("hidden-prompts-list");
var binToggle = document.getElementById("bin-toggle");
var binContent = document.getElementById("bin-content");
var binPromptsList = document.getElementById("bin-prompts-list");
var detailSection = document.getElementById("detail-section");
var detailTitle = document.getElementById("detail-title");
var detailBody = document.getElementById("detail-body");
var insertButton = document.getElementById("btn-insert");
var copyButton = document.getElementById("btn-copy");
var saveButton = document.getElementById("btn-save");
var optionsButton = document.getElementById("btn-options");
var toastContainer = document.getElementById("toast-container");
var currentPromptId = null;
var prompts = [];
var searchWorker = null;
var searchState = {
  showHidden: false,
  includeBin: false
};
async function init() {
  try {
    await refresh();
    await loadHiddenPrompts();
    await loadBinPrompts();
    wireEvents();
    setupSearchWorker();
    await ensureStartersLoaded();
    setInterval(async () => {
      try {
        await loadHiddenPrompts();
        await loadBinPrompts();
      } catch (error) {
        console.error("Periodic refresh failed:", error);
      }
    }, 5e3);
    console.log("Sidepanel initialized successfully");
  } catch (error) {
    console.error("Failed to initialize sidepanel:", error);
    showToast("Failed to initialize sidepanel", "error");
  }
}
async function ensureStartersLoaded() {
  try {
    const started = await getMeta("starterLoaded");
    if (!started) {
      await chrome.runtime.sendMessage({ type: "starter:ensure" });
    }
  } catch (error) {
    console.error("Failed to check starters:", error);
  }
}
function setupSearchWorker() {
  try {
    searchWorker = new Worker(chrome.runtime.getURL("searchWorker.js"));
    searchWorker.onmessage = (e) => {
      const results = e.data;
      if (results.error) {
        console.error("Search worker error:", results.error);
        return;
      }
      displayResults(results);
    };
  } catch (error) {
    console.warn("Search worker not available, falling back to basic search");
  }
}
function wireEvents() {
  searchInput.addEventListener("input", performSearch);
  clearSearchBtn.addEventListener("click", clearSearch);
  hiddenToggle.addEventListener("click", () => toggleSection(hiddenToggle, hiddenContent));
  binToggle.addEventListener("click", () => toggleSection(binToggle, binContent));
  insertButton.addEventListener("click", insertCurrentPrompt);
  copyButton.addEventListener("click", copyCurrentPrompt);
  saveButton.addEventListener("click", saveCurrentPrompt);
  optionsButton.addEventListener("click", openOptions);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "prompts:updated") {
      console.log("Sidebar received prompts:updated message, refreshing...");
      refresh();
      loadHiddenPrompts();
      loadBinPrompts();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.altKey) {
      switch (e.key.toLowerCase()) {
        case "p":
          e.preventDefault();
          if (currentPromptId) {
            insertCurrentPrompt();
          }
          break;
        case "i":
          e.preventDefault();
          if (detailBody.value) {
            copyCurrentPrompt();
          }
          break;
      }
    }
  });
}
function toggleSection(toggle, content) {
  const isExpanded = toggle.classList.contains("expanded");
  if (isExpanded) {
    toggle.classList.remove("expanded");
    content.classList.remove("expanded");
  } else {
    toggle.classList.add("expanded");
    content.classList.add("expanded");
    if (toggle === hiddenToggle) {
      loadHiddenPrompts();
    } else if (toggle === binToggle) {
      loadBinPrompts();
    }
  }
}
function clearSearch() {
  searchInput.value = "";
  clearSearchBtn.classList.remove("visible");
  performSearch();
}
async function performSearch() {
  const query = searchInput.value.trim();
  if (query) {
    clearSearchBtn.classList.add("visible");
  } else {
    clearSearchBtn.classList.remove("visible");
  }
  if (searchWorker) {
    searchWorker.postMessage({
      prompts,
      query: {
        q: query,
        showHidden: searchState.showHidden,
        includeBin: searchState.includeBin,
        sortBy: "updatedAt",
        sortOrder: "desc"
      }
    });
  } else {
    const results = performBasicSearch(query);
    displayResults(results);
  }
}
function sortPromptsByPriority(prompts2) {
  return [...prompts2].sort((a, b) => {
    if (a.favorite && !b.favorite)
      return -1;
    if (!a.favorite && b.favorite)
      return 1;
    return 0;
  });
}
function performBasicSearch(query) {
  if (!query) {
    const filtered2 = prompts.filter((p) => !p.hidden && !p.deletedAt);
    return sortPromptsByPriority(filtered2);
  }
  const terms = query.toLowerCase().split(/\s+/);
  const filtered = prompts.filter((p) => {
    if (!searchState.showHidden && p.hidden)
      return false;
    if (!searchState.includeBin && p.deletedAt)
      return false;
    const searchableText = `${p.title} ${p.tags.join(" ")} ${p.body}`.toLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
  return sortPromptsByPriority(filtered);
}
function displayResults(results) {
  promptsList.innerHTML = "";
  if (results.length === 0) {
    promptsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">\u{1F50D}</div>
        <div class="empty-state-title">No prompts found</div>
        <div class="empty-state-message">Try adjusting your search or filters</div>
      </div>
    `;
    return;
  }
  results.forEach((prompt) => {
    const promptElement = createPromptElement(prompt);
    promptsList.appendChild(promptElement);
  });
}
function createPromptElement(prompt) {
  const div = document.createElement("div");
  div.className = `prompt-item ${prompt.id === currentPromptId ? "active" : ""} ${prompt.favorite ? "favorite" : ""} ${prompt.hidden ? "hidden" : ""}`;
  div.setAttribute("data-prompt-id", prompt.id);
  div.innerHTML = `
    <div class="prompt-header">
      <div class="prompt-title">${escapeHtml(prompt.title)}</div>
      <div class="prompt-actions">
        ${prompt.deletedAt ? (
    // Deleted prompts: only restore and permanent delete
    `<button class="action-btn" data-action="restore" title="Restore prompt"><img src="../assets/icons/restore32.png" alt="Restore" class="action-icon" /></button>
           <button class="action-btn danger" data-action="permanentDelete" title="Delete permanently"><img src="../assets/icons/delete32.png" alt="Delete Permanently" class="action-icon" /></button>`
  ) : prompt.hidden ? (
    // Hidden prompts: only show visibility toggle
    `<button class="action-btn" data-action="hide" title="Show prompt">
             <img src="../assets/icons/hide32.png" alt="Show" class="action-icon" />
           </button>`
  ) : (
    // Active prompts: normal actions
    `<button class="action-btn" data-action="fav" title="${prompt.favorite ? "Remove from favorites" : "Add to favorites"}">
             <img src="../assets/icons/${prompt.favorite ? "fav-f32.png" : "fav-s32.png"}" alt="Favorite" class="action-icon" />
           </button>
           <button class="action-btn" data-action="hide" title="Hide prompt">
             <img src="../assets/icons/visible32.png" alt="Visibility" class="action-icon" />
           </button>
           <button class="action-btn" data-action="clone" title="Clone prompt">
             <img src="../assets/icons/clone32.png" alt="Clone" class="action-icon" />
           </button>
           ${prompt.source === "starter" ? "" : '<button class="action-btn danger" data-action="delete" title="Delete prompt"><img src="../assets/icons/delete32.png" alt="Delete" class="action-icon" /></button>'}`
  )}
      </div>
    </div>
    <div class="prompt-content">${escapeHtml(prompt.body.substring(0, 150))}${prompt.body.length > 150 ? "..." : ""}</div>
  `;
  div.addEventListener("click", () => selectPrompt(prompt.id));
  div.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      handlePromptAction(action, prompt.id);
    });
  });
  return div;
}
async function handlePromptAction(action, promptId) {
  try {
    switch (action) {
      case "fav":
        await toggleFavorite(promptId);
        break;
      case "hide":
        await toggleHidden(promptId);
        break;
      case "clone":
        await clonePrompt(promptId);
        break;
      case "delete":
        const prompt = await getPrompt(promptId);
        if (prompt?.source === "starter") {
          showToast("Starter prompts cannot be deleted. Use hide instead.", "error");
          return;
        }
        await deletePrompt(promptId);
        break;
      case "restore":
        await restorePrompt(promptId);
        break;
      case "permanentDelete":
        if (confirm("This will permanently delete this prompt. This action cannot be undone. Continue?")) {
          await permanentlyDeletePrompt(promptId);
        }
        break;
      case "incrementUsage":
        await incrementPromptUsage(promptId);
        break;
    }
    await refresh();
    await loadHiddenPrompts();
    await loadBinPrompts();
  } catch (error) {
    console.error("Action failed:", error);
    showToast("Action failed", "error");
  }
}
async function selectPrompt(id) {
  currentPromptId = id;
  const prompt = await getPrompt(id);
  if (!prompt)
    return;
  detailTitle.value = prompt.title;
  detailBody.value = prompt.body;
  saveButton.classList.toggle("visible", prompt.source !== "starter");
  detailTitle.readOnly = prompt.source === "starter";
  detailBody.readOnly = prompt.source === "starter";
  await putMeta("lastUsedPromptId", id);
  document.querySelectorAll(".prompt-item").forEach((item) => {
    item.classList.remove("active");
  });
  const clickedItem = document.querySelector(`[data-prompt-id="${id}"]`);
  if (clickedItem) {
    clickedItem.classList.add("active");
  }
}
async function insertCurrentPrompt() {
  if (!currentPromptId)
    return;
  try {
    await chrome.runtime.sendMessage({ type: "insert", text: detailBody.value });
    await incrementPromptUsage(currentPromptId);
    showToast("Prompt inserted");
  } catch (error) {
    console.error("Insert failed:", error);
    showToast("Insert failed", "error");
  }
}
async function copyCurrentPrompt() {
  try {
    await navigator.clipboard.writeText(detailBody.value);
    if (currentPromptId) {
      await incrementPromptUsage(currentPromptId);
    }
    showToast("Copied to clipboard");
  } catch (error) {
    console.error("Copy failed:", error);
    showToast("Copy failed", "error");
  }
}
async function saveCurrentPrompt() {
  if (!currentPromptId)
    return;
  const prompt = await getPrompt(currentPromptId);
  if (!prompt)
    return;
  if (prompt.source === "starter") {
    showToast("Starter prompts cannot be edited", "error");
    return;
  }
  try {
    prompt.title = detailTitle.value.trim();
    prompt.body = detailBody.value;
    prompt.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!prompt.title) {
      showToast("Title cannot be empty", "error");
      return;
    }
    await putPrompt(prompt);
    await refresh();
    showToast("Prompt saved successfully", "success");
  } catch (error) {
    console.error("Failed to save:", error);
    showToast("Failed to save prompt", "error");
  }
}
async function clonePrompt(id) {
  const prompt = await getPrompt(id);
  if (!prompt)
    return;
  const clone = {
    ...prompt,
    id: crypto.randomUUID(),
    source: "user",
    originId: prompt.source === "starter" ? prompt.id : prompt.originId,
    title: prompt.title + " (copy)",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    version: 1
  };
  await putPrompt(clone);
}
async function loadHiddenPrompts() {
  try {
    console.log("loadHiddenPrompts: Starting...");
    const allPrompts = await listPrompts(true);
    console.log("loadHiddenPrompts: All prompts loaded:", allPrompts.length);
    const hiddenPrompts = allPrompts.filter((p) => p.hidden && !p.deletedAt);
    console.log("loadHiddenPrompts: Hidden prompts found:", hiddenPrompts.length, hiddenPrompts);
    hiddenPromptsList.innerHTML = "";
    if (hiddenPrompts.length === 0) {
      hiddenPromptsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-message">No hidden prompts</div>
        </div>
      `;
      return;
    }
    hiddenPrompts.forEach((prompt) => {
      const promptElement = createPromptElement(prompt);
      hiddenPromptsList.appendChild(promptElement);
    });
    console.log("loadHiddenPrompts: Hidden prompts loaded successfully");
  } catch (error) {
    console.error("Failed to load hidden prompts:", error);
  }
}
async function loadBinPrompts() {
  try {
    console.log("loadBinPrompts: Starting...");
    const allPrompts = await listPrompts(true);
    console.log("loadBinPrompts: All prompts loaded:", allPrompts.length);
    const binPrompts = allPrompts.filter((p) => p.deletedAt);
    console.log("loadBinPrompts: Deleted prompts found:", binPrompts.length, binPrompts);
    binPromptsList.innerHTML = "";
    if (binPrompts.length === 0) {
      binPromptsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-message">No prompts in bin</div>
        </div>
      `;
      return;
    }
    binPrompts.forEach((prompt) => {
      const promptElement = createPromptElement(prompt);
      binPromptsList.appendChild(promptElement);
    });
    console.log("loadBinPrompts: Deleted prompts loaded successfully");
  } catch (error) {
    console.error("Failed to load bin prompts:", error);
  }
}
async function refresh() {
  try {
    prompts = await listPrompts(true);
    if (prompts.length === 0) {
      try {
        await chrome.runtime.sendMessage({ type: "starter:ensure" });
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      } catch (starterError) {
        console.error("Starter ensure failed:", starterError);
      }
    }
    performSearch();
    await loadHiddenPrompts();
    await loadBinPrompts();
  } catch (error) {
    console.error("Failed to refresh:", error);
    showToast("Failed to refresh", "error");
  }
}
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
      <button class="toast-close">\xD7</button>
    </div>
    <div class="toast-message">${message}</div>
  `;
  const closeBtn = toast.querySelector(".toast-close");
  closeBtn.addEventListener("click", () => {
    if (toast.parentNode) {
      toast.remove();
    }
  });
  toastContainer.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 3e3);
}
function openOptions() {
  chrome.runtime.openOptionsPage();
}
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
document.addEventListener("DOMContentLoaded", init);
//# sourceMappingURL=main.js.map

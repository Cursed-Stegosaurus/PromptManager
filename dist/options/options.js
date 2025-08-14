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
var telemetryEnabled = document.getElementById("telemetry-enabled");
var recyclePurgeDays = document.getElementById("recycle-purge-days");
var toastContainer = document.getElementById("toast-container");
var newPromptButton = document.getElementById("btn-new-prompt");
var savePromptButton = document.getElementById("btn-save-prompt");
var deletePromptButton = document.getElementById("btn-delete-prompt");
var promptSelect = document.getElementById("prompt-select");
var promptSourceBadge = document.getElementById("prompt-source-badge");
var promptTitle = document.getElementById("prompt-title");
var promptTags = document.getElementById("prompt-tags");
var tagsDisplay = document.getElementById("tags-display");
var promptBody = document.getElementById("prompt-body");
var promptsSearch = document.getElementById("prompts-search");
var promptsFilterSource = document.getElementById("prompts-filter-source");
var promptsCards = document.getElementById("prompts-cards");
var currentPrompt = null;
var allPrompts = [];
var currentTags = [];
var isEditing = false;
async function init() {
  try {
    await loadSettings();
    await loadPrompts();
    wireEvents();
    setupTagInput();
  } catch (error) {
    console.error("Failed to initialize options:", error);
    showToast("Failed to initialize options", "error");
  }
}
async function loadSettings() {
  try {
    const telemetry = await getMeta("telemetryEnabled") ?? false;
    telemetryEnabled.checked = telemetry;
    const purgeDays = await getMeta("recycleAutoPurgeDays") ?? 30;
    recyclePurgeDays.value = purgeDays.toString();
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
}
async function loadPrompts() {
  try {
    console.log("Loading prompts...");
    allPrompts = await listPrompts(true);
    console.log("Prompts loaded:", allPrompts.length, allPrompts);
    if (allPrompts.length === 0) {
      console.log("No prompts found, ensuring starters are loaded...");
      try {
        await chrome.runtime.sendMessage({ type: "seed:ensure" });
        await new Promise((resolve) => setTimeout(resolve, 1e3));
        allPrompts = await listPrompts(true);
        console.log("Prompts after starter ensure:", allPrompts.length, allPrompts);
      } catch (starterError) {
        console.error("Starter ensure failed:", starterError);
      }
    }
    populatePromptSelect();
    renderPromptCards();
    if (allPrompts.length === 0) {
      showToast("No prompts found. Try reloading seed prompts.", "info");
    } else {
      showToast(`Loaded ${allPrompts.length} prompts`, "info");
    }
  } catch (error) {
    console.error("Failed to load prompts:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    showToast("Failed to load prompts: " + errorMessage, "error");
    console.log("Creating fallback sample prompts...");
    allPrompts = createSamplePrompts();
    populatePromptSelect();
    renderPromptCards();
  }
}
function createSamplePrompts() {
  return [
    {
      id: "sample-1",
      title: "Sample Writing Prompt",
      body: "This is a sample writing prompt to help you get started. You can edit this or create your own prompts.",
      tags: ["writing", "sample", "creative"],
      source: "user",
      favorite: false,
      hidden: false,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      version: 1
    },
    {
      id: "sample-2",
      title: "Sample Code Review",
      body: "This is a sample code review prompt. Use this template to structure your code reviews effectively.",
      tags: ["code", "review", "development"],
      source: "user",
      favorite: true,
      hidden: false,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      version: 1
    }
  ];
}
function populatePromptSelect() {
  promptSelect.innerHTML = '<option value="">-- Select a prompt --</option>';
  const seedPrompts = allPrompts.filter((p) => p.source === "seed");
  const userPrompts = allPrompts.filter((p) => p.source === "user");
  if (seedPrompts.length > 0) {
    const seedGroup = document.createElement("optgroup");
    seedGroup.label = "Seed Prompts";
    seedPrompts.forEach((prompt) => {
      const option = document.createElement("option");
      option.value = prompt.id;
      option.textContent = prompt.title;
      seedGroup.appendChild(option);
    });
    promptSelect.appendChild(seedGroup);
  }
  if (userPrompts.length > 0) {
    const userGroup = document.createElement("optgroup");
    userGroup.label = "User Prompts";
    userPrompts.forEach((prompt) => {
      const option = document.createElement("option");
      option.value = prompt.id;
      option.textContent = prompt.title;
      userGroup.appendChild(option);
    });
    promptSelect.appendChild(userGroup);
  }
}
function wireEvents() {
  exportButton.addEventListener("click", exportPrompts);
  importButton.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", handleImport);
  telemetryEnabled.addEventListener("change", async () => {
    await putMeta("telemetryEnabled", telemetryEnabled.checked);
  });
  recyclePurgeDays.addEventListener("change", async () => {
    await putMeta("recycleAutoPurgeDays", parseInt(recyclePurgeDays.value));
  });
  newPromptButton.addEventListener("click", createNewPrompt);
  savePromptButton.addEventListener("click", saveCurrentPrompt);
  deletePromptButton.addEventListener("click", deleteCurrentPrompt);
  promptSelect.addEventListener("change", onPromptSelectChange);
  promptsSearch.addEventListener("input", filterPromptCards);
  promptsFilterSource.addEventListener("change", filterPromptCards);
}
function setupTagInput() {
  promptTags.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(promptTags.value.trim());
      promptTags.value = "";
    }
  });
}
function addTag(tagText) {
  if (tagText && !currentTags.includes(tagText)) {
    currentTags.push(tagText);
    renderTags();
  }
}
function renderTags() {
  tagsDisplay.innerHTML = "";
  currentTags.forEach((tag) => {
    const tagElement = document.createElement("span");
    tagElement.className = "tag-item";
    tagElement.innerHTML = `
      ${tag}
      <button class="tag-remove" onclick="removeTag('${tag}')">\xD7</button>
    `;
    tagsDisplay.appendChild(tagElement);
  });
}
function createNewPrompt() {
  currentPrompt = null;
  isEditing = true;
  clearEditor();
  promptSelect.value = "";
  promptSourceBadge.textContent = "";
  promptSourceBadge.className = "source-badge";
  updateEditorButtons();
  showToast("Creating new prompt", "info");
}
function clearEditor() {
  promptTitle.value = "";
  promptBody.value = "";
  currentTags = [];
  renderTags();
}
async function onPromptSelectChange() {
  const promptId = promptSelect.value;
  if (!promptId) {
    currentPrompt = null;
    clearEditor();
    updateEditorButtons();
    return;
  }
  try {
    currentPrompt = allPrompts.find((p) => p.id === promptId) || null;
    if (currentPrompt) {
      loadPromptIntoEditor(currentPrompt);
      updateEditorButtons();
    }
  } catch (error) {
    console.error("Failed to load prompt:", error);
    showToast("Failed to load prompt", "error");
  }
}
function loadPromptIntoEditor(prompt) {
  promptTitle.value = prompt.title;
  promptBody.value = prompt.body;
  currentTags = [...prompt.tags];
  renderTags();
  promptSourceBadge.textContent = prompt.source;
  promptSourceBadge.className = `source-badge ${prompt.source}`;
  isEditing = prompt.source === "user";
  updateEditorButtons();
}
function updateEditorButtons() {
  if (currentPrompt) {
    savePromptButton.disabled = currentPrompt.source === "seed";
    deletePromptButton.disabled = currentPrompt.source === "seed";
    promptTitle.readOnly = currentPrompt.source === "seed";
    promptBody.readOnly = currentPrompt.source === "seed";
  } else {
    savePromptButton.disabled = false;
    deletePromptButton.disabled = true;
    promptTitle.readOnly = false;
    promptBody.readOnly = false;
  }
}
async function saveCurrentPrompt() {
  try {
    if (!promptTitle.value.trim()) {
      showToast("Title is required", "error");
      return;
    }
    if (!promptBody.value.trim()) {
      showToast("Content is required", "error");
      return;
    }
    let prompt;
    if (currentPrompt) {
      if (currentPrompt.source === "seed") {
        showToast("Seed prompts cannot be edited", "error");
        return;
      }
      prompt = { ...currentPrompt };
    } else {
      prompt = {
        id: crypto.randomUUID(),
        title: promptTitle.value.trim(),
        body: promptBody.value.trim(),
        tags: currentTags,
        source: "user",
        favorite: false,
        hidden: false,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        version: 1
      };
    }
    prompt.title = promptTitle.value.trim();
    prompt.body = promptBody.value.trim();
    prompt.tags = currentTags;
    prompt.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await putPrompt(prompt);
    await loadPrompts();
    if (!currentPrompt) {
      promptSelect.value = prompt.id;
      currentPrompt = prompt;
    }
    showToast("Prompt saved successfully", "success");
    updateEditorButtons();
  } catch (error) {
    console.error("Failed to save prompt:", error);
    showToast("Failed to save prompt", "error");
  }
}
async function deleteCurrentPrompt() {
  if (!currentPrompt)
    return;
  if (currentPrompt.source === "seed") {
    showToast("Seed prompts cannot be deleted", "error");
    return;
  }
  if (!confirm(`Are you sure you want to delete "${currentPrompt.title}"?`)) {
    return;
  }
  try {
    await deletePrompt(currentPrompt.id);
    await loadPrompts();
    clearEditor();
    currentPrompt = null;
    promptSelect.value = "";
    promptSourceBadge.textContent = "";
    promptSourceBadge.className = "source-badge";
    updateEditorButtons();
    showToast("Prompt deleted successfully", "success");
  } catch (error) {
    console.error("Failed to delete prompt:", error);
    showToast("Failed to delete prompt", "error");
  }
}
function filterPromptCards() {
  const searchTerm = promptsSearch.value.toLowerCase();
  const sourceFilter = promptsFilterSource.value;
  const filteredPrompts = allPrompts.filter((prompt) => {
    const matchesSearch = !searchTerm || prompt.title.toLowerCase().includes(searchTerm) || prompt.body.toLowerCase().includes(searchTerm) || prompt.tags.some((tag) => tag.toLowerCase().includes(searchTerm));
    const matchesSource = !sourceFilter || prompt.source === sourceFilter;
    return matchesSearch && matchesSource;
  });
  renderPromptCards(filteredPrompts);
}
function renderPromptCards(prompts = allPrompts) {
  console.log("Rendering prompt cards:", prompts.length, prompts);
  console.log("promptsCards element:", promptsCards);
  if (!promptsCards) {
    console.error("promptsCards element not found!");
    return;
  }
  promptsCards.innerHTML = "";
  if (prompts.length === 0) {
    console.log("No prompts to render, showing empty state");
    promptsCards.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-message">No prompts found</div>
      </div>
    `;
    return;
  }
  console.log("Creating cards for", prompts.length, "prompts");
  prompts.forEach((prompt, index) => {
    console.log(`Creating card ${index + 1}:`, prompt.title);
    const card = createPromptCard(prompt);
    promptsCards.appendChild(card);
  });
  console.log("Cards rendered, total children:", promptsCards.children.length);
}
function createPromptCard(prompt) {
  const card = document.createElement("div");
  card.className = `prompt-card ${prompt.id === currentPrompt?.id ? "selected" : ""}`;
  card.setAttribute("data-prompt-id", prompt.id);
  card.innerHTML = `
    <div class="prompt-card-header">
      <div class="prompt-card-title">${escapeHtml(prompt.title)}</div>
      <span class="prompt-card-source ${prompt.source}">${prompt.source}</span>
    </div>
    <div class="prompt-card-content">${escapeHtml(prompt.body.substring(0, 150))}${prompt.body.length > 150 ? "..." : ""}</div>
    <div class="prompt-card-tags">
      ${prompt.tags.map((tag) => `<span class="prompt-card-tag">${escapeHtml(tag)}</span>`).join("")}
    </div>
    <div class="prompt-card-meta">
      <span>${prompt.favorite ? "\u2B50" : ""} ${prompt.hidden ? "\u{1F441}\uFE0F" : ""}</span>
      <span>${new Date(prompt.updatedAt).toLocaleDateString()}</span>
    </div>
  `;
  card.addEventListener("click", () => {
    promptSelect.value = prompt.id;
    onPromptSelectChange();
    document.querySelectorAll(".prompt-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
  });
  return card;
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
  await loadPrompts();
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
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
document.addEventListener("DOMContentLoaded", init);
//# sourceMappingURL=options.js.map

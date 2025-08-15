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
    const prompts = await listPromptsRaw(includeDeleted);
    console.log("listPrompts: Raw prompts from DB:", prompts.length, prompts);
    let needsMigration = false;
    const migratedPrompts = prompts.map((prompt) => {
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
async function getAnalytics() {
  try {
    const totalUsed2 = await getMeta("totalPromptsUsed") ?? 0;
    const topUsed = await getMeta("topUsedPrompts") ?? [];
    return {
      totalPromptsUsed: totalUsed2,
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

// src/options/options.ts
var exportButton = document.getElementById("btn-export");
var importButton = document.getElementById("btn-import");
var importFile = document.getElementById("import-file");
var recyclePurgeDays = document.getElementById("recycle-purge-days");
var toastContainer = document.getElementById("toast-container");
var totalUsed = document.getElementById("total-used");
var topPromptsList = document.getElementById("top-prompts-list");
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
var hiddenToggle = document.getElementById("hidden-toggle");
var hiddenContent = document.getElementById("hidden-content");
var hiddenPromptsCards = document.getElementById("hidden-prompts-cards");
var deletedToggle = document.getElementById("deleted-toggle");
var deletedContent = document.getElementById("deleted-content");
var deletedPromptsCards = document.getElementById("deleted-prompts-cards");
var currentPrompt = null;
var allPrompts = [];
var currentTags = [];
var isEditing = false;
async function init() {
  try {
    await loadSettings();
    await refreshPrompts();
    wireEvents();
    setupTagInput();
  } catch (error) {
    console.error("Failed to initialize options:", error);
    showToast("Failed to initialize options", "error");
  }
}
async function loadSettings() {
  try {
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
        await chrome.runtime.sendMessage({ type: "starter:ensure" });
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
      showToast("No prompts found. Try reloading starter prompts.", "info");
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
async function refreshPrompts() {
  await loadPrompts();
  await loadAnalytics();
}
async function loadAnalytics() {
  try {
    const analytics = await getAnalytics();
    if (totalUsed) {
      totalUsed.textContent = analytics.totalPromptsUsed.toString();
    }
    if (topPromptsList) {
      if (analytics.topUsedPrompts.length === 0) {
        topPromptsList.innerHTML = '<div class="empty-analytics">No prompts used yet</div>';
      } else {
        const topPromptsWithTitles = await Promise.all(
          analytics.topUsedPrompts.map(async (usage) => {
            const prompt = allPrompts.find((p) => p.id === usage.promptId);
            return {
              ...usage,
              title: prompt?.title || "Unknown Prompt"
            };
          })
        );
        topPromptsList.innerHTML = topPromptsWithTitles.map((prompt, index) => `
            <div class="prompt-usage-item">
              <span class="prompt-usage-title">${index + 1}. ${escapeHtml(prompt.title)}</span>
              <span class="prompt-usage-count">${prompt.usageCount} uses</span>
            </div>
          `).join("");
      }
    }
  } catch (error) {
    console.error("Failed to load analytics:", error);
    if (topPromptsList) {
      topPromptsList.innerHTML = '<div class="empty-analytics">Failed to load analytics</div>';
    }
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
  const starterPrompts = allPrompts.filter((p) => p.source === "starter");
  const userPrompts = allPrompts.filter((p) => p.source === "user");
  if (starterPrompts.length > 0) {
    const starterGroup = document.createElement("optgroup");
    starterGroup.label = "Starter Prompts";
    starterPrompts.forEach((prompt) => {
      const option = document.createElement("option");
      option.value = prompt.id;
      option.textContent = prompt.title;
      starterGroup.appendChild(option);
    });
    promptSelect.appendChild(starterGroup);
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
  const metaPromptButton = document.getElementById("btn-meta-prompt");
  if (metaPromptButton) {
    metaPromptButton.addEventListener("click", copyMetaPrompt);
  }
  recyclePurgeDays.addEventListener("change", async () => {
    await putMeta("recycleAutoPurgeDays", parseInt(recyclePurgeDays.value));
  });
  newPromptButton.addEventListener("click", createNewPrompt);
  savePromptButton.addEventListener("click", saveCurrentPrompt);
  deletePromptButton.addEventListener("click", deleteCurrentPrompt);
  promptSelect.addEventListener("change", onPromptSelectChange);
  promptsSearch.addEventListener("input", filterPromptCards);
  promptsFilterSource.addEventListener("change", filterPromptCards);
  hiddenToggle.addEventListener("click", () => toggleSection(hiddenToggle, hiddenContent));
  deletedToggle.addEventListener("click", () => toggleSection(deletedToggle, deletedContent));
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
function toggleSection(toggle, content) {
  const isExpanded = toggle.classList.contains("expanded");
  if (isExpanded) {
    toggle.classList.remove("expanded");
    content.classList.remove("expanded");
  } else {
    toggle.classList.add("expanded");
    content.classList.add("expanded");
  }
}
function addTag(tagText) {
  if (tagText && !currentTags.includes(tagText)) {
    currentTags.push(tagText);
    renderTags();
  }
}
function removeTag(tagText) {
  currentTags = currentTags.filter((tag) => tag !== tagText);
  renderTags();
}
function renderTags() {
  tagsDisplay.innerHTML = "";
  currentTags.forEach((tag) => {
    const tagElement = document.createElement("span");
    tagElement.className = "tag-item";
    tagElement.innerHTML = `
      ${tag}
      <button class="tag-remove">\xD7</button>
    `;
    const removeBtn = tagElement.querySelector(".tag-remove");
    removeBtn.addEventListener("click", () => removeTag(tag));
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
    savePromptButton.disabled = currentPrompt.source === "starter";
    deletePromptButton.disabled = currentPrompt.source === "starter";
    promptTitle.readOnly = currentPrompt.source === "starter";
    promptBody.readOnly = currentPrompt.source === "starter";
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
      if (currentPrompt.source === "starter") {
        showToast("Starter prompts cannot be edited", "error");
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
    await refreshPrompts();
    if (!currentPrompt) {
      promptSelect.value = prompt.id;
      currentPrompt = prompt;
    }
    showToast("Prompt saved successfully", "success");
    updateEditorButtons();
    chrome.runtime.sendMessage({ type: "prompts:updated" });
  } catch (error) {
    console.error("Failed to save prompt:", error);
    showToast("Failed to save prompt", "error");
  }
}
async function deleteCurrentPrompt() {
  if (!currentPrompt)
    return;
  if (currentPrompt.source === "starter") {
    showToast("Starter prompts cannot be deleted", "error");
    return;
  }
  if (!confirm(`Are you sure you want to delete "${currentPrompt.title}"?`)) {
    return;
  }
  try {
    await deletePrompt(currentPrompt.id);
    await refreshPrompts();
    clearEditor();
    currentPrompt = null;
    promptSelect.value = "";
    promptSourceBadge.textContent = "";
    promptSourceBadge.className = "source-badge";
    updateEditorButtons();
    showToast("Prompt deleted successfully", "success");
    chrome.runtime.sendMessage({ type: "prompts:updated" });
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
  const activePrompts = prompts.filter((p) => !p.hidden && !p.deletedAt);
  const hiddenPrompts = prompts.filter((p) => p.hidden && !p.deletedAt);
  const deletedPrompts = prompts.filter((p) => p.deletedAt);
  const sortedActivePrompts = sortPromptsByPriority(activePrompts);
  promptsCards.innerHTML = "";
  if (sortedActivePrompts.length === 0) {
    promptsCards.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-message">No active prompts found</div>
      </div>
    `;
  } else {
    sortedActivePrompts.forEach((prompt, index) => {
      console.log(`Creating active card ${index + 1}:`, prompt.title);
      const card = createPromptCard(prompt);
      promptsCards.appendChild(card);
    });
  }
  if (hiddenPromptsCards) {
    hiddenPromptsCards.innerHTML = "";
    if (hiddenPrompts.length === 0) {
      hiddenPromptsCards.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-message">No hidden prompts</div>
        </div>
      `;
    } else {
      const sortedHiddenPrompts = sortPromptsByPriority(hiddenPrompts);
      sortedHiddenPrompts.forEach((prompt, index) => {
        console.log(`Creating hidden card ${index + 1}:`, prompt.title);
        const card = createPromptCard(prompt);
        hiddenPromptsCards.appendChild(card);
      });
    }
  }
  if (deletedPromptsCards) {
    deletedPromptsCards.innerHTML = "";
    if (deletedPrompts.length === 0) {
      deletedPromptsCards.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-message">No deleted prompts</div>
        </div>
      `;
    } else {
      const sortedDeletedPrompts = sortPromptsByPriority(deletedPrompts);
      sortedDeletedPrompts.forEach((prompt, index) => {
        console.log(`Creating deleted card ${index + 1}:`, prompt.title);
        const card = createPromptCard(prompt);
        deletedPromptsCards.appendChild(card);
      });
    }
  }
  console.log("Cards rendered - Active:", sortedActivePrompts.length, "Hidden:", hiddenPrompts.length, "Deleted:", deletedPrompts.length);
}
function createPromptCard(prompt) {
  const card = document.createElement("div");
  card.className = `prompt-card ${prompt.id === currentPrompt?.id ? "selected" : ""} ${prompt.favorite ? "favorite" : ""}`;
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
    <div class="prompt-card-actions">
      ${!prompt.hidden && !prompt.deletedAt ? `<button class="action-btn favorite-btn" title="${prompt.favorite ? "Remove from favorites" : "Add to favorites"}">
          <img src="../assets/icons/fav-${prompt.favorite ? "f" : "s"}32.png" alt="Favorite" width="16" height="16">
        </button>` : ""}
      ${!prompt.hidden && !prompt.deletedAt ? `<button class="action-btn clone-btn" title="Clone prompt">
          <img src="../assets/icons/clone32.png" alt="Clone" width="16" height="16">
        </button>` : ""}
      ${!prompt.deletedAt ? `<button class="action-btn hide-btn" title="${prompt.hidden ? "Show prompt" : "Hide prompt"}">
          <img src="../assets/icons/${prompt.hidden ? "visible" : "hide"}32.png" alt="${prompt.hidden ? "Show" : "Hide"}" width="16" height="16">
        </button>` : ""}
      ${prompt.deletedAt ? `<button class="action-btn restore-btn" title="Restore prompt">
          <img src="../assets/icons/restore32.png" alt="Restore" width="16" height="16">
        </button>` : prompt.source === "starter" ? "" : `<button class="action-btn delete-btn" title="Delete prompt">
          <img src="../assets/icons/delete32.png" alt="Delete" width="16" height="16">
        </button>`}
    </div>
  `;
  card.addEventListener("click", (e) => {
    if (e.target.closest(".action-btn")) {
      return;
    }
    promptSelect.value = prompt.id;
    onPromptSelectChange();
    document.querySelectorAll(".prompt-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
  });
  const favoriteBtn = card.querySelector(".favorite-btn");
  const cloneBtn = card.querySelector(".clone-btn");
  const hideBtn = card.querySelector(".hide-btn");
  const deleteBtn = card.querySelector(".delete-btn");
  const restoreBtn = card.querySelector(".restore-btn");
  if (favoriteBtn && !prompt.hidden && !prompt.deletedAt) {
    favoriteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await toggleFavorite(prompt.id);
        await refreshPrompts();
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error("Failed to toggle favorite:", error);
        showToast("Failed to update favorite status", "error");
      }
    });
  }
  if (cloneBtn && !prompt.hidden && !prompt.deletedAt) {
    cloneBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const clonedPrompt = {
          ...prompt,
          id: crypto.randomUUID(),
          title: `${prompt.title} (Copy)`,
          source: "user",
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          favorite: false,
          hidden: false,
          deletedAt: void 0
        };
        await putPrompt(clonedPrompt);
        await refreshPrompts();
        showToast("Prompt cloned successfully", "success");
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error("Failed to clone prompt:", error);
        showToast("Failed to clone prompt", "error");
      }
    });
  }
  if (hideBtn && !prompt.deletedAt) {
    hideBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await toggleHidden(prompt.id);
        await refreshPrompts();
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error("Failed to toggle hidden status:", error);
        showToast("Failed to update hidden status", "error");
      }
    });
  }
  if (deleteBtn && !prompt.deletedAt) {
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete "${prompt.title}"?`)) {
        try {
          await deletePrompt(prompt.id);
          await refreshPrompts();
          showToast("Prompt deleted successfully", "success");
          chrome.runtime.sendMessage({ type: "prompts:updated" });
        } catch (error) {
          console.error("Failed to delete prompt:", error);
          showToast("Failed to delete prompt", "error");
        }
      }
    });
  }
  if (restoreBtn && prompt.deletedAt) {
    restoreBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await restorePrompt(prompt.id);
        await refreshPrompts();
        showToast("Prompt restored successfully", "success");
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error("Failed to restore prompt:", error);
        showToast("Failed to restore prompt", "error");
      }
    });
  }
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
async function copyMetaPrompt() {
  try {
    const metaPrompt = `Take the time to think through every detail. Reason carefully so you produce the best possible prompt.

You are a prompt-rewriting assistant. Your goal is to take any provided sample prompt and output a new, structured prompt in the JSON format below, following these rules:

Extract key details from the sample prompt:

Role and goal

Inputs needed, explicit and implied

Any inputs already provided

Required output structure or sections

Ask only the questions needed to collect missing inputs.

Ask zero to five concise, targeted questions.

Include a question only if the answer is not already given.

Generate three appropriate tags based on topic, task type, and intended output.

Tags must be relevant, descriptive, and lowercase.

Avoid generic placeholders unless they truly fit.

Rewrite the prompt so it clearly:

States the role and goal

Lists the exact questions to ask before starting, if any

Lists the known inputs

Lists the output sections in bullet form

Generate a randomized alphanumeric string exactly 20 characters long for the id field.

Output using this exact JSON template format:

{
  "schemaVersion": "1.0.0",
  "timestamp": "[current UTC timestamp in ISO 8601 format]",
  "prompts": [
    {
      "id": "[randomized 20-character alphanumeric ID]",
      "title": "[Short descriptive title for the new prompt]",
      "body": "[Full rewritten prompt text in the new format]",
      "tags": ["tag1", "tag2", "tag3"],
      "source": "user",
      "favorite": false,
      "hidden": false,
      "createdAt": "[current UTC timestamp in ISO 8601 format]",
      "updatedAt": "[current UTC timestamp in ISO 8601 format]",
      "version": 1
    }
  ]
}

Keep language direct and concise. Do not add filler or commentary.

Ensure the body uses the "questions first, then execute" approach before producing the output. If no questions are needed, proceed directly to execution details.`;
    await navigator.clipboard.writeText(metaPrompt);
    showToast("Meta prompt copied to clipboard", "success");
  } catch (error) {
    console.error("Failed to copy meta prompt:", error);
    showToast("Failed to copy meta prompt", "error");
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
    } else if (existing.source === "starter") {
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
  chrome.runtime.sendMessage({ type: "prompts:updated" });
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
function sortPromptsByPriority(prompts) {
  return [...prompts].sort((a, b) => {
    if (a.favorite && !b.favorite)
      return -1;
    if (!a.favorite && b.favorite)
      return 1;
    return 0;
  });
}
document.addEventListener("DOMContentLoaded", init);
//# sourceMappingURL=options.js.map

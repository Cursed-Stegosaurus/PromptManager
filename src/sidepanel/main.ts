// src/sidepanel/main.ts
import { openDb, putPrompt, getPrompt, listPrompts, putMeta } from '../lib/db.js';
import type { Prompt } from "../lib/schema";
import { renderTemplate } from "../lib/template";

// Declare chrome API for TypeScript
declare const chrome: any;

let q: HTMLInputElement;
let list: HTMLElement;
let titleEl: HTMLInputElement;
let bodyEl: HTMLTextAreaElement;
let toast: HTMLElement;
let currentId: string | null = null;
let searchWorker: Worker | null = null;
let allPrompts: any[] = [];
let selectedItems: Set<string> = new Set();
let isMultiSelectMode = false;

// Search state
let searchState = {
  showHidden: false,
  includeBin: false,
  sortBy: 'relevance' as 'relevance' | 'title' | 'createdAt' | 'updatedAt' | 'favorite',
  sortOrder: 'desc' as 'asc' | 'desc'
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
    searchWorker = new Worker(chrome.runtime.getURL('lib/searchWorker.js'));
    searchWorker.onmessage = (e) => {
      const results = e.data;
      displayResults(results);
    };
  } catch (error) {
    console.warn('Search worker not available, falling back to basic search');
  }
}

function wireEvents() {
  q = document.getElementById('search') as HTMLInputElement;
  list = document.getElementById('list') as HTMLElement;
  titleEl = document.getElementById('title') as HTMLInputElement;
  bodyEl = document.getElementById('body') as HTMLTextAreaElement;
  toast = document.getElementById('toast') as HTMLElement;

  q.oninput = () => performSearch();
  
  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'p':
          e.preventDefault();
          if (currentId) {
            document.getElementById('btn-insert')?.click();
          }
          break;
        case 'i':
          e.preventDefault();
          if (bodyEl.value) {
            document.getElementById('btn-copy')?.click();
          }
          break;
      }
    }
  });
  
  // Add filter controls
  const filterControls = document.getElementById('filter-controls');
  if (filterControls) {
    const hiddenToggle = filterControls.querySelector('#show-hidden') as HTMLInputElement;
    const binToggle = filterControls.querySelector('#show-bin') as HTMLInputElement;
    const sortSelect = filterControls.querySelector('#sort-by') as HTMLSelectElement;
    const orderToggle = filterControls.querySelector('#sort-order') as HTMLButtonElement;

    if (hiddenToggle) hiddenToggle.onchange = () => { searchState.showHidden = hiddenToggle.checked; performSearch(); };
    if (binToggle) binToggle.onchange = () => { searchState.includeBin = binToggle.checked; performSearch(); };
    if (sortSelect) sortSelect.onchange = () => { searchState.sortBy = sortSelect.value as any; performSearch(); };
    if (orderToggle) orderToggle.onclick = () => { 
      searchState.sortOrder = searchState.sortOrder === 'asc' ? 'desc' : 'asc'; 
      orderToggle.textContent = searchState.sortOrder === 'asc' ? '↑' : '↓';
      performSearch(); 
    };
  }

  // Add bulk operation buttons
  const multiSelectBtn = document.getElementById('btn-multi-select');
  if (multiSelectBtn) multiSelectBtn.onclick = toggleMultiSelect;

  const selectAllBtn = document.getElementById('btn-select-all');
  if (selectAllBtn) selectAllBtn.onclick = selectAll;

  const bulkFavoriteBtn = document.getElementById('btn-bulk-favorite');
  if (bulkFavoriteBtn) bulkFavoriteBtn.onclick = bulkFavorite;

  const bulkHideBtn = document.getElementById('btn-bulk-hide');
  if (bulkHideBtn) bulkHideBtn.onclick = bulkHide;

  const bulkDeleteBtn = document.getElementById('btn-bulk-delete');
  if (bulkDeleteBtn) bulkDeleteBtn.onclick = bulkDelete;

  document.getElementById('btn-insert')!.onclick = async () => {
    if (!currentId) return;
    const p = await getPrompt(currentId);
    if (!p) return;
    await chrome.runtime.sendMessage({ type: 'insert', text: bodyEl.value });
    showToast('Inserted or copied');
  };

  document.getElementById('btn-copy')!.onclick = async () => {
    await navigator.clipboard.writeText(bodyEl.value);
    showToast('Copied to clipboard');
  };

  document.getElementById('btn-fav')!.onclick = toggleFavorite;
  document.getElementById('btn-hide')!.onclick = toggleHidden;
  document.getElementById('btn-clone')!.onclick = cloneCurrent;
  document.getElementById('btn-delete')!.onclick = trashCurrent;
}

async function ensureSeeds() {
  await chrome.runtime.sendMessage({ type: 'seed:ensure' }).catch(() => {});
}

async function performSearch() {
  const query = q.value.trim();
  
  if (searchWorker) {
    // Use enhanced search worker
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
    // Fallback to basic search
    const results = performBasicSearch(query);
    displayResults(results);
  }
}

function performBasicSearch(query: string): any[] {
  if (!query) {
    return allPrompts.filter(p => !p.hidden && !p.deletedAt);
  }

  const terms = query.toLowerCase().split(/\s+/);
  const filtered = allPrompts.filter(p => {
    if (!searchState.showHidden && p.hidden) return false;
    if (!searchState.includeBin && p.deletedAt) return false;
    
    const searchableText = `${p.title} ${p.tags.join(' ')} ${p.body}`.toLowerCase();
    return terms.every(term => searchableText.includes(term));
  });

  // Basic sorting
  if (searchState.sortBy === 'favorite') {
    filtered.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  } else if (searchState.sortBy === 'title') {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else if (searchState.sortBy === 'updatedAt') {
    filtered.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }

  if (searchState.sortOrder === 'asc') {
    filtered.reverse();
  }

  return filtered;
}

function displayResults(results: any[]) {
  list.innerHTML = '';
  
  for (const p of results) {
    const div = document.createElement('div');
    const isSelected = selectedItems.has(p.id);
    div.className = `item ${p.id === currentId ? 'active' : ''} ${p.favorite ? 'favorite' : ''} ${p.hidden ? 'hidden' : ''} ${isSelected ? 'selected' : ''}`;
    
    // Create item content with better structure
    div.innerHTML = `
      ${isMultiSelectMode ? `<input type="checkbox" class="item-checkbox" ${isSelected ? 'checked' : ''} />` : ''}
      <div class="item-content">
        <div class="item-title">${escapeHtml(p.title)}</div>
        <div class="item-meta">
          ${p.favorite ? '<span class="favorite-icon">★</span>' : ''}
          ${p.hidden ? '<span class="hidden-icon">👁️</span>' : ''}
          ${p.deletedAt ? '<span class="deleted-icon">🗑️</span>' : ''}
          <span class="category">${p.category || 'General'}</span>
        </div>
      </div>
    `;
    
    // Handle click events
    if (isMultiSelectMode) {
      const checkbox = div.querySelector('.item-checkbox') as HTMLInputElement;
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
  allPrompts = await listPrompts(true); // Get all prompts including hidden/deleted
  performSearch();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Bulk Operations
function toggleMultiSelect() {
  isMultiSelectMode = !isMultiSelectMode;
  selectedItems.clear();
  
  const multiSelectBtn = document.getElementById('btn-multi-select');
  const selectAllBtn = document.getElementById('btn-select-all');
  if (multiSelectBtn) {
    multiSelectBtn.textContent = isMultiSelectMode ? 'Exit Multi-Select' : 'Multi-Select';
    multiSelectBtn.className = isMultiSelectMode ? 'btn btn-secondary active' : 'btn btn-secondary';
  }
  
  if (selectAllBtn) {
    selectAllBtn.style.display = isMultiSelectMode ? 'inline-block' : 'none';
  }
  
  // Show/hide bulk action buttons
  const bulkActions = document.getElementById('bulk-actions');
  if (bulkActions) {
    bulkActions.style.display = isMultiSelectMode ? 'flex' : 'none';
  }
  
  refreshListClasses();
  updateBulkActionsState();
  updateSelectionCount();
}

function selectAll() {
  if (selectedItems.size === allPrompts.length) {
    selectedItems.clear();
  } else {
    allPrompts.forEach(p => selectedItems.add(p.id));
  }
  refreshListClasses();
  updateBulkActionsState();
  updateSelectionCount();
}

function toggleItemSelection(id: string) {
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
  const countElement = document.getElementById('bulk-selection-count');
  if (countElement) {
    countElement.textContent = `${selectedItems.size} item${selectedItems.size !== 1 ? 's' : ''} selected`;
  }
}

function updateBulkActionsState() {
  const hasSelection = selectedItems.size > 0;
  const bulkFavoriteBtn = document.getElementById('btn-bulk-favorite') as HTMLButtonElement;
  const bulkHideBtn = document.getElementById('btn-bulk-hide') as HTMLButtonElement;
  const bulkDeleteBtn = document.getElementById('btn-bulk-delete') as HTMLButtonElement;
  
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
      p.updatedAt = new Date().toISOString();
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
      p.updatedAt = new Date().toISOString();
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
      p.deletedAt = new Date().toISOString();
      await putPrompt(p);
    }
  }
  
  selectedItems.clear();
  await refresh();
  showToast(`Moved ${selectedItems.size} prompts to bin`);
}

async function select(id: string) {
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
    el.classList.toggle("active", (el as HTMLElement).textContent === titleEl.textContent);
  }
}

function showToast(msg: string) {
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), 1200);
}

async function toggleFavorite() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.favorite = !p.favorite;
  p.updatedAt = new Date().toISOString();
  await putPrompt(p);
  await refresh();
  await select(p.id);
}

async function toggleHidden() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  p.hidden = !p.hidden;
  p.updatedAt = new Date().toISOString();
  await putPrompt(p);
  currentId = null;
  await refresh();
}

async function cloneCurrent() {
  if (!currentId) return;
  const p = await getPrompt(currentId);
  if (!p) return;
  const clone: Prompt = {
    ...p,
    id: crypto.randomUUID(),
    source: "user",
    originId: p.source === "seed" ? p.id : p.originId,
    title: p.title + " (copy)",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  p.deletedAt = new Date().toISOString();
  await putPrompt(p);
  currentId = null;
  titleEl.textContent = "";
  bodyEl.value = "";
  await refresh();
  showToast("Moved to bin");
}


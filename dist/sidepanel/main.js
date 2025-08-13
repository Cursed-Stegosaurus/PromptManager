// Enhanced side panel main.js with database integration
let q = document.getElementById("search");
let list = document.getElementById("list");
let titleEl = document.getElementById("title");
let bodyEl = document.getElementById("body");
let toast = document.getElementById("toast");
let currentId = null;
let prompts = [];
let searchWorker = null;
let includeBin = false;
const notificationsEl = document.getElementById('notifications');

// Initialize the extension
init();

async function init() {
  try {
    await ensureSeeds();
    wireEvents();
    await refresh();
  } catch (error) {
    showToast('Failed to initialize', 'error');
  }
}

function wireEvents() {
  q.oninput = debounce(() => refresh(), 300);

  document.getElementById("btn-insert").onclick = async () => {
    if (!currentId) return;
    try {
      await chrome.runtime.sendMessage({ type: "insert", text: bodyEl.value });
      await chrome.runtime.sendMessage({ type: 'setMeta', key: 'lastUsedPromptId', value: currentId });
      showToast("Inserted successfully", "success");
    } catch (error) {
      showToast("Insert failed", "error");
    }
  };

  document.getElementById("btn-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(bodyEl.value);
      showToast("Copied to clipboard", "success");
    } catch (error) {
      showToast("Copy failed", "error");
    }
  };

  // Editor actions
  const btnNew = document.getElementById('btn-new');
  const btnSave = document.getElementById('btn-save');
  const btnClone = document.getElementById('btn-clone');
  if (btnNew) btnNew.onclick = onNew;
  if (btnSave) btnSave.onclick = onSave;
  if (btnClone) btnClone.onclick = () => clonePrompt(currentId);

  // Panel import wiring
  (function wireImport(){
    const importBtn = document.getElementById('btn-import');
    const fileInput = document.getElementById('panelImportInput');
    if (importBtn && fileInput) {
      importBtn.onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const res = await chrome.runtime.sendMessage({ type: 'importData', data });
          if (res && res.success) {
            const n = res.info?.importedCount ?? 0;
            showToast(`Imported ${n} prompts`, 'success');
            await refresh();
          } else {
            showToast(res?.error || 'Import failed', 'error');
          }
        } catch (e) {
          showToast('Import failed', 'error');
        } finally {
          fileInput.value = '';
        }
      };
    }
  })();

  // Recycle bin toggle
  const binToggle = document.getElementById('btn-bin');
  if (binToggle) {
    binToggle.onclick = () => {
      includeBin = !includeBin;
      binToggle.textContent = includeBin ? 'Exit Recycle Bin' : 'Recycle Bin';
      refresh();
    };
  }

  // List interactions
  list.addEventListener('click', (event) => {
    const target = event.target;
    const itemEl = target.closest('.prompt-item');
    if (!itemEl) return;
    const id = itemEl.getAttribute('data-id');
    if (!id) return;

    if (target.closest('.action-btn')) {
      if (target.closest('.action-fav')) {
        event.preventDefault();
        toggleFavorite(id);
        return;
      }
      if (target.closest('.action-hide')) {
        event.preventDefault();
        toggleHidden(id);
        return;
      }
      if (target.closest('.action-clone')) {
        event.preventDefault();
        clonePrompt(id);
        return;
      }
      if (target.closest('.action-delete')) {
        const item = prompts.find(p => p.id === id);
        if (item && item.source === 'seed') {
          showToast('Seed prompt cannot be deleted', 'warning');
          return;
        }
        event.preventDefault();
        deletePrompt(id);
        return;
      }
      if (target.closest('.action-restore')) {
        event.preventDefault();
        restorePrompt(id);
        return;
      }
      if (target.closest('.action-hard-delete')) {
        event.preventDefault();
        hardDeletePrompt(id);
        return;
      }
    }

    selectPrompt(id);
  });

  // Clear search button wiring
  (function wireClearSearch(){
    const btn = document.getElementById('btn-clear-search');
    if (!btn) return;
    const updateVis = () => {
      if (q.value && q.value.length > 0) btn.classList.remove('hidden');
      else btn.classList.add('hidden');
    };
    q.addEventListener('input', updateVis);
    updateVis();
    btn.onclick = () => { q.value = ''; updateVis(); refresh(); q.focus(); };
  })();
}

async function ensureSeeds() {
  try {
    // Check if we have any prompts
    const result = await chrome.runtime.sendMessage({ type: "getPrompts" });
    if (result.success && result.prompts.length === 0) {
      console.log('No prompts found, seeds will be loaded by background script');
    }
  } catch (error) {
    console.error('Failed to check seeds:', error);
  }
}

// Try to initialize search worker if supported
try {
  if (window && 'Worker' in window) {
    searchWorker = new Worker('searchWorker.js');
  }
} catch (_) {
  // ignore
}

async function refresh() {
  try {
    const query = q.value.trim();

    const resAll = await chrome.runtime.sendMessage({ type: 'getAllPrompts' });
    if (!resAll.success) { showToast('Failed to load prompts', 'error'); return; }
    let all = resAll.prompts || [];

    const plain = query.replace(/\b(fav|hidden|bin|tag|category|date):\S+/g, '').replace(/\"/g, '').replace(/"/g, '').trim().toLowerCase();
    if (plain) {
      const terms = plain.split(/\s+/).filter(Boolean);
      all = all.filter(p => {
        const hay = `${p.title} ${p.body} ${(p.tags||[]).join(' ')}`.toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }

    const active = all.filter(p => !p.deletedAt && !p.hidden);
    lastHidden = all.filter(p => !p.deletedAt && !!p.hidden);
    lastBin = all.filter(p => !!p.deletedAt);

    // Sort: favorites first, then most recently updated
    const byFavThenUpdated = (a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      const aT = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bT = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bT - aT;
    };
    active.sort(byFavThenUpdated);
    lastHidden.sort(byFavThenUpdated);
    lastBin.sort(byFavThenUpdated);

    prompts = active;
    renderActiveList(prompts);

    if (!currentId && prompts.length > 0) selectPrompt(prompts[0].id);
  } catch (error) {
    showToast('Failed to refresh', 'error');
  }
}

function parseFilters(query) {
  const filters = {};
  const parts = query.split(/\s+/);

  for (const part of parts) {
    if (part.startsWith('fav:')) {
      filters.favorite = part.endsWith('true');
    } else if (part.startsWith('hidden:')) {
      filters.hidden = part.endsWith('true');
    } else if (part.startsWith('bin:')) {
      filters.bin = part.endsWith('true');
    } else if (part.startsWith('category:')) {
      filters.category = part.slice(9);
    } else if (part.startsWith('date:')) {
      filters.date = part.slice(5);
    }
  }

  return filters;
}

function renderPrompts() {
  if (prompts.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-title">No prompts found</div>
        <div class="empty-state-message">Try adjusting your search or create a new prompt</div>
      </div>
    `;
    return;
  }

  list.innerHTML = prompts.map(prompt => {
    const actions = includeBin
      ? `<button class="action-btn action-restore" title="Restore">↩</button>
         <button class="action-btn action-hard-delete danger" title="Delete now">✖</button>`
      : `<button class="action-btn action-fav ${prompt.favorite ? 'primary' : ''}" title="${prompt.favorite ? 'Remove from favorites' : 'Add to favorites'}">${prompt.favorite ? '★' : '☆'}</button>
         <button class="action-btn action-hide" title="${prompt.hidden ? 'Show prompt' : 'Hide prompt'}">${prompt.hidden ? '👁️' : '🙈'}</button>
         <button class="action-btn action-clone" title="Clone prompt">📋</button>
         ${prompt.source === 'seed' ? '' : '<button class="action-btn action-delete danger" title="Delete prompt">🗑️</button>'}`;

    return `
    <div class="prompt-item ${prompt.favorite ? 'favorite' : ''} ${prompt.hidden ? 'hidden' : ''}" data-id="${prompt.id}">
      <div class="prompt-header">
        <div class="prompt-title">${escapeHtml(prompt.title)}</div>
        <div class="prompt-actions">${actions}</div>
      </div>
      <div class="prompt-content">${escapeHtml(prompt.body.substring(0, 120))}${prompt.body.length > 120 ? '...' : ''}</div>
    </div>`;
  }).join('');

  document.querySelectorAll('.prompt-item').forEach(item => {
    item.classList.toggle('selected', item.getAttribute('data-id') === currentId);
  });
}

async function onNew() {
  currentId = null;
  titleEl.value = '';
  bodyEl.value = '';
  // Clear selection in list
  document.querySelectorAll('.prompt-item').forEach(item => item.classList.remove('selected'));
  showToast('New prompt', 'info');
}

async function onSave() {
  const title = (titleEl.value || '').trim();
  const body = (bodyEl.value || '').trim();
  if (!title && !body) {
    showToast('Nothing to save', 'warning');
    return;
  }

  try {
    if (currentId) {
      const result = await chrome.runtime.sendMessage({ type: 'updatePrompt', id: currentId, updates: { title, body } });
      if (!result.success) {
        showErrorBanner(result.error || 'Update failed');
        return;
      }
      await chrome.runtime.sendMessage({ type: 'setMeta', key: 'lastUsedPromptId', value: currentId });
      showToast('Saved', 'success');
    } else {
      const result = await chrome.runtime.sendMessage({ type: 'addPrompt', prompt: { title, body, tags: [], category: 'general', source: 'user' } });
      if (!result.success) throw new Error(result.error || 'Create failed');
      currentId = result.prompt.id;
      await chrome.runtime.sendMessage({ type: 'setMeta', key: 'lastUsedPromptId', value: currentId });
      showToast('Created', 'success');
    }
    await refresh();
    if (currentId) selectPrompt(currentId);
  } catch (e) {
    console.error('Save failed:', e);
    showErrorBanner('Save failed');
  }
}

// Ensure title/body inputs are used when selecting
function selectPrompt(id) {
  currentId = id;
  const prompt = prompts.find(p => p.id === id);
  if (!prompt) return;

  titleEl.value = prompt.title || '';
  bodyEl.value = prompt.body || '';
  chrome.runtime.sendMessage({ type: 'setMeta', key: 'lastUsedPromptId', value: id });

  document.querySelectorAll('.prompt-item').forEach(item => item.classList.remove('selected'));
  const sel = document.querySelector(`[data-id="${id}"]`);
  if (sel) sel.classList.add('selected');
}

async function toggleFavorite(id = currentId) {
  if (!id) return;

  try {
    const prompt = prompts.find(p => p.id === id);
    if (!prompt) return;

    const result = await chrome.runtime.sendMessage({
      type: "updatePrompt",
      id,
      updates: { favorite: !prompt.favorite }
    });

    if (result.success) {
      await refresh();
      showToast(prompt.favorite ? 'Removed from favorites' : 'Added to favorites', 'success');
    } else {
      showToast('Failed to update favorite', 'error');
    }
  } catch (error) {
    console.error('Toggle favorite failed:', error);
    showToast('Failed to update favorite', 'error');
  }
}

async function toggleHidden(id = currentId) {
  if (!id) return;

  try {
    const prompt = prompts.find(p => p.id === id);
    if (!prompt) return;

    const result = await chrome.runtime.sendMessage({
      type: "updatePrompt",
      id,
      updates: { hidden: !prompt.hidden }
    });

    if (result.success) {
      await refresh();
      showToast(prompt.hidden ? 'Prompt shown' : 'Prompt hidden', 'success');
    } else {
      showToast('Failed to update visibility', 'error');
    }
  } catch (error) {
    console.error('Toggle hidden failed:', error);
    showToast('Failed to update visibility', 'error');
  }
}

async function clonePrompt(id = currentId) {
  if (!id) return;

  try {
    const prompt = prompts.find(p => p.id === id);
    if (!prompt) return;

    const clone = {
      title: `${prompt.title} (Copy)`,
      body: prompt.body,
      tags: Array.isArray(prompt.tags) ? prompt.tags.slice(0, 50) : [],
      category: prompt.category || 'general',
      favorite: false,
      hidden: false,
      source: 'user',
      originId: prompt.originId || prompt.id
    };

    const result = await chrome.runtime.sendMessage({ type: "addPrompt", prompt: clone });

    if (result.success) {
      currentId = result.prompt.id;
      await refresh();
      selectPrompt(currentId);
      showToast('Prompt cloned as editable copy', 'success');
    } else {
      showToast('Failed to clone prompt', 'error');
    }
  } catch (error) {
    console.error('Clone failed:', error);
    showToast('Failed to clone prompt', 'error');
  }
}

async function deletePrompt(id = currentId) {
  if (!id) return;

  if (!confirm('Are you sure you want to delete this prompt? It will be moved to the recycle bin.')) {
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({
      type: "deletePrompt",
      id,
      softDelete: true
    });

    if (result.success) {
      await refresh();
      showToast('Prompt moved to recycle bin', 'success');

      if (currentId === id) {
        currentId = null;
        titleEl.value = '';
        bodyEl.value = '';
      }
    } else {
      showToast('Failed to delete prompt', 'error');
    }
  } catch (error) {
    console.error('Delete failed:', error);
    showToast('Failed to delete prompt', 'error');
  }
}

async function restorePrompt(id) {
  try {
    await chrome.runtime.sendMessage({ type: 'updatePrompt', id, updates: { deletedAt: null } });
    showToast('Restored', 'success');
    await refresh();
  } catch (e) { showToast('Restore failed', 'error'); }
}

async function hardDeletePrompt(id) {
  try {
    await chrome.runtime.sendMessage({ type: 'deletePrompt', id, softDelete: false });
    showToast('Deleted permanently', 'success');
    await refresh();
  } catch (e) { showToast('Delete failed', 'error'); }
}

function showToast(message, type = 'info') {
  if (!notificationsEl) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<div class="toast-header"><span class="toast-title">${type.toUpperCase()}</span><button class="toast-close" aria-label="Close">×</button></div><div class="toast-message">${escapeHtml(message)}</div>`;
  notificationsEl.appendChild(toast);
  const close = toast.querySelector('.toast-close');
  if (close) close.addEventListener('click', () => toast.remove());
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return date.toLocaleDateString();
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function showErrorBanner(message) {
  showToast(message, 'error');
}

function renderActiveList(items) {
  // Preserve open state of collapsibles before re-render
  const hiddenOpenBefore = document.getElementById('hiddenSection')?.open;
  const binOpenBefore = document.getElementById('binSection')?.open;

  const parts = [];
  if (!items || items.length === 0) {
    parts.push(`<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-title">No prompts found</div><div class="empty-state-message">Try adjusting your search or create a new prompt</div></div>`);
  } else {
    parts.push(items.map(renderTile(false)).join(''));
  }

  parts.push(renderSection('Hidden', 'hiddenSection', lastHidden || []));
  parts.push(renderSection('Deleted', 'binSection', lastBin || [], true));

  list.innerHTML = parts.join('');

  // Restore open state
  const hiddenEl = document.getElementById('hiddenSection');
  if (hiddenEl && typeof hiddenOpenBefore === 'boolean') hiddenEl.open = hiddenOpenBefore;
  const binEl = document.getElementById('binSection');
  if (binEl && typeof binOpenBefore === 'boolean') binEl.open = binOpenBefore;

  document.querySelectorAll('#list .prompt-item').forEach(item => {
    item.classList.toggle('selected', item.getAttribute('data-id') === currentId);
  });
}

let lastHidden = [];
let lastBin = [];

function renderHiddenList(items) { lastHidden = items || []; }
function renderBinList(items) { lastBin = items || []; }

async function updateHidden(id, hidden) {
  try {
    // Only send 'hidden' to allow seed prompts to unhide
    await chrome.runtime.sendMessage({ type: 'updatePrompt', id, updates: { hidden } });
    showToast(hidden ? 'Hidden' : 'Unhidden', 'success');
    await refresh();
  } catch { showToast('Update failed', 'error'); }
}

function renderSection(title, id, items, isBin = false) {
  const label = isBin ? 'Deleted' : title;
  const itemsHtml = (items || []).map(p => {
    if (isBin) {
      return `<div class="prompt-item" data-id="${p.id}"><div class="prompt-header"><div class="prompt-title">${escapeHtml(p.title)}</div><div class="prompt-actions"><button class="action-btn action-restore" title="Restore">↩</button><button class="action-btn action-hard-delete danger" title="Delete now">✖</button></div></div><div class="prompt-content">${escapeHtml(p.body.substring(0,120))}${p.body.length>120?'...':''}</div></div>`;
    }
    // Hidden section uses show icon to unhide
    return `<div class="prompt-item hidden" data-id="${p.id}"><div class="prompt-header"><div class="prompt-title">${escapeHtml(p.title)}</div><div class="prompt-actions"><button class="action-btn action-unhide" title="Unhide"><img src="../assets/icons/show54.png" alt="Unhide" width="18" height="18"/></button></div></div><div class="prompt-content">${escapeHtml(p.body.substring(0,120))}${p.body.length>120?'...':''}</div></div>`;
  }).join('');

  return `<details id="${id}" class="section"><summary>${label}</summary><div class="section-list">${itemsHtml || ''}</div></details>`;
}

function renderTile(isBinView) {
  return (prompt) => {
    const hideIconBase = prompt.hidden ? 'show' : 'hide';
    const hideTitle = prompt.hidden ? 'Show prompt' : 'Hide prompt';
    const favIconBase = prompt.favorite ? 'star-f' : 'star-s';
    const favTitle = prompt.favorite ? 'Remove from favorites' : 'Add to favorites';
    const actions = `<button class="action-btn action-fav ${prompt.favorite ? 'primary' : ''}" title="${favTitle}"><img src="../assets/icons/${favIconBase}54.png" alt="Favorite" width="18" height="18"/></button>
      <button class="action-btn action-hide" title="${hideTitle}"><img src="../assets/icons/${hideIconBase}54.png" alt="${hideTitle}" width="18" height="18"/></button>
      <button class="action-btn action-clone" title="Clone prompt"><img src="../assets/icons/clone54.png" alt="Clone" width="18" height="18"/></button>
      ${prompt.source === 'seed' ? '' : '<button class="action-btn action-delete danger" title="Delete prompt">🗑️</button>'}`;
    return `<div class="prompt-item ${prompt.favorite ? 'favorite' : ''} ${prompt.hidden ? 'hidden' : ''}" data-id="${prompt.id}"><div class="prompt-header"><div class="prompt-title">${escapeHtml(prompt.title)}</div><div class="prompt-actions">${actions}</div></div><div class="prompt-content">${escapeHtml(prompt.body.substring(0,120))}${prompt.body.length>120?'...':''}</div></div>`;
  };
}

// Extend list click handler to support unhide in hiddenList
list.addEventListener('click', onListClick);
function onListClick(e) {
  const target = e.target;
  const itemEl = target.closest('.prompt-item');
  if (!itemEl) return;
  const id = itemEl.getAttribute('data-id');
  if (!id) return;
  if (target.closest('.action-unhide')) { e.preventDefault(); updateHidden(id, false); return; }
}

import { openDb, putPrompt, getPrompt, listPrompts, deletePrompt, restorePrompt, toggleFavorite, toggleHidden, putMeta, getMeta, permanentlyDeletePrompt, incrementPromptUsage } from '../lib/db.js';
import type { Prompt } from '../lib/schema.js';

// Chrome API types
declare const chrome: {
  runtime: {
    sendMessage: (message: any) => Promise<any>;
    getURL: (path: string) => string;
    openOptionsPage: () => void;
    onMessage: {
      addListener: (callback: (message: any, sender: any, sendResponse: any) => void) => void;
    };
  };
};

// DOM elements
const searchInput = document.getElementById('search') as HTMLInputElement;
const clearSearchBtn = document.getElementById('clear-search') as HTMLButtonElement;
const promptsList = document.getElementById('prompts-list') as HTMLDivElement;
const hiddenToggle = document.getElementById('hidden-toggle') as HTMLDivElement;
const hiddenContent = document.getElementById('hidden-content') as HTMLDivElement;
const hiddenPromptsList = document.getElementById('hidden-prompts-list') as HTMLDivElement;
const binToggle = document.getElementById('bin-toggle') as HTMLDivElement;
const binContent = document.getElementById('bin-content') as HTMLDivElement;
const binPromptsList = document.getElementById('bin-prompts-list') as HTMLDivElement;
const detailSection = document.getElementById('detail-section') as HTMLDivElement;
const detailTitle = document.getElementById('detail-title') as HTMLInputElement;
const detailBody = document.getElementById('detail-body') as HTMLTextAreaElement;
const insertButton = document.getElementById('btn-insert') as HTMLButtonElement;
const copyButton = document.getElementById('btn-copy') as HTMLButtonElement;
const saveButton = document.getElementById('btn-save') as HTMLButtonElement;
const optionsButton = document.getElementById('btn-options') as HTMLButtonElement;
const toastContainer = document.getElementById('toast-container') as HTMLDivElement;

// State
let currentPromptId: string | null = null;
let prompts: Prompt[] = [];
let searchWorker: Worker | null = null;
let searchState = {
  showHidden: false,
  includeBin: false
};

// Initialize the sidepanel
async function init() {
  try {
    // Load prompts first
    await refresh();
    
    // Load hidden and deleted prompts immediately
    await loadHiddenPrompts();
    await loadBinPrompts();
    
    // Wire up event listeners
    wireEvents();
    
    // Set up search worker
    setupSearchWorker();
    
    // Load starters if needed
    await ensureStartersLoaded();
    
    // Set up periodic refresh to keep sections up-to-date
    setInterval(async () => {
      try {
        await loadHiddenPrompts();
        await loadBinPrompts();
      } catch (error) {
        console.error('Periodic refresh failed:', error);
      }
    }, 5000); // Refresh every 5 seconds
    
    console.log('Sidepanel initialized successfully');
  } catch (error) {
    console.error('Failed to initialize sidepanel:', error);
    showToast('Failed to initialize sidepanel', 'error');
  }
}

// Ensure starters are loaded
async function ensureStartersLoaded() {
  try {
    const started = await getMeta<boolean>("starterLoaded");
    if (!started) {
      await chrome.runtime.sendMessage({ type: "starter:ensure" });
    }
  } catch (error) {
    console.error('Failed to check starters:', error);
  }
}

// Initialize search worker
function setupSearchWorker() {
  try {
    searchWorker = new Worker(chrome.runtime.getURL('searchWorker.js'));
    searchWorker.onmessage = (e) => {
      const results = e.data;
      if (results.error) {
        console.error('Search worker error:', results.error);
        return;
      }
      displayResults(results);
    };
  } catch (error) {
    console.warn('Search worker not available, falling back to basic search');
  }
}

// Wire up event listeners
function wireEvents() {
  // Search
  searchInput.addEventListener('input', performSearch);
  clearSearchBtn.addEventListener('click', clearSearch);
  
  // Toggle sections
  hiddenToggle.addEventListener('click', () => toggleSection(hiddenToggle, hiddenContent));
  binToggle.addEventListener('click', () => toggleSection(binToggle, binContent));
  
  // Detail actions
  insertButton.addEventListener('click', insertCurrentPrompt);
  copyButton.addEventListener('click', copyCurrentPrompt);
  saveButton.addEventListener('click', saveCurrentPrompt);
  optionsButton.addEventListener('click', openOptions);
  
  // Listen for prompt updates from options page
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "prompts:updated") {
      console.log('Sidebar received prompts:updated message, refreshing...');
      refresh();
      loadHiddenPrompts();
      loadBinPrompts();
    }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'p':
          e.preventDefault();
          if (currentPromptId) {
            insertCurrentPrompt();
          }
          break;
        case 'i':
          e.preventDefault();
          if (detailBody.value) {
            copyCurrentPrompt();
          }
          break;
      }
    }
  });
}

// Toggle section visibility
function toggleSection(toggle: HTMLElement, content: HTMLElement) {
  const isExpanded = toggle.classList.contains('expanded');
  if (isExpanded) {
    toggle.classList.remove('expanded');
    content.classList.remove('expanded');
  } else {
    toggle.classList.add('expanded');
    content.classList.add('expanded');
    // Always refresh content when expanding sections to ensure up-to-date data
    if (toggle === hiddenToggle) {
      loadHiddenPrompts();
    } else if (toggle === binToggle) {
      loadBinPrompts();
    }
  }
}

// Clear search
function clearSearch() {
  searchInput.value = '';
  clearSearchBtn.classList.remove('visible');
  performSearch();
}

// Perform search using worker or fallback
async function performSearch() {
  const query = searchInput.value.trim();
  
  // Show/hide clear button
  if (query) {
    clearSearchBtn.classList.add('visible');
  } else {
    clearSearchBtn.classList.remove('visible');
  }
  
  if (searchWorker) {
    // Use search worker for smooth performance
    searchWorker.postMessage({
      prompts,
      query: {
        q: query,
        showHidden: searchState.showHidden,
        includeBin: searchState.includeBin,
        sortBy: 'updatedAt',
        sortOrder: 'desc'
      }
    });
  } else {
    // Fallback to basic search
    const results = performBasicSearch(query);
    displayResults(results);
  }
}

// Consistent sorting function for all prompt lists (same as options page)
function sortPromptsByPriority(prompts: any[]): any[] {
  return [...prompts].sort((a, b) => {
    // First: sort by favorite status (favorites come first)
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    
    // Within the same favorite status, maintain database order (usage count then alphabetical)
    // This ensures consistent sorting across all sections
    return 0; // Maintain database order within each favorite group
  });
}

// Basic search fallback
function performBasicSearch(query: string): any[] {
  if (!query) {
    // Show all non-hidden, non-deleted prompts when no search query
    const filtered = prompts.filter(p => !p.hidden && !p.deletedAt);
    // Sort with favorites first, then by usage count and alphabetical
    return sortPromptsByPriority(filtered);
  }

  const terms = query.toLowerCase().split(/\s+/);
  const filtered = prompts.filter(p => {
    if (!searchState.showHidden && p.hidden) return false;
    if (!searchState.includeBin && p.deletedAt) return false;
    
    const searchableText = `${p.title} ${p.tags.join(' ')} ${p.body}`.toLowerCase();
    return terms.every(term => searchableText.includes(term));
  });

  // Sort with favorites first, then by usage count and alphabetical
  return sortPromptsByPriority(filtered);
}

// Display search results
function displayResults(results: any[]) {
  promptsList.innerHTML = '';
  
  if (results.length === 0) {
    promptsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-title">No prompts found</div>
        <div class="empty-state-message">Try adjusting your search or filters</div>
      </div>
    `;
    return;
  }
  
  results.forEach(prompt => {
    const promptElement = createPromptElement(prompt);
    promptsList.appendChild(promptElement);
  });
}

// Create prompt element
function createPromptElement(prompt: Prompt): HTMLElement {
  const div = document.createElement('div');
  div.className = `prompt-item ${prompt.id === currentPromptId ? 'active' : ''} ${prompt.favorite ? 'favorite' : ''} ${prompt.hidden ? 'hidden' : ''}`;
  
  div.setAttribute('data-prompt-id', prompt.id);
  div.innerHTML = `
    <div class="prompt-header">
      <div class="prompt-title">${escapeHtml(prompt.title)}</div>
      <div class="prompt-actions">
        ${prompt.deletedAt ? 
          // Deleted prompts: only restore and permanent delete
          `<button class="action-btn" data-action="restore" title="Restore prompt"><img src="../assets/icons/restore32.png" alt="Restore" class="action-icon" /></button>
           <button class="action-btn danger" data-action="permanentDelete" title="Delete permanently"><img src="../assets/icons/delete32.png" alt="Delete Permanently" class="action-icon" /></button>` :
          prompt.hidden ?
          // Hidden prompts: only show visibility toggle
          `<button class="action-btn" data-action="hide" title="Show prompt">
             <img src="../assets/icons/hide32.png" alt="Show" class="action-icon" />
           </button>` :
          // Active prompts: normal actions
          `<button class="action-btn" data-action="fav" title="${prompt.favorite ? 'Remove from favorites' : 'Add to favorites'}">
             <img src="../assets/icons/${prompt.favorite ? 'fav-f32.png' : 'fav-s32.png'}" alt="Favorite" class="action-icon" />
           </button>
           <button class="action-btn" data-action="hide" title="Hide prompt">
             <img src="../assets/icons/visible32.png" alt="Visibility" class="action-icon" />
           </button>
           <button class="action-btn" data-action="clone" title="Clone prompt">
             <img src="../assets/icons/clone32.png" alt="Clone" class="action-icon" />
           </button>
           ${prompt.source === 'starter' ? '' : '<button class="action-btn danger" data-action="delete" title="Delete prompt"><img src="../assets/icons/delete32.png" alt="Delete" class="action-icon" /></button>'}`
        }
      </div>
    </div>
    <div class="prompt-content">${escapeHtml(prompt.body.substring(0, 150))}${prompt.body.length > 150 ? '...' : ''}</div>
  `;
  
  // Add click handler
  div.addEventListener('click', () => selectPrompt(prompt.id));
  
  // Add action button handlers
  div.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      handlePromptAction(action!, prompt.id);
    });
  });
  
  return div;
}

// Handle prompt actions
async function handlePromptAction(action: string, promptId: string) {
  try {
    switch (action) {
      case 'fav':
        await toggleFavorite(promptId);
        break;
      case 'hide':
        await toggleHidden(promptId);
        break;
      case 'clone':
        await clonePrompt(promptId);
        break;
      case 'delete':
        // Prevent deletion of starter prompts
        const prompt = await getPrompt(promptId);
        if (prompt?.source === 'starter') {
          showToast('Starter prompts cannot be deleted. Use hide instead.', 'error');
          return;
        }
        await deletePrompt(promptId);
        break;
      case 'restore':
        await restorePrompt(promptId);
        break;
      case 'permanentDelete':
        if (confirm('This will permanently delete this prompt. This action cannot be undone. Continue?')) {
          await permanentlyDeletePrompt(promptId);
        }
        break;
      case 'incrementUsage':
        await incrementPromptUsage(promptId);
        break;
    }
    await refresh();
    await loadHiddenPrompts();
    await loadBinPrompts();
  } catch (error) {
    console.error('Action failed:', error);
    showToast('Action failed', 'error');
  }
}

// Select a prompt
async function selectPrompt(id: string) {
  currentPromptId = id;
  const prompt = await getPrompt(id);
  if (!prompt) return;
  
  detailTitle.value = prompt.title;
  detailBody.value = prompt.body;
  
  // Show save button only for non-starter prompts
  saveButton.classList.toggle('visible', prompt.source !== 'starter');
  
  // Make title and textarea editable only for non-starter prompts
  detailTitle.readOnly = prompt.source === 'starter';
  detailBody.readOnly = prompt.source === 'starter';
  
  // Store last used
  await putMeta("lastUsedPromptId", id);
  
  // Update list selection
  document.querySelectorAll('.prompt-item').forEach(item => {
    item.classList.remove('active');
  });
  // Find the clicked prompt item and mark it as active
  const clickedItem = document.querySelector(`[data-prompt-id="${id}"]`);
  if (clickedItem) {
    clickedItem.classList.add('active');
  }
}

// Insert current prompt
async function insertCurrentPrompt() {
  if (!currentPromptId) return;
  
  try {
    await chrome.runtime.sendMessage({ type: "insert", text: detailBody.value });
    // Track analytics
    await incrementPromptUsage(currentPromptId);
    showToast('Prompt inserted');
  } catch (error) {
    console.error('Insert failed:', error);
    showToast('Insert failed', 'error');
  }
}

// Copy current prompt
async function copyCurrentPrompt() {
  try {
    await navigator.clipboard.writeText(detailBody.value);
    // Track analytics if we have a current prompt
    if (currentPromptId) {
      await incrementPromptUsage(currentPromptId);
    }
    showToast('Copied to clipboard');
  } catch (error) {
    console.error('Copy failed:', error);
    showToast('Copy failed', 'error');
  }
}

// Save current prompt
async function saveCurrentPrompt() {
  if (!currentPromptId) return;
  
  const prompt = await getPrompt(currentPromptId);
  if (!prompt) return;
  
  // Don't allow saving starter prompts
  if (prompt.source === 'starter') {
    showToast('Starter prompts cannot be edited', 'error');
    return;
  }
  
  try {
    prompt.title = detailTitle.value.trim();
    prompt.body = detailBody.value;
    prompt.updatedAt = new Date().toISOString();
    
    // Validate title is not empty
    if (!prompt.title) {
      showToast('Title cannot be empty', 'error');
      return;
    }
    
    await putPrompt(prompt);
    await refresh();
    showToast('Prompt saved successfully', 'success');
  } catch (error) {
    console.error('Failed to save:', error);
    showToast('Failed to save prompt', 'error');
  }
}

// Toggle current prompt favorite
async function toggleCurrentFavorite() {
  if (!currentPromptId) return;
  await toggleFavorite(currentPromptId);
  await refresh();
  await loadHiddenPrompts();
  await loadBinPrompts();
  showToast('Favorite updated');
}

// Toggle current prompt hidden
async function toggleCurrentHidden() {
  if (!currentPromptId) return;
  await toggleHidden(currentPromptId);
  await refresh();
  await loadHiddenPrompts();
  await loadBinPrompts();
  showToast('Visibility updated');
}

// Clone current prompt
async function cloneCurrentPrompt() {
  if (!currentPromptId) return;
  await clonePrompt(currentPromptId);
  await refresh();
  showToast('Prompt cloned');
}

// Delete current prompt
async function deleteCurrentPrompt() {
  if (!currentPromptId) return;
  
  // Check if this is a starter prompt
  const prompt = await getPrompt(currentPromptId);
  if (prompt?.source === 'starter') {
    showToast('Starter prompts cannot be deleted. Use hide instead.', 'error');
    return;
  }
  
  if (!confirm('Move this prompt to the recycle bin?')) return;
  
  await deletePrompt(currentPromptId);
  await refresh();
  await loadHiddenPrompts();
  await loadBinPrompts();
  showToast('Prompt moved to bin');
}

// Restore current prompt
async function restoreCurrentPrompt() {
  if (!currentPromptId) return;
  await restorePrompt(currentPromptId);
  await refresh();
  await loadHiddenPrompts();
  await loadBinPrompts();
  showToast('Prompt restored');
}

// Clone a prompt
async function clonePrompt(id: string) {
  const prompt = await getPrompt(id);
  if (!prompt) return;
  
  const clone: Prompt = {
    ...prompt,
    id: crypto.randomUUID(),
    source: "user",
    originId: prompt.source === "starter" ? prompt.id : prompt.originId,
    title: prompt.title + " (copy)",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  };
  
  await putPrompt(clone);
}

// Load hidden prompts
async function loadHiddenPrompts() {
  try {
    console.log('loadHiddenPrompts: Starting...');
    // Get all prompts including hidden ones
    const allPrompts = await listPrompts(true);
    console.log('loadHiddenPrompts: All prompts loaded:', allPrompts.length);
    
    const hiddenPrompts = allPrompts.filter(p => p.hidden && !p.deletedAt);
    console.log('loadHiddenPrompts: Hidden prompts found:', hiddenPrompts.length, hiddenPrompts);
    
    hiddenPromptsList.innerHTML = '';
    
    if (hiddenPrompts.length === 0) {
      hiddenPromptsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-message">No hidden prompts</div>
        </div>
      `;
      return;
    }
    
    hiddenPrompts.forEach(prompt => {
      const promptElement = createPromptElement(prompt);
      hiddenPromptsList.appendChild(promptElement);
    });
    
    console.log('loadHiddenPrompts: Hidden prompts loaded successfully');
  } catch (error) {
    console.error('Failed to load hidden prompts:', error);
  }
}

// Load bin prompts
async function loadBinPrompts() {
  try {
    console.log('loadBinPrompts: Starting...');
    // Get all prompts including deleted ones
    const allPrompts = await listPrompts(true);
    console.log('loadBinPrompts: All prompts loaded:', allPrompts.length);
    
    const binPrompts = allPrompts.filter(p => p.deletedAt);
    console.log('loadBinPrompts: Deleted prompts found:', binPrompts.length, binPrompts);
    
    binPromptsList.innerHTML = '';
    
    if (binPrompts.length === 0) {
      binPromptsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-message">No prompts in bin</div>
        </div>
      `;
      return;
    }
    
    binPrompts.forEach(prompt => {
      const promptElement = createPromptElement(prompt);
      binPromptsList.appendChild(promptElement);
    });
    
    console.log('loadBinPrompts: Deleted prompts loaded successfully');
  } catch (error) {
    console.error('Failed to load bin prompts:', error);
  }
}

// Refresh the prompt list
async function refresh() {
  try {
    prompts = await listPrompts(true);
    
    if (prompts.length === 0) {
      // Try to manually trigger starter loading
      try {
        await chrome.runtime.sendMessage({ type: "starter:ensure" });
        // Wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (starterError) {
        console.error('Starter ensure failed:', starterError);
      }
    }
    
    performSearch();
    
    // Also refresh hidden and deleted prompts to ensure consistency
    await loadHiddenPrompts();
    await loadBinPrompts();
  } catch (error) {
    console.error('Failed to refresh:', error);
    showToast('Failed to refresh', 'error');
  }
}

// Show toast notification
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
      <button class="toast-close">×</button>
    </div>
    <div class="toast-message">${message}</div>
  `;
  
  // Add click handler for close button
  const closeBtn = toast.querySelector('.toast-close') as HTMLButtonElement;
  closeBtn.addEventListener('click', () => {
    if (toast.parentNode) {
      toast.remove();
    }
  });
  
  toastContainer.appendChild(toast);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 3000);
}

// Open options page
function openOptions() {
  chrome.runtime.openOptionsPage();
}

// Utility functions
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

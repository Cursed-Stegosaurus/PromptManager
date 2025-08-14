import { openDb, listPrompts, putPrompt, putMeta, getMeta, deletePrompt } from '../lib/db.js';
import type { Prompt } from '../lib/schema.js';

// DOM elements
const exportButton = document.getElementById('btn-export') as HTMLButtonElement;
const importButton = document.getElementById('btn-import') as HTMLButtonElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;
const telemetryEnabled = document.getElementById('telemetry-enabled') as HTMLInputElement;
const recyclePurgeDays = document.getElementById('recycle-purge-days') as HTMLSelectElement;
const toastContainer = document.getElementById('toast-container') as HTMLDivElement;

// New prompt editor elements
const newPromptButton = document.getElementById('btn-new-prompt') as HTMLButtonElement;
const savePromptButton = document.getElementById('btn-save-prompt') as HTMLButtonElement;
const deletePromptButton = document.getElementById('btn-delete-prompt') as HTMLButtonElement;
const promptSelect = document.getElementById('prompt-select') as HTMLSelectElement;
const promptSourceBadge = document.getElementById('prompt-source-badge') as HTMLSpanElement;
const promptTitle = document.getElementById('prompt-title') as HTMLInputElement;
const promptTags = document.getElementById('prompt-tags') as HTMLInputElement;
const tagsDisplay = document.getElementById('tags-display') as HTMLDivElement;
const promptBody = document.getElementById('prompt-body') as HTMLTextAreaElement;
const promptsSearch = document.getElementById('prompts-search') as HTMLInputElement;
const promptsFilterSource = document.getElementById('prompts-filter-source') as HTMLSelectElement;
const promptsCards = document.getElementById('prompts-cards') as HTMLDivElement;

// State
let currentPrompt: Prompt | null = null;
let allPrompts: Prompt[] = [];
let currentTags: string[] = [];
let isEditing = false;

// Initialize
async function init() {
  try {
    await loadSettings();
    await loadPrompts();
    wireEvents();
    setupTagInput();
  } catch (error) {
    console.error('Failed to initialize options:', error);
    showToast('Failed to initialize options', 'error');
  }
}

// Load current settings
async function loadSettings() {
  try {
    // Other settings
    const telemetry = await getMeta<boolean>('telemetryEnabled') ?? false;
    telemetryEnabled.checked = telemetry;
    
    const purgeDays = await getMeta<number>('recycleAutoPurgeDays') ?? 30;
    recyclePurgeDays.value = purgeDays.toString();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Load all prompts
async function loadPrompts() {
  try {
    console.log('Loading prompts...');
    allPrompts = await listPrompts(true);
    console.log('Prompts loaded:', allPrompts.length, allPrompts);
    
    // If no prompts exist, try to ensure starters are loaded first
    if (allPrompts.length === 0) {
      console.log('No prompts found, ensuring starters are loaded...');
      try {
        await chrome.runtime.sendMessage({ type: "seed:ensure" });
        // Wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 1000));
        allPrompts = await listPrompts(true);
        console.log('Prompts after starter ensure:', allPrompts.length, allPrompts);
      } catch (starterError) {
        console.error('Starter ensure failed:', starterError);
      }
    }
    
    populatePromptSelect();
    renderPromptCards();
    
    // Show debug info
    if (allPrompts.length === 0) {
      showToast('No prompts found. Try reloading seed prompts.', 'info');
    } else {
      showToast(`Loaded ${allPrompts.length} prompts`, 'info');
    }
  } catch (error) {
    console.error('Failed to load prompts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    showToast('Failed to load prompts: ' + errorMessage, 'error');
    
    // Fallback: create some sample prompts for testing
    console.log('Creating fallback sample prompts...');
    allPrompts = createSamplePrompts();
    populatePromptSelect();
    renderPromptCards();
  }
}

// Create sample prompts for testing
function createSamplePrompts(): Prompt[] {
  return [
    {
      id: 'sample-1',
      title: 'Sample Writing Prompt',
      body: 'This is a sample writing prompt to help you get started. You can edit this or create your own prompts.',
      tags: ['writing', 'sample', 'creative'],
      source: 'user',
      favorite: false,
      hidden: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    },
    {
      id: 'sample-2',
      title: 'Sample Code Review',
      body: 'This is a sample code review prompt. Use this template to structure your code reviews effectively.',
      tags: ['code', 'review', 'development'],
      source: 'user',
      favorite: true,
      hidden: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    }
  ];
}

// Populate prompt selector dropdown
function populatePromptSelect() {
  promptSelect.innerHTML = '<option value="">-- Select a prompt --</option>';
  
  // Group prompts by source
  const seedPrompts = allPrompts.filter(p => p.source === 'seed');
  const userPrompts = allPrompts.filter(p => p.source === 'user');
  
  if (seedPrompts.length > 0) {
    const seedGroup = document.createElement('optgroup');
    seedGroup.label = 'Seed Prompts';
    seedPrompts.forEach(prompt => {
      const option = document.createElement('option');
      option.value = prompt.id;
      option.textContent = prompt.title;
      seedGroup.appendChild(option);
    });
    promptSelect.appendChild(seedGroup);
  }
  
  if (userPrompts.length > 0) {
    const userGroup = document.createElement('optgroup');
    userGroup.label = 'User Prompts';
    userPrompts.forEach(prompt => {
      const option = document.createElement('option');
      option.value = prompt.id;
      option.textContent = prompt.title;
      userGroup.appendChild(option);
    });
    promptSelect.appendChild(userGroup);
  }
}

// Wire up event listeners
function wireEvents() {
  // Import/Export
  exportButton.addEventListener('click', exportPrompts);
  importButton.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', handleImport);
  
  // Other settings
  telemetryEnabled.addEventListener('change', async () => {
    await putMeta('telemetryEnabled', telemetryEnabled.checked);
  });
  
  recyclePurgeDays.addEventListener('change', async () => {
    await putMeta('recycleAutoPurgeDays', parseInt(recyclePurgeDays.value));
  });
  
  // Prompt editor
  newPromptButton.addEventListener('click', createNewPrompt);
  savePromptButton.addEventListener('click', saveCurrentPrompt);
  deletePromptButton.addEventListener('click', deleteCurrentPrompt);
  promptSelect.addEventListener('change', onPromptSelectChange);
  
  // Search and filter
  promptsSearch.addEventListener('input', filterPromptCards);
  promptsFilterSource.addEventListener('change', filterPromptCards);
}

// Setup tag input functionality
function setupTagInput() {
  promptTags.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(promptTags.value.trim());
      promptTags.value = '';
    }
  });
}

// Add a new tag
function addTag(tagText: string) {
  if (tagText && !currentTags.includes(tagText)) {
    currentTags.push(tagText);
    renderTags();
  }
}

// Remove a tag
function removeTag(tagText: string) {
  currentTags = currentTags.filter(tag => tag !== tagText);
  renderTags();
}

// Render tags display
function renderTags() {
  tagsDisplay.innerHTML = '';
  currentTags.forEach(tag => {
    const tagElement = document.createElement('span');
    tagElement.className = 'tag-item';
    tagElement.innerHTML = `
      ${tag}
      <button class="tag-remove" onclick="removeTag('${tag}')">×</button>
    `;
    tagsDisplay.appendChild(tagElement);
  });
}

// Create new prompt
function createNewPrompt() {
  currentPrompt = null;
  isEditing = true;
  clearEditor();
  promptSelect.value = '';
  promptSourceBadge.textContent = '';
  promptSourceBadge.className = 'source-badge';
  updateEditorButtons();
  showToast('Creating new prompt', 'info');
}

// Clear editor
function clearEditor() {
  promptTitle.value = '';
  promptBody.value = '';
  currentTags = [];
  renderTags();
}

// On prompt selection change
async function onPromptSelectChange() {
  const promptId = promptSelect.value;
  if (!promptId) {
    currentPrompt = null;
    clearEditor();
    updateEditorButtons();
    return;
  }
  
  try {
    currentPrompt = allPrompts.find(p => p.id === promptId) || null;
    if (currentPrompt) {
      loadPromptIntoEditor(currentPrompt);
      updateEditorButtons();
    }
  } catch (error) {
    console.error('Failed to load prompt:', error);
    showToast('Failed to load prompt', 'error');
  }
}

// Load prompt into editor
function loadPromptIntoEditor(prompt: Prompt) {
  promptTitle.value = prompt.title;
  promptBody.value = prompt.body;
  currentTags = [...prompt.tags];
  renderTags();
  
  // Update source badge
  promptSourceBadge.textContent = prompt.source;
  promptSourceBadge.className = `source-badge ${prompt.source}`;
  
  // Set editing mode
  isEditing = prompt.source === 'user';
  updateEditorButtons();
}

// Update editor buttons state
function updateEditorButtons() {
  if (currentPrompt) {
    savePromptButton.disabled = currentPrompt.source === 'seed';
    deletePromptButton.disabled = currentPrompt.source === 'seed';
    promptTitle.readOnly = currentPrompt.source === 'seed';
    promptBody.readOnly = currentPrompt.source === 'seed';
  } else {
    savePromptButton.disabled = false;
    deletePromptButton.disabled = true;
    promptTitle.readOnly = false;
    promptBody.readOnly = false;
  }
}

// Save current prompt
async function saveCurrentPrompt() {
  try {
    if (!promptTitle.value.trim()) {
      showToast('Title is required', 'error');
      return;
    }
    
    if (!promptBody.value.trim()) {
      showToast('Content is required', 'error');
      return;
    }
    
    let prompt: Prompt;
    
      if (currentPrompt) {
    // Update existing prompt
    if (currentPrompt.source === 'seed') {
      showToast('Seed prompts cannot be edited', 'error');
      return;
    }
    prompt = { ...currentPrompt };
  } else {
      // Create new prompt
      prompt = {
        id: crypto.randomUUID(),
        title: promptTitle.value.trim(),
        body: promptBody.value.trim(),
        tags: currentTags,
        source: 'user',
        favorite: false,
        hidden: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };
    }
    
    // Update fields
    prompt.title = promptTitle.value.trim();
    prompt.body = promptBody.value.trim();
    prompt.tags = currentTags;
    prompt.updatedAt = new Date().toISOString();
    
    await putPrompt(prompt);
    await loadPrompts();
    
    // Update selection if this was a new prompt
    if (!currentPrompt) {
      promptSelect.value = prompt.id;
      currentPrompt = prompt;
    }
    
    showToast('Prompt saved successfully', 'success');
    updateEditorButtons();
  } catch (error) {
    console.error('Failed to save prompt:', error);
    showToast('Failed to save prompt', 'error');
  }
}

// Delete current prompt
async function deleteCurrentPrompt() {
  if (!currentPrompt) return;
  
  if (currentPrompt.source === 'seed') {
    showToast('Seed prompts cannot be deleted', 'error');
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
    promptSelect.value = '';
    promptSourceBadge.textContent = '';
    promptSourceBadge.className = 'source-badge';
    updateEditorButtons();
    showToast('Prompt deleted successfully', 'success');
  } catch (error) {
    console.error('Failed to delete prompt:', error);
    showToast('Failed to delete prompt', 'error');
  }
}

// Filter prompt cards
function filterPromptCards() {
  const searchTerm = promptsSearch.value.toLowerCase();
  const sourceFilter = promptsFilterSource.value;
  
  const filteredPrompts = allPrompts.filter(prompt => {
    const matchesSearch = !searchTerm || 
      prompt.title.toLowerCase().includes(searchTerm) ||
      prompt.body.toLowerCase().includes(searchTerm) ||
      prompt.tags.some(tag => tag.toLowerCase().includes(searchTerm));
    
    const matchesSource = !sourceFilter || prompt.source === sourceFilter;
    
    return matchesSearch && matchesSource;
  });
  
  renderPromptCards(filteredPrompts);
}

// Render prompt cards
function renderPromptCards(prompts: Prompt[] = allPrompts) {
  console.log('Rendering prompt cards:', prompts.length, prompts);
  console.log('promptsCards element:', promptsCards);
  
  if (!promptsCards) {
    console.error('promptsCards element not found!');
    return;
  }
  
  promptsCards.innerHTML = '';
  
  if (prompts.length === 0) {
    console.log('No prompts to render, showing empty state');
    promptsCards.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-message">No prompts found</div>
      </div>
    `;
    return;
  }
  
  console.log('Creating cards for', prompts.length, 'prompts');
  prompts.forEach((prompt, index) => {
    console.log(`Creating card ${index + 1}:`, prompt.title);
    const card = createPromptCard(prompt);
    promptsCards.appendChild(card);
  });
  
  console.log('Cards rendered, total children:', promptsCards.children.length);
}

// Create prompt card element
function createPromptCard(prompt: Prompt): HTMLElement {
  const card = document.createElement('div');
  card.className = `prompt-card ${prompt.id === currentPrompt?.id ? 'selected' : ''}`;
  card.setAttribute('data-prompt-id', prompt.id);
  
  card.innerHTML = `
    <div class="prompt-card-header">
      <div class="prompt-card-title">${escapeHtml(prompt.title)}</div>
      <span class="prompt-card-source ${prompt.source}">${prompt.source}</span>
    </div>
    <div class="prompt-card-content">${escapeHtml(prompt.body.substring(0, 150))}${prompt.body.length > 150 ? '...' : ''}</div>
    <div class="prompt-card-tags">
      ${prompt.tags.map(tag => `<span class="prompt-card-tag">${escapeHtml(tag)}</span>`).join('')}
    </div>
    <div class="prompt-card-meta">
      <span>${prompt.favorite ? '⭐' : ''} ${prompt.hidden ? '👁️' : ''}</span>
      <span>${new Date(prompt.updatedAt).toLocaleDateString()}</span>
    </div>
  `;
  
  // Add click handler
  card.addEventListener('click', () => {
    promptSelect.value = prompt.id;
    onPromptSelectChange();
    
    // Update card selection
    document.querySelectorAll('.prompt-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  });
  
  return card;
}

// Export prompts to JSON file
async function exportPrompts() {
  try {
    const prompts = await listPrompts();
    const exportData = {
      schemaVersion: '1.0.0',
      timestamp: new Date().toISOString(),
      prompts: prompts.filter(p => p.source === 'user') // Only export user prompts
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-library-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Export completed successfully', 'success');
  } catch (error) {
    console.error('Export failed:', error);
    showToast('Export failed', 'error');
  }
}

// Handle import file selection
async function handleImport(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const importData = JSON.parse(text);
    
    if (!importData.prompts || !Array.isArray(importData.prompts)) {
      throw new Error('Invalid import file format');
    }
    
    // Perform merge
    await mergePrompts(importData.prompts);
    
    showToast('Import completed successfully', 'success');
  } catch (error) {
    console.error('Import failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    showToast(`Import failed: ${errorMessage}`, 'error');
  } finally {
    // Reset file input
    target.value = '';
  }
}

// Merge prompts with conflict resolution
async function mergePrompts(importedPrompts: Prompt[]) {
  const existingPrompts = await listPrompts();
  const existingMap = new Map(existingPrompts.map(p => [p.id, p]));
  
  let added = 0;
  let updated = 0;
  let skipped = 0;
  
  for (const imported of importedPrompts) {
    const existing = existingMap.get(imported.id);
    
    if (!existing) {
      // New prompt
      await putPrompt(imported);
      added++;
    } else if (existing.source === 'seed') {
      // Never modify seed prompts
      skipped++;
    } else if (new Date(imported.updatedAt) > new Date(existing.updatedAt)) {
      // Imported is newer
      await putPrompt(imported);
      updated++;
    } else {
      // Existing is newer or same
      skipped++;
    }
  }
  
  showToast(`Merge completed: ${added} added, ${updated} updated, ${skipped} skipped`, 'info');
  
  // Reload prompts
  await loadPrompts();
}



// Show toast notification
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
      <button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
    <div class="toast-message">${message}</div>
  `;
  
  toastContainer.appendChild(toast);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 5000);
}

// Utility functions
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);


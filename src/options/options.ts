import { openDb, listPrompts, putPrompt, putMeta, getMeta, deletePrompt, getAnalytics, toggleFavorite, toggleHidden, restorePrompt } from '../lib/db.js';
import type { Prompt } from '../lib/schema.js';

// DOM elements
const exportButton = document.getElementById('btn-export') as HTMLButtonElement;
const importButton = document.getElementById('btn-import') as HTMLButtonElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;
const recyclePurgeDays = document.getElementById('recycle-purge-days') as HTMLSelectElement;
const toastContainer = document.getElementById('toast-container') as HTMLDivElement;

// Analytics elements
const totalUsed = document.getElementById('total-used') as HTMLSpanElement;
const topPromptsList = document.getElementById('top-prompts-list') as HTMLDivElement;

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

// Collapsible section elements
const hiddenToggle = document.getElementById('hidden-toggle') as HTMLDivElement;
const hiddenContent = document.getElementById('hidden-content') as HTMLDivElement;
const hiddenPromptsCards = document.getElementById('hidden-prompts-cards') as HTMLDivElement;
const deletedToggle = document.getElementById('deleted-toggle') as HTMLDivElement;
const deletedContent = document.getElementById('deleted-content') as HTMLDivElement;
const deletedPromptsCards = document.getElementById('deleted-prompts-cards') as HTMLDivElement;

// State
let currentPrompt: Prompt | null = null;
let allPrompts: Prompt[] = [];
let currentTags: string[] = [];
let isEditing = false;

// Initialize
async function init() {
  try {
    await loadSettings();
    await refreshPrompts();
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
        await chrome.runtime.sendMessage({ type: "starter:ensure" });
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
      showToast('No prompts found. Try reloading starter prompts.', 'info');
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

// Refresh prompts and analytics
async function refreshPrompts() {
  await loadPrompts();
  await loadAnalytics();
}

// Load analytics data
async function loadAnalytics() {
  try {
    const analytics = await getAnalytics();
    
    // Update total used counter
    if (totalUsed) {
      totalUsed.textContent = analytics.totalPromptsUsed.toString();
    }
    
    // Update top prompts list
    if (topPromptsList) {
      if (analytics.topUsedPrompts.length === 0) {
        topPromptsList.innerHTML = '<div class="empty-analytics">No prompts used yet</div>';
      } else {
        // Get prompt titles for the top used prompts
        const topPromptsWithTitles = await Promise.all(
          analytics.topUsedPrompts.map(async (usage) => {
            const prompt = allPrompts.find(p => p.id === usage.promptId);
            return {
              ...usage,
              title: prompt?.title || 'Unknown Prompt'
            };
          })
        );
        
        // Render the top prompts list
        topPromptsList.innerHTML = topPromptsWithTitles
          .map((prompt, index) => `
            <div class="prompt-usage-item">
              <span class="prompt-usage-title">${index + 1}. ${escapeHtml(prompt.title)}</span>
              <span class="prompt-usage-count">${prompt.usageCount} uses</span>
            </div>
          `)
          .join('');
      }
    }
  } catch (error) {
    console.error('Failed to load analytics:', error);
    if (topPromptsList) {
      topPromptsList.innerHTML = '<div class="empty-analytics">Failed to load analytics</div>';
    }
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
  const starterPrompts = allPrompts.filter(p => p.source === 'starter');
  const userPrompts = allPrompts.filter(p => p.source === 'user');
  
  if (starterPrompts.length > 0) {
    const starterGroup = document.createElement('optgroup');
    starterGroup.label = 'Starter Prompts';
    starterPrompts.forEach(prompt => {
      const option = document.createElement('option');
      option.value = prompt.id;
      option.textContent = prompt.title;
      starterGroup.appendChild(option);
    });
    promptSelect.appendChild(starterGroup);
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
  
  // Meta Prompt
  const metaPromptButton = document.getElementById('btn-meta-prompt') as HTMLButtonElement;
  
  if (metaPromptButton) {
    metaPromptButton.addEventListener('click', copyMetaPrompt);
  }
  
  // Other settings
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
  
  // Collapsible sections
  hiddenToggle.addEventListener('click', () => toggleSection(hiddenToggle, hiddenContent));
  deletedToggle.addEventListener('click', () => toggleSection(deletedToggle, deletedContent));
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

// Toggle section visibility
function toggleSection(toggle: HTMLElement, content: HTMLElement) {
  const isExpanded = toggle.classList.contains('expanded');
  if (isExpanded) {
    toggle.classList.remove('expanded');
    content.classList.remove('expanded');
  } else {
    toggle.classList.add('expanded');
    content.classList.add('expanded');
  }
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
      <button class="tag-remove">×</button>
    `;
    
    // Add event listener for the remove button
    const removeBtn = tagElement.querySelector('.tag-remove') as HTMLButtonElement;
    removeBtn.addEventListener('click', () => removeTag(tag));
    
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
    savePromptButton.disabled = currentPrompt.source === 'starter';
    deletePromptButton.disabled = currentPrompt.source === 'starter';
    promptTitle.readOnly = currentPrompt.source === 'starter';
    promptBody.readOnly = currentPrompt.source === 'starter';
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
    if (currentPrompt.source === 'starter') {
      showToast('Starter prompts cannot be edited', 'error');
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
    await refreshPrompts();
    
    // Update selection if this was a new prompt
    if (!currentPrompt) {
      promptSelect.value = prompt.id;
      currentPrompt = prompt;
    }
    
    showToast('Prompt saved successfully', 'success');
    updateEditorButtons();
    
    // Notify sidebar to refresh
    chrome.runtime.sendMessage({ type: "prompts:updated" });
  } catch (error) {
    console.error('Failed to save prompt:', error);
    showToast('Failed to save prompt', 'error');
  }
}

// Delete current prompt
async function deleteCurrentPrompt() {
  if (!currentPrompt) return;
  
  if (currentPrompt.source === 'starter') {
    showToast('Starter prompts cannot be deleted', 'error');
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
    promptSelect.value = '';
    promptSourceBadge.textContent = '';
    promptSourceBadge.className = 'source-badge';
    updateEditorButtons();
    showToast('Prompt deleted successfully', 'success');
    
    // Notify sidebar to refresh
    chrome.runtime.sendMessage({ type: "prompts:updated" });
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
  
  // Separate prompts by status
  const activePrompts = prompts.filter(p => !p.hidden && !p.deletedAt);
  const hiddenPrompts = prompts.filter(p => p.hidden && !p.deletedAt);
  const deletedPrompts = prompts.filter(p => p.deletedAt);
  
  // Sort active prompts by priority: favorites first, then by usage count and alphabetical
  const sortedActivePrompts = sortPromptsByPriority(activePrompts);
  
  // Render active prompts
  promptsCards.innerHTML = '';
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
  
  // Render hidden prompts
  if (hiddenPromptsCards) {
    hiddenPromptsCards.innerHTML = '';
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
  
  // Render deleted prompts
  if (deletedPromptsCards) {
    deletedPromptsCards.innerHTML = '';
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
  
  console.log('Cards rendered - Active:', sortedActivePrompts.length, 'Hidden:', hiddenPrompts.length, 'Deleted:', deletedPrompts.length);
}

// Create prompt card element
function createPromptCard(prompt: Prompt): HTMLElement {
  const card = document.createElement('div');
  card.className = `prompt-card ${prompt.id === currentPrompt?.id ? 'selected' : ''} ${prompt.favorite ? 'favorite' : ''}`;
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
    <div class="prompt-card-actions">
      ${!prompt.hidden && !prompt.deletedAt ? 
        `<button class="action-btn favorite-btn" title="${prompt.favorite ? 'Remove from favorites' : 'Add to favorites'}">
          <img src="../assets/icons/fav-${prompt.favorite ? 'f' : 's'}32.png" alt="Favorite" width="16" height="16">
        </button>` : ''
      }
      ${!prompt.hidden && !prompt.deletedAt ? 
        `<button class="action-btn clone-btn" title="Clone prompt">
          <img src="../assets/icons/clone32.png" alt="Clone" width="16" height="16">
        </button>` : ''
      }
      ${!prompt.deletedAt ? 
        `<button class="action-btn hide-btn" title="${prompt.hidden ? 'Show prompt' : 'Hide prompt'}">
          <img src="../assets/icons/${prompt.hidden ? 'visible' : 'hide'}32.png" alt="${prompt.hidden ? 'Show' : 'Hide'}" width="16" height="16">
        </button>` : ''
      }
      ${prompt.deletedAt ? 
        `<button class="action-btn restore-btn" title="Restore prompt">
          <img src="../assets/icons/restore32.png" alt="Restore" width="16" height="16">
        </button>` : 
        prompt.source === 'starter' ? '' :
        `<button class="action-btn delete-btn" title="Delete prompt">
          <img src="../assets/icons/delete32.png" alt="Delete" width="16" height="16">
        </button>`
      }
    </div>
  `;
  
  // Add click handler for card selection
  card.addEventListener('click', (e) => {
    // Don't trigger selection if clicking on action buttons
    if ((e.target as HTMLElement).closest('.action-btn')) {
      return;
    }
    
    promptSelect.value = prompt.id;
    onPromptSelectChange();
    
    // Update card selection
    document.querySelectorAll('.prompt-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  });

  // Add event listeners for action buttons (only for buttons that exist)
  const favoriteBtn = card.querySelector('.favorite-btn') as HTMLButtonElement;
  const cloneBtn = card.querySelector('.clone-btn') as HTMLButtonElement;
  const hideBtn = card.querySelector('.hide-btn') as HTMLButtonElement;
  const deleteBtn = card.querySelector('.delete-btn') as HTMLButtonElement;
  const restoreBtn = card.querySelector('.restore-btn') as HTMLButtonElement;

  // Only add favorite listener for active prompts
  if (favoriteBtn && !prompt.hidden && !prompt.deletedAt) {
    favoriteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await toggleFavorite(prompt.id);
        await refreshPrompts();
        // Notify sidebar to refresh
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
        showToast('Failed to update favorite status', 'error');
      }
    });
  }

  // Only add clone listener for active prompts
  if (cloneBtn && !prompt.hidden && !prompt.deletedAt) {
    cloneBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        // Create a clone of the prompt
        const clonedPrompt: Prompt = {
          ...prompt,
          id: crypto.randomUUID(),
          title: `${prompt.title} (Copy)`,
          source: 'user' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          favorite: false,
          hidden: false,
          deletedAt: undefined
        };
        
        await putPrompt(clonedPrompt);
        await refreshPrompts();
        showToast('Prompt cloned successfully', 'success');
        // Notify sidebar to refresh
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error('Failed to clone prompt:', error);
        showToast('Failed to clone prompt', 'error');
      }
    });
  }

  // Only add hide listener for non-deleted prompts
  if (hideBtn && !prompt.deletedAt) {
    hideBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await toggleHidden(prompt.id);
        await refreshPrompts();
        // Notify sidebar to refresh
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error('Failed to toggle hidden status:', error);
        showToast('Failed to update hidden status', 'error');
      }
    });
  }

  // Only add delete listener for non-deleted prompts
  if (deleteBtn && !prompt.deletedAt) {
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete "${prompt.title}"?`)) {
        try {
          await deletePrompt(prompt.id);
          await refreshPrompts();
          showToast('Prompt deleted successfully', 'success');
          // Notify sidebar to refresh
          chrome.runtime.sendMessage({ type: "prompts:updated" });
        } catch (error) {
          console.error('Failed to delete prompt:', error);
          showToast('Failed to delete prompt', 'error');
        }
      }
    });
  }

  // Only add restore listener for deleted prompts
  if (restoreBtn && prompt.deletedAt) {
    restoreBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await restorePrompt(prompt.id);
        await refreshPrompts();
        showToast('Prompt restored successfully', 'success');
        // Notify sidebar to refresh
        chrome.runtime.sendMessage({ type: "prompts:updated" });
      } catch (error) {
        console.error('Failed to restore prompt:', error);
        showToast('Failed to restore prompt', 'error');
      }
    });
  }
  
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



// Copy meta prompt to clipboard
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
    showToast('Meta prompt copied to clipboard', 'success');
  } catch (error) {
    console.error('Failed to copy meta prompt:', error);
    showToast('Failed to copy meta prompt', 'error');
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
    } else if (existing.source === 'starter') {
      // Never modify starter prompts
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
    
    // Notify sidebar to refresh
    chrome.runtime.sendMessage({ type: "prompts:updated" });
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

// Consistent sorting function for all prompt lists
function sortPromptsByPriority(prompts: Prompt[]): Prompt[] {
  return [...prompts].sort((a, b) => {
    // First: sort by favorite status (favorites come first)
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    
    // Within the same favorite status, sort by usage count then alphabetical
    // Since the database already provides this order, we maintain it
    // This ensures consistent sorting across all sections
    return 0; // Maintain database order within each favorite group
  });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);



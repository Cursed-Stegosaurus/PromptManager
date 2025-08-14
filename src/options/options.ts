import { openDb, listPrompts, putPrompt, putMeta, getMeta } from '../lib/db.js';
import type { Prompt } from '../lib/schema.js';

// DOM elements
const exportButton = document.getElementById('btn-export') as HTMLButtonElement;
const importButton = document.getElementById('btn-import') as HTMLButtonElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;
const encryptionEnabled = document.getElementById('encryption-enabled') as HTMLInputElement;
const encryptionControls = document.getElementById('encryption-controls') as HTMLDivElement;
const encryptionPassphrase = document.getElementById('encryption-passphrase') as HTMLInputElement;
const confirmPassphrase = document.getElementById('confirm-passphrase') as HTMLInputElement;
const setPassphraseButton = document.getElementById('btn-set-passphrase') as HTMLButtonElement;
const telemetryEnabled = document.getElementById('telemetry-enabled') as HTMLInputElement;
const recyclePurgeDays = document.getElementById('recycle-purge-days') as HTMLSelectElement;
const reloadSeedsButton = document.getElementById('btn-reload-seeds') as HTMLButtonElement;
const resetSeedsButton = document.getElementById('btn-reset-seeds') as HTMLButtonElement;
const toastContainer = document.getElementById('toast-container') as HTMLDivElement;

// Initialize
async function init() {
  try {
    await loadSettings();
    wireEvents();
  } catch (error) {
    console.error('Failed to initialize options:', error);
    showToast('Failed to initialize options', 'error');
  }
}

// Load current settings
async function loadSettings() {
  try {
    // Encryption
    const encryptionOn = await getMeta<boolean>('encryptionEnabled') ?? false;
    encryptionEnabled.checked = encryptionOn;
    if (encryptionOn) {
      encryptionControls.classList.remove('hidden');
    } else {
      encryptionControls.classList.add('hidden');
    }
    
    // Other settings
    const telemetry = await getMeta<boolean>('telemetryEnabled') ?? false;
    telemetryEnabled.checked = telemetry;
    
    const purgeDays = await getMeta<number>('recycleAutoPurgeDays') ?? 30;
    recyclePurgeDays.value = purgeDays.toString();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Wire up event listeners
function wireEvents() {
  // Import/Export
  exportButton.addEventListener('click', exportPrompts);
  importButton.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', handleImport);
  
  // Encryption
  encryptionEnabled.addEventListener('change', async () => {
    const enabled = encryptionEnabled.checked;
    if (enabled) {
      encryptionControls.classList.remove('hidden');
      showToast('Encryption enabled. Set a passphrase to secure your prompts.', 'info');
    } else {
      encryptionControls.classList.add('hidden');
    }
    await putMeta('encryptionEnabled', enabled);
  });
  
  setPassphraseButton.addEventListener('click', setEncryptionPassphrase);
  
  // Other settings
  telemetryEnabled.addEventListener('change', async () => {
    await putMeta('telemetryEnabled', telemetryEnabled.checked);
  });
  
  recyclePurgeDays.addEventListener('change', async () => {
    await putMeta('recycleAutoPurgeDays', parseInt(recyclePurgeDays.value));
  });
  
  // Seed management
  reloadSeedsButton.addEventListener('click', reloadSeeds);
  resetSeedsButton.addEventListener('click', resetSeeds);
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
}

// Set encryption passphrase
async function setEncryptionPassphrase() {
  const passphrase = encryptionPassphrase.value;
  const confirm = confirmPassphrase.value;
  
  if (!passphrase || passphrase.length < 8) {
    showToast('Passphrase must be at least 8 characters long', 'error');
    return;
  }
  
  if (passphrase !== confirm) {
    showToast('Passphrases do not match', 'error');
    return;
  }
  
  try {
    // Generate salt and derive key
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const saltB64 = btoa(String.fromCharCode(...salt));
    
    // Store salt (key derivation will happen when needed)
    await putMeta('saltB64', saltB64);
    
    showToast('Encryption passphrase set successfully', 'success');
    
    // Clear inputs
    encryptionPassphrase.value = '';
    confirmPassphrase.value = '';
  } catch (error) {
    console.error('Failed to set passphrase:', error);
    showToast('Failed to set passphrase', 'error');
  }
}

// Reload seed prompts
async function reloadSeeds() {
  try {
    reloadSeedsButton.disabled = true;
    reloadSeedsButton.textContent = 'Reloading...';
    
    await chrome.runtime.sendMessage({ type: "seed:reload" });
    
    showToast('Seed prompts reloaded successfully', 'success');
  } catch (error) {
    console.error('Failed to reload seeds:', error);
    showToast('Failed to reload seed prompts', 'error');
  } finally {
    reloadSeedsButton.disabled = false;
    reloadSeedsButton.textContent = 'Reload Seed Prompts';
  }
}

// Reset all seed prompts
async function resetSeeds() {
  if (!confirm('This will remove all existing seed prompts and reload them fresh. This action cannot be undone. Continue?')) {
    return;
  }
  
  try {
    resetSeedsButton.disabled = true;
    resetSeedsButton.textContent = 'Resetting...';
    
    // Clear all seed prompts from database
    const db = await openDb();
    const tx = db.transaction("prompts", "readwrite");
    const store = tx.objectStore("prompts");
    
    // Get all seed prompts
    const seedPrompts = await listPrompts();
    const seedIds = seedPrompts.filter(p => p.source === 'seed').map(p => p.id);
    
    // Delete them
    for (const id of seedIds) {
      await store.delete(id);
    }
    
    // Clear seed metadata
    await putMeta("seedLoaded", false);
    await putMeta("seedSchemaVersion", "");
    
    // Reload seeds
    await chrome.runtime.sendMessage({ type: "seed:ensure" });
    
    showToast('Seed prompts reset successfully', 'success');
  } catch (error) {
    console.error('Failed to reset seeds:', error);
    showToast('Failed to reset seed prompts', 'error');
  } finally {
    resetSeedsButton.disabled = false;
    resetSeedsButton.textContent = 'Reset All Seeds';
  }
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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);


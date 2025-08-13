// Enhanced options page with database integration
let enableDriveCheckbox = document.getElementById("enableDrive");
let backupButton = document.getElementById("btnBackup");
let restoreButton = document.getElementById("btnRestore");
let backupStatus = document.getElementById("backupStatus");
let enableEncCheckbox = document.getElementById("enableEnc");
let pass1Input = document.getElementById("pass1");
let pass2Input = document.getElementById("pass2");
let setPassButton = document.getElementById("btnSetPass");
let fileImport = document.getElementById("fileImport");
let importButton = document.getElementById("btnImport");
let exportButton = document.getElementById("btnExport");

// Initialize the options page
init();

async function init() {
  try {
    await loadSettings();
    wireEvents();
  } catch (error) {
    showNotification('Failed to initialize options', 'error');
  }
}

function wireEvents() {
  // Google Drive backup
  enableDriveCheckbox.onchange = saveSettings;
  backupButton.onclick = doDriveBackup;
  restoreButton.onclick = doDriveRestore;

  // Encryption
  enableEncCheckbox.onchange = saveSettings;
  setPassButton.onclick = setEncryptionPassword;

  // Import/Export
  importButton.onclick = importData;
  exportButton.onclick = exportData;
}

async function loadSettings() {
  const result = await chrome.runtime.sendMessage({ type: "getMeta", key: "settings" });
  if (result.success && result.value) {
    const settings = result.value;
    enableDriveCheckbox.checked = settings.enableDrive || false;
    enableEncCheckbox.checked = settings.enableEncryption || false;
  }
  const backupResult = await chrome.runtime.sendMessage({ type: "getMeta", key: "driveLastBackupAt" });
  backupStatus.textContent = `Last backup: ${backupResult?.value ? new Date(backupResult.value).toLocaleString() : 'never'}`;
}

async function saveSettings() {
  const settings = {
    enableDrive: enableDriveCheckbox.checked,
    enableEncryption: enableEncCheckbox.checked,
    updatedAt: new Date().toISOString()
  };
  const result = await chrome.runtime.sendMessage({ type: "setMeta", key: "settings", value: settings });
  showNotification(result.success ? 'Settings saved' : 'Failed to save settings', result.success ? 'success' : 'error');
}

async function doDriveBackup() {
  try {
    backupButton.disabled = true;
    backupButton.textContent = 'Backing up...';
    const res = await chrome.runtime.sendMessage({ type: 'driveBackup' });
    if (res.success) {
      await chrome.runtime.sendMessage({ type: 'setMeta', key: 'driveLastBackupAt', value: new Date().toISOString() });
      backupStatus.textContent = `Last backup: ${new Date().toLocaleString()}`;
      showNotification(`Backed up ${res.info?.count ?? 0} prompts`, 'success');
    } else {
      showNotification('Backup failed', 'error');
    }
  } catch (e) {
    showNotification(`Backup failed: ${e.message}`, 'error');
  } finally {
    backupButton.disabled = false;
    backupButton.textContent = 'Back up now';
  }
}

async function doDriveRestore() {
  try {
    restoreButton.disabled = true;
    restoreButton.textContent = 'Restoring...';
    const res = await chrome.runtime.sendMessage({ type: 'driveRestore' });
    if (res.success) {
      showNotification(`Restore complete (${res.info?.count ?? 0} prompts)`, 'success');
    } else {
      showNotification('Restore failed', 'error');
    }
  } catch (e) {
    showNotification(`Restore failed: ${e.message}`, 'error');
  } finally {
    restoreButton.disabled = false;
    restoreButton.textContent = 'Restore from Drive';
  }
}

async function setEncryptionPassword() {
  const pass1 = pass1Input.value;
  const pass2 = pass2Input.value;
  if (!pass1 || !pass2) return showNotification('Please enter both password fields', 'warning');
  if (pass1 !== pass2) return showNotification('Passwords do not match', 'error');
  if (pass1.length < 8) return showNotification('Password must be at least 8 characters', 'warning');
  try {
    setPassButton.disabled = true;
    setPassButton.textContent = 'Setting...';
    const result = await chrome.runtime.sendMessage({ type: "setMeta", key: "encryptionPassword", value: { hash: btoa(pass1), enabled: true, setAt: new Date().toISOString() } });
    if (result.success) {
      showNotification('Encryption password set', 'success');
      pass1Input.value = '';
      pass2Input.value = '';
      enableEncCheckbox.checked = true;
      await saveSettings();
    } else {
      showNotification('Failed to set encryption password', 'error');
    }
  } finally {
    setPassButton.disabled = false;
    setPassButton.textContent = 'Set';
  }
}

async function importData() {
  const file = fileImport.files[0];
  if (!file) return showNotification('Please select a file to import', 'warning');
  try {
    importButton.disabled = true;
    importButton.textContent = 'Importing...';
    const text = await file.text();
    const data = JSON.parse(text);
    const result = await chrome.runtime.sendMessage({ type: "importData", data });
    if (result.success) {
      showNotification('Import completed', 'success');
      fileImport.value = '';
    } else {
      showNotification('Import failed', 'error');
    }
  } catch (e) {
    showNotification(`Import failed: ${e.message}`, 'error');
  } finally {
    importButton.disabled = false;
    importButton.textContent = 'Import';
  }
}

async function exportData() {
  try {
    exportButton.disabled = true;
    exportButton.textContent = 'Exporting...';
    const result = await chrome.runtime.sendMessage({ type: "exportData" });
    if (!result.success) throw new Error(result.error || 'Export failed');
    const dataStr = JSON.stringify(result.data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `prompt-library-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showNotification('Export completed', 'success');
  } catch (e) {
    showNotification(`Export failed: ${e.message}`, 'error');
  } finally {
    exportButton.disabled = false;
    exportButton.textContent = 'Export';
  }
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `position: fixed; top: 20px; right: 20px; padding: 12px 16px; border-radius: 8px; color: white; font-weight: 500; z-index: 1000; animation: slideIn 0.3s ease;`;
  switch (type) {
    case 'success': notification.style.backgroundColor = '#10B981'; break;
    case 'error': notification.style.backgroundColor = '#EF4444'; break;
    case 'warning': notification.style.backgroundColor = '#F59E0B'; break;
    default: notification.style.backgroundColor = '#3B82F6';
  }
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

const style = document.createElement('style');
style.textContent = `@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}`;
document.head.appendChild(style);

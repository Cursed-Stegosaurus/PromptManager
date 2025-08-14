// Enhanced background script for Prompt Library with database integration
console.log('Prompt Library enhanced background script loaded');

// Import database module
importScripts('db-working.js');

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed:', details.reason);
  
  try {
    // Create context menu
    chrome.contextMenus.create({
      id: 'insert-last',
      title: 'Insert last prompt',
      contexts: ['editable']
    });
    
    // Set up daily purge alarm
    chrome.alarms.create('purge', { periodInMinutes: 60 * 24 });
    
    // Load seed prompts if this is a fresh install
    if (details.reason === 'install') {
      await loadSeedPrompts();
    }
    
    console.log('Extension initialized successfully');
  } catch (error) {
    console.error('Initialization error:', error);
  }
});

// Handle action button click
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Action clicked for tab:', tab.id);
  
  if (tab?.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log('Side panel opened successfully');
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'insert-last' && tab?.id) {
    console.log('Insert last prompt requested');
    try {
      // Get last used prompt ID from database
      const lastId = await promptDB.getMeta('lastUsedPromptId');
      
      if (lastId) {
        // Get the prompt from database
        const prompt = await promptDB.getPrompt(lastId);
        
        if (prompt) {
          await insertIntoTab(tab.id, prompt.body);
        }
      }
    } catch (error) {
      console.error('Failed to insert prompt:', error);
    }
  }
});

// Handle alarms (daily purge)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'purge') {
    console.log('Running daily purge');
    try {
      const purgedCount = await promptDB.purgeDeletedPrompts();
      console.log(`Purged ${purgedCount} old prompts`);
    } catch (error) {
      console.error('Purge failed:', error);
    }
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message);
  
  if (message.type === 'ping') {
    sendResponse({ status: 'ok' });
  } else if (message.type === 'insert') {
    // Handle insert request
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      if (tabs[0]?.id) {
        try {
          await insertIntoTab(tabs[0].id, message.text);
          sendResponse({ success: true });
        } catch (error) {
          console.error('Insert failed:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
    });
    return true; // Keep message channel open
  } else if (message.type === 'getPrompts') {
    // Handle get prompts request
    (async () => {
      try {
        const prompts = await promptDB.searchPrompts(message.query, message.filters);
        sendResponse({ success: true, prompts });
      } catch (error) {
        console.error('Get prompts failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.type === 'addPrompt') {
    // Handle add prompt request
    (async () => {
      try {
        const prompt = await promptDB.addPrompt(message.prompt);
        sendResponse({ success: true, prompt });
      } catch (error) {
        console.error('Add prompt failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.type === 'updatePrompt') {
    // Handle update prompt request
    (async () => {
      try {
        const prompt = await promptDB.updatePrompt(message.id, message.updates);
        sendResponse({ success: true, prompt });
      } catch (error) {
        console.error('Update prompt failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.type === 'deletePrompt') {
    // Handle delete prompt request
    (async () => {
      try {
        await promptDB.deletePrompt(message.id, message.softDelete);
        sendResponse({ success: true });
      } catch (error) {
        console.error('Delete prompt failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.type === 'exportData') {
    // Handle export request
    (async () => {
      try {
        const data = await promptDB.exportData();
        sendResponse({ success: true, data });
      } catch (error) {
        console.error('Export failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (message.type === 'importData') {
    // Handle import request
    (async () => {
      try {
        await promptDB.importData(message.data);
        sendResponse({ success: true });
      } catch (error) {
        console.error('Import failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

// Insert text into active tab
async function insertIntoTab(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (textToInsert) => {
        // Try to insert into active element
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.value !== undefined || activeElement.isContentEditable)) {
          if (activeElement.value !== undefined) {
            // Input/textarea
            const start = activeElement.selectionStart || 0;
            const end = activeElement.selectionEnd || 0;
            activeElement.setRangeText(textToInsert, start, end, 'end');
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            // ContentEditable
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              range.insertNode(document.createTextNode(textToInsert));
            }
          }
          return true;
        }
        return false;
      },
      args: [text]
    });
  } catch (error) {
    console.error('Script execution failed:', error);
    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(text);
      console.log('Text copied to clipboard as fallback');
    } catch (clipboardError) {
      console.error('Clipboard fallback failed:', clipboardError);
    }
  }
}

// Load seed prompts for new installations
async function loadSeedPrompts() {
  try {
    const seedPrompts = [
      {
        title: 'Sales Follow-up',
        body: 'Hi {{name}}, I wanted to follow up on our conversation about {{product}}. When would be a good time to discuss this further?',
        tags: ['sales', 'follow-up', 'email'],
        category: 'sales',
        favorite: true
      },
      {
        title: 'Engineering Code Review',
        body: 'Please review this code for:\n- Performance considerations\n- Security implications\n- Code quality and maintainability\n- Test coverage',
        tags: ['engineering', 'code-review', 'development'],
        category: 'engineering',
        favorite: true
      },
      {
        title: 'Finance Report Request',
        body: 'Could you please provide a {{report_type}} report for {{time_period}}? I need this by {{deadline}} for {{purpose}}.',
        tags: ['finance', 'report', 'request'],
        category: 'finance',
        favorite: false
      }
    ];

    for (const seedPrompt of seedPrompts) {
      await promptDB.addPrompt(seedPrompt);
    }

    console.log('Seed prompts loaded successfully');
  } catch (error) {
    console.error('Failed to load seed prompts:', error);
  }
}

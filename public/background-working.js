// Working background script for Prompt Library
console.log('Prompt Library background script loaded');

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason);
  
  // Create context menu
  try {
    chrome.contextMenus.create({
      id: 'insert-last',
      title: 'Insert last prompt',
      contexts: ['editable']
    });
  } catch (error) {
    console.log('Context menu creation failed:', error);
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
    // For now, just log - we'll add the actual functionality later
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message);
  
  if (message.type === 'ping') {
    sendResponse({ status: 'ok' });
  }
  
  return true; // Keep message channel open for async response
});

// Simple test background script
console.log('Background script loaded successfully');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  console.log('Action clicked');
  if (tab?.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

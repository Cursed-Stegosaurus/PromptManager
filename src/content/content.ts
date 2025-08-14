// Content script for prompt insertion
// This script runs in the context of web pages

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "insert") {
    const success = insertText(message.text);
    sendResponse({ success });
  }
});

// Function to insert text into the focused element
function insertText(text: string): boolean {
  const activeElement = document.activeElement as HTMLElement;
  if (!activeElement) return false;

  // Try to insert into the active element
  if (tryInsertIntoElement(activeElement, text)) {
    return true;
  }

  // Try to find a suitable input field
  const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], textarea, [contenteditable="true"]');
  for (const input of inputs) {
    if (tryInsertIntoElement(input as HTMLElement, text)) {
      return true;
    }
  }

  return false;
}

// Try to insert text into a specific element
function tryInsertIntoElement(element: HTMLElement, text: string): boolean {
  try {
    // Handle input elements
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;
      
      element.setRangeText(text, start, end, "end");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.focus();
      return true;
    }

    // Handle contenteditable elements
    if (element.contentEditable === "true") {
      const selection = window.getSelection();
      if (selection) {
        selection.deleteFromDocument();
        const textNode = document.createTextNode(text);
        
        if (selection.rangeCount === 0) {
          const range = document.createRange();
          range.selectNodeContents(element);
          selection.addRange(range);
        }
        
        const range = selection.getRangeAt(0);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        element.focus();
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Failed to insert text:", error);
    return false;
  }
}

// Add keyboard shortcut for quick prompt insertion
document.addEventListener("keydown", (event) => {
  // Ctrl+Shift+P for prompt insertion
  if (event.ctrlKey && event.shiftKey && event.key === "P") {
    event.preventDefault();
    
    // Request the last used prompt from the extension
    chrome.runtime.sendMessage({ type: "getLastPrompt" }, (response) => {
      if (response && response.prompt) {
        insertText(response.prompt.body);
      }
    });
  }
});

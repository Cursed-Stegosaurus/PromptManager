// src/content/content.ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "insert") {
    const success = insertText(message.text);
    sendResponse({ success });
  }
});
function insertText(text) {
  const activeElement = document.activeElement;
  if (!activeElement)
    return false;
  if (tryInsertIntoElement(activeElement, text)) {
    return true;
  }
  const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], textarea, [contenteditable="true"]');
  for (const input of inputs) {
    if (tryInsertIntoElement(input, text)) {
      return true;
    }
  }
  return false;
}
function tryInsertIntoElement(element, text) {
  try {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;
      element.setRangeText(text, start, end, "end");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.focus();
      return true;
    }
    if (element.contentEditable === "true") {
      const selection = window.getSelection();
      if (selection) {
        selection.deleteFromDocument();
        const textNode = document.createTextNode(text);
        if (selection.rangeCount === 0) {
          const range2 = document.createRange();
          range2.selectNodeContents(element);
          selection.addRange(range2);
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
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.key === "P") {
    event.preventDefault();
    chrome.runtime.sendMessage({ type: "getLastPrompt" }, (response) => {
      if (response && response.prompt) {
        insertText(response.prompt.body);
      }
    });
  }
});
//# sourceMappingURL=content.js.map

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const event = new CustomEvent('BC_SIDEBAR_TOGGLE');
        window.dispatchEvent(event);
      }
    });
  } catch (err) {
    console.error('Failed to toggle sidebar:', err);
  }
});



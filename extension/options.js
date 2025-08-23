function restore() {
  chrome.storage.sync.get(['appBaseUrl', 'jwtContext'], (result) => {
    document.getElementById('appBaseUrl').value = result.appBaseUrl || '';
    document.getElementById('jwtContext').value = result.jwtContext || '';
  });
}

function save() {
  const appBaseUrl = document.getElementById('appBaseUrl').value.trim();
  const jwtContext = document.getElementById('jwtContext').value.trim();

  chrome.storage.sync.set({ appBaseUrl, jwtContext }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Saved';
    setTimeout(() => (status.textContent = ''), 1500);
  });
}

document.getElementById('save').addEventListener('click', save);
document.addEventListener('DOMContentLoaded', restore);



(function () {
  const SIDEBAR_ID = 'bc-app-sidebar-container';
  const IFRAME_ID = 'bc-app-sidebar-iframe';

  function getStoredConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['appBaseUrl', 'jwtContext'], (result) => {
        resolve({ appBaseUrl: result.appBaseUrl, jwtContext: result.jwtContext });
      });
    });
  }

  function parseProductIdFromUrl() {
    const match = window.location.pathname.match(/\/manage\/products\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function ensureContainer() {
    let container = document.getElementById(SIDEBAR_ID);
    if (container) return container;

    container = document.createElement('div');
    container.id = SIDEBAR_ID;
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.right = '0';
    container.style.height = '100vh';
    container.style.width = '420px';
    container.style.maxWidth = '90vw';
    container.style.boxShadow = 'rgba(0, 0, 0, 0.2) 0px 0px 24px';
    container.style.zIndex = '2147483647';
    container.style.display = 'none';
    container.style.background = '#fff';
    container.style.borderLeft = '1px solid #e5e7eb';

    const iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';

    container.appendChild(iframe);
    document.body.appendChild(container);
    return container;
  }

  async function updateIframeSrc() {
    const iframe = document.getElementById(IFRAME_ID);
    if (!iframe) return;

    const { appBaseUrl, jwtContext } = await getStoredConfig();
    const productId = parseProductIdFromUrl();
    if (!appBaseUrl || !jwtContext || !productId) return;

    // Prefer the existing app extension page if available
    const url = new URL(`${appBaseUrl}/productAppExtension/${productId}`);
    url.searchParams.set('context', jwtContext);
    iframe.src = url.toString();
  }

  function isVisible() {
    const el = document.getElementById(SIDEBAR_ID);
    return !!el && el.style.display !== 'none';
  }

  function show() {
    const el = ensureContainer();
    el.style.display = 'block';
    document.documentElement.style.marginRight = '420px';
  }

  function hide() {
    const el = document.getElementById(SIDEBAR_ID);
    if (el) el.style.display = 'none';
    document.documentElement.style.marginRight = '';
  }

  async function toggle() {
    if (isVisible()) {
      hide();
    } else {
      ensureContainer();
      await updateIframeSrc();
      show();
    }
  }

  window.addEventListener('BC_SIDEBAR_TOGGLE', toggle);

  // Auto-sync when navigating between products in SPA-like UI
  const observer = new MutationObserver(() => {
    if (isVisible()) {
      updateIframeSrc();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();



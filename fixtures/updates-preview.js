// Synthetic releases and downloads. No GitHub or MAX requests.
(() => {
  const originalFetch = window.fetch.bind(window);
  const mode = new URLSearchParams(location.search).get('update') || 'available';
  window.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.github.com/')) return originalFetch(url, options);
    if (mode === 'offline') throw new Error('Synthetic offline');
    const version = '0.4.0', name = `max-archive-${version}-test.zip`;
    return { ok: true, json: async () => mode === 'current' ? [] : [{ tag_name: `v${version}`, assets: [{ name, state: 'uploaded', browser_download_url: `https://github.com/just-trust-digital/max-chat-archive/releases/download/v${version}/${name}` }] }] };
  };
  chrome.runtime.getManifest = () => ({ version: '0.3.12' });
  const originalDownload = chrome.downloads?.download;
  chrome.downloads ||= {};
  chrome.downloads.download = async options => {
    if (!options.url.startsWith('https://github.com/')) return originalDownload?.(options);
    if (mode === 'download-error') throw new Error('Synthetic disk failure');
    document.documentElement.dataset.updateDownload = options.filename;
    return 123;
  };
})();

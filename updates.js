/* Public release metadata only. Never sends MAX data or account identifiers. */
const MaxUpdates = (() => {
  const repository = 'https://github.com/just-trust-digital/max-chat-archive';
  const api = 'https://api.github.com/repos/just-trust-digital/max-chat-archive/releases?per_page=30';
  const directory = 'MAX-Archive-updates/';
  function parts(version) {
    return /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version) ? version.split('.').map(Number) : null;
  }
  function compare(a, b) {
    const left = parts(a), right = parts(b);
    if (!left || !right) return 0;
    for (let i = 0; i < 4; i++) {
      const delta = (left[i] || 0) - (right[i] || 0);
      if (delta) return Math.sign(delta);
    }
    return 0;
  }
  function select(releases, current) {
    if (!Array.isArray(releases) || !parts(current)) return null;
    const candidates = [];
    for (const release of releases) {
      if (!release || release.draft) continue;
      const version = String(release.tag_name || '').replace(/^v/, '');
      if (!parts(version) || compare(version, current) <= 0) continue;
      const name = `max-archive-${version}-test.zip`;
      const url = `${repository}/releases/download/v${version}/${name}`;
      const asset = release.assets?.find(item => item.name === name && item.state === 'uploaded' && item.browser_download_url === url);
      if (asset) candidates.push({ version, name, url });
    }
    return candidates.sort((a, b) => compare(b.version, a.version))[0] || null;
  }
  async function check() {
    const response = await fetch(api, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('GitHub недоступен');
    return select(await response.json(), chrome.runtime.getManifest().version);
  }
  async function download(release) {
    // Revalidate even cached/caller-provided metadata before using Downloads API.
    const verified = select([{ tag_name: `v${release.version}`, assets: [{ name: release.name, state: 'uploaded', browser_download_url: release.url }] }], '0.0.0');
    if (!verified) throw new Error('Некорректный адрес обновления');
    const id = await chrome.downloads.download({ url: verified.url, filename: directory + verified.name, conflictAction: 'uniquify', saveAs: false });
    if (!Number.isInteger(id)) throw new Error('Браузер не подтвердил загрузку');
    return id;
  }
  async function mount(root) {
    const panel = document.createElement('details');
    panel.className = 'update-panel';
    panel.open = true;
    panel.setAttribute('aria-label', 'Обновление расширения');
    const summary = document.createElement('summary');
    summary.textContent = 'Обновления';
    const content = document.createElement('div');
    content.className = 'update-content';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Проверяем обновления…';
    button.disabled = true;
    const status = document.createElement('div');
    status.className = 'update-status';
    status.setAttribute('role', 'status');
    content.append(button, status);
    panel.append(summary, content);
    root.insertBefore(panel, root.querySelector('.product-footer'));
    let release = null, busy = false;
    async function refresh() {
      button.disabled = true;
      try {
        release = await check();
        if (release) {
          panel.open = true;
          summary.textContent = `Обновление ${release.version}`;
          button.textContent = `Скачать версию ${release.version}`;
          status.textContent = 'Доступно обновление MAX Архив.';
        } else {
          panel.open = false;
          summary.textContent = 'Обновления';
          button.textContent = 'Проверить обновления';
          status.textContent = 'У вас установлена актуальная версия, обновление не требуется.';
        }
      } catch {
        panel.open = true;
        summary.textContent = 'Обновления';
        release = null;
        button.textContent = 'Повторить проверку';
        status.textContent = 'Не удалось проверить GitHub. Попробуйте позже.';
      } finally { button.disabled = false; }
    }
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      try {
        if (!release) await refresh();
        else {
          await download(release);
          button.textContent = 'Скачать ещё раз';
          status.textContent = 'Загрузка началась в Загрузки/MAX-Archive-updates. После завершения распакуйте ZIP в папку расширения, перезагрузите его на странице расширений и обновите MAX.';
        }
      } catch {
        status.textContent = 'Не удалось начать загрузку. Нажмите, чтобы повторить.';
      } finally { busy = false; button.disabled = false; }
    });
    await refresh();
  }
  return { compare, select, check, download, mount };
})();
if (typeof document !== 'undefined') {
  const updateRoot = document.querySelector('main');
  if (updateRoot) MaxUpdates.mount(updateRoot);
}
if (typeof module !== 'undefined') module.exports = MaxUpdates;

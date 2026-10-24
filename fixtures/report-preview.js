// Synthetic reporting preview. It never sends reports to the live intake.
(() => {
  const params = new URLSearchParams(location.search);
  const values = {};
  const id = '00000000-0000-4000-8000-000000000001';
  if (['crash', 'long', 'images', 'images-two'].includes(params.get('fixture'))) {
    const imageFixture = ['images', 'images-two'].includes(params.get('fixture'));
    const canvas = document.createElement('canvas');
    canvas.width = 440; canvas.height = 240;
    const context = canvas.getContext('2d');
    context.fillStyle = '#dbeafe'; context.fillRect(0, 0, 440, 240);
    context.fillStyle = '#17345c'; context.font = 'bold 32px Arial'; context.fillText('ТЕСТОВЫЙ СНИМОК', 22, 125);
    values.maxArchiveReports = [{ report_id: id, product: 'maxexport', kind: imageFixture ? 'problem' : 'crash',
      created_at: new Date().toISOString(), release: '0.3.20', environment: 'browser-extension',
      component: 'export', error_code: 'INTERRUPTED_EXPORT',
      text: params.get('fixture') === 'long' ? 'Синтетическое описание ошибки. '.repeat(30) : (imageFixture ? 'Пример обращения со скриншотом' : ''),
      contact: '', screenshots: imageFixture ? Array.from({ length: params.get('fixture') === 'images-two' ? 2 : 1 }, () => ({ mime: 'image/webp', data: canvas.toDataURL('image/webp').split(',')[1] })) : [],
      state: 'draft', attempts: 0, next_attempt_at: null }];
    const url = new URL(location.href);
    url.searchParams.set('draft', id);
    history.replaceState(null, '', url);
  }
  window.chrome = {
    storage: { local: {
      async get(key) { return { [key]: values[key] }; },
      async set(patch) { Object.assign(values, structuredClone(patch)); },
      async remove(key) { delete values[key]; }
    } },
    runtime: { getManifest: () => ({ version: '0.3.20' }), getURL: path => '/' + path }
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    if (String(url).startsWith('https://pult.justtrust.digital/bugs/report/')) {
      if (params.get('fixture') === 'success') return Promise.resolve(new Response(JSON.stringify({ product: 'maxexport', report_id: JSON.parse(options.body).report_id }), {status:200,headers:{'Content-Type':'application/json'}}));
      return Promise.reject(new Error('Synthetic offline preview'));
    }
    if (String(url).startsWith('https://raw.githubusercontent.com/')) return Promise.reject(new Error('Synthetic offline preview'));
    if (String(url).endsWith('known-issues.json') && params.get('fixture') === 'known-populated') {
      return Promise.resolve(new Response(JSON.stringify({ updated_at: '2026-10-23', issues: [
        { title: 'Синтетическая проверка длинного названия проблемы с экспортом вложений в группе',
          url: 'https://github.com/just-trust-digital/max-chat-archive/issues/123',
          affected: '0.3.12 и более ранние тестовые версии',
          workaround: 'Сохраните выбранный чат отдельно и проверьте результат перед удалением исходных сообщений.',
          fixed_in: '' },
        { title: 'Синтетическая проверка второго элемента',
          url: 'https://github.com/just-trust-digital/max-chat-archive/issues/124',
          affected: '0.3.11', workaround: 'Повторите экспорт.', fixed_in: '0.3.13' }
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return originalFetch(url, options);
  };
})();

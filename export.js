(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab'));
  const quick = params.get('mode') === 'quick';
  const status = $('status');
  const list = $('chat-list');
  const start = $('start');
  const cancel = $('cancel');
  const log = $('log');
  const stageProgress = $('stage-progress');
  let port, sequence = 0, pending = new Map(), chats = [], discoveryComplete = false, running = false, stopped = false, currentAbort = null;
  const defaults = { format: 'html-json', split: 'by-chat', media: true, downloadMedia: false, links: true, reactions: true, limit: 10000 };

  function note(message, error = false) { status.textContent = message; status.style.color = error ? '#b52831' : ''; }
  function stage(message, completed = null, total = null) {
    $('progress-text').textContent = message;
    stageProgress.hidden = false;
    if (total && completed != null) { stageProgress.max = total; stageProgress.value = completed; }
    else stageProgress.removeAttribute('value');
  }
  function call(type, data = {}, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject, onProgress, chunks: [] });
      port.postMessage({ type, id, ...data });
    });
  }
  function connect() {
    if (!Number.isInteger(tabId) || tabId < 1) throw new Error('Вкладка MAX не выбрана. Откройте экспорт через значок расширения.');
    port = chrome.tabs.connect(tabId, { name: 'max-export' });
    port.onMessage.addListener(message => {
      const job = pending.get(message.id);
      if (!job) return;
      if (message.type === 'progress') return job.onProgress(message.value);
      if (message.type === 'chunk') { job.chunks.push(message.messages); return; }
      pending.delete(message.id);
      if (message.type === 'error') job.reject(new Error(message.error));
      else job.resolve(message.value?.messages ? { ...message.value, messages: job.chunks.flat() } : message.value);
    });
    port.onDisconnect.addListener(() => {
      for (const job of pending.values()) job.reject(new Error('Связь с MAX потеряна. Не закрывайте и не обновляйте вкладку во время экспорта.'));
      pending.clear(); port = null; note('Связь с вкладкой MAX потеряна.', true);
    });
  }
  function scope() { return document.querySelector('input[name="scope"]:checked').value; }
  function options() {
    const value = {
      format: $('format').value,
      split: $('split').value,
      from: $('from').value, to: $('to').value,
      media: $('media').checked, downloadMedia: $('download-media').checked,
      links: $('links').checked, reactions: $('reactions').checked,
      limit: Number($('limit').value)
    };
    if (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100000) throw new Error('Укажите максимум от 1 до 100 000 сообщений.');
    if (value.from && value.to && value.from > value.to) throw new Error('Начальная дата позже конечной.');
    return value;
  }
  function selection() {
    if (scope() === 'current') return [null];
    if (scope() === 'all') return chats;
    const keys = new Set([...list.querySelectorAll('input:checked')].map(input => input.value));
    return chats.filter(chat => keys.has(chat.key));
  }
  function updateSelection() {
    const count = selection().length;
    $('selection-count').textContent = scope() === 'current' ? 'Открытый чат' : `${count} чатов`;
    list.querySelectorAll('input').forEach(input => { input.disabled = scope() !== 'selected' || running; });
  }
  function renderChats() {
    list.replaceChildren();
    if (!chats.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Чаты пока не найдены'; list.append(empty); }
    chats.forEach((chat, index) => {
      const label = document.createElement('label'); label.className = 'chat-row';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = chat.key; input.checked = true;
      input.addEventListener('change', updateSelection);
      const title = document.createElement('span'); title.textContent = chat.title;
      const number = document.createElement('small'); number.textContent = String(index + 1);
      label.append(input, title, number); list.append(label);
    });
    updateSelection();
  }
  async function refresh() {
    if (running) return;
    $('refresh').disabled = true;
    note('Ищем чаты в текущей папке MAX…');
    try { const result = await call('discover'); chats = result.chats; discoveryComplete = result.complete; renderChats(); note(`Найдено чатов: ${chats.length}.${discoveryComplete ? '' : ' Список загружен не полностью.'}`); }
    catch (error) { note(error.message, true); }
    finally { $('refresh').disabled = false; }
  }
  function filename(index, chat) { return `${String(index + 1).padStart(3, '0')}-${ArchiveFormat.safeName(chat.title)}`; }
  async function readLimited(response, controller, limit) {
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > limit) throw new Error('Файл больше 25 МБ');
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { controller.abort(); throw new Error('Файл больше 25 МБ'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  async function downloadMedia(zip, chat, path, report, initialBytes, onProgress) {
    let total = initialBytes;
    const used = new Map();
    const entries = [...new Map(chat.messages.flatMap(message => message.attachments).filter(attachment => attachment.downloadable && attachment.url).map(attachment => [attachment.url, attachment])).values()];
    let completed = 0;
    onProgress(completed, entries.length);
    for (const attachment of entries) {
      if (stopped) break;
      if (!attachment.downloadable || !attachment.url || used.has(attachment.url)) continue;
      let timer;
      try {
        const url = new URL(attachment.url);
        if (url.protocol !== 'https:' || !(url.hostname === 'max.ru' || url.hostname.endsWith('.max.ru'))) throw new Error('Адрес вне доменов MAX');
        if (total >= 250 * 1024 * 1024) throw new Error('Лимит архива');
        const controller = new AbortController(); currentAbort = controller;
        timer = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(url.href, { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const size = Number(response.headers.get('content-length'));
        if (size > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ');
        const bytes = await readLimited(response, controller, 25 * 1024 * 1024);
        if (bytes.length > 25 * 1024 * 1024 || total + bytes.length > 250 * 1024 * 1024) throw new Error('Превышен лимит размера');
        let name = ArchiveFormat.safeName(attachment.name || decodeURIComponent(url.pathname.split('/').pop()) || attachment.kind);
        if (!/\.[A-Za-z0-9]{1,6}$/.test(name)) {
          const type = response.headers.get('content-type') || '';
          const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3' }[type.split(';')[0]] || '';
          name += ext;
        }
        const localPath = `media/${String(used.size + 1).padStart(4, '0')}-${name}`;
        zip.add(`${path}/${localPath}`, bytes);
        used.set(attachment.url, localPath);
        total += bytes.length;
      } catch (error) { report.skippedMedia.push({ url: attachment.url, reason: error.name === 'AbortError' ? 'Превышено время загрузки' : error.message }); }
      finally { clearTimeout(timer); currentAbort = null; completed++; onProgress(completed, entries.length); }
    }
    for (const message of chat.messages) for (const attachment of message.attachments) {
      if (used.has(attachment.url)) attachment.localPath = used.get(attachment.url);
    }
    for (const message of chat.messages) for (const attachment of message.attachments) {
      if (attachment.source === 'download-button') report.skippedMedia.push({ name: attachment.name, reason: 'Веб-версия не показывает прямой адрес файла' });
    }
    return total;
  }
  async function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    try { await chrome.downloads.download({ url, filename, saveAs: false }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }
  async function saveZip(zip, filename) { await saveBlob(zip.blob(), filename); }
  async function run() {
    if (running) return;
    try {
      const selected = selection(), settings = options();
      if (!selected.length) throw new Error('Выберите хотя бы один чат.');
      const perChat = settings.split === 'by-chat';
      running = true; stopped = false; start.disabled = true; cancel.hidden = false;
      $('progress-panel').hidden = false; log.replaceChildren(); updateSelection();
      $('progress').max = selected.length; $('progress').value = 0;
      $('overall-text').textContent = `Обработано 0 из ${selected.length} чатов`;
      stage('Подготовка экспорта…');
      const rows = selected.map(info => {
        const item = document.createElement('li');
        item.textContent = `${info?.title || 'Открытый чат'} — в очереди`;
        log.append(item);
        return item;
      });
      await chrome.storage.local.set({ settings });
      const combinedZip = perChat ? null : new ZipArchive();
      const report = { exportedAt: new Date().toISOString(), source: 'web.max.ru', options: settings, discoveryComplete: scope() === 'current' ? null : discoveryComplete, chats: [], skippedMedia: [], errors: [], mediaBytes: 0 };
      for (let index = 0; index < selected.length; index++) {
        if (stopped) break;
        const info = selected[index];
        note(`Чат ${index + 1} из ${selected.length}: ${info?.title || 'открытый чат'}`);
        rows[index].textContent = `${info?.title || 'Открытый чат'} — чтение истории`;
        stage(`Чат ${index + 1} из ${selected.length}: чтение истории…`);
        try {
          const result = await call('export', { chat: info, options: settings }, value => {
            const phase = value.stage === 'opening' ? 'Открытие чата' : value.stage === 'waiting' ? 'MAX подготавливает историю' : value.stage === 'resolving' ? 'Получение адресов файлов' : 'Чтение истории';
            stage(`Чат ${index + 1} из ${selected.length}: ${phase}, найдено ${value.count} сообщений${value.fileCount ? `, файлов ${value.fileCount}` : ''}`);
            rows[index].textContent = `${value.title} — ${phase.toLowerCase()}, ${value.count} сообщений`;
          });
          stage(`Чат ${index + 1} из ${selected.length}: подготовка сообщений…`);
          const unknownDates = result.messages.filter(message => !ArchiveFormat.dateOf(message)).length;
          result.messages = ArchiveFormat.filter(result.messages, settings);
          const path = filename(index, result);
          const zip = perChat ? new ZipArchive() : combinedZip;
          const skippedBefore = report.skippedMedia.length;
          let chatMediaBytes = 0;
          if (settings.media && settings.downloadMedia && !stopped) {
            rows[index].textContent = `${result.title} — загрузка вложений`;
            const total = await downloadMedia(zip, result, path, report, perChat ? 0 : report.mediaBytes, (done, count) => {
              stage(`Чат ${index + 1} из ${selected.length}: вложения ${done} из ${count}`, done, count);
            });
            chatMediaBytes = perChat ? total : total - report.mediaBytes;
            report.mediaBytes += chatMediaBytes;
          }
          stage(`Чат ${index + 1} из ${selected.length}: создание ZIP…`);
          ArchiveFormat.add(zip, path, result, settings.format);
          const summary = { title: result.title, path, messages: result.messages.length, complete: result.complete, reason: result.reason, gaps: result.gaps, unknownDates };
          if (perChat) {
            zip.add('report.json', JSON.stringify({ ...report, chats: [summary], skippedMedia: report.skippedMedia.slice(skippedBefore), mediaBytes: chatMediaBytes }, null, 2));
            await saveZip(zip, `max-archive-${path}.zip`);
          }
          report.chats.push(summary);
          rows[index].textContent = `${result.title} — ${result.messages.length} сообщений${result.complete ? ', готово' : ', история загружена частично'}`;
        } catch (error) {
          report.errors.push({ chat: info?.title || 'Открытый чат', error: error.message });
          rows[index].textContent = `${info?.title || 'Открытый чат'} — ошибка: ${error.message}`;
        }
        $('progress').value = index + 1;
        $('overall-text').textContent = `Обработано ${index + 1} из ${selected.length} чатов`;
      }
      if (report.chats.length) {
        stage('Сохранение отчёта…');
        if (perChat) {
          if (selected.length > 1 || report.errors.length) await saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'max-archive-summary.json');
        } else {
          combinedZip.add('report.json', JSON.stringify(report, null, 2));
          await saveZip(combinedZip, `max-archive-${new Date().toISOString().slice(0, 10)}.zip`);
        }
        note(`ZIP сохранён. Чатов: ${report.chats.length}; ошибок: ${report.errors.length}; пропущенных файлов: ${report.skippedMedia.length}.`);
      } else note(report.errors[0]?.error || 'Нет данных для архива.', true);
    } catch (error) { note(error.message, true); }
    finally { running = false; start.disabled = false; cancel.hidden = true; stageProgress.hidden = true; updateSelection(); }
  }
  async function init() {
    try {
      const saved = (await chrome.storage.local.get('settings')).settings || defaults;
      for (const key of ['format', 'split', 'from', 'to', 'limit']) if (saved[key] != null && $(key)) $(key).value = saved[key];
      for (const [key, id] of [['media', 'media'], ['downloadMedia', 'download-media'], ['links', 'links'], ['reactions', 'reactions']]) $(id).checked = saved[key] ?? defaults[key];
      connect();
      const current = await call('current');
      note(current.title ? `Открыт чат: ${current.title}` : 'Выберите чат в MAX.');
      if (quick) run(); else refresh();
    } catch (error) { note(error.message, true); start.disabled = true; }
  }
  document.querySelectorAll('input[name="scope"]').forEach(input => input.addEventListener('change', updateSelection));
  $('refresh').addEventListener('click', refresh);
  start.addEventListener('click', run);
  cancel.addEventListener('click', () => { stopped = true; currentAbort?.abort(); port?.postMessage({ type: 'cancel' }); note('Останавливаем после текущего шага…'); });
  init();
})();

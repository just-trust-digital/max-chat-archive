(() => {
  let connectListener, handleMessage, loaded = 30, phase = '', sequence = 0;
  const jobs = new Map(), captures = [], title = 'Синтетический чат';
  window.chrome = { runtime: { onConnect: { addListener(fn) { connectListener = fn; } } } };
  function check(value, message) { if (!value) throw new Error(message); }
  function renderMessages(pane, from, to, prepend = false) {
    const fragment = document.createDocumentFragment();
    for (let index = from; index < to; index++) {
      const row = document.createElement('div'); row.className = 'messageWrapper';
      row.innerHTML = `<div class="message"><div class="bubbleContent"><span class="text">Сообщение ${index}</span></div><time datetime="2026-10-19T12:00:00">12:00</time></div>`;
      if (index === 0 || index === 89) {
        const button = document.createElement('button'); button.setAttribute('aria-label', 'Скачать'); button.innerHTML = `<span class="title">file-${index}.pdf</span>`;
        button.addEventListener('click', () => {
          captures.push({ index, phase });
          const link = document.createElement('a'); link.href = `https://fd.oneme.ru/fixture-${index}.pdf`; link.download = `file-${index}.pdf`; link.click();
        }); row.append(button);
      } fragment.append(row);
    } if (prepend) pane.prepend(fragment); else pane.append(fragment);
  }
  function reset() {
    loaded = 30; phase = ''; captures.length = 0;
    document.getElementById('chat').replaceChildren();
    const aside = document.querySelector('.aside');
    aside.innerHTML = `<div class="wrapper--withActions"><a href="#fixture-chat" hidden></a><div class="cell"><span class="title">${title}</span></div></div>`;
    aside.querySelector('.cell').addEventListener('click', () => {
      aside.replaceChildren();
      document.getElementById('chat').innerHTML = `<div class="openedChat"><div class="header"><div class="content--subtitle"><span class="title">${title}</span><span class="subtitle">1 of 22 online</span></div></div><div class="history"></div></div>`;
      const pane = document.querySelector('.history'); renderMessages(pane, 60, 90); pane.scrollTop = pane.scrollHeight;
      let loading = false;
      pane.addEventListener('wheel', event => {
        if (event.deltaY >= 0 || pane.scrollTop > 1 || loaded >= 90 || loading) return;
        loading = true;
        setTimeout(() => { const oldHeight = pane.scrollHeight; renderMessages(pane, 90 - loaded - 30, 90 - loaded, true); loaded += 30; pane.scrollTop += pane.scrollHeight - oldHeight; loading = false; }, 80);
      });
    });
  }
  function call(type, data = {}) {
    return new Promise((resolve, reject) => { const id = ++sequence; jobs.set(id, { resolve, reject, chunks: [] }); handleMessage({ type, id, ...data }); });
  }
  const port = {
    name: 'max-export', onMessage: { addListener(fn) { handleMessage = fn; } },
    postMessage(message) {
      const job = jobs.get(message.id); if (!job) return;
      if (message.type === 'progress') { if (message.value.stage) phase = message.value.stage; document.getElementById('result').textContent = `${phase}: ${message.value.count} сообщений`; return; }
      if (message.type === 'chunk') { job.chunks.push(...message.messages); return; }
      jobs.delete(message.id);
      if (message.type === 'error') job.reject(new Error(message.error));
      else job.resolve(message.value?.messages ? { ...message.value, messages: job.chunks } : message.value);
    }
  };
  window.FixtureHarness = { async run() {
    const output = document.getElementById('result');
    try {
      connectListener(port); const results = [];
      for (const limit of [100, 60]) {
        reset(); check(!document.querySelector('.openedChat'), 'Чат должен быть закрыт перед запуском');
        const discovery = await call('discover'); check(discovery.chats.length === 1, 'Чат не найден');
        const result = await call('export', { chat: discovery.chats[0], options: { limit, media: true, downloadMedia: true } });
        const expected = Math.min(limit, 90);
        check(result.messages.length === expected, `Ожидалось ${expected}, получено ${result.messages.length}`);
        check(result.messages[0].text === `Сообщение ${90 - expected}`, 'Неверное начало истории');
        check(result.messages.at(-1).text === 'Сообщение 89', 'Потеряно последнее сообщение');
        check(captures.every(item => item.phase === 'resolving'), 'Файл нажат до окончания загрузки истории');
        check(captures.length === (limit === 100 ? 2 : 1), 'Неверное число файлов');
        check(result.messages.flatMap(item => item.attachments).every(item => item.downloadable && item.url), 'Адрес файла не получен');
        check(result.reason === (limit === 100 ? 'top' : 'message_limit'), 'Неверная причина завершения');
        const zip = new ZipArchive(); ArchiveFormat.add(zip, 'synthetic', result, 'html-json');
        const archiveBytes = (await zip.blob().arrayBuffer()).byteLength; check(archiveBytes > 1000, 'ZIP пуст');
        results.push({ limit, messages: result.messages.length, complete: result.complete, reason: result.reason, fileClicks: captures.length, archiveBytes });
      }
      output.dataset.status = 'passed'; output.textContent = JSON.stringify({ status: 'passed', scenarios: results }, null, 2);
    } catch (error) { output.dataset.status = 'failed'; output.textContent = error.stack || String(error); }
  } };
})();

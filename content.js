(() => {
  const CHAT_ROWS = '.aside .wrapper--withActions:has(.cell .title)';
  const MESSAGE_ROWS = '.openedChat .messageWrapper';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let cancelled = false;

  function titleOf(row) {
    return (row.querySelector('.title, [class*="title"]')?.textContent || row.getAttribute('aria-label') || row.innerText?.split('\n')[0] || '').trim();
  }
  function rowKey(row) {
    const route = row.querySelector('a[href]')?.getAttribute('href');
    return route || [titleOf(row), row.innerText?.trim().slice(0, 160)].join('|');
  }
  function scrollParent(element) {
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 2) return current;
    }
    return null;
  }
  function visibleRows() {
    return [...document.querySelectorAll(CHAT_ROWS)].filter(row => row.getClientRects().length);
  }
  function chatInfo(row) {
    return { key: rowKey(row), title: titleOf(row) || 'Чат без названия' };
  }
  async function discover() {
    const list = document.querySelector('.aside');
    if (!list) throw new Error('Список чатов не найден. Откройте раздел «Чаты» в MAX.');
    const scroller = scrollParent(visibleRows()[0] || list) || list;
    const original = scroller.scrollTop;
    const found = new Map();
    let stable = 0, complete = false;
    const started = Date.now();
    try {
      scroller.scrollTop = 0;
      await wait(350);
      for (let round = 0; round < 2000 && Date.now() - started < 3 * 60 * 1000; round++) {
        if (cancelled) throw new Error('Остановлено пользователем.');
        const before = found.size;
        visibleRows().forEach(row => { const info = chatInfo(row); found.set(info.key, info); });
        const previousTop = scroller.scrollTop;
        scroller.scrollTop = Math.min(scroller.scrollHeight, previousTop + Math.max(300, scroller.clientHeight * 0.8));
        await wait(300);
        if (found.size === before && Math.abs(scroller.scrollTop - previousTop) < 2) stable++;
        else stable = 0;
        if (stable >= 4) { complete = true; break; }
      }
    } finally { scroller.scrollTop = original; }
    return { chats: [...found.values()], complete };
  }
  function openedTitle() {
    const root = document.querySelector('.openedChat');
    if (!root) return null;
    return root.querySelector('.header .title, .header [class*="title"], header [class*="title"]')?.textContent?.trim() || document.title.replace(/\s*[|—-]\s*MAX.*$/i, '').trim() || 'Открытый чат';
  }
  function attachmentsOf(row) {
    const items = [];
    for (const element of row.querySelectorAll('a[href],img[src],video[src],audio[src],source[src]')) {
      const raw = element.getAttribute('href') || element.getAttribute('src');
      if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
      let url;
      try { url = new URL(raw, location.href).href; } catch { continue; }
      const tag = element.tagName.toLowerCase();
      const kind = tag === 'a' ? 'file-or-link' : tag;
      items.push({ kind, url, downloadable: tag !== 'a' || element.hasAttribute('download'), name: element.getAttribute('download') || element.getAttribute('alt') || element.textContent?.trim().slice(0, 100) || '' });
    }
    return [...new Map(items.map(item => [item.url, item])).values()];
  }
  function extract(row, dateLabel) {
    const message = row.querySelector('.message') || row;
    const textNode = message.querySelector('.bubbleContent') || message;
    const body = textNode.innerText?.trim() || textNode.textContent?.trim() || '';
    const time = message.querySelector('time')?.getAttribute('datetime') || message.querySelector('time, [class*="meta"]')?.textContent?.trim() || '';
    const author = row.querySelector('[class*="sender"], [class*="author"]')?.textContent?.trim() || '';
    const reactions = [...row.querySelectorAll('[class*="reactions"] [class*="reaction"]')].map(el => el.textContent.trim()).filter(Boolean);
    const attachments = attachmentsOf(row);
    return { dateLabel, time, author, direction: row.classList.contains('messageWrapper--isOut') ? 'out' : 'in', text: body, reactions, attachments };
  }
  function snapshot() {
    const rows = [...document.querySelectorAll(MESSAGE_ROWS)];
    let dateLabel = '';
    return rows.map(row => {
      const date = row.closest('[role="listitem"]')?.previousElementSibling;
      const candidate = date?.querySelector?.('.dateSeparator .date, .dateSeparator');
      if (candidate) dateLabel = candidate.textContent?.trim() || dateLabel;
      return extract(row, dateLabel);
    });
  }
  function signature(item) {
    return JSON.stringify([item.dateLabel, item.time, item.author, item.direction, item.text, item.attachments.map(a => a.url)]);
  }
  function mergeOlder(current, older) {
    if (!current.length) return { items: older, gap: false };
    if (!older.length) return { items: current, gap: false };
    const a = older.map(signature), b = current.map(signature);
    for (let overlap = Math.min(a.length, b.length); overlap > 0; overlap--) {
      let matches = true;
      for (let i = 0; i < overlap; i++) if (a[a.length - overlap + i] !== b[i]) { matches = false; break; }
      if (matches) return { items: older.slice(0, -overlap).concat(current), gap: false };
    }
    return { items: older.concat(current), gap: true };
  }
  async function exportOpen(options, progress) {
    const root = document.querySelector('.openedChat');
    if (!root) throw new Error('Открытый чат не найден. Выберите переписку в MAX.');
    const title = openedTitle();
    const first = root.querySelector(MESSAGE_ROWS.replace('.openedChat ', ''));
    const scroller = first && scrollParent(first);
    if (scroller) { scroller.scrollTop = scroller.scrollHeight; await wait(500); }
    let messages = snapshot();
    let gaps = 0, stable = 0, reason = 'top', reachedTop = false;
    if (!scroller) return { title, messages, complete: false, reason: 'scroll_container_not_found', gaps };
    const started = Date.now();
    for (let round = 0; round < 5000; round++) {
      if (cancelled) { reason = 'cancelled'; break; }
      if (messages.length >= options.limit) { reason = 'message_limit'; break; }
      if (Date.now() - started > 10 * 60 * 1000) { reason = 'timeout'; break; }
      const previousTop = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, previousTop - Math.max(300, scroller.clientHeight * 0.75));
      await wait(450);
      const before = messages.length;
      const merged = mergeOlder(messages, snapshot());
      messages = merged.items;
      if (merged.gap) gaps++;
      progress({ title, count: messages.length, round });
      if (messages.length === before && Math.abs(scroller.scrollTop - previousTop) < 2 && scroller.scrollTop < 2) stable++;
      else stable = 0;
      if (stable >= 5) { reachedTop = true; break; }
    }
    if (!reachedTop && reason === 'top') reason = 'scroll_limit';
    if (messages.length > options.limit) messages = messages.slice(-options.limit);
    return { title, messages, complete: reachedTop && gaps === 0 && messages.length < options.limit, reason: gaps ? 'possible_gaps' : reason, gaps };
  }
  async function openChat(info) {
    const list = document.querySelector('.aside');
    if (!list) throw new Error('Список чатов исчез из MAX.');
    const scroller = scrollParent(visibleRows()[0] || list) || list;
    scroller.scrollTop = 0;
    await wait(200);
    for (let round = 0; round < 2000; round++) {
      if (cancelled) throw new Error('Остановлено пользователем.');
      const row = visibleRows().find(row => rowKey(row) === info.key);
      if (row) {
        row.click();
        for (let attempt = 0; attempt < 30; attempt++) {
          await wait(200);
          if (document.querySelector('.openedChat .messageWrapper, .openedChat .emptyHistory')) return;
        }
        throw new Error(`Чат «${info.title}» не открылся.`);
      }
      const previous = scroller.scrollTop;
      scroller.scrollTop += Math.max(300, scroller.clientHeight * 0.8);
      await wait(250);
      if (Math.abs(scroller.scrollTop - previous) < 2) break;
    }
    throw new Error(`Чат «${info.title}» не найден в текущем списке.`);
  }

  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'max-export') return;
    port.onMessage.addListener(async message => {
      try {
        if (message.type === 'cancel') { cancelled = true; return; }
        cancelled = false;
        if (message.type === 'discover') port.postMessage({ type: 'result', id: message.id, value: await discover() });
        if (message.type === 'current') port.postMessage({ type: 'result', id: message.id, value: { title: openedTitle() } });
        if (message.type === 'export') {
          if (message.chat) await openChat(message.chat);
          const result = await exportOpen(message.options, value => port.postMessage({ type: 'progress', id: message.id, value }));
          const messages = result.messages;
          for (let index = 0; index < messages.length; index += 250) {
            port.postMessage({ type: 'chunk', id: message.id, messages: messages.slice(index, index + 250) });
          }
          port.postMessage({ type: 'result', id: message.id, value: { ...result, messages: [] } });
        }
      } catch (error) { port.postMessage({ type: 'error', id: message.id, error: error.message }); }
    });
  });
})();

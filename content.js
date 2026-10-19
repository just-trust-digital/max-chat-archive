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
    const raw = root.querySelector('.header .title, .header [class*="title"], header [class*="title"]')?.textContent?.trim() || document.title.replace(/\s*[|—-]\s*MAX.*$/i, '').trim() || 'Открытый чат';
    return raw.replace(/\s+\d+\s+из\s+\d+\s+в\s+сети\s*$/i, '').trim();
  }
  function comparableTitle(title) {
    return (title || '').replace(/\s+\d+\s+из\s+\d+\s+в\s+сети\s*$/i, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }
  function activeChatGuard(info, originalRow) {
    const route = location.pathname;
    const expectedTitle = comparableTitle(info.title);
    return () => {
      const selected = [...document.querySelectorAll(CHAT_ROWS)].find(row => row.querySelector('.cell--selected'));
      const selectedMatches = selected === originalRow || selected && comparableTitle(titleOf(selected)) === expectedTitle;
      if (!selectedMatches || comparableTitle(openedTitle()) !== expectedTitle || location.pathname !== route) {
        throw new Error(`Выбранный чат «${info.title}» больше не открыт в MAX. Экспорт остановлен без сохранения чужой переписки.`);
      }
    };
  }
  function currentChatGuard() {
    const title = openedTitle();
    const route = location.pathname;
    const selected = [...document.querySelectorAll(CHAT_ROWS)].find(row => row.querySelector('.cell--selected'));
    const selectedTitle = selected && comparableTitle(titleOf(selected));
    return () => {
      const currentSelected = [...document.querySelectorAll(CHAT_ROWS)].find(row => row.querySelector('.cell--selected'));
      if (comparableTitle(openedTitle()) !== comparableTitle(title) || location.pathname !== route || (selected && (!currentSelected || comparableTitle(titleOf(currentSelected)) !== selectedTitle))) {
        throw new Error('Открытый чат изменился во время экспорта. Экспорт остановлен без сохранения чужой переписки.');
      }
    };
  }
  function attachmentsOf(row) {
    const items = [];
    for (const element of row.querySelectorAll('a[href],img[src],video[src],audio[src],source[src],button[aria-label="Скачать"]')) {
      if (element.closest?.('[class*="emoji"], [class*="Emoji"], [class*="reaction"], [class*="avatar"]')) continue;
      if (element.tagName.toLowerCase() === 'button') {
        const name = element.querySelector?.('.title, [class*="title"]')?.textContent?.trim() || element.textContent?.trim().slice(0, 100) || 'Вложение';
        items.push({ kind: 'file', url: null, downloadable: false, source: 'download-button', name });
        continue;
      }
      const raw = element.getAttribute('href') || element.getAttribute('src');
      if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
      let url;
      try { url = new URL(raw, location.href).href; } catch { continue; }
      const tag = element.tagName.toLowerCase();
      const kind = tag === 'a' ? 'file-or-link' : tag;
      items.push({ kind, url, downloadable: tag !== 'a' || element.hasAttribute('download'), name: element.getAttribute('download') || element.getAttribute('alt') || element.textContent?.trim().slice(0, 100) || '' });
    }
    return [...new Map(items.map((item, index) => [item.url || `button:${index}:${item.name}`, item])).values()];
  }
  function extract(row, dateLabel) {
    const message = row.querySelector('.message') || row;
    const textNode = message.querySelector('.bubbleContent') || message;
    const textParts = [...(textNode.querySelectorAll?.('.text') || [])].map(element => element.innerText?.trim() || element.textContent?.trim() || '').filter(Boolean);
    let body = textParts.join('\n');
    if (!body && textNode.cloneNode) {
      const copy = textNode.cloneNode(true);
      copy.querySelectorAll('.header, .meta, time, .reactions, [class*="emoji"], [class*="media"], button[aria-label="Скачать"]').forEach(element => element.remove());
      body = copy.innerText?.trim() || copy.textContent?.trim() || '';
    }
    if (!body) body = textNode.innerText?.trim() || textNode.textContent?.trim() || '';
    const time = message.querySelector('time')?.getAttribute('datetime') || message.querySelector('time, [class*="meta"]')?.textContent?.trim() || '';
    const authorElement = row.querySelector('button.header, .bubbleContent .header, [class*="sender"], [class*="author"]');
    const author = authorElement?.innerText?.trim() || authorElement?.textContent?.trim() || '';
    const reactions = [...row.querySelectorAll('[class*="reactions"] [class*="reaction"]')].map(el => el.textContent.trim()).filter(Boolean);
    const attachments = attachmentsOf(row);
    return { dateLabel, time, author, direction: row.classList.contains('messageWrapper--isOut') ? 'out' : 'in', text: body, reactions, attachments };
  }
  function snapshot() {
    const rows = [...document.querySelectorAll(MESSAGE_ROWS)];
    let dateLabel = '';
    return rows.map(row => {
      const item = row.closest('[role="listitem"]');
      const candidate = item?.querySelector?.('.dateSeparator .date, .dateSeparator') || item?.previousElementSibling?.querySelector?.('.dateSeparator .date, .dateSeparator') || row.previousElementSibling?.querySelector?.('.dateSeparator .date, .dateSeparator');
      if (candidate) dateLabel = candidate.textContent?.trim() || dateLabel;
      return extract(row, dateLabel);
    });
  }
  function signature(item) {
    return JSON.stringify([item.time, item.direction, item.text?.replace(/\s+/g, ' ').trim(), item.attachments.map(a => [a.kind, a.source?.startsWith('download-button') ? 'download-button' : a.name])]);
  }
  function captureButton(button) {
    return new Promise(resolve => {
      const marker = 'max-archive-download-capture';
      const nonce = crypto.randomUUID();
      let ready = false;
      const timer = setTimeout(() => finish(null), 15000);
      const readyTimer = setTimeout(() => { if (!ready) finish(null); }, 800);
      function finish(value) {
        clearTimeout(timer); clearTimeout(readyTimer);
        window.removeEventListener('message', onMessage);
        window.postMessage({ marker, type: 'cancel', nonce }, location.origin);
        resolve(value);
      }
      function onMessage(event) {
        if (event.source !== window || event.origin !== location.origin || event.data?.marker !== marker || event.data.nonce !== nonce) return;
        if (event.data.type === 'ready') {
          ready = true;
          try { button.click(); } catch { finish(null); }
        }
        if (event.data.type === 'captured') finish({ url: event.data.href, name: event.data.name });
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ marker, type: 'arm', nonce }, location.origin);
    });
  }
  async function captureVisibleUrls(items, options, cache, progress, title) {
    if (!options.downloadMedia || !options.media || typeof window === 'undefined') return items;
    const rows = [...document.querySelectorAll(MESSAGE_ROWS)];
    for (let index = 0; index < rows.length; index++) {
      const buttons = [...rows[index].querySelectorAll('button[aria-label="Скачать"]')];
      const files = items[index]?.attachments.filter(attachment => attachment.source === 'download-button') || [];
      const messageKey = items[index] && signature(items[index]);
      for (let fileIndex = 0; fileIndex < Math.min(buttons.length, files.length); fileIndex++) {
        if (cancelled) return items;
        const key = `${messageKey}:${fileIndex}`;
        if (!cache.has(key)) {
          progress({ title, count: items.length, stage: 'resolving', fileCount: cache.size + 1 });
          cache.set(key, await captureButton(buttons[fileIndex]));
        }
        const captured = cache.get(key);
        if (captured?.url && /^https:\/\//i.test(captured.url)) {
          files[fileIndex].url = captured.url;
          files[fileIndex].downloadable = true;
          files[fileIndex].source = 'download-button-url';
          if (captured.name) files[fileIndex].name = captured.name;
        }
      }
    }
    return items;
  }
  function carryDates(items) {
    let date = '';
    for (const item of items) {
      if (item.dateLabel) date = item.dateLabel;
      else item.dateLabel = date;
    }
    return items;
  }
  function mergeOlder(current, older) {
    if (!current.length) return { items: older, gap: false };
    if (!older.length) return { items: current, gap: false };
    const a = older.map(signature), b = current.map(signature);
    let best = null;
    for (let offset = 0; offset > -older.length; offset--) {
      const first = -offset;
      const overlap = Math.min(older.length - first, current.length);
      if (overlap < Math.min(3, older.length, current.length)) continue;
      let matches = 0;
      for (let index = 0; index < overlap; index++) if (a[first + index] === b[index]) matches++;
      if (matches / overlap < 0.7 || matches < Math.min(3, overlap)) continue;
      if (!best || matches > best.matches || matches === best.matches && overlap > best.overlap) best = { offset, overlap, matches };
    }
    if (!best) return { items: current, gap: true };
    const prefix = older.slice(0, -best.offset);
    for (let index = -best.offset; index < older.length; index++) {
      const existing = current[index + best.offset];
      if (existing && !existing.dateLabel && older[index].dateLabel) existing.dateLabel = older[index].dateLabel;
    }
    return { items: carryDates(prefix.concat(current)), gap: false };
  }
  async function exportOpen(options, progress, assertActive = () => {}) {
    assertActive();
    const root = document.querySelector('.openedChat');
    if (!root) throw new Error('Открытый чат не найден. Выберите переписку в MAX.');
    const title = openedTitle();
    let scroller = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const first = root.querySelector(MESSAGE_ROWS.replace('.openedChat ', ''));
      scroller = first && scrollParent(first);
      if (scroller || cancelled) break;
      progress({ title, count: document.querySelectorAll(MESSAGE_ROWS).length, stage: 'waiting' });
      await wait(150);
      assertActive();
    }
    if (scroller) { scroller.scrollTop = scroller.scrollHeight; await wait(500); }
    assertActive();
    let messages = snapshot();
    const initialCount = messages.length;
    const captureCache = new Map();
    await captureVisibleUrls(messages, options, captureCache, progress, title);
    assertActive();
    let gaps = 0, stable = 0, reason = 'top', reachedTop = false;
    let movedTowardHistory = false;
    if (!scroller) return { title, messages, complete: false, reason: 'scroll_container_not_found', gaps };
    const started = Date.now();
    for (let round = 0; round < 5000; round++) {
      if (cancelled) { reason = 'cancelled'; break; }
      assertActive();
      if (messages.length >= options.limit) { reason = 'message_limit'; break; }
      if (Date.now() - started > 10 * 60 * 1000) { reason = 'timeout'; break; }
      const previousTop = scroller.scrollTop;
      // Reversed history panes use negative scrollTop for older messages.
      scroller.scrollTop = previousTop - Math.max(300, scroller.clientHeight * 0.75);
      await wait(450);
      assertActive();
      const moved = Math.abs(scroller.scrollTop - previousTop) >= 2;
      if (moved) movedTowardHistory = true;
      const before = messages.length;
      const current = snapshot();
      await captureVisibleUrls(current, options, captureCache, progress, title);
      assertActive();
      const merged = mergeOlder(messages, current);
      messages = merged.items;
      if (merged.gap) gaps++;
      progress({ title, count: messages.length, round });
      if (messages.length === before && !moved) stable++;
      else stable = 0;
      if (stable >= 12) {
        if (movedTowardHistory && messages.length > initialCount) reachedTop = true;
        else reason = movedTowardHistory ? 'history_not_expanded' : 'scroll_stalled';
        break;
      }
    }
    if (!reachedTop && reason === 'top') reason = 'scroll_limit';
    if (messages.length > options.limit) messages = messages.slice(-options.limit);
    assertActive();
    return { title, messages, complete: reachedTop && gaps === 0 && messages.length < options.limit, reason: gaps ? 'possible_gaps' : reason, gaps };
  }
  async function openChat(info, progress = () => {}) {
    const list = document.querySelector('.aside');
    if (!list) throw new Error('Список чатов исчез из MAX.');
    const scroller = scrollParent(visibleRows()[0] || list) || list;
    scroller.scrollTop = 0;
    await wait(200);
    for (let round = 0; round < 2000; round++) {
      if (cancelled) throw new Error('Остановлено пользователем.');
      const row = visibleRows().find(row => rowKey(row) === info.key);
      if (row) {
        const cell = row.querySelector('.cell');
        if (!cell) throw new Error(`Строка чата «${info.title}» изменилась в MAX. Обновите список.`);
        progress({ title: info.title, count: 0, stage: 'opening' });
        cell.click();
        for (let attempt = 0; attempt < 50; attempt++) {
          if (cancelled) throw new Error('Остановлено пользователем.');
          await wait(200);
          const root = document.querySelector('.openedChat');
          if (row.querySelector('.cell--selected') && comparableTitle(openedTitle()) === comparableTitle(info.title) && root?.querySelector('.messageWrapper, .emptyHistory')) {
            await wait(300);
            const assertActive = activeChatGuard(info, row);
            assertActive();
            return assertActive;
          }
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
          const progress = value => port.postMessage({ type: 'progress', id: message.id, value });
          const assertActive = message.chat ? await openChat(message.chat, progress) : currentChatGuard();
          const result = await exportOpen(message.options, progress, assertActive);
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

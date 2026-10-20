(() => {
  const CHAT_ROWS = '.aside .wrapper--withActions:has(.cell .title)';
  const MESSAGE_ROWS = '.openedChat .messageWrapper';
  const PHOTO_TILES = '[aria-label="Прикрепленные фото"] button.tile';
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
  async function showChatList() {
    if (visibleRows().length) return;
    const back = document.querySelector('.openedChat')?.querySelector('button[aria-label="Go back"], button[aria-label="Назад"]');
    if (!back) {
      if (document.querySelector('.openedChat')) throw new Error('Список чатов скрыт. Вернитесь к списку в MAX и повторите поиск.');
      return;
    }
    back.click();
    for (let attempt = 0; attempt < 50; attempt++) {
      if (cancelled) throw new Error('Остановлено пользователем.');
      await wait(100);
      if (visibleRows().length) return;
    }
    throw new Error('Список чатов не появился в MAX. Откройте раздел «Чаты» и повторите поиск.');
  }
  async function discover() {
    const previousTitle = !visibleRows().length && document.querySelector('.openedChat') ? openedTitle() : null;
    await showChatList();
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
    const chats = [...found.values()];
    if (previousTitle) {
      const matches = chats.filter(chat => comparableTitle(chat.title) === comparableTitle(previousTitle));
      if (matches.length !== 1) throw new Error('Поиск завершён. Откройте исходный чат в MAX перед экспортом открытой переписки.');
      await openChat(matches[0]);
    }
    return { chats, complete };
  }
  function openedTitle() {
    const root = document.querySelector('.openedChat');
    if (!root) return null;
    const title = root.querySelector('.header .title') || root.querySelector('header .title') || root.querySelector('.header [class*="title"]:not([class*="subtitle"]), header [class*="title"]:not([class*="subtitle"])');
    const raw = title?.textContent?.trim() || document.title.replace(/\s*[|—-]\s*MAX.*$/i, '').trim() || 'Открытый чат';
    return raw.replace(/\s+\d+\s+из\s+\d+\s+в\s+сети\s*$/i, '').trim();
  }
  function comparableTitle(title) {
    return (title || '').replace(/\s+\d+\s+из\s+\d+\s+в\s+сети\s*$/i, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }
  function selectedChatMatches(info, originalRow) {
    const rows = [...document.querySelectorAll(CHAT_ROWS)];
    // MAX unmounts the sidebar in its compact chat view.
    if (!rows.length) return true;
    const selected = rows.find(row => row.querySelector('.cell--selected'));
    return selected === originalRow || !!selected && comparableTitle(titleOf(selected)) === comparableTitle(info.title);
  }
  function activeChatGuard(info, originalRow) {
    const route = location.pathname;
    const expectedTitle = comparableTitle(info.title);
    return () => {
      if (!selectedChatMatches(info, originalRow) || comparableTitle(openedTitle()) !== expectedTitle || location.pathname !== route) {
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
  function photoTiles(row) {
    return [...row.querySelectorAll(PHOTO_TILES)].filter(tile => !tile.querySelector('video, audio, source'));
  }
  function attachmentsOf(row) {
    const items = [];
    for (const element of row.querySelectorAll('a[href],img[src],video[src],audio[src],source[src],button[aria-label="Скачать"]')) {
      if (element.closest?.('[class*="emoji"], [class*="Emoji"], [class*="reaction"], [class*="avatar"]')) continue;
      if (element.tagName.toLowerCase() === 'img' && element.closest?.(PHOTO_TILES)) continue;
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
    photoTiles(row).forEach((_tile, index) => items.push({ kind: 'photo', url: null, downloadable: false, source: 'photo-tile', name: `photo-${index + 1}` }));
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
  async function capturePhoto(tile, assertActive) {
    if (document.querySelector('dialog[open]')) return null;
    let viewer = null;
    try {
      assertActive(); tile.click();
      for (let attempt = 0; attempt < 50; attempt++) {
        if (cancelled) return null;
        await wait(100); assertActive();
        viewer = document.querySelector('dialog[open]');
        const image = viewer && [...viewer.querySelectorAll('img[src]')].find(img => !img.closest('[class*="avatar"]') && /^https?:\/\//i.test(img.currentSrc || img.getAttribute('src') || ''));
        if (!image) continue;
        const fallback = { url: image.currentSrc || image.getAttribute('src'), quality: 'viewer', width: image.naturalWidth || null, height: image.naturalHeight || null };
        const download = viewer.querySelector('button[aria-label="Download"], button[aria-label="Скачать"]');
        const original = download ? await captureButton(download) : null;
        return original?.url && /^https:\/\//i.test(original.url) ? { ...original, quality: 'download' } : fallback;
      }
      return null;
    } finally {
      const close = viewer?.querySelector('button[aria-label="Close"], button[aria-label="Закрыть"]');
      if (close) { close.click(); await wait(50); }
    }
  }
  async function captureVisibleUrls(items, options, cache, progress, title, assertActive = () => {}) {
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
      const tiles = photoTiles(rows[index]);
      const photos = items[index]?.attachments.filter(attachment => attachment.source === 'photo-tile') || [];
      for (let photoIndex = 0; photoIndex < Math.min(tiles.length, photos.length); photoIndex++) {
        if (cancelled) return items;
        assertActive();
        const key = `${messageKey}:photo:${photoIndex}`;
        if (!cache.has(key)) {
          progress({ title, count: items.length, stage: 'resolving', fileCount: cache.size + 1 });
          cache.set(key, await capturePhoto(tiles[photoIndex], assertActive));
        }
        const captured = cache.get(key);
        if (captured?.url) Object.assign(photos[photoIndex], captured, { downloadable: true, source: 'photo-viewer', name: captured.name || photos[photoIndex].name });
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
  function historyScroller() {
    const first = document.querySelector('.openedChat')?.querySelector('.messageWrapper');
    return first && scrollParent(first);
  }
  function scrollHistoryUp(scroller) {
    const distance = Math.max(300, scroller.clientHeight * 0.75);
    // Preserve negative coordinates in reversed panes and notify MAX's loader
    // even when the viewport has already reached its upper boundary.
    scroller.scrollTop -= distance;
    scroller.dispatchEvent?.(new Event('scroll', { bubbles: true }));
    scroller.dispatchEvent?.(new WheelEvent('wheel', { deltaY: -distance, deltaMode: 0, bubbles: true, cancelable: true }));
  }
  async function resolveHistoryAttachments(messages, options, progress, title, assertActive) {
    const targets = new Map();
    if (!options.media || !options.downloadMedia) return { neededMessages: 0, unresolvedMessages: 0, scrollAttempts: 0 };
    for (const message of messages) {
      if (!message.attachments.some(item => item.source === 'download-button' || item.source === 'photo-tile')) continue;
      const key = signature(message);
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push(message);
    }
    const neededMessages = targets.size, cache = new Map();
    let scrollAttempts = 0, stable = 0;
    if (!targets.size || cancelled) return { neededMessages, unresolvedMessages: targets.size, scrollAttempts };
    progress({ title, count: messages.length, stage: 'resolving', fileCount: 0 });
    let scroller = historyScroller();
    if (scroller) { scroller.scrollTop = scroller.scrollHeight; await wait(500); }
    const started = Date.now();
    for (let round = 0; round < 5000 && Date.now() - started < 10 * 60 * 1000; round++) {
      if (cancelled) break;
      assertActive();
      const visible = snapshot();
      const keys = visible.map(signature);
      // Keep row indexes aligned while resolving only files included by the history limit.
      const wanted = visible.map((item, index) => targets.has(keys[index]) ? item : { ...item, attachments: [] });
      await captureVisibleUrls(wanted, options, cache, value => progress({ ...value, count: messages.length }), title, assertActive);
      assertActive();
      const before = targets.size;
      for (let itemIndex = 0; itemIndex < wanted.length; itemIndex++) {
        const item = wanted[itemIndex], key = keys[itemIndex], copies = targets.get(key);
        if (!copies) continue;
        for (const copy of copies) item.attachments.forEach((attachment, index) => {
          if (attachment.source === 'download-button-url' || attachment.source === 'photo-viewer') Object.assign(copy.attachments[index], attachment);
        });
        targets.delete(key);
      }
      if (!targets.size || cancelled) break;
      scroller = historyScroller();
      if (!scroller) break;
      const previousTop = scroller.scrollTop;
      scrollHistoryUp(scroller);
      await wait(450);
      scrollAttempts++;
      const live = historyScroller();
      if (live === scroller && Math.abs(live.scrollTop - previousTop) < 2 && targets.size === before) stable++;
      else stable = 0;
      if (stable >= 12) break;
    }
    return { neededMessages, unresolvedMessages: targets.size, scrollAttempts };
  }
  async function exportOpen(options, progress, assertActive = () => {}) {
    assertActive();
    const root = document.querySelector('.openedChat');
    if (!root) throw new Error('Открытый чат не найден. Выберите переписку в MAX.');
    const title = openedTitle();
    let scroller = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      scroller = historyScroller();
      if (scroller || cancelled) break;
      progress({ title, count: document.querySelectorAll(MESSAGE_ROWS).length, stage: 'waiting' });
      await wait(150);
      assertActive();
    }
    if (scroller) { scroller.scrollTop = scroller.scrollHeight; await wait(500); }
    assertActive();
    let messages = snapshot();
    const initialCount = messages.length;
    const history = { initialMessages: initialCount, scrollAttempts: 0, paneReplacements: 0, restarts: 0, lastSteps: [] };
    let gaps = 0, stable = 0, reason = 'top', reachedTop = false;
    let movedTowardHistory = false;
    if (!scroller) {
      if (messages.length > options.limit) messages = messages.slice(-options.limit);
      progress({ title, count: messages.length, stage: 'history-ready', reason: 'scroll_container_not_found' });
      history.mediaResolution = await resolveHistoryAttachments(messages, options, progress, title, assertActive);
      return { title, messages, complete: false, reason: 'scroll_container_not_found', gaps, history };
    }
    const started = Date.now();
    for (let round = 0; round < 5000; round++) {
      if (cancelled) { reason = 'cancelled'; break; }
      assertActive();
      if (messages.length >= options.limit) { reason = 'message_limit'; break; }
      if (Date.now() - started > 10 * 60 * 1000) { reason = 'timeout'; break; }
      const liveScroller = historyScroller();
      if (!liveScroller) { reason = 'scroll_container_not_found'; break; }
      let replaced = liveScroller !== scroller;
      if (replaced) history.paneReplacements++;
      scroller = liveScroller;
      const previousTop = scroller.scrollTop;
      const connected = scroller.isConnected !== false;
      scrollHistoryUp(scroller);
      await wait(450);
      assertActive();
      const afterScroller = historyScroller();
      if (!afterScroller) { reason = 'scroll_container_not_found'; break; }
      if (afterScroller !== scroller) { history.paneReplacements++; replaced = true; scroller = afterScroller; }
      const moved = Math.abs(scroller.scrollTop - previousTop) >= 2;
      if (moved) movedTowardHistory = true;
      const before = messages.length;
      const current = snapshot();
      const merged = mergeOlder(messages, current);
      messages = merged.items;
      if (merged.gap) gaps++;
      history.scrollAttempts++;
      history.lastSteps.push({ beforeTop: previousTop, afterTop: scroller.scrollTop, height: scroller.scrollHeight, viewport: scroller.clientHeight, mounted: current.length, collected: messages.length, replaced, connected });
      if (history.lastSteps.length > 20) history.lastSteps.shift();
      progress({ title, count: messages.length, round, stage: 'history', limit: options.limit });
      if (messages.length === before && !moved && !replaced) stable++;
      else stable = 0;
      if (stable >= 4 && messages.length === initialCount && history.restarts === 0) {
        // A freshly opened chat can bind its history loader after the first
        // scroll has reached the edge. Cross it again after initialization.
        history.restarts++;
        progress({ title, count: messages.length, stage: 'waiting' });
        scroller.scrollTop = scroller.scrollHeight;
        await wait(750);
        stable = 0;
        continue;
      }
      if (stable >= 12) {
        if (movedTowardHistory && messages.length > initialCount) reachedTop = true;
        else reason = movedTowardHistory ? 'history_not_expanded' : 'scroll_stalled';
        break;
      }
    }
    if (!reachedTop && reason === 'top') reason = 'scroll_limit';
    if (messages.length > options.limit) messages = messages.slice(-options.limit);
    assertActive();
    progress({ title, count: messages.length, stage: 'history-ready', reason });
    history.mediaResolution = await resolveHistoryAttachments(messages, options, progress, title, assertActive);
    assertActive();
    return { title, messages, complete: reachedTop && gaps === 0 && messages.length < options.limit, reason: gaps ? 'possible_gaps' : reason, gaps, history };
  }
  async function openChat(info, progress = () => {}) {
    await showChatList();
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
          if (selectedChatMatches(info, row) && comparableTitle(openedTitle()) === comparableTitle(info.title) && root?.querySelector('.messageWrapper, .emptyHistory')) {
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

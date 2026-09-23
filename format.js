const ArchiveFormat = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const safeName = value => String(value || 'chat').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100) || 'chat';
  const csvCell = value => {
    let cell = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  };
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  function dateOf(item) {
    for (const value of [item.time, item.dateLabel]) {
      const label = String(value || '').trim().toLowerCase();
      const standard = label.match(/\b\d{4}-\d{2}-\d{2}\b/);
      if (standard) return standard[0];
      const dotted = label.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
      if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
      if (label === 'сегодня') return iso(new Date());
      if (label === 'вчера') { const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); return iso(yesterday); }
      const russian = label.match(/\b(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/u);
      if (russian && months.includes(russian[2])) {
        const month = months.indexOf(russian[2]);
        const today = new Date();
        let year = russian[3] ? Number(russian[3]) : today.getFullYear();
        if (!russian[3] && new Date(year, month, Number(russian[1])) > today) year--;
        return `${year}-${String(month + 1).padStart(2, '0')}-${russian[1].padStart(2, '0')}`;
      }
    }
    return null;
  }
  function filter(messages, options) {
    return messages.filter(item => {
      const raw = dateOf(item);
      if (!raw) return true;
      return (!options.from || raw >= options.from) && (!options.to || raw <= options.to);
    }).map(item => ({
      ...item,
      reactions: options.reactions ? item.reactions : [],
      attachments: options.media ? item.attachments : [],
      links: options.links ? item.attachments.filter(entry => entry.kind === 'file-or-link').map(entry => entry.url) : []
    }));
  }
  function html(chat) {
    const blocks = chat.messages.map(item => `<article class="msg ${item.direction === 'out' ? 'out' : ''}"><div class="meta">${escape(item.author || (item.direction === 'out' ? 'Вы' : 'Собеседник'))} · ${escape(item.dateLabel)} ${escape(item.time)}</div><div class="body">${escape(item.text).replace(/\n/g, '<br>')}</div>${item.attachments.map(entry => { const url = entry.localPath ? encodeURI(entry.localPath.replace(/^.*?\/media\//, 'media/')) : safeUrl(entry.url); return url ? `<div class="attachment"><a href="${escape(url)}">${escape(entry.name || entry.kind)}</a></div>` : ''; }).join('')}${item.reactions.length ? `<div class="reactions">${escape(item.reactions.join(' · '))}</div>` : ''}</article>`).join('');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(chat.title)}</title><style>body{font:15px/1.5 Arial,sans-serif;background:#f2f5fa;color:#17233a;margin:0;padding:24px}.wrap{max-width:850px;margin:auto}h1{font-size:25px}.msg{background:white;border:1px solid #dce3ed;border-radius:13px;margin:12px 15% 12px 0;padding:13px}.msg.out{margin:12px 0 12px 15%;background:#e9f3ff}.meta,.reactions{color:#6d7b91;font-size:12px}.body{white-space:normal;margin-top:7px}.attachment{margin-top:8px;overflow-wrap:anywhere}a{color:#1563dc}</style></head><body><div class="wrap"><h1>${escape(chat.title)}</h1><p>${chat.messages.length} сообщений</p>${blocks}</div></body></html>`;
  }
  function txt(chat) { return `${chat.title}\n${chat.messages.length} сообщений\n\n${chat.messages.map(item => `[${item.dateLabel} ${item.time}] ${item.author || (item.direction === 'out' ? 'Вы' : 'Собеседник')}\n${item.text}${item.attachments.length ? '\n' + item.attachments.map(a => `${a.name || a.kind}: ${a.localPath || a.url}`).join('\n') : ''}`).join('\n\n')}`; }
  function csv(chat) { return '\ufeff' + ['date', 'time', 'author', 'direction', 'text', 'attachments', 'reactions'].map(csvCell).join(',') + '\r\n' + chat.messages.map(item => [item.dateLabel, item.time, item.author, item.direction, item.text, item.attachments.map(a => a.localPath || a.url).join(' | '), item.reactions.join(' | ')].map(csvCell).join(',')).join('\r\n'); }
  function add(zip, path, chat, format) {
    if (format === 'html-json' || format === 'html') zip.add(`${path}/messages.html`, html(chat));
    if (format === 'html-json' || format === 'json') zip.add(`${path}/messages.json`, JSON.stringify(chat, null, 2));
    if (format === 'csv') zip.add(`${path}/messages.csv`, csv(chat));
    if (format === 'txt') zip.add(`${path}/messages.txt`, txt(chat));
  }
  return { filter, add, safeName, dateOf };
})();

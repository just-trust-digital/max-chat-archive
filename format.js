const ArchiveFormat = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const safeName = value => String(value || 'chat').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100).replace(/[. ]+$/,'') || 'chat';
  const csvCell = value => {
    let cell = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  };
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const englishMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  function dateOf(item) {
    if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) return item.date;
    for (const value of [item.time, item.dateLabel]) {
      const label = String(value || '').trim().toLowerCase();
      const standard = label.match(/\b\d{4}-\d{2}-\d{2}\b/);
      if (standard) return standard[0];
      const dotted = label.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
      if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
      if (label === 'сегодня' || label === 'today') return iso(new Date());
      if (label === 'вчера' || label === 'yesterday') { const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); return iso(yesterday); }
      const english = label.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/) || label.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/)?.map((value, index, values) => index === 1 ? values[2] : index === 2 ? values[1] : value);
      if (english && englishMonths.includes(english[1])) return `${english[3]}-${String(englishMonths.indexOf(english[1]) + 1).padStart(2, '0')}-${english[2].padStart(2, '0')}`;
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
  function clock(value) {
    const match=String(value || '').match(/(?:T|\b)(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
    if(!match) return '';
    let hour=Number(match[1]);
    if(match[3]) hour=hour%12 + (match[3].toUpperCase()==='PM'?12:0);
    return `${String(hour).padStart(2,'0')}:${match[2]}`;
  }
  function displayDate(item) {const date=dateOf(item);return date?date.split('-').reverse().join('.'):item.dateLabel || '';}
  function category(entry) {
    const kind=String(entry.kind || ''), type=String(entry.mimeType || ''), name=String(entry.name || entry.url || '').toLowerCase();
    if(kind==='voice') return 'voice';
    if(kind==='video-message') return 'videoMessage';
    if(kind==='sticker') return 'sticker';
    if(kind==='gif' || type==='image/gif' || /\.gif(?:$|\?)/.test(name)) return 'gif';
    if(kind==='audio' || type.startsWith('audio/')) return 'audio';
    if(kind==='video' || type.startsWith('video/')) return 'video';
    if(['photo','img','image'].includes(kind) || type.startsWith('image/')) return 'photo';
    return kind==='file-or-link' && !entry.downloadable ? 'link' : 'file';
  }
  function selected(entry,options) {const type=category(entry);return type==='link'?!!options.links:options.media!==false && options.mediaTypes?.[type]!==false;}
  function prepareChat(chat,options) {
    return {...chat, messages:filter(chat.messages || [],options), participants:options.anonymize || options.participants===false ? [] : (chat.participants || []), participantsStatus:options.anonymize?'excluded':chat.participantsStatus};
  }
  function filter(messages, options) {
    return messages.filter(Boolean).filter(item => {
      const raw = dateOf(item);
      if (!raw) return true;
      return (!options.from || raw >= options.from) && (!options.to || raw <= options.to);
    }).map(item => ({
      ...item,
      date: dateOf(item),
      time: clock(item.time),
      edited: item.edited || /ред\.|edited/i.test(item.time || ''),
      author: options.anonymize ? '' : item.author,
      forwardedFrom: options.anonymize ? '' : item.forwardedFrom,
      replyTo: item.replyTo ? {...item.replyTo, author:options.anonymize?'':item.replyTo.author} : undefined,
      reactions: options.reactions ? item.reactions : [],
      attachments: (item.attachments || []).filter(entry=>selected(entry,options)),
      links: options.links ? (item.attachments || []).filter(entry => entry.kind === 'file-or-link').map(entry => entry.url) : []
    }));
  }
  function mediaPath(value) {const path=String(value || '').replace(/^.*?\/media\//,'media/');return path.startsWith('media/') && !path.split('/').some(part=>part==='..' || part==='.') && !/[\\\x00-\x1f]/.test(path) ? path.split('/').map(encodeURIComponent).join('/') : '';}
  function html(chat) {
    function attachment(entry) {
      const name = escape(entry.name || entry.kind || 'Файл');
      const path = String(entry.localPath || '').replace(/^.*?\/media\//, 'media/');
      const local = path.startsWith('media/') && !path.split('/').some(part => part === '..' || part === '.') && !/[\\\x00-\x1f]/.test(path)
        ? path.split('/').map(encodeURIComponent).join('/') : '';
      const url = local || safeUrl(entry.url);
      if (!url) return `<div class="attachment">${name} — файл недоступен</div>`;
      const href = escape(url);
      const poster=mediaPath(entry.posterPath);
      const type = String(entry.mimeType || '').toLowerCase();
      const extension = path.split('.').pop().toLowerCase();
      let preview = '';
      // Remote URLs remain links: an offline archive never contacts MAX merely
      // because the reader opened its HTML file.
      if (local) {
        if (['photo', 'img', 'image', 'sticker'].includes(entry.kind) || type.startsWith('image/') || /^(jpe?g|png|webp|gif|avif|bmp|svg)$/.test(extension)) preview = `<a class="preview" href="${href}"><img src="${href}" alt="${name}" loading="lazy" decoding="async"></a>`;
        else if (entry.kind !== 'audio' && !type.startsWith('audio/') && (entry.kind === 'video' || type.startsWith('video/') || /^(mp4|webm|mov|m4v)$/.test(extension))) preview = `<video src="${href}#t=0.1" ${poster?`poster="${escape(poster)}" `:''}controls preload="metadata" playsinline aria-label="${name}"></video>`;
        else if (['audio','voice'].includes(entry.kind) || type.startsWith('audio/') || /^(mp3|ogg|opus|wav|m4a|aac|flac)$/.test(extension)) preview = `<audio src="${href}" controls preload="none" aria-label="${name}"></audio>`;
      }
      if(!local && poster) preview=`<a class="preview" href="${href}" rel="noreferrer"><img src="${escape(poster)}" alt="${name}" loading="lazy"></a>`;
      return `<div class="attachment">${preview}<a class="file-link" href="${href}" rel="noreferrer">${name}</a></div>`;
    }
    const participants = chat.participants?.length ? `<details class="participants"><summary>Участники: ${chat.participants.length}${chat.participantsStatus==='complete'?'':' · список может быть неполным'}</summary><ul>${chat.participants.map(person=>`<li>${escape(person.name)}${person.role?' · '+escape(person.role):''}</li>`).join('')}</ul></details>` : '';
    let previousDay = null;
    const blocks = chat.messages.map(item => {
      const date = dateOf(item), day = date || item.dateLabel || 'Дата неизвестна';
      const separator = day !== previousDay ? `<h2 class="day-separator">${escape(date ? date.split('-').reverse().join('.') : day)}</h2>` : '';
      previousDay = day;
      return `${separator}<article class="msg ${item.direction === 'out' ? 'out' : ''}"><div class="meta">${escape(item.author || (item.direction === 'out' ? 'Вы' : 'Собеседник'))} · ${escape(displayDate(item))} ${escape(clock(item.time))}</div><div class="body">${item.forwardedFrom ? `<div class="forwarded">Переслано от: ${escape(item.forwardedFrom)}</div>` : ''}${item.replyTo ? `<div class="forwarded">Ответ: ${escape(item.replyTo.author || '')} ${escape(item.replyTo.text || '')}</div>` : ''}${escape(item.text).replace(/\n/g, '<br>')}</div>${(item.attachments || []).map(attachment).join('')}${item.reactions?.length ? `<div class="reactions">${escape(item.reactions.join(' · '))}</div>` : ''}</article>`;
    }).join('');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(chat.title)}</title><style>*{box-sizing:border-box}body{font:15px/1.5 Arial,sans-serif;background:#f2f5fa;color:#17233a;margin:0;padding:24px}.wrap{max-width:850px;margin:auto;overflow-wrap:anywhere}h1{font-size:25px}.day-separator{font-size:14px;font-weight:600;text-align:center;color:#526178;margin:28px 0 16px}.msg{background:white;border:1px solid #dce3ed;border-radius:13px;margin:12px 15% 12px 0;padding:13px;min-width:0}.msg.out{margin:12px 0 12px 15%;background:#e9f3ff}.meta,.reactions{color:#526178;font-size:12px}.body{white-space:normal;margin-top:7px}.attachment{margin-top:12px;min-width:0}.attachment img,.attachment video{display:block;max-width:100%;max-height:480px;height:auto;border-radius:6px}.attachment audio{display:block;width:100%;max-width:420px}.preview{display:block;width:fit-content;max-width:100%}.file-link{display:inline-block;max-width:100%;padding:6px 0;overflow-wrap:anywhere}a{color:#1563dc}a:focus-visible,audio:focus-visible,video:focus-visible{outline:2px solid #1563dc;outline-offset:4px}@media(max-width:600px){body{padding:12px}.msg{margin-right:5%}.msg.out{margin-left:5%}.attachment img,.attachment video{max-height:360px}}@media(prefers-color-scheme:dark){:root{color-scheme:dark}body{background:#101820;color:#e2eaf2}.msg{background:#1b2835;border-color:#354656}.msg.out{background:#203b50}.meta,.reactions,.day-separator,.forwarded{color:#b5c5d5}a{color:#77b9ff}}.forwarded{font-size:13px;color:inherit;border-left:2px solid #7995b3;padding-left:9px;margin-bottom:8px}</style></head><body><div class="wrap"><h1>${escape(chat.title)}</h1><p>${chat.messages.length} сообщений</p>${participants}${blocks}</div></body></html>`;
  }
  function txt(chat) { return `${chat.title}\n${chat.messages.length} сообщений\n\n${chat.messages.map(item => `[${displayDate(item)} ${clock(item.time)}] ${item.author || (item.direction === 'out' ? 'Вы' : 'Собеседник')}\n${item.text}${item.attachments.length ? '\n' + item.attachments.map(a => `${a.name || a.kind}: ${a.localPath || a.url || 'ссылка недоступна'}`).join('\n') : ''}`).join('\n\n')}`; }
  function csv(chat) { return '\ufeff' + ['date', 'time', 'author', 'direction', 'text', 'attachments', 'reactions'].map(csvCell).join(',') + '\r\n' + chat.messages.map(item => [displayDate(item), clock(item.time), item.author, item.direction, item.text, item.attachments.map(a => a.localPath || a.url || a.name).join(' | '), item.reactions.join(' | ')].map(csvCell).join(',')).join('\r\n'); }
  function add(zip, path, chat, format) {
    if(chat.participants?.length) {
      zip.add(`${path}/participants.json`,JSON.stringify({status:chat.participantsStatus || 'partial',participants:chat.participants},null,2));
      zip.add(`${path}/participants.csv`,'\ufeff'+['Имя','Роль','Ссылка'].map(csvCell).join(',')+'\r\n'+chat.participants.map(item=>[item.name,item.role,item.url].map(csvCell).join(',')).join('\r\n'));
    }
    if (format === 'html-json' || format === 'html') zip.add(`${path}/messages.html`, html(chat));
    if (format === 'html-json' || format === 'json') zip.add(`${path}/messages.json`, JSON.stringify(chat, null, 2));
    if (format === 'csv') zip.add(`${path}/messages.csv`, csv(chat));
    if (format === 'txt') zip.add(`${path}/messages.txt`, txt(chat));
  }
  function addIndex(archive, chats, format) {
    const file = {html:'messages.html','html-json':'messages.html',json:'messages.json',csv:'messages.csv',txt:'messages.txt'}[format] || 'messages.html';
    const rows = chats.map(chat => {
      const parts=String(chat.path || '').split('/');
      if(parts.some(part=>!part || part==='.' || part==='..' || /[\\:\x00-\x1f]/.test(part))) throw new Error('Некорректный путь переписки.');
      const href=parts.map(encodeURIComponent).join('/')+'/'+file;
      return `<li><a href="${escape(href)}">${escape(chat.title || 'Чат')}</a><p>${Number(chat.messages) || 0} сообщений${chat.complete===false?' · история может быть неполной':''}</p></li>`;
    }).join('');
    archive.add('index.html',`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Переписка MAX</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f4f6fa;color:#17233a}main{max-width:800px;margin:auto;padding:40px 24px}h1{font-size:28px}ul{list-style:none;padding:0}li{padding:20px 0;border-bottom:1px solid #cbd5e1;overflow-wrap:anywhere}a{color:#155ac2}li>a{font-size:19px;font-weight:650}p,footer{color:#526178}li p{margin:6px 0}footer{margin-top:32px;font-size:13px}a:focus-visible{outline:3px solid currentColor;outline-offset:4px}@media(prefers-color-scheme:dark){body{background:#101820;color:#e2eaf2}a{color:#8ec3ff}p,footer{color:#b5c5d5}li{border-color:#354656}}</style></head><body><main><h1>Переписка MAX</h1><p>Выберите чат для просмотра.</p><ul>${rows || '<li>Сохранённых переписок пока нет.</li>'}</ul><footer><a href="report.json">Технический отчёт об экспорте</a></footer></main></body></html>`);
  }
  return { filter, prepareChat, selected, category, clock, add, addIndex, safeName, dateOf };
})();

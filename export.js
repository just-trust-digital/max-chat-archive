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
  const durable = typeof CheckpointStore === 'undefined' ? null : CheckpointStore;
  let recoveryBusy=false;
  const defaults = { format: 'html-json', split: 'by-chat', media: true, downloadMedia: true, links: true, reactions: true, limit: 10000 };

  function note(message, error = false) { status.textContent = message; status.style.color = '';status.setAttribute?.('data-error',String(error)); }
  function stage(message, completed = null, total = null) {
    $('progress-text').textContent = message;
    stageProgress.hidden = false;
    if (total && completed != null) { stageProgress.max = total; stageProgress.value = completed; }
    else stageProgress.removeAttribute('value');
  }
  function call(type, data = {}, onProgress = () => {}, onCheckpoint = async () => {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject, onProgress, onCheckpoint, chunks: [] });
      port.postMessage({ type, id, ...data });
    });
  }
  function connect() {
    if (!Number.isInteger(tabId) || tabId < 1) throw new Error('Вкладка MAX не выбрана. Откройте экспорт через значок расширения.');
    port = chrome.tabs.connect(tabId, { name: 'max-export' });
    port.onMessage.addListener(message => {
      const job = pending.get(message.id);
      if (!job) return;
      if (message.type === 'checkpoint-start') {job.checkpoint={token:message.token,value:message.value,chunks:[]};return;}
      if (message.type === 'checkpoint-chunk') {if(job.checkpoint?.token===message.token) job.checkpoint.chunks.push(message.messages);return;}
      if (message.type === 'checkpoint-end') {
        const copy=job.checkpoint;job.checkpoint=null;
        if(copy?.token!==message.token) return;
        Promise.resolve().then(()=>job.onCheckpoint({...copy.value,messages:copy.chunks.flat()})).then(
          ()=>port?.postMessage({type:'checkpoint-ack',token:message.token}),
          error=>port?.postMessage({type:'checkpoint-ack',token:message.token,error:`Не удалось сохранить копию: ${error.message}`}));
        return;
      }
      if (message.type === 'progress') return job.onProgress(message.value);
      if (message.type === 'chunk') { job.chunks.push(message.messages); return; }
      pending.delete(message.id);
      if (message.type === 'error') { const error = new Error(message.error); error.code = message.code; job.reject(error); }
      else job.resolve(message.value?.messages ? { ...message.value, messages: job.chunks.flat() } : message.value);
    });
    port.onDisconnect.addListener(() => {
      for (const job of pending.values()) job.reject(new Error('Связь с MAX потеряна. Не закрывайте и не обновляйте вкладку во время экспорта.'));
      pending.clear(); port = null; note('Связь с вкладкой MAX потеряна.', true);
    });
  }
  async function showMax() {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (chrome.windows?.update && tab?.windowId != null) {
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
    }
  }
  function visibilityPrompt(show) {
    const alert=$('visibility-alert');
    if(!alert) return;
    const wasHidden=alert.hidden;alert.hidden=!show;
    if(show && wasHidden) alert.scrollIntoView?.({block:'center',behavior:'instant'});
  }
  function updatePeriod() {
    const from=$('from')?.value,to=$('to')?.value, display=value=>value.split('-').reverse().join('.');
    if($('period-summary')) $('period-summary').textContent=`${from?'С '+display(from):'С первого сообщения'} ${to?'по '+display(to):'до последнего сообщения'}`;
    if(!from && !to && $('period-summary')) $('period-summary').textContent='С первого до последнего сообщения';
  }
  function updatePrivacy() {if($('participants')) $('participants').disabled=!!$('anonymize')?.checked;}
  function recoveryControls(disabled) {$('recovery-list')?.querySelectorAll('button').forEach(button=>{button.disabled=disabled;});}
  function scope() { return document.querySelector('input[name="scope"]:checked').value; }
  function options() {
    const value = {
      format: $('format').value,
      split: $('split').value,
      from: $('from').value, to: $('to').value,
      media: $('media').checked, mediaTypes:Object.fromEntries(['photo','video','voice','videoMessage','audio','sticker','gif','file'].map(key=>[key,$('type-'+key)?.checked ?? true])),
      anonymize:!!$('anonymize')?.checked, participants:!!$('participants')?.checked && !$('anonymize')?.checked,
      downloadMedia: $('download-media').checked,
      links: $('links').checked, reactions: $('reactions').checked,
      limit: Number($('limit').value)
    };
    if($('type-photo')) value.media=Object.values(value.mediaTypes).some(Boolean);
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
    const selectedScope = scope() === 'selected';
    $('selection-count').textContent = scope() === 'current' ? 'Открытый чат' : selectedScope ? `${count} из ${chats.length} чатов` : `${count} чатов`;
    $('bulk-actions').hidden = !selectedScope;
    $('select-all').disabled = running || !selectedScope || !chats.length;
    $('select-none').disabled = running || !selectedScope || !chats.length;
    list.querySelectorAll('input').forEach(input => { input.disabled = !selectedScope || running; });
  }
  function setChatSelection(checked) {
    if (running || scope() !== 'selected') return;
    list.querySelectorAll('input').forEach(input => { input.checked = checked; });
    updateSelection();
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
  async function downloadMedia(zip, chat, path, report, initialBytes, onProgress, checkpointId = null) {
    let total = initialBytes;
    const used = new Map();
    const media=chat.messages.flatMap(message=>message.attachments);
    const candidates=media.filter(attachment=>attachment.downloadable && attachment.url);
    const posters=candidates.filter(attachment=>attachment.posterUrl).map(attachment=>({kind:'photo',name:'Обложка видео',url:attachment.posterUrl,downloadable:true}));
    const entries=[...new Map([...candidates,...posters].map(attachment=>[attachment.url,attachment])).values()];
    let completed = 0;
    onProgress(completed, entries.length);
    for (const attachment of entries) {
      if (stopped) break;
      if (!attachment.downloadable || !attachment.url || used.has(attachment.url)) continue;
      let timer;
      try {
        const url = new URL(attachment.inlineData || attachment.url);
        const mediaHost = url.hostname === 'max.ru' || url.hostname.endsWith('.max.ru') || ['i.oneme.ru', 'fd.oneme.ru'].includes(url.hostname) || /^maxvd\d+\.okcdn\.ru$/.test(url.hostname);
        const inlineAudio = attachment.kind==='voice' && /^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(attachment.inlineData || '') && attachment.inlineData.length<=36*1024*1024;
        if (!inlineAudio && (url.protocol !== 'https:' || !mediaHost)) throw new Error('Адрес вне разрешённых доменов медиа');
        if (total >= 250 * 1024 * 1024) throw new Error('Лимит архива');
        const controller = new AbortController(); currentAbort = controller;
        const video = attachment.kind === 'video' || attachment.mimeType?.startsWith('video/') || /^maxvd\d+\.okcdn\.ru$/.test(url.hostname);
        timer = setTimeout(() => controller.abort(), video ? 120000 : 30000);
        const response = await fetch(url.href, { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const size = Number(response.headers.get('content-length'));
        if (size > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ');
        const bytes = await readLimited(response, controller, 25 * 1024 * 1024);
        attachment.mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (bytes.length > 25 * 1024 * 1024 || total + bytes.length > 250 * 1024 * 1024) throw new Error('Превышен лимит размера');
        let name = ArchiveFormat.safeName(attachment.name || decodeURIComponent(url.pathname.split('/').pop()) || attachment.kind);
        if (!/\.[A-Za-z0-9]{1,6}$/.test(name)) {
          const type = response.headers.get('content-type') || '';
          const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/webm': '.webm', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'application/pdf': '.pdf' }[type.split(';')[0].trim().toLowerCase()] || '';
          name += ext;
        }
        const localPath = `media/${String(used.size + 1).padStart(4, '0')}-${name}`;
        if(durable && checkpointId) {
          try {await durable.file(checkpointId,attachment.url,{localPath,bytes,mimeType:attachment.mimeType});}
          catch(error) {error.code='CHECKPOINT_WRITE';throw error;}
        }
        zip.add(`${path}/${localPath}`, bytes);
        used.set(attachment.url, localPath);
        total += bytes.length;
      } catch (error) { if(error.code==='CHECKPOINT_WRITE') {error.message=`Не удалось сохранить копию файла: ${error.message}`;throw error;} report.skippedMedia.push({ url: attachment.url, reason: error.name === 'AbortError' ? 'Превышено время загрузки' : error.message }); }
      finally { clearTimeout(timer); currentAbort = null; completed++; onProgress(completed, entries.length); }
    }
    for (const message of chat.messages) for (const attachment of message.attachments) {
      if (used.has(attachment.url)) {attachment.localPath = used.get(attachment.url);delete attachment.inlineData;}
      if (attachment.posterUrl && used.has(attachment.posterUrl)) attachment.posterPath=used.get(attachment.posterUrl);
    }
    for (const message of chat.messages) for (const attachment of message.attachments) {
      if (attachment.source === 'download-button') report.skippedMedia.push({ name: attachment.name, reason: 'Веб-версия не показывает прямой адрес файла' });
      if (attachment.source === 'voice-tile') report.skippedMedia.push({name:attachment.name,reason:'Не удалось получить голосовое сообщение',detail:attachment.resolutionError || 'message_not_revisited'});
      if (attachment.source === 'photo-tile') report.skippedMedia.push({ name: attachment.name, reason: 'Не удалось получить фотографию из просмотрщика MAX', detail: attachment.resolutionError || 'message_not_revisited', diagnostics: attachment.resolutionDiagnostics });
    }
    return total;
  }
  async function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const id=await chrome.downloads.download({ url, filename, saveAs: false });
      if(!Number.isInteger(id)) throw new Error('Браузер не подтвердил запуск скачивания. Проверьте список загрузок.');
      if(chrome.downloads.onChanged && chrome.downloads.search) await new Promise((resolve,reject)=>{
        const finish=(error)=>{clearTimeout(timer);chrome.downloads.onChanged.removeListener(changed);error?reject(error):resolve();};
        const changed=delta=>{if(delta.id!==id) return;if(delta.state?.current==='complete') finish();if(delta.error || delta.state?.current==='interrupted') finish(new Error(`Загрузка прервана браузером: ${delta.error?.current || 'interrupted'}`));};
        const timer=setTimeout(()=>finish(new Error('Браузер не подтвердил завершение скачивания. Проверьте список загрузок.')),120000);
        chrome.downloads.onChanged.addListener(changed);
        chrome.downloads.search({id}).then(items=>{const item=items[0];if(item?.state==='complete') finish();else if(item?.state==='interrupted') finish(new Error(`Загрузка прервана: ${item.error || 'interrupted'}`));},finish);
      });
    }
    finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }
  async function saveZip(zip, filename) { await saveBlob(zip.blob(), filename); }
  async function run() {
    if (running || recoveryBusy) return;
    let reportTabId = null;
    try {
      const selected = selection(), settings = options();
      if (!selected.length) throw new Error('Выберите хотя бы один чат.');
      const perChat = settings.split === 'by-chat';
      running = true; stopped = false; recoveryControls(true); start.disabled = true; cancel.hidden = false;
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
      reportTabId = (await chrome.tabs.getCurrent())?.id ?? null;
      // MAX needs an active tab: background timer throttling can consume the
      // history deadline before even one screenful has been traversed.
      await showMax();
      const combinedZip = perChat ? null : new ZipArchive();
      const report = { exportedAt: new Date().toISOString(), extensionVersion: chrome.runtime.getManifest().version, source: 'web.max.ru', options: settings, discoveryComplete: scope() === 'current' ? null : discoveryComplete, chats: [], skippedMedia: [], errors: [], mediaBytes: 0 };
      const runId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      for (let index = 0; index < selected.length; index++) {
        if (stopped) break;
        const info = selected[index];
        const checkpointId=`${runId}:${index}`;
        const saveCopy = async (chat,state) => {if(durable) {try {await durable.put({id:checkpointId,chat:ArchiveFormat.prepareChat?ArchiveFormat.prepareChat(chat,settings):chat,settings,path:filename(index,chat),state,extensionVersion:report.extensionVersion});} catch(error){error.code='CHECKPOINT_WRITE';throw error;}$('checkpoint-text').textContent=`Копия сохранена · сообщений: ${chat.messages.length} · ${new Date().toLocaleTimeString('ru-RU')}`;}};
        note(`Чат ${index + 1} из ${selected.length}: ${info?.title || 'открытый чат'}`);
        rows[index].textContent = `${info?.title || 'Открытый чат'} — чтение истории`;
        stage(`Чат ${index + 1} из ${selected.length}: чтение истории…`);
        try {
          const result = await call('export', { chat: info, options: settings }, value => {
            visibilityPrompt(value.stage === 'visibility');
            const phase = value.stage === 'visibility' ? 'Ожидание показа MAX — откройте вкладку MAX' : value.stage === 'participants' ? `Чтение списка участников: ${value.memberCount || 0}` : value.stage === 'opening' ? 'Открытие чата' : value.stage === 'waiting' ? 'MAX подготавливает историю' : value.stage === 'history-ready' ? 'История прочитана' : value.stage === 'resolving' ? 'Получение адресов файлов' : 'Загрузка истории';
            const files = value.stage === 'resolving' ? `; получение адресов: ${value.fileCount || 0} из ${value.fileTotal || 0}${value.fileName ? `; ${value.fileName}, ${value.fileElapsed || 0} с` : ''}` : '';
            stage(`Чат ${index + 1} из ${selected.length}: ${phase}, найдено ${value.count} сообщений${files}`, value.stage === 'resolving' ? value.fileCount : null, value.fileTotal);
            rows[index].textContent = `${value.title} — ${phase[0].toLowerCase() + phase.slice(1)}, ${value.count} сообщений`;
          }, chat => saveCopy(chat,'history'));
          stage(`Чат ${index + 1} из ${selected.length}: подготовка сообщений…`);
          if(ArchiveFormat.prepareChat) Object.assign(result,ArchiveFormat.prepareChat(result,settings));
          const unknownDates = result.messages.filter(message => !ArchiveFormat.dateOf(message)).length;
          result.messages = ArchiveFormat.filter(result.messages, settings);
          await saveCopy(result,'media');
          const path = filename(index, result);
          const zip = perChat ? new ZipArchive() : combinedZip;
          const skippedBefore = report.skippedMedia.length;
          let chatMediaBytes = 0;
          if (settings.media && settings.downloadMedia && !stopped) {
            rows[index].textContent = `${result.title} — загрузка вложений`;
            const total = await downloadMedia(zip, result, path, report, perChat ? 0 : report.mediaBytes, (done, count) => {
              stage(`Чат ${index + 1} из ${selected.length}: скачивание файлов ${done} из ${count}`, done, count);
            },checkpointId);
            chatMediaBytes = perChat ? total : total - report.mediaBytes;
            report.mediaBytes += chatMediaBytes;
          }
          await saveCopy(result,'ready');
          stage(`Чат ${index + 1} из ${selected.length}: создание ZIP…`);
          ArchiveFormat.add(zip, path, result, settings.format);
          const summary = { title: result.title, path, messages: result.messages.length, complete: result.complete, reason: result.reason, gaps: result.gaps, unknownDates, participants:result.participants?.length || 0,participantsStatus:result.participantsStatus || 'unavailable', history: result.history };
          if (perChat) {
            zip.add('report.json', JSON.stringify({ ...report, chats: [summary], skippedMedia: report.skippedMedia.slice(skippedBefore), mediaBytes: chatMediaBytes }, null, 2));
            await saveZip(zip, `max-archive-${path}.zip`);
          }
          report.chats.push(summary);
          rows[index].textContent = `${result.title} — ${result.messages.length} сообщений${result.complete ? ', готово' : ', история загружена частично'}`;
        } catch (error) {
          report.errors.push({ chat: info?.title || 'Открытый чат', error: error.message });
          rows[index].textContent = `${info?.title || 'Открытый чат'} — ошибка: ${error.message}`;
          if (['MAX_HIDDEN','CHECKPOINT_WRITE','EXPORT_BUSY'].includes(error.code)) stopped = true;
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
        stage(stopped ? 'Экспорт остановлен' : 'Экспорт завершён');
      } else note(report.errors[0]?.error || 'Нет данных для архива.', true);
    } catch (error) { note(error.message, true); }
    finally {
      visibilityPrompt(false);
      running = false; start.disabled = false; cancel.hidden = true; stageProgress.hidden = true; updateSelection();
      await renderRecovery();
      if (reportTabId != null) {
        try { await chrome.tabs.update(reportTabId, { active: true }); } catch { /* The report tab may have been closed. */ }
      }
    }
  }
  async function recoverCopy(id,feedback=null,button=null) {
    const show=(text,error=false)=>{if(feedback){feedback.textContent=text;feedback.className=`recovery-feedback${error?' error':''}`;}note(text,error);};
    if(running || recoveryBusy) {show('Дождитесь завершения текущего экспорта или скачивания копии.');return false;}
    recoveryBusy=true;start.disabled=true;recoveryControls(true);
    if(button) button.textContent='Создаём ZIP…';
    show('Чтение сохранённой копии…');
    try {
      await new Promise(resolve=>setTimeout(resolve,0));
      const saved=await durable.get(id);
      if(!saved?.chat?.messages) throw new Error('Сохранённая копия не найдена или повреждена.');
      const files=await durable.files(id), zip=new ZipArchive();
      const chat=ArchiveFormat.prepareChat?ArchiveFormat.prepareChat(saved.chat,saved.settings):saved.chat;
      const byUrl=new Map(files.map(file=>[file.url,file]));
      let recoveredVoices=0;
      chat.messages=ArchiveFormat.filter(chat.messages,saved.settings);
      for(const message of chat.messages) for(const attachment of message.attachments) {
        delete attachment.localPath;delete attachment.posterPath;
        if(!byUrl.has(attachment.url) && attachment.kind==='voice' && /^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(attachment.inlineData || '') && attachment.inlineData.length<=36*1024*1024) {
          const binary=atob(attachment.inlineData.split(',')[1]);
          if(binary.length<=25*1024*1024) {
            const mimeType=attachment.inlineData.slice(5).split(';')[0];
            const ext={'audio/ogg':'.ogg','audio/mpeg':'.mp3','audio/wav':'.wav','audio/webm':'.webm','audio/mp4':'.m4a','audio/aac':'.aac','audio/opus':'.opus'}[mimeType] || '.audio';
            const value={url:attachment.url,localPath:`media/recovered-voice-${++recoveredVoices}${ext}`,mimeType,bytes:Uint8Array.from(binary,char=>char.charCodeAt(0))};
            files.push(value);byUrl.set(attachment.url,value);
          }
        }
        const file=byUrl.get(attachment.url);
        if(file) {attachment.localPath=file.localPath;attachment.mimeType=file.mimeType;delete attachment.inlineData;}
        if(attachment.posterUrl && byUrl.has(attachment.posterUrl)) attachment.posterPath=byUrl.get(attachment.posterUrl).localPath;
      }
      const referenced=new Set(chat.messages.flatMap(message=>message.attachments).flatMap(item=>[item.url,item.posterUrl].filter(Boolean)));
      let count=0;
      for(const file of files) if(referenced.has(file.url)) {
        show(`Создание ZIP: файлов ${++count} из ${files.length}…`);
        await new Promise(resolve=>setTimeout(resolve,0));
        const bytes=file.bytes instanceof Uint8Array?file.bytes : file.bytes?.arrayBuffer?new Uint8Array(await file.bytes.arrayBuffer()):ArrayBuffer.isView(file.bytes)?new Uint8Array(file.bytes.buffer,file.bytes.byteOffset,file.bytes.byteLength):file.bytes instanceof ArrayBuffer?new Uint8Array(file.bytes):Array.isArray(file.bytes)?new Uint8Array(file.bytes):null;
        if(!bytes) throw new Error('В сохранённой копии повреждены данные вложения. Сообщения остаются в хранилище.');
        zip.add(`${saved.path}/${file.localPath}`,bytes);
      }
      ArchiveFormat.add(zip,saved.path,chat,saved.settings.format);
      const missing=chat.messages.flatMap(message=>message.attachments).filter(item=>!item.localPath && item.kind!=='file-or-link');
      zip.add('report.json',JSON.stringify({recovered:true,checkpointAt:saved.updatedAt,extensionVersion:saved.extensionVersion,options:saved.settings,chats:[{title:chat.title,messages:chat.messages.length,complete:chat.complete,reason:chat.reason,history:chat.history,participants:chat.participants?.length || 0,participantsStatus:chat.participantsStatus || 'unavailable'}],missingFiles:missing.length},null,2));
      show('Скачивание восстановленного ZIP…');
      await saveZip(zip,`max-recovered-${saved.path}.zip`);
      show(`Копия скачана. Сообщений: ${chat.messages.length}; файлов без локальной копии: ${missing.length}.`);
      return true;
    } catch(error) {show(`Не удалось скачать копию: ${error.message}`,true);return false;}
    finally {recoveryBusy=false;start.disabled=running;recoveryControls(running);if(button) button.textContent='Скачать сохранённое';}
  }
  async function renderRecovery() {
    if(!durable) return;
    try {
      const saved=await durable.list(), container=$('recovery-list');
      container.replaceChildren();$('recovery-panel').hidden=!saved.length;
      for(const copy of saved) {
        const row=document.createElement('div');row.className='recovery-row';
        const info=document.createElement('div');info.className='recovery-info';
        const title=document.createElement('strong');title.textContent=copy.title;
        const detail=document.createElement('small');
        const state={history:'Чтение истории',media:'Обработка вложений',ready:'Подготовлено к сохранению'}[copy.state] || 'Копия';
        detail.textContent=`Сообщений: ${copy.messages} · ${new Date(copy.updatedAt).toLocaleString('ru-RU')} · ${state}`;
        info.append(title,detail);
        const actions=document.createElement('div');actions.className='actions';
        const download=document.createElement('button');download.className='secondary';download.textContent='Скачать сохранённое';download.disabled=running;
        const feedback=document.createElement('div');feedback.className='recovery-feedback';feedback.setAttribute('role','status');
        download.addEventListener('click',()=>recoverCopy(copy.id,feedback,download));
        const remove=document.createElement('button');remove.className='text-button';remove.textContent='Удалить копию';remove.disabled=running;
        remove.addEventListener('click',async()=>{if(running || recoveryBusy) return;try{await durable.remove(copy.id);await renderRecovery();}catch(error){note(error.message,true);}});
        actions.append(download,remove);row.append(info,actions,feedback);container.append(row);
      }
    } catch(error) {note(`Сохранённые копии недоступны: ${error.message}`,true);}
  }
  async function init() {
    await renderRecovery();
    try {
      const saved = (await chrome.storage.local.get('settings')).settings || defaults;
      for (const key of ['format', 'split', 'from', 'to', 'limit']) if (saved[key] != null && $(key)) $(key).value = saved[key];
      for (const [key, id] of [['anonymize','anonymize'],['participants','participants'],['media', 'media'], ['downloadMedia', 'download-media'], ['links', 'links'], ['reactions', 'reactions']]) if($(id)) $(id).checked = saved[key] ?? (key==='participants'?true:defaults[key]);
      for(const key of ['photo','video','voice','videoMessage','audio','sticker','gif','file']) if($('type-'+key)) $('type-'+key).checked=saved.mediaTypes?.[key] ?? (saved.media!==false);
      updatePeriod();updatePrivacy();
      connect();
      const current = await call('current');
      note(current.title ? `Открыт чат: ${current.title}` : 'Выберите чат в MAX.');
      if (quick) run(); else refresh();
    } catch (error) { note(error.message, true); start.disabled = true; }
  }
  document.querySelectorAll('input[name="scope"]').forEach(input => input.addEventListener('change', updateSelection));
  $('refresh').addEventListener('click', refresh);
  $('select-all').addEventListener('click', () => setChatSelection(true));
  $('select-none').addEventListener('click', () => setChatSelection(false));
  start.addEventListener('click', run);
  function stopExport() { stopped = true; currentAbort?.abort(); port?.postMessage({ type: 'cancel' }); note('Останавливаем после текущего шага…'); visibilityPrompt(false); }
  $('from')?.addEventListener('change',updatePeriod);
  $('to')?.addEventListener('change',updatePeriod);
  $('anonymize')?.addEventListener('change',updatePrivacy);
  cancel.addEventListener('click', stopExport);
  init();
})();

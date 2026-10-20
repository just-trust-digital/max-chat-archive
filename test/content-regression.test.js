const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadContent(document, { instantWait = false, capture = null, runtime = null, pageTimer = setTimeout } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const instrumented = (instantWait ? source.replace(/const wait = ms =>[^\n]+/, 'const wait = () => Promise.resolve();') : source)
    .replace(/\}\)\(\);\s*$/, 'if (captureOverride) captureButton = captureOverride; globalThis.contentUnderTest = { discover, extract, snapshot, attachmentsOf, exportOpen, openChat, activeChatGuard, mergeOlder, openedTitle, capturePhoto };})();');
  assert.notEqual(instrumented, source, 'content test seam should load');
  const context = {
    document,
    window: capture ? {} : undefined,
    captureOverride: capture,
    location: { href: 'https://web.max.ru/' },
    URL,
    setTimeout: pageTimer,
    setInterval, clearInterval,
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    WheelEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    getComputedStyle: element => ({ overflowY: element.overflowY || 'visible' }),
    chrome: { runtime: runtime || { onConnect: { addListener() {} } } }
  };
  vm.runInNewContext(instrumented, context);
  return context.contentUnderTest;
}

test('photo uses its visible image without waiting for a download button', async () => {
  let open = false, clicks = 0, closed = false;
  const image = { currentSrc: 'https://i.oneme.ru/photo.jpg', naturalWidth: 1000, naturalHeight: 462, closest: () => null };
  const viewer = {
    querySelectorAll: () => [image],
    querySelector: selector => selector.includes('Close') ? { click() { closed = true; open = false; } } : { click() {} }
  };
  const api = loadContent({ querySelector: () => open ? viewer : null }, {
    instantWait: true, capture: async () => { clicks++; return null; }
  });
  const result = await api.capturePhoto({ click() { open = true; } }, () => {});
  assert.equal(clicks, 0, 'do not wait for an original when viewer URL is ready');
  assert.equal(result.url, image.currentSrc);
  assert.equal(result.quality, 'viewer');
  assert.equal(closed, true);
});

test('lazy MAX photo must enter the viewport before its click opens a viewer', async () => {
  let visible=false,open=false;
  const image={currentSrc:'https://i.oneme.ru/photo.jpg',naturalWidth:1200,naturalHeight:800,closest:()=>null};
  const viewer={querySelectorAll:()=>[image],querySelector:()=>({click(){open=false;}})};
  const tile={scrollIntoView(){visible=true;},click(){if(visible)open=true;}};
  const api=loadContent({querySelector:()=>open?viewer:null},{instantWait:true,capture:async()=>null});
  const result=await api.capturePhoto(tile,()=>{});
  assert.equal(result?.url,image.currentSrc);
  assert.equal(open,false);
});

test('media inventory is refreshed after MAX hydrates a video placeholder', async () => {
  let hydrated=false;
  const tile={querySelector:()=>null};
  const video={tagName:'VIDEO',textContent:'',closest:()=>null,hasAttribute:()=>false,getAttribute:name=>name==='src'?'https://maxvd640.okcdn.ru/video.mp4':null};
  const row=messageRow({text:'Видео'});
  row.scrollIntoView=()=>{hydrated=true;};
  row.querySelectorAll=selector=>selector.includes('button.tile')?(hydrated?[]:[tile]):(hydrated?[video]:[]);
  const root={querySelector:selector=>selector==='.messageWrapper'?row:{textContent:'Чат'}};
  const document={title:'MAX',querySelector:selector=>selector==='.openedChat'?root:null,querySelectorAll:()=>[row]};
  const result=await loadContent(document,{instantWait:true,capture:async()=>null}).exportOpen({limit:100,media:true,downloadMedia:true},()=>{});
  assert.equal(result.messages[0].attachments.length,1);
  assert.equal(result.messages[0].attachments[0].kind,'video');
  assert.equal(result.messages[0].attachments[0].downloadable,true);
});

function messageRow({ author = 'Екатерина Волкова', text = 'Добрый вечер', time = '17:58', previousElementSibling = null, ownDate = null } = {}) {
  const header = { textContent: author, innerText: author };
  const textElement = { textContent: text, innerText: text };
  const meta = { textContent: time, innerText: time };
  const bubble = {
    textContent: `${author}\n${text}\n${time}`,
    innerText: `${author}\n${text}\n${time}`,
    querySelector(selector) { return selector.includes('.text') ? textElement : null; },
    querySelectorAll(selector) { return selector.includes('.text') ? [textElement] : []; }
  };
  const message = {
    querySelector(selector) {
      if (selector === '.bubbleContent') return bubble;
      if (selector === 'time') return null;
      if (selector.includes('meta')) return meta;
      return null;
    }
  };
  const row = {
    classList: { contains: () => false },
    parentElement: null,
    querySelector(selector) {
      if (selector === '.message') return message;
      if (selector.includes('header')) return header;
      if (selector.includes('sender') || selector.includes('author')) return null;
      return null;
    },
    querySelectorAll() { return []; },
    closest() { return { previousElementSibling, querySelector: () => ownDate ? { textContent: ownDate } : null }; }
  };
  return row;
}

test('date separator applies to following messages in the same day', () => {
  const first = messageRow({ ownDate: '18 октября 2026' });
  const second = messageRow({ text: 'Второе сообщение', previousElementSibling: { querySelector: () => null } });
  const content = loadContent({ querySelectorAll: () => [first, second] });
  const rows = content.snapshot();
  assert.equal(rows[0].dateLabel, '18 октября 2026');
  assert.equal(rows[1].dateLabel, '18 октября 2026');
});

test('MAX capsule dates are found in preceding outer items, skipping New messages', () => {
  const separator = { previousElementSibling: null, querySelector: () => ({ textContent: 'October 18, 2026' }) };
  const previousMessage = { previousElementSibling: separator, querySelector: () => null };
  const unread = { previousElementSibling: previousMessage, querySelector: () => ({ textContent: 'New messages' }) };
  const container = { previousElementSibling: unread, querySelector: () => null };
  const row = messageRow();
  row.closest = selector => selector === '.item' ? container : null;
  const result = loadContent({ querySelectorAll: () => [row] }).snapshot();
  assert.equal(result[0].dateLabel, 'October 18, 2026');
});

test('discovery returns to the chat list when compact MAX has unmounted its rows', async () => {
  let opened = true, returned = 0;
  const row = { getClientRects: () => [1], parentElement: null, innerText: 'Чат', querySelector: selector => selector === 'a[href]' ? null : selector === '.cell' ? { click() { opened = true; } } : { textContent: 'Чат' }, getAttribute: () => null };
  const list = { clientHeight: 100, scrollHeight: 100, parentElement: null, get scrollTop() { return 0; }, set scrollTop(_value) {} };
  const root = { querySelector: selector => selector.includes('Go back') ? { click() { opened = false; returned++; } } : selector.includes('messageWrapper') ? {} : { textContent: 'Чат' } };
  const document = { body: {}, title: 'MAX', querySelector: selector => selector === '.aside' ? list : selector === '.openedChat' && opened ? root : null, querySelectorAll: () => opened ? [] : [row] };
  const result = await loadContent(document, { instantWait: true }).discover();
  assert.equal(result.chats.length, 1);
  assert.equal(returned, 1);
  assert.equal(opened, true, 'restore the original chat for current-chat export');
  assert.equal(result.complete, true);
});

test('sender header and message text are separated', () => {
  const content = loadContent({});
  const result = content.extract(messageRow(), '18 октября 2026');
  assert.equal(result.author, 'Екатерина Волкова');
  assert.equal(result.text, 'Добрый вечер');
});

test('nested header and meta text do not become message body', () => {
  const row = messageRow();
  const body = { innerText: 'Здравствуйте', closest: () => null };
  const header = { innerText: 'Анна', closest: () => ({}) };
  const time = { innerText: '01:52 PM ред.', closest: () => ({}) };
  const bubble = { querySelectorAll: () => [header, body, time] };
  const message = row.querySelector('.message');
  const original = message.querySelector;
  message.querySelector = selector => selector === '.bubbleContent' ? bubble : original(selector);
  assert.equal(loadContent({}).extract(row, 'October 18, 2026').text, 'Здравствуйте');
});

test('photo-only message stays empty after metadata is removed', () => {
  const row = messageRow();
  const bubble = { innerText: '04:19 PM', querySelectorAll: () => [], cloneNode: () => ({ innerText: '', textContent: '', querySelectorAll: () => [] }) };
  const message = row.querySelector('.message');
  const original = message.querySelector;
  message.querySelector = selector => selector === '.bubbleContent' ? bubble : original(selector);
  assert.equal(loadContent({}).extract(row, '').text, '');
});

test('file button is captured while emoji image is ignored', () => {
  const emoji = {
    tagName: 'IMG', textContent: '',
    getAttribute: name => name === 'src' ? 'https://st.max.ru/emoji/smile.png' : null,
    closest: selector => selector.includes('emoji') ? {} : null
  };
  const title = { textContent: 'документ.pdf' };
  const file = {
    tagName: 'BUTTON', textContent: 'документ.pdf',
    getAttribute: name => name === 'aria-label' ? 'Скачать' : null,
    querySelector: selector => selector.includes('title') ? title : null
  };
  const row = {
    querySelectorAll(selector) { return selector.includes('button.tile') ? [] : selector.includes('button') ? [emoji, file] : [emoji]; }
  };
  const content = loadContent({});
  const attachments = content.attachmentsOf(row);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'документ.pdf');
});

test('photo tiles with data placeholders are retained as pending photos', () => {
  const tile = { querySelector: () => null };
  const row = { querySelectorAll: selector => selector.includes('button.tile') ? [tile, tile] : [] };
  const photos = loadContent({}).attachmentsOf(row);
  assert.equal(photos.length, 2);
  assert.equal(photos[0].kind, 'photo');
  assert.equal(photos[0].source, 'photo-tile');
  assert.equal(photos[0].url, null);
});

test('audio and video sources retain their media type', () => {
  const elements = ['audio', 'video'].map(kind => ({
    tagName: 'SOURCE', textContent: '', hasAttribute: () => false,
    getAttribute: name => name === 'src' ? `https://i.oneme.ru/${kind}` : name === 'type' ? `${kind}/webm` : null,
    closest: selector => selector === 'audio, video' ? { tagName: kind.toUpperCase() } : null
  }));
  const rows = loadContent({}).attachmentsOf({ querySelectorAll: selector => selector.includes('button.tile') ? [] : elements });
  assert.deepEqual(Array.from(rows, item => item.kind), ['audio', 'video']);
  assert.equal(rows[0].mimeType, 'audio/webm');
});

test('export waits for a scrollable history before treating 30 visible messages as the archive', async () => {
  const scroller = { overflowY: 'auto', scrollHeight: 90, clientHeight: 90, scrollTop: 0, parentElement: null };
  const rows = Array.from({ length: 100 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` });
    row.parentElement = scroller;
    return row;
  });
  let mounted = 30;
  const root = { querySelector: () => rows[0] };
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? root : null,
    querySelectorAll: () => rows.slice(0, mounted)
  };
  const content = loadContent(document);
  setTimeout(() => { mounted = 100; scroller.scrollHeight = 1000; }, 50);
  const result = await content.exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 100);
});

test('reversed history scrolls below zero to load messages older than the first 30', async () => {
  let top = 0;
  let mounted = 30;
  const scroller = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return top; },
    set scrollTop(value) {
      top = Math.max(-900, Math.min(0, value));
      if (top < 0) mounted = 60;
    }
  };
  const rows = Array.from({ length: 60 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` });
    row.parentElement = scroller;
    return row;
  });
  const root = { querySelector: () => rows[60 - mounted] };
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? root : null,
    querySelectorAll: () => rows.slice(60 - mounted)
  };
  const result = await loadContent(document, { instantWait: true }).exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 60);
  assert.ok(top < 0, 'history pane must move into negative scrollTop');
});

test('history continues when page timers are suspended but extension worker is responsive', async () => {
  let top = 900, mounted = 30, workerWaits = 0;
  const scroller = { overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return top; }, set scrollTop(value) { top = Math.max(0, Math.min(900, value)); if (top === 0) mounted = 60; }
  };
  const rows = Array.from({length: 60}, (_, index) => { const row = messageRow({text: `Сообщение ${index}`}); row.parentElement = scroller; return row; });
  const root = {querySelector: selector => selector === '.messageWrapper' ? rows[60-mounted] : {textContent: 'Чат'}};
  const document = { title: 'MAX', querySelector: selector => selector === '.openedChat' ? root : null, querySelectorAll: () => rows.slice(60-mounted) };
  let workerReceive;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'timer-worker.js'), 'utf8'), {
    chrome: {runtime: {id: 'self', onMessage: {addListener(fn) {workerReceive = fn;}}}},
    setTimeout(fn) {workerWaits++; queueMicrotask(fn);}
  });
  const runtime = { onConnect: {addListener() {}}, sendMessage: message => new Promise(resolve => workerReceive(message, {id: 'self'}, resolve)) };
  const work = loadContent(document, {runtime, pageTimer: () => 0}).exportOpen({limit: 100}, () => {});
  const result = await Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error('history blocked by suspended page timers')), 100))]);
  assert.equal(result.messages.length, 60);
  assert.ok(workerWaits > 0);
});

test('hidden MAX must become visible before its history loading edge is crossed', async () => {
  let top=600,mounted=30,activations=0;
  const scroller={overflowY:'auto',scrollHeight:1000,clientHeight:400,parentElement:null,get scrollTop(){return top;},set scrollTop(value){top=Math.max(0,Math.min(600,value));if(top===0&&document.visibilityState==='visible')mounted=60;}};
  const rows=Array.from({length:60},(_,index)=>{const row=messageRow({text:`Сообщение ${index}`});row.parentElement=scroller;return row;});
  const root={querySelector:selector=>selector==='.messageWrapper'?rows[60-mounted]:{textContent:'Чат'}};
  const document={title:'MAX',visibilityState:'hidden',querySelector:selector=>selector==='.openedChat'?root:null,querySelectorAll:()=>rows.slice(60-mounted)};
  let receive;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','timer-worker.js'),'utf8'),{
    chrome:{runtime:{id:'self',onMessage:{addListener(fn){receive=fn;}}},tabs:{async update(id){assert.equal(id,7);activations++;document.visibilityState='visible';}},windows:{async update(){}}},
    setTimeout:fn=>queueMicrotask(fn)
  });
  const runtime={onConnect:{addListener(){}},sendMessage:message=>new Promise(resolve=>receive(message,{id:'self',tab:{id:7,windowId:2}},resolve))};
  const result=await loadContent(document,{runtime}).exportOpen({limit:100},()=>{});
  assert.equal(activations,1);
  assert.equal(result.messages.length,60);
});

test('embedded browser that cannot show MAX returns a visibility error instead of a 30-message archive', async () => {
  let shown=0;
  const row=messageRow();
  const root={querySelector:()=>({textContent:'Чат'})};
  const document={visibilityState:'hidden',title:'MAX',querySelector:()=>root,querySelectorAll:()=>[row]};
  const runtime={onConnect:{addListener(){}},async sendMessage(message){if(message.type==='max-archive-show')shown++;return {ok:true};}};
  await assert.rejects(loadContent(document,{runtime}).exportOpen({limit:100},()=>{}),error=>error.code==='MAX_HIDDEN');
  assert.equal(shown,1);
});

test('unmoving history is reported as partial instead of complete', async () => {
  const scroller = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return 0; }, set scrollTop(_value) {}
  };
  const rows = Array.from({ length: 30 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` });
    row.parentElement = scroller;
    return row;
  });
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? { querySelector: () => rows[0] } : null,
    querySelectorAll: () => rows
  };
  const result = await loadContent(document, { instantWait: true }).exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 30);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'scroll_stalled');
});

test('a moving pane with only the initial 30 messages is not called complete', async () => {
  let top = 900;
  const scroller = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(900, value)); }
  };
  const rows = Array.from({ length: 30 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` });
    row.parentElement = scroller;
    return row;
  });
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? { querySelector: () => rows[0] } : null,
    querySelectorAll: () => rows
  };
  const result = await loadContent(document, { instantWait: true }).exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 30);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'history_not_expanded');
});

test('history notifies the top edge without fabricating wheel input', async () => {
  let top = 900, mounted = 30;
  const events = [];
  const scroller = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(900, value)); },
    dispatchEvent(event) {
      events.push(event.type);
      if (event.type === 'scroll' && top === 0) mounted = 60;
      return true;
    }
  };
  const rows = Array.from({ length: 60 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` }); row.parentElement = scroller; return row;
  });
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? { querySelector: () => rows[60 - mounted] } : null,
    querySelectorAll: () => rows.slice(60 - mounted)
  };
  const result = await loadContent(document, { instantWait: true }).exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 60);
  assert.ok(events.includes('scroll'));
  assert.ok(!events.includes('wheel'));
  assert.ok(result.history.scrollAttempts > 0);
  assert.equal(result.history.initialMessages, 30);
  assert.equal(result.history.lastSteps.at(-1).collected, 60);
});

test('initial MAX history crosses directly to the loading edge rather than creeping there', async () => {
  let top = 600, mounted = 30;
  const scroller = {overflowY: 'auto', scrollHeight: 1000, clientHeight: 400, parentElement: null,
    get scrollTop() {return top;}, set scrollTop(value) {const previous = top;top=Math.max(0,Math.min(600,value));if(top===0 && previous>400) mounted=60;}
  };
  const rows=Array.from({length:60},(_, index)=>{const row=messageRow({text:`Сообщение ${index}`});row.parentElement=scroller;return row;});
  const root={querySelector:selector=>selector==='.messageWrapper'?rows[60-mounted]:{textContent:'Чат'}};
  const document={title:'MAX',querySelector:selector=>selector==='.openedChat'?root:null,querySelectorAll:()=>rows.slice(60-mounted)};
  const result=await loadContent(document,{instantWait:true}).exportOpen({limit:100},()=>{});
  assert.equal(result.messages.length,60);
});

test('visible MAX loader prevents early termination before older messages arrive', async () => {
  let top=600,mounted=30,checks=0;
  const scroller={overflowY:'auto',scrollHeight:1000,clientHeight:400,parentElement:null,get scrollTop(){return top;},set scrollTop(value){top=Math.max(0,Math.min(600,value));}};
  const rows=Array.from({length:60},(_,index)=>{const row=messageRow({text:`Сообщение ${index}`});row.parentElement=scroller;return row;});
  const root={querySelector:selector=>selector==='.messageWrapper'?rows[60-mounted]:{textContent:'Чат'},querySelectorAll(){checks++;if(checks>=15){mounted=60;return [];}return [{getClientRects:()=>[1]}];}};
  const document={title:'MAX',querySelector:selector=>selector==='.openedChat'?root:null,querySelectorAll:()=>rows.slice(60-mounted)};
  const result=await loadContent(document,{instantWait:true}).exportOpen({limit:100},()=>{});
  assert.equal(result.messages.length,60);
  assert.ok(checks>=15);
});

test('history retries the first window when the loader binds after the initial edge crossing', async () => {
  let top = 900, ready = false, mounted = 30;
  const scroller = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return top; },
    set scrollTop(value) {
      const previous = top; top = Math.max(0, Math.min(900, value));
      if (top === 0 && previous > 0) { if (ready) mounted = 60; else ready = true; }
    }
  };
  const rows = Array.from({ length: 60 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` }); row.parentElement = scroller; return row;
  });
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? { querySelector: () => rows[60 - mounted] } : null,
    querySelectorAll: () => rows.slice(60 - mounted)
  };
  const result = await loadContent(document, { instantWait: true }).exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 60);
  assert.equal(result.history.restarts, 1);
});

test('history reading reacquires a pane replaced during MAX rendering', async () => {
  let mounted = 30, top = 900, rows;
  const replacement = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(900, value)); if (top < 900) mounted = 60; }
  };
  const original = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, scrollTop: 900, parentElement: null,
    dispatchEvent() { for (const row of rows) row.parentElement = replacement; return true; }
  };
  rows = Array.from({ length: 60 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` }); row.parentElement = original; return row;
  });
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? { querySelector: () => rows[60 - mounted] } : null,
    querySelectorAll: () => rows.slice(60 - mounted)
  };
  const result = await loadContent(document, { instantWait: true }).exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 60);
  assert.equal(result.history.paneReplacements, 1);
});

test('file resolution starts after history loading and revisits virtualized messages', async () => {
  let top = 900, olderLoaded = false;
  const phases = [], captures = [];
  const scroller = {
    overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, parentElement: null,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(900, value)); if (top === 0) olderLoaded = true; }
  };
  const rows = Array.from({ length: 60 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` }); row.parentElement = scroller;
    const button = { tagName: 'BUTTON', textContent: `file-${index}.pdf`, querySelector: () => ({ textContent: `file-${index}.pdf` }), getAttribute: () => 'Скачать', index };
    if (index === 0 || index === 59) row.querySelectorAll = selector => selector.includes('button') ? [button] : [];
    return row;
  });
  // The oldest window overlaps the newest one by five messages, then is unmounted on return to the bottom.
  const visible = () => olderLoaded && top < 900 ? rows.slice(0, 35) : rows.slice(30);
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? { querySelector: () => visible()[0] } : null,
    querySelectorAll: () => visible()
  };
  const content = loadContent(document, { instantWait: true, capture: async button => {
    assert.ok(phases.includes('history-ready'), 'must finish loading before clicking a file');
    captures.push(button.index);
    return { url: `https://fd.oneme.ru/file-${button.index}.pdf`, name: `server-file-${button.index}.pdf` };
  } });
  const result = await content.exportOpen({ limit: 100, media: true, downloadMedia: true }, value => phases.push(value.stage));
  assert.equal(result.messages.length, 60);
  assert.deepEqual(captures.sort((a,b) => a-b), [0, 59]);
  assert.equal(result.messages[0].attachments[0].url, 'https://fd.oneme.ru/file-0.pdf');
  assert.equal(result.messages[59].attachments[0].url, 'https://fd.oneme.ru/file-59.pdf');
  phases.length = 0; captures.length = 0;
  const limited = await content.exportOpen({ limit: 40, media: true, downloadMedia: true }, value => phases.push(value.stage));
  assert.equal(limited.messages.length, 40);
  assert.equal(limited.reason, 'message_limit');
  assert.deepEqual(captures, [59], 'do not resolve files outside the requested history');
});

test('switching chats waits for the new conversation instead of accepting old messages', async () => {
  let root = { querySelector: selector => selector.includes('messageWrapper') ? {} : { textContent: 'Первый чат' } };
  const location = { href: 'https://web.max.ru/c/first' };
  let selected = false;
  let cellClicked = false;
  const cell = { click() {
    cellClicked = true;
    setTimeout(() => {
      selected = true;
      location.href = 'https://web.max.ru/c/second';
      root = { querySelector: selector => selector.includes('messageWrapper') ? {} : { textContent: 'Второй чат 1 из 3 в сети' } };
    }, 450);
  } };
  const row = {
    innerText: 'Второй чат',
    getClientRects: () => [1],
    getAttribute: () => null,
    querySelector: selector => selector === 'a[href]' ? { getAttribute: () => '/c/second' } : selector === '.cell--selected' ? (selected ? cell : null) : selector === '.cell' ? cell : { textContent: 'Второй чат' },
    click() { throw Error('outer wrapper must not be clicked'); }
  };
  const list = { scrollTop: 0, clientHeight: 500 };
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.aside' ? list : selector === '.openedChat' ? root : null,
    querySelectorAll: () => [row]
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'globalThis.openChatUnderTest = openChat;})();');
  const context = { document, location, setTimeout, getComputedStyle: () => ({ overflowY: 'visible' }), chrome: { runtime: { onConnect: { addListener() {} } } } };
  vm.runInNewContext(instrumented, context);
  const started = Date.now();
  const guard = await context.openChatUnderTest({ key: '/c/second', title: 'Второй чат' });
  assert.equal(cellClicked, true);
  assert.ok(Date.now() - started >= 700, 'must wait for new chat content after clicking');
  guard();
  selected = false;
  assert.throws(() => guard(), /больше не открыт/);
});

test('manual chat switch interrupts history reading without returning another chat', async () => {
  const scroller = { overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, scrollTop: 900, parentElement: null };
  const row = messageRow();
  row.parentElement = scroller;
  const root = { querySelector: () => row };
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? root : null,
    querySelectorAll: () => [row]
  };
  const content = loadContent(document);
  let active = true;
  setTimeout(() => { active = false; }, 600);
  await assert.rejects(content.exportOpen({ limit: 100 }, () => {}, () => {
    if (!active) throw new Error('Другой чат открыт');
  }), /Другой чат открыт/);
});

test('rerendered selected chat row retains identity despite changed preview text', () => {
  const makeRow = (title, preview) => ({
    innerText: `${title}\n${preview}`,
    querySelector(selector) {
      if (selector === '.cell--selected') return {};
      if (selector.includes('title')) return { textContent: title };
      return null;
    }
  });
  const original = makeRow('2 "А" класс', 'старое сообщение');
  let selected = original;
  const root = { querySelector: () => ({ textContent: '2 "А" класс 1 из 22 в сети' }) };
  const document = {
    querySelector: () => root,
    querySelectorAll: () => [selected]
  };
  const content = loadContent(document);
  const guard = content.activeChatGuard({ key: '2 "А" класс|старое сообщение', title: '2 "А" класс' }, original);
  selected = makeRow('2 "А" класс', 'новое сообщение');
  assert.doesNotThrow(() => guard());
  selected = makeRow('Другой чат', 'новое сообщение');
  assert.throws(() => guard(), /больше не открыт/);
});

test('chat archive title excludes changing online member count', () => {
  const root = { querySelector: () => ({ textContent: '2 "А" класс 1 из 22 в сети' }) };
  const content = loadContent({ querySelector: () => root });
  assert.equal(content.openedTitle(), '2 "А" класс');
});

test('header title wins over an earlier subtitle container in document order', () => {
  const root = { querySelector: selector => ({ textContent: selector === '.header .title' ? '2 "А" класс ' : '2 "А" класс 1 of 22 online' }) };
  const content = loadContent({ querySelector: () => root });
  assert.equal(content.openedTitle(), '2 "А" класс');
});

test('selected chat opens when MAX unmounts the sidebar after navigation', async () => {
  let opened = false;
  let title = '2 "А" класс';
  const cell = { click() { opened = true; } };
  const row = {
    innerText: title, getClientRects: () => [1], parentElement: null,
    querySelector(selector) {
      if (selector === 'a[href]') return { getAttribute: () => '/c/class' };
      if (selector === '.cell') return cell;
      if (selector === '.cell--selected') return null;
      return { textContent: title };
    }
  };
  const root = { querySelector: selector => selector.includes('messageWrapper') ? {} : { textContent: title } };
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.aside' ? { scrollTop: 0, clientHeight: 500 } : selector === '.openedChat' && opened ? root : null,
    querySelectorAll: () => opened ? [] : [row]
  };
  const content = loadContent(document, { instantWait: true });
  const guard = await content.openChat({ key: '/c/class', title });
  assert.equal(opened, true);
  assert.doesNotThrow(guard);
  title = 'Другой чат';
  assert.throws(guard, /больше не открыт/);
});

test('repeated MAX window with one changed message does not triple the archive', () => {
  const content = loadContent({});
  const message = index => ({ time: `12:${String(index).padStart(2, '0')}`, direction: 'in', text: `Сообщение ${index}`, attachments: [], dateLabel: '' });
  const current = Array.from({ length: 30 }, (_, index) => message(index));
  const repeated = current.map(item => ({ ...item }));
  repeated[28].text += '!';
  const same = content.mergeOlder(current, repeated);
  assert.equal(same.items.length, 30);
  assert.equal(same.gap, false);
  const earlier = [message(-2), message(-1), ...repeated];
  const extended = content.mergeOlder(current, earlier);
  assert.equal(extended.items.length, 32);
  assert.equal(extended.gap, false);
  const unrelated = Array.from({ length: 30 }, (_, index) => message(index + 50));
  const missingOverlap = content.mergeOlder(current, unrelated);
  assert.equal(missingOverlap.items.length, 30);
  assert.equal(missingOverlap.gap, true);
});

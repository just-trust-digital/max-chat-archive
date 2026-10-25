const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

function loadExporter(fetch, timers = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'export.js'), 'utf8');
  const instrumented = source.replace(/\binit\(\);\s*\}\)\(\);\s*$/, 'globalThis.mediaUnderTest = { downloadMedia, readLimited };})();');
  assert.notEqual(instrumented, source);
  const document = {
    getElementById: () => ({ addEventListener() {} }),
    querySelectorAll: () => []
  };
  const context = {
    document, location: { search: '' }, URL, URLSearchParams, Uint8Array,
    AbortController, fetch, setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
    ArchiveFormat: { safeName: name => name }, CheckpointStore: timers.store
  };
  vm.runInNewContext(instrumented, context);
  return context.mediaUnderTest;
}

test('downloaded MAX file is placed into chat ZIP and linked from message', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const exporter = loadExporter(async () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
  const attachment = { name: 'document.pdf', url: 'https://st.max.ru/document.pdf', downloadable: true, source: 'download-button-url' };
  const chat = { messages: [{ attachments: [attachment] }] };
  const files = new Map();
  const zip = { add(name, data) { files.set(name, data); } };
  const report = { skippedMedia: [] };
  const progress = [];
  const count = await exporter.downloadMedia(zip, chat, '001-chat', report, 0, (done, total) => progress.push([done, total]));
  assert.equal(count, 4);
  assert.deepEqual([...files.keys()], ['001-chat/media/0001-document.pdf']);
  assert.equal(attachment.localPath, 'media/0001-document.pdf');
  assert.deepEqual(progress, [[0, 1], [1, 1]]);
  assert.equal(report.skippedMedia.length, 0);
});

test('file outside MAX domains is recorded as skipped without fetching', async () => {
  let fetched = false;
  const exporter = loadExporter(async () => { fetched = true; throw Error('unexpected fetch'); });
  const attachment = { name: 'external.pdf', url: 'https://example.com/external.pdf', downloadable: true };
  const report = { skippedMedia: [] };
  await exporter.downloadMedia({ add() {} }, { messages: [{ attachments: [attachment] }] }, '001-chat', report, 0, () => {});
  assert.equal(fetched, false);
  assert.match(report.skippedMedia[0].reason, /вне разрешённых доменов медиа/);
});

test('MAX image host from a user archive can be downloaded', async () => {
  const exporter = loadExporter(async () => new Response(new Uint8Array([9, 8]), { headers: { 'content-type': 'image/jpeg' } }));
  const attachment = { name: 'photo', url: 'https://i.oneme.ru/i?r=sample', downloadable: true, kind: 'img' };
  const files = new Map();
  const report = { skippedMedia: [] };
  await exporter.downloadMedia({ add(name, bytes) { files.set(name, bytes); } }, { messages: [{ attachments: [attachment] }] }, '001-chat', report, 0, () => {});
  assert.deepEqual([...files.keys()], ['001-chat/media/0001-photo.jpg']);
  assert.equal(report.skippedMedia.length, 0);
});

test('MAX document and video hosts from a user archive can be downloaded', async () => {
  const fetched = [];
  const exporter = loadExporter(async url => {
    fetched.push(url);
    return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': url.includes('okcdn.ru') ? 'video/mp4' : 'application/octet-stream' } });
  });
  const attachments = [
    { name: 'document.docx', url: 'https://fd.oneme.ru/getfile?rq=sample', downloadable: true, kind: 'file' },
    { name: '', url: 'https://maxvd505.okcdn.ru/?id=sample', downloadable: true, kind: 'source' }
  ];
  const files = new Map();
  const report = { skippedMedia: [] };
  await exporter.downloadMedia({ add(name, bytes) { files.set(name, bytes); } }, { messages: [{ attachments }] }, '001-chat', report, 0, () => {});
  assert.equal(fetched.length, 2);
  assert.deepEqual([...files.keys()], ['001-chat/media/0001-document.docx', '001-chat/media/0002-source.mp4']);
  assert.equal(report.skippedMedia.length, 0);
});

test('other okcdn hosts stay outside the media allowlist', async () => {
  let fetched = false;
  const exporter = loadExporter(async () => { fetched = true; throw Error('unexpected fetch'); });
  const attachment = { name: 'other', url: 'https://other.okcdn.ru/file', downloadable: true };
  const report = { skippedMedia: [] };
  await exporter.downloadMedia({ add() {} }, { messages: [{ attachments: [attachment] }] }, '001-chat', report, 0, () => {});
  assert.equal(fetched, false);
  assert.equal(report.skippedMedia.length, 1);
});

test('media rejects forged domains, alternate ports and URL credentials before requesting', async () => {
  let requests = 0;
  const exporter = loadExporter(async () => { requests++; throw Error('unexpected fetch'); });
  const urls = ['https://st.max.ru.evil.invalid/a', 'https://st.max.ru@evil.invalid/a',
    'https://st.max.ru:8443/a', 'https://user:pass@st.max.ru/a', 'http://st.max.ru/a',
    'file:///private', 'javascript:alert(1)', 'data:text/html,test', 'blob:https://web.max.ru/fake'];
  const report = {skippedMedia: []};
  await exporter.downloadMedia({add() {assert.fail('no file may be saved');}},
    {messages: [{attachments: urls.map(url => ({url, downloadable: true}))}]}, 'chat', report, 0, () => {});
  assert.equal(requests, 0);
  assert.equal(report.skippedMedia.length, urls.length);
});

test('real HTTP redirect never requests its destination or stores a foreign response', async t => {
  let destinationRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, {location: '/foreign'}); response.end();
    } else { destinationRequests++; response.end('must not be fetched'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const exporter = loadExporter(async (url, options) => {
    assert.equal(url, 'https://st.max.ru/redirect');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return fetch(origin + '/redirect', options);
  });
  const report = {skippedMedia: []};
  const result = await exporter.downloadMedia({add() {assert.fail('foreign file saved');}},
    {messages: [{attachments: [{url: 'https://st.max.ru/redirect', downloadable: true}]}]},
    'chat', report, 0, () => {});
  assert.equal(destinationRequests, 0);
  assert.equal(result, 0);
  assert.equal(report.skippedMedia.length, 1);
});

test('viewer photo is written as an image and unresolved photo is reported', async () => {
  const exporter = loadExporter(async () => new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } }));
  const photo = { kind: 'photo', name: 'photo-1', source: 'photo-viewer', downloadable: true, url: 'https://i.oneme.ru/i?r=fixture' };
  const missing = { kind: 'photo', name: 'photo-2', source: 'photo-tile', downloadable: false, url: null };
  const files = new Map(), report = { skippedMedia: [] };
  await exporter.downloadMedia({ add(name, bytes) { files.set(name, bytes); } }, { messages: [{ attachments: [photo, missing] }] }, 'chat', report, 0, () => {});
  assert.ok(files.has('chat/media/0001-photo-1.jpg'));
  assert.equal(photo.localPath, 'media/0001-photo-1.jpg');
  assert.equal(report.skippedMedia.length, 1);
  assert.equal(report.skippedMedia[0].name, 'photo-2');
});

test('download records MIME type and creates a playable audio extension', async () => {
  const exporter = loadExporter(async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/ogg; codecs=opus' } }));
  const attachment = { name: 'voice', kind: 'audio', downloadable: true, url: 'https://fd.oneme.ru/file?id=voice' };
  const files = new Map();
  await exporter.downloadMedia({ add: (name, data) => files.set(name, data) }, { messages: [{ attachments: [attachment] }] }, 'chat', { skippedMedia: [] }, 0, () => {});
  assert.equal(attachment.mimeType, 'audio/ogg');
  assert.ok(files.has('chat/media/0001-voice.ogg'));
});

test('video that responds after 40 seconds is not aborted by the image deadline', async () => {
  const scheduled=[];
  const timers={setTimeout(fn,ms){const task={fn,ms,active:true};scheduled.push(task);return task;},clearTimeout(task){if(task)task.active=false;}};
  const exporter=loadExporter((_url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{const error=new Error('aborted');error.name='AbortError';reject(error);});
    timers.setTimeout(()=>resolve(new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}})),40000);
  }),timers);
  const attachment={kind:'video',name:'video',downloadable:true,url:'https://maxvd640.okcdn.ru/video'};
  const files=new Map(),report={skippedMedia:[]};
  const work=exporter.downloadMedia({add:(name,data)=>files.set(name,data)},{messages:[{attachments:[attachment]}]},'chat',report,0,()=>{});
  for(const task of scheduled.filter(task=>task.ms<=45000).sort((a,b)=>a.ms-b.ms)){
    if(task.active)task.fn();await Promise.resolve();
  }
  await work;
  assert.equal(report.skippedMedia.length,0);
  assert.equal(files.size,1);
  assert.equal(attachment.localPath,'media/0001-video.mp4');
});


test('download is persisted before ZIP assembly and a storage failure stops further downloads', async () => {
  const events=[];
  const attachment={name:'photo',url:'https://i.oneme.ru/synthetic.jpg',downloadable:true,kind:'photo'};
  const exporter=loadExporter(async()=>new Response(new Uint8Array([9,8]),{headers:{'content-type':'image/jpeg'}}),{store:{async file(id,url,value){events.push('persist');assert.equal(id,'checkpoint');assert.deepEqual([...value.bytes],[9,8]);}}});
  await exporter.downloadMedia({add(){events.push('zip');}},{messages:[{attachments:[attachment]}]},'001-chat',{skippedMedia:[]},0,()=>{},'checkpoint');
  assert.deepEqual(events,['persist','zip']);
  let fetches=0;
  const failing=loadExporter(async()=>{fetches++;return new Response(new Uint8Array([1]));},{store:{async file(){throw Error('QuotaExceededError');}}});
  await assert.rejects(failing.downloadMedia({add(){assert.fail('must not assemble unsaved media');}},{messages:[{attachments:[attachment,{...attachment,url:'https://i.oneme.ru/other.jpg'}]}]},'001-chat',{skippedMedia:[]},0,()=>{},'checkpoint'),/QuotaExceededError/);
  assert.equal(fetches,1);
});


test('video cover is downloaded into ZIP and linked as a local poster',async()=>{
 const attachment={kind:'video',name:'video',downloadable:true,url:'https://maxvd505.okcdn.ru/video',posterUrl:'https://i.oneme.ru/cover'};
 const files=new Map();const exporter=loadExporter(async url=>new Response(new Uint8Array([1,2]),{headers:{'content-type':url.includes('cover')?'image/jpeg':'video/mp4'}}));
 await exporter.downloadMedia({add:(path,bytes)=>files.set(path,bytes)},{messages:[{attachments:[attachment]}]},'chat',{skippedMedia:[]},0,()=>{});
 assert.equal(files.size,2);assert.match(attachment.posterPath,/\.jpg$/);assert.ok(files.has('chat/'+attachment.posterPath));
});


test('inline voice uses a compact storage key and removes base64 from completed message JSON',async()=>{
 const data='data:audio/ogg;base64,T2dnUw==';let fetched;
 const voice={kind:'voice',url:'inline-voice:one',inlineData:data,name:'Голосовое',downloadable:true};
 const saved=[];const exporter=loadExporter(async url=>{fetched=url;return new Response(new Uint8Array([79,103,103,83]),{headers:{'content-type':'audio/ogg'}});},{store:{async file(id,url,value){saved.push(url);}}});
 await exporter.downloadMedia({add(){}},{messages:[{attachments:[voice]}]},'chat',{skippedMedia:[]},0,()=>{},'checkpoint');
 assert.equal(fetched,data);assert.deepEqual(saved,['inline-voice:one']);assert.equal(voice.inlineData,undefined);assert.match(voice.localPath,/\.ogg$/);
});


test('configured file limit rejects declared and streamed sizes but accepts the exact boundary',async()=>{
 for(const declared of [true,false]) {
  const exporter=loadExporter(async()=>new Response(new Uint8Array([1,2,3,4]),{headers:declared?{'content-length':'4'}:{}}));
  for(const limit of [3,4]) {const report={skippedMedia:[]},files=[];await exporter.downloadMedia({add:(_name,bytes)=>files.push(bytes)}, {messages:[{attachments:[{name:'file',url:'https://st.max.ru/file',downloadable:true}]}]},'chat',report,0,()=>{},null,20,limit);assert.equal(files.length,limit===4?1:0);assert.equal(report.skippedMedia.length,limit===4?0:1);}
 }
});
test('folder and combined media honor the remaining shared byte allowance',async()=>{
 const exporter=loadExporter(async()=>new Response(new Uint8Array([1,2,3])));const report={skippedMedia:[]},files=[];
 const total=await exporter.downloadMedia({add:(_name,bytes)=>files.push(bytes)}, {messages:[{attachments:[{name:'file',url:'https://st.max.ru/file',downloadable:true}]}]},'chat',report,4,()=>{},null,6,10);
 assert.equal(total,4);assert.equal(files.length,0);assert.equal(report.skippedMedia.length,1);
});

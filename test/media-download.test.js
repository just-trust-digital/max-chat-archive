const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
    ArchiveFormat: { safeName: name => name }
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

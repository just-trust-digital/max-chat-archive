const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadExporter(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'export.js'), 'utf8');
  const instrumented = source.replace(/\binit\(\);\s*\}\)\(\);\s*$/, 'globalThis.mediaUnderTest = { downloadMedia, readLimited };})();');
  assert.notEqual(instrumented, source);
  const document = {
    getElementById: () => ({ addEventListener() {} }),
    querySelectorAll: () => []
  };
  const context = {
    document, location: { search: '' }, URL, URLSearchParams, Uint8Array,
    AbortController, fetch, setTimeout, clearTimeout,
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
  assert.match(report.skippedMedia[0].reason, /вне доменов MAX/);
});

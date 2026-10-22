const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('export activates MAX before reading and returns to its report after saving', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, checked: false, addEventListener() {}, querySelectorAll: () => [], replaceChildren() {}, append() {}, removeAttribute() {} });
    return nodes.get(id);
  };
  Object.assign(node('limit'), { value: '10000' });
  node('split').value = 'by-chat';
  const events = [];
  let receive;
  const port = {
    onMessage: { addListener(fn) { receive = fn; } }, onDisconnect: { addListener() {} },
    postMessage(message) {
      events.push(message.type);
      queueMicrotask(() => receive({ id: message.id, type: 'result', value: { title: 'Чат', messages: [], complete: true } }));
    }
  };
  const source = fs.readFileSync(require.resolve('../export.js'), 'utf8').replace('  init();', '  globalThis.runTest = () => { connect(); return run(); };');
  const context = {
    document: { getElementById: node, createElement: () => node(Symbol()), querySelector: () => ({ value: 'current' }), querySelectorAll: () => [] },
    location: { search: '?tab=7&mode=advanced' }, URLSearchParams, Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout(fn) { fn(); }, clearTimeout() {},
    chrome: {
      tabs: { connect: () => port, getCurrent: async () => ({ id: 10 }), update: async id => { events.push(`active:${id}`); } },
      storage: { local: { set: async () => {} } }, runtime: { getManifest: () => ({ version: 'test' }) },
      downloads: { download: async () => { events.push('saved'); return 7; } }
    },
    ArchiveFormat: { filter: messages => messages, safeName: value => value, add() {}, addIndex() {} },
    ZipArchive: class { add() {} blob() { return new Blob(['archive']); } }
  };
  vm.runInNewContext(source, context);
  await context.runTest();
  assert.ok(events.indexOf('active:7') >= 0, 'MAX must be activated');
  assert.ok(events.indexOf('active:7') < events.indexOf('export'), 'activate MAX before starting content work');
  assert.ok(events.indexOf('active:10') > events.indexOf('saved'), 'return after saving');
  assert.equal(node('progress-text').textContent, 'Экспорт завершён');
});

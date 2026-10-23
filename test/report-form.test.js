const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function setup({ offline = false } = {}) {
  const nodes = new Map(), events = [], records = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, dataset: {}, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return nodes.get(id);
  };
  const store = {
    async get(id) { return records.get(id) || null; },
    async create(kind) { const item = { report_id: 'stable-id', kind, state: 'draft', attempts: 0, release: '0.3.13' }; records.set(item.report_id, item); return item; },
    async update(id, values) { Object.assign(records.get(id), values); return records.get(id); },
    payload(item) { return { ...item, report_kind: item.kind }; },
    async remove(id) { records.delete(id); events.push('removed'); },
    async send(id) {
      const item = records.get(id); item.attempts++; events.push('send');
      if (offline) { item.state = 'queued'; throw Error('Не удалось отправить; попробуйте позже.'); }
      item.state = 'sent'; return item;
    }
  };
  vm.runInNewContext(fs.readFileSync('report.js', 'utf8'), {
    document: { getElementById: node }, location: { search: '' }, URLSearchParams,
    MaxReportStore: store, history: { length: 1 }, window: { close() { events.push('closed'); } }
  });
  await new Promise(resolve => setImmediate(resolve));
  const submit = () => node('report-form').listeners.submit({ preventDefault() {} });
  return { node, records, events, submit };
}
test('cancel discards an unsent report and never sends it', async () => {
  const app = await setup();
  await app.node('report-cancel').listeners.click();
  assert.equal(app.records.size, 0);
  assert.deepEqual(app.events, ['removed', 'closed']);
});
test('send requires consent; an optional topic still allows feedback', async () => {
  const app = await setup();
  app.node('report-text').value = 'Synthetic feedback';
  await app.submit();
  assert.deepEqual(app.events, []);
  app.node('report-consent').checked = true;
  await app.submit();
  assert.equal(app.records.get('stable-id').kind, 'idea');
  assert.equal(app.records.get('stable-id').text, 'Synthetic feedback');
  assert.match(app.node('report-payload').textContent, /Номер обращения: stable-id/);
  assert.equal(app.node('report-send').disabled, true);
  assert.equal(app.node('report-cancel').textContent, 'Закрыть');
  await app.node('report-cancel').listeners.click();
  assert.equal(app.records.size, 1);
});
test('delivery error permits retry and cancel without a separate save action', async () => {
  const app = await setup({ offline: true });
  app.node('report-text').value = 'Synthetic error';
  app.node('report-consent').checked = true;
  await app.submit();
  assert.equal(app.node('report-send').disabled, false);
  assert.equal(app.node('report-cancel').disabled, false);
  assert.equal(app.node('report-send').textContent, 'Повторить отправку');
  assert.doesNotMatch(app.node('report-status').textContent, /браузер|сохран/i);
  await app.node('report-cancel').listeners.click();
  assert.equal(app.records.size, 0);
});

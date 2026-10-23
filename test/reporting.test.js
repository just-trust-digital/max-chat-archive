const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');

function setup(fetch) {
  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
    async remove(key) { delete values[key]; }
  };
  const chrome = { storage: { local: storage }, tabs: { query: async () => [] }, runtime: { getManifest: () => ({ version: '0.3.13' }), getURL: path => `chrome-extension://test/${path}` } };
  const context = { chrome,
    crypto: webcrypto, fetch, AbortController, setTimeout, clearTimeout, Date, console };
  runInNewContext(readFileSync('reporting.js', 'utf8'), context);
  return { store: context.MaxReportStore, values, chrome };
}

test('expected MAX tab and size errors do not create crash reports', async () => {
  const { store } = setup(async () => { throw Error('unexpected send'); });
  assert.equal(await store.recordSerious({ code: 'MAX_HIDDEN' }), null);
  assert.equal(await store.recordSerious({ code: 'ARCHIVE_LIMIT' }), null);
  assert.equal(await store.recordSerious({ code: 'TAB_DISCONNECTED' }), null);
  assert.equal((await store.list()).length, 0);
  const report = await store.recordSerious({ code: 'UNEXPECTED_RENDER', message: 'private chat name' });
  assert.equal(report.kind, 'crash');
  assert.equal(store.payload(report).error_code, 'UNEXPECTED_RENDER');
  assert.equal(JSON.stringify(store.payload(report)).includes('private chat name'), false);
});

test('delivery retry retains report ID and exact body across restart', async () => {
  const sent = [];
  let fail = true;
  const { store, values } = setup(async (_url, request) => {
    sent.push(JSON.parse(request.body));
    if (fail) { fail = false; throw Error('offline'); }
    return { ok: true, status: 200, json: async () => ({ product: 'maxexport', report_id: sent.at(-1).report_id }) };
  });
  const draft = await store.create('idea');
  await store.update(draft.report_id, { kind: 'idea', text: 'Synthetic suggestion', contact: '' });
  await assert.rejects(store.send(draft.report_id), /Не удалось отправить/);
  const queued = await store.get(draft.report_id);
  assert.equal(queued.attempts, 1);
  assert.equal(queued.state, 'queued');
  assert.equal(queued.report_id, draft.report_id);
  assert.equal(JSON.stringify(values).includes('Synthetic suggestion'), true);
  values.maxArchiveReports[0].next_attempt_at = new Date(Date.now() - 1).toISOString();
  const receipt = await store.send(draft.report_id);
  assert.equal(receipt.state, 'sent');
  assert.equal(receipt.attempts, 2);
  assert.deepEqual(sent[0], sent[1]);
  await store.send(draft.report_id);
  assert.equal(sent.length, 2);
});

test('stale interrupted run creates a local draft only once', async () => {
  const { store, values } = setup(async () => { throw Error('unexpected send'); });
  const id = await store.beginRun();
  values.maxArchiveActiveRun.last_heartbeat = Date.now() - 61000;
  const draft = await store.recoverInterrupted();
  assert.equal(draft.kind, 'crash');
  assert.equal(draft.error_code, 'INTERRUPTED_EXPORT');
  assert.equal(await store.recoverInterrupted(), null);
  assert.equal((await store.list()).length, 1);
  assert.notEqual(id, draft.report_id);
});

test('closed export page is offered immediately while an open page is left running', async () => {
  const { store, chrome } = setup(async () => { throw Error('unexpected send'); });
  await store.beginRun();
  chrome.tabs.query = async () => [{ id: 7 }];
  assert.equal(await store.recoverInterrupted(), null);
  chrome.tabs.query = async () => [];
  const draft = await store.recoverInterrupted();
  assert.equal(draft.error_code, 'INTERRUPTED_EXPORT');
});

test('local queue stays within 20 reports', async () => {
  const { store } = setup(async () => { throw Error('unexpected send'); });
  const first = await store.create('problem');
  for (let i = 0; i < 20; i++) await store.create('idea');
  const items = await store.list();
  assert.equal(items.length, 20);
  assert.equal(items.some(item => item.report_id === first.report_id), false);
});

test('HTTP-date Retry-After delays a stable queued report', async () => {
  const future = new Date(Date.now() + 180000).toUTCString();
  const { store } = setup(async () => ({ ok: false, status: 429, headers: { get: () => future } }));
  const draft = await store.create('problem');
  await store.update(draft.report_id, { text: 'Synthetic rate limit', contact: '', kind: 'problem' });
  await assert.rejects(store.send(draft.report_id), /попробуйте позже/);
  const queued = await store.get(draft.report_id);
  assert.equal(queued.report_id, draft.report_id);
  assert.equal(queued.attempts, 1);
  assert.ok(Date.parse(queued.next_attempt_at) >= Date.now() + 120000);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const updates = require('../updates.js');
const repository = 'https://github.com/just-trust-digital/max-chat-archive';
function release(version, extra = {}) {
  return { tag_name: `v${version}`, assets: [{ name: `max-archive-${version}-test.zip`, state: 'uploaded', browser_download_url: `${repository}/releases/download/v${version}/max-archive-${version}-test.zip` }], ...extra };
}
test('update selection compares numeric versions and ignores older/equal or malformed tags', () => {
  assert.equal(updates.select([release('0.3.9'), release('0.3.12'), release('0.3.14-beta')], '0.3.12'), null);
  assert.equal(updates.select([release('0.3.13'), release('0.3.20'), release('0.3.14')], '0.3.12').version, '0.3.20');
  assert.equal(updates.compare('1.2.3', '1.2.3.0'), 0);
});
test('only uploaded ZIP assets from this repository are accepted, including test releases', () => {
  assert.equal(updates.select([release('0.3.13', { draft: true }), release('0.3.14', { assets: [] })], '0.3.12'), null);
  const bad = release('0.3.13'); bad.assets[0].browser_download_url = 'https://evil.example/update.zip';
  assert.equal(updates.select([bad], '0.3.12'), null);
  assert.equal(updates.select([release('0.3.13', { prerelease: true })], '0.3.12').version, '0.3.13');
});
test('download stays in the fixed Downloads subfolder and never overwrites installed files', async () => {
  let received;
  global.chrome = { downloads: { download: async options => { received = options; return 7; } } };
  const selected = updates.select([release('0.3.13')], '0.3.12');
  assert.equal(await updates.download(selected), 7);
  assert.equal(received.filename, 'MAX-Archive-updates/max-archive-0.3.13-test.zip');
  assert.equal(received.conflictAction, 'uniquify');
  assert.equal(received.saveAs, false);
  await assert.rejects(updates.download({ ...selected, url: 'https://evil.example/file' }), /Некорректный/);
  global.chrome.downloads.download = async () => undefined;
  await assert.rejects(updates.download(selected), /не подтвердил/);
  delete global.chrome;
});
test('GitHub check sends no credentials and handles offline/rate limit responses', async () => {
  const originalFetch = global.fetch;
  global.chrome = { runtime: { getManifest: () => ({ version: '0.3.12' }) } };
  try {
    global.fetch = async (url, options) => {
      assert.match(url, /^https:\/\/api.github.com\/repos\/just-trust-digital\/max-chat-archive\/releases\?/);
      assert.equal(options.credentials, 'omit');
      assert.ok(options.signal);
      return { ok: true, json: async () => [release('0.3.13')] };
    };
    assert.equal((await updates.check()).version, '0.3.13');
    global.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(updates.check(), /GitHub/);
    global.fetch = async () => { throw Error('offline'); };
    await assert.rejects(updates.check(), /offline/);
  } finally { global.fetch = originalFetch; delete global.chrome; }
});

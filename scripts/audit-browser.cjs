// Optional integration audit. Requires Playwright and a separate Chromium executable.
// Uses synthetic data in a fresh profile; no MAX account or live reporting endpoint.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(process.env.MAX_AUDIT_EXTENSION || path.join(__dirname, '..'));
  const out = path.resolve('output/security-audit');
  fs.mkdirSync(out, {recursive: true});
  const profile = fs.mkdtempSync(path.join(out, 'browser-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.MAX_AUDIT_BROWSER ? {executablePath: process.env.MAX_AUDIT_BROWSER} : {channel: 'chromium'}),
    headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    const requests = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = request.url();
      requests.push({url, method: request.method()});
      if (url.startsWith('chrome-extension://')) return route.continue();
      if (url === 'https://st.max.ru/audit-redirect') {
        return route.fulfill({status: 302, headers: {location: 'http://127.0.0.1:9/audit-must-not-follow'}});
      }
      if (url === 'https://st.max.ru/audit-media') {
        return route.fulfill({status: 200, contentType: 'application/pdf', body: Buffer.from([1, 2, 3, 4])});
      }
      if (url.startsWith('https://web.max.ru/')) {
        return route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic MAX</title><p>No account or real messages.</p>'});
      }
      // Block every other initial request. Redirects must be rejected by production code.
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 15000});
    const id = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.set({auditSyntheticContact: 'synthetic@example.invalid'}));
    const page = await context.newPage(), cdp = await context.newCDPSession(page), worlds = [];
    cdp.on('Runtime.executionContextCreated', ({context: world}) => worlds.push(world));
    await cdp.send('Runtime.enable');
    await page.goto('https://web.max.ru/', {waitUntil: 'load'});
    // Wait for the registered content script's isolated world, not a world invented by this test.
    const isContentWorld = world => world.name === id || world.origin === `chrome-extension://${id}`;
    for (let tries = 0; tries < 50 && !worlds.some(isContentWorld); tries++) await page.waitForTimeout(100);
    const isolated = worlds.find(isContentWorld);
    assert.ok(isolated, 'registered content script world missing');
    const storage = await cdp.send('Runtime.evaluate', {
      contextId: isolated.id, awaitPromise: true, returnByValue: true,
      expression: "chrome.storage.local.get('auditSyntheticContact').then(v=>({readable:!!v.auditSyntheticContact})).catch(()=>({readable:false}))"
    });
    assert.equal(storage.result.value.readable, false, 'content script can read private report storage');
    const tabs = await worker.evaluate(async () => ({
      manifest: chrome.runtime.getManifest(), max: (await chrome.tabs.query({url: 'https://web.max.ru/*'})).map(tab => ({id: tab.id, url: tab.url})),
      trustedRead: !!(await chrome.storage.local.get('auditSyntheticContact')).auditSyntheticContact
    }));
    assert.equal(tabs.manifest.incognito, 'not_allowed');
    assert.equal(tabs.manifest.permissions.includes('tabs'), false);
    assert.equal(tabs.max.length, 1);
    assert.equal(tabs.trustedRead, true);
    await worker.evaluate(async tab => {await chrome.tabs.update(tab.id, {active: true});}, tabs.max[0]);
    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${id}/export.html?tab=${tabs.max[0].id}`);
    const ownTabs = await worker.evaluate(() => chrome.tabs.query({url: chrome.runtime.getURL('export.html*')}));
    assert.equal(ownTabs.length, 1, 'own page lookup without tabs permission failed');
    const source = fs.readFileSync(path.join(root, 'export.js'), 'utf8');
    const instrumented = source.replace(/\binit\(\);\s*\}\)\(\);\s*$/, 'globalThis.auditMedia = downloadMedia;})();');
    assert.notEqual(instrumented, source);
    const extCdp = await context.newCDPSession(ext);
    const loaded = await extCdp.send('Runtime.evaluate', {expression: instrumented});
    assert.equal(loaded.exceptionDetails, undefined, 'could not load actual downloadMedia');
    const media = await ext.evaluate(async () => {
      async function run(url) {
        const saved = [], report = {skippedMedia: []};
        const bytes = await globalThis.auditMedia({add(name, data) {saved.push({name, bytes: data.length});}},
          {messages: [{attachments: [{url, name: 'synthetic.pdf', downloadable: true}]}]}, 'chat', report, 0, () => {});
        return {bytes, saved, skipped: report.skippedMedia.length, reasons: report.skippedMedia.map(item => item.reason)};
      }
      return {redirect: await run('https://st.max.ru/audit-redirect'), direct: await run('https://st.max.ru/audit-media')};
    });
    console.log(JSON.stringify({media}));
    assert.equal(media.redirect.bytes, 0);
    assert.equal(media.redirect.saved.length, 0);
    assert.equal(media.redirect.skipped, 1);
    assert.equal(media.direct.bytes, 4);
    assert.equal(media.direct.skipped, 0);
    assert.equal(requests.some(request => request.url.includes('audit-must-not-follow')), false);
    const checkpoint = await ext.evaluate(async () => {
      const id = 'audit-synthetic-copy';
      await CheckpointStore.put({id, chat: {title: 'Synthetic', messages: []}, state: 'complete'});
      await CheckpointStore.file(id, 'https://st.max.ru/audit-media', {localPath: 'media/test.pdf', bytes: new Uint8Array([1,2,3,4])});
      const before = {chats: (await CheckpointStore.list()).length, files: (await CheckpointStore.files(id)).length};
      await CheckpointStore.remove(id);
      return {before, after: {chats: (await CheckpointStore.list()).length, files: (await CheckpointStore.files(id)).length}};
    });
    assert.deepEqual(checkpoint, {before: {chats: 1, files: 1}, after: {chats: 0, files: 0}});
    const report = {browser: context.browser().version(), manifestVersion: tabs.manifest.version,
      storageDeniedToContent: true, trustedStorageReadable: true, tabsPermissionRemoved: true,
      tabLookupAndActivation: true, incognito: tabs.manifest.incognito, media, checkpoint, requests};
    fs.writeFileSync(path.join(out, 'browser-after.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({...report, requests: report.requests.filter(r => r.url.startsWith('https:'))}, null, 2));
  } finally {
    await context.close();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});

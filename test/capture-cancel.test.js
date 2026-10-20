const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('stop interrupts a pending file address capture and clears its timers', async () => {
  let connect, receive, nextTimer = 0, clicks = 0, disarmed = 0;
  const listeners = new Set(), timers = new Map();
  const window = {
    addEventListener(type, fn) { listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    postMessage(data) {
      if (data.type === 'cancel') disarmed++;
      if (data.type === 'arm') for (const fn of listeners) fn({ source: window, origin: 'https://web.max.ru', data: { ...data, type: 'ready' } });
    }
  };
  const source = fs.readFileSync(require.resolve('../content.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.capture = captureButton; globalThis.own = port => { activeOperation = {port}; };})();');
  const context = {
    window, location: { origin: 'https://web.max.ru' }, crypto: { randomUUID: () => 'nonce' },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { onConnect: { addListener(fn) { connect = fn; } } } }
  };
  vm.runInNewContext(source, context);
  const port = { name: 'max-export', onMessage: { addListener(fn) { receive = fn; } } };
  connect(port); context.own(port);
  const captured = context.capture({ click() { clicks++; } });
  assert.equal(clicks, 1);
  assert.equal(timers.size, 2);
  await receive({ type: 'cancel' });
  assert.equal(timers.size, 0, 'stop should clear timers without waiting 15 seconds');
  assert.equal(await captured, null);
  assert.equal(disarmed, 1);
  assert.equal(listeners.size, 0);
});

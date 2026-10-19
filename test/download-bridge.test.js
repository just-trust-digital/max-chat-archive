const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bridge() {
  const listeners = new Set();
  const messages = [];
  const location = { origin: 'https://web.max.ru' };
  const window = {
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
    postMessage(data) {
      messages.push(data);
      for (const listener of listeners) listener({ source: window, origin: location.origin, data });
    }
  };
  let ordinaryClicks = 0;
  class HTMLAnchorElement {
    constructor(href, name = '') { this.href = href; this.download = name; }
    hasAttribute(name) { return name === 'download' && Boolean(this.download); }
    click() { ordinaryClicks++; }
  }
  const originalClick = HTMLAnchorElement.prototype.click;
  const source = fs.readFileSync(path.join(__dirname, '..', 'download-bridge.js'), 'utf8');
  vm.runInNewContext(source, { window, location, HTMLAnchorElement, setTimeout, clearTimeout });
  return { window, messages, HTMLAnchorElement, originalClick, ordinaryClicks: () => ordinaryClicks };
}

test('MAX download bridge captures the file URL and restores normal clicks', () => {
  const state = bridge();
  state.window.postMessage({ marker: 'max-archive-download-capture', type: 'arm', nonce: 'one' });
  assert.equal(state.messages.at(-1).type, 'ready');
  new state.HTMLAnchorElement('https://st.max.ru/file.pdf', 'file.pdf').click();
  assert.deepEqual({ ...state.messages.at(-1) }, {
    marker: 'max-archive-download-capture', type: 'captured', nonce: 'one',
    href: 'https://st.max.ru/file.pdf', name: 'file.pdf'
  });
  assert.equal(state.HTMLAnchorElement.prototype.click, state.originalClick);
  new state.HTMLAnchorElement('https://web.max.ru/').click();
  assert.equal(state.ordinaryClicks(), 1);
});

test('cancel disarms the MAX download bridge', () => {
  const state = bridge();
  state.window.postMessage({ marker: 'max-archive-download-capture', type: 'arm', nonce: 'two' });
  state.window.postMessage({ marker: 'max-archive-download-capture', type: 'cancel', nonce: 'two' });
  assert.equal(state.HTMLAnchorElement.prototype.click, state.originalClick);
});

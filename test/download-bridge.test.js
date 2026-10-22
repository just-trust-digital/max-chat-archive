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
  let played=0;
  class HTMLMediaElement {constructor(url){this.src=url;}getAttribute(){return this.src;}play(){played++;return Promise.resolve();}}
  const originalPlay=HTMLMediaElement.prototype.play;
  const originalClick = HTMLAnchorElement.prototype.click;
  const source = fs.readFileSync(path.join(__dirname, '..', 'download-bridge.js'), 'utf8');
  vm.runInNewContext(source, { window, location, HTMLAnchorElement, HTMLMediaElement, setTimeout, clearTimeout, Uint8Array, btoa:value=>Buffer.from(value,'binary').toString('base64'),fetch:async()=>({arrayBuffer:async()=>new Uint8Array([79,103,103,83]).buffer,headers:{get:()=> 'audio/ogg'}}) });
  return { window, messages, HTMLAnchorElement, HTMLMediaElement, originalPlay, played:()=>played, originalClick, ordinaryClicks: () => ordinaryClicks };
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


test('voice source is captured without playing private audio and the play hook is restored', async()=>{
 const state=bridge();
 state.window.postMessage({marker:'max-archive-download-capture',type:'arm',nonce:'voice',mode:'voice'});
 await new state.HTMLMediaElement('https://fd.oneme.ru/voice.ogg').play();
 assert.equal(state.messages.at(-1).href,'https://fd.oneme.ru/voice.ogg');
 assert.equal(state.played(),0);
 assert.equal(state.HTMLMediaElement.prototype.play,state.originalPlay);
 await new state.HTMLMediaElement('https://fd.oneme.ru/ordinary.ogg').play();assert.equal(state.played(),1);
});


test('temporary voice blob is captured as bounded inline audio data',async()=>{
 const state=bridge();state.window.postMessage({marker:'max-archive-download-capture',type:'arm',nonce:'blob',mode:'voice'});
 await new state.HTMLMediaElement('blob:https://web.max.ru/synthetic').play();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(state.messages.at(-1).href,'data:audio/ogg;base64,T2dnUw==');assert.equal(state.played(),0);assert.equal(state.HTMLMediaElement.prototype.play,state.originalPlay);
});


test('voice blob respects the configured byte limit without playback',async()=>{
 const state=bridge();state.window.postMessage({marker:'max-archive-download-capture',type:'arm',nonce:'small',mode:'voice',maxBytes:3});await new state.HTMLMediaElement('blob:https://web.max.ru/synthetic').play();await new Promise(resolve=>setImmediate(resolve));assert.equal(state.messages.at(-1).href,'');assert.equal(state.played(),0);
});
